import path from 'path';
import { readFileSync } from 'fs';
import {
    readAgentRecoveryIntervalMs,
    readAgentStateBackend,
    readAgentSqlitePath,
    type AgentStateBackend
} from './agent-api-contracts';
import { PostgresAgentStateStore } from './agent-state-postgres';
import { SqliteAgentStateStore } from './agent-state-sqlite';
import type { AgentStateStore } from './agent-state-store';

type CachedStore = {
    backend: AgentStateBackend;
    key: string;
    store: AgentStateStore;
    initPromise: Promise<void>;
    lastRecoveryAtMs?: number;
    recoveryPromise?: Promise<number>;
};

let cachedStore: CachedStore | undefined;
let storeFactoryForTests: ((backend: AgentStateBackend, key: string, env: Record<string, string | undefined>) => AgentStateStore) | undefined;

function cacheAgentStateStore(backend: AgentStateBackend, key: string, store: AgentStateStore): AgentStateStore {
    const initPromise = store.init().catch((error) => {
        if (cachedStore?.store === store && cachedStore.initPromise === initPromise) {
            cachedStore = undefined;
        }
        throw error;
    });
    cachedStore = { backend, key, store, initPromise };
    return store;
}

function readEnvValue(env: Record<string, string | undefined>, fieldName: string): string | undefined {
    const value = env[fieldName]?.trim();
    return value ? value : undefined;
}

function readEnvSecret(env: Record<string, string | undefined>, fieldName: string, fileFieldName: string): string | undefined {
    const directValue = readEnvValue(env, fieldName);
    if (directValue) return directValue;
    const filePath = readEnvValue(env, fileFieldName);
    if (!filePath) return undefined;
    return readFileSync(filePath, 'utf8').trim() || undefined;
}

export function readAgentDatabaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
    const configuredUrl = readEnvValue(env, 'AGENT_DATABASE_URL');
    if (configuredUrl) return configuredUrl;

    const password = readEnvSecret(env, 'AGENT_DB_PASSWORD', 'AGENT_DB_PASSWORD_FILE');
    if (!password) return undefined;

    const host = readEnvValue(env, 'AGENT_DB_HOST') || 'localhost';
    const port = readEnvValue(env, 'AGENT_DB_PORT') || '5432';
    const database = readEnvValue(env, 'AGENT_DB_NAME') || 'gpt_image_playground';
    const user = readEnvValue(env, 'AGENT_DB_USER') || 'gpt_image';
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

export function resetAgentStateStoreForTests(): void {
    cachedStore = undefined;
}

export function setAgentStateStoreFactoryForTests(
    factory: ((backend: AgentStateBackend, key: string, env: Record<string, string | undefined>) => AgentStateStore) | undefined
): void {
    storeFactoryForTests = factory;
}

export function getAgentStateStore(env: Record<string, string | undefined> = process.env): AgentStateStore {
    const backend = readAgentStateBackend(env);
    const databaseUrl = backend === 'postgres' ? readAgentDatabaseUrl(env) : undefined;
    const key =
        backend === 'postgres'
            ? databaseUrl || ''
            : path.resolve(/* turbopackIgnore: true */ process.cwd(), readAgentSqlitePath(env));
    if (cachedStore && cachedStore.backend === backend && cachedStore.key === key) {
        return cachedStore.store;
    }
    if (storeFactoryForTests) {
        return cacheAgentStateStore(backend, key, storeFactoryForTests(backend, key, env));
    }
    if (backend === 'postgres') {
        if (!databaseUrl) {
            throw new Error('AGENT_STATE_BACKEND=postgres 时必须设置 AGENT_DATABASE_URL 或 AGENT_DB_PASSWORD。');
        }
        return cacheAgentStateStore(backend, key, new PostgresAgentStateStore(databaseUrl));
    }
    return cacheAgentStateStore(backend, key, new SqliteAgentStateStore(key));
}

export async function ensureAgentStateStoreReady(
    env: Record<string, string | undefined> = process.env,
    now = new Date()
): Promise<AgentStateStore> {
    const store = getAgentStateStore(env);
    await cachedStore?.initPromise;
    await recoverAgentStateIfDue(store, env, now);
    return store;
}

export async function recoverAgentStateOnStartup(env: Record<string, string | undefined> = process.env): Promise<number> {
    const store = getAgentStateStore(env);
    await cachedStore?.initPromise;
    const recovered = await store.recoverExpiredRequests();
    await store.purgeExpiredRequests();
    if (cachedStore) {
        cachedStore.lastRecoveryAtMs = Date.now();
    }
    return recovered;
}

async function recoverAgentStateIfDue(store: AgentStateStore, env: Record<string, string | undefined>, now: Date): Promise<void> {
    if (!cachedStore) return;
    const nowMs = now.getTime();
    const intervalMs = readAgentRecoveryIntervalMs(env);
    if (cachedStore.recoveryPromise) {
        await cachedStore.recoveryPromise;
        return;
    }
    if (cachedStore.lastRecoveryAtMs !== undefined && nowMs - cachedStore.lastRecoveryAtMs < intervalMs) {
        return;
    }
    cachedStore.recoveryPromise = (async () => {
        try {
            await store.recoverExpiredRequests(now);
            await store.purgeExpiredRequests(now);
            if (cachedStore) {
                cachedStore.lastRecoveryAtMs = nowMs;
            }
            return 0;
        } finally {
            if (cachedStore) {
                cachedStore.recoveryPromise = undefined;
            }
        }
    })();
    await cachedStore.recoveryPromise;
}
