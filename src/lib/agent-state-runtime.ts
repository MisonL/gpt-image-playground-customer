import {
    readAgentRecoveryIntervalMs,
    readAgentStateBackend,
    readAgentSqlitePath,
    type AgentStateBackend
} from './agent-api-contracts';
import { MemoryAgentStateStore } from './agent-state-memory';
import { PostgresAgentStateStore } from './agent-state-postgres';
import { SqliteAgentStateStore } from './agent-state-sqlite';
import type { AgentStateStore } from './agent-state-store';
import { purgeExpiredImageSharesForStore } from './share-store';
import { readFileSync } from 'fs';
import path from 'path';

type CachedStore = {
    backend: AgentStateBackend;
    key: string;
    store: AgentStateStore;
    initPromise: Promise<void>;
    closePromise?: Promise<void>;
    disposePromise?: Promise<void>;
    disposing?: boolean;
    lastRecoveryAtMs?: number;
    recoveryPromise?: Promise<number>;
    startupRecoveryPromise?: Promise<number>;
};

let cachedStore: CachedStore | undefined;
let storeFactoryForTests:
    ((backend: AgentStateBackend, key: string, env: Record<string, string | undefined>) => AgentStateStore) | undefined;

function cacheAgentStateStore(backend: AgentStateBackend, key: string, store: AgentStateStore): CachedStore {
    const cached: CachedStore = { backend, key, store, initPromise: Promise.resolve() };
    cachedStore = cached;
    cached.initPromise = startStoreInitialization(store).catch(async (error) => {
        if (cachedStore === cached) cachedStore = undefined;
        try {
            await closeCachedStore(cached);
        } catch (closeError) {
            throw new AggregateError([error, closeError], 'Agent state store initialization and cleanup failed.');
        }
        throw error;
    });
    return cached;
}

function startStoreInitialization(store: AgentStateStore): Promise<void> {
    try {
        return Promise.resolve(store.init());
    } catch (error) {
        return Promise.reject(error);
    }
}

function closeCachedStore(cached: CachedStore): Promise<void> {
    if (!cached.closePromise) {
        cached.closePromise = Promise.resolve().then(async () => {
            await cached.store.close?.();
        });
    }
    return cached.closePromise;
}

async function disposeCachedStore(cached: CachedStore): Promise<void> {
    if (!cached.disposePromise) {
        cached.disposing = true;
        cached.disposePromise = (async () => {
            try {
                await cached.initPromise;
            } catch {
                // Initialization failure already attempts cleanup before rejecting.
            }
            try {
                await cached.recoveryPromise;
            } catch {
                // Recovery errors are owned by the request that started recovery.
            }
            try {
                await cached.startupRecoveryPromise;
            } catch {
                // Startup recovery errors are owned by server startup.
            }
            await closeCachedStore(cached);
        })();
    }
    await cached.disposePromise;
}

function readEnvValue(env: Record<string, string | undefined>, fieldName: string): string | undefined {
    const value = env[fieldName]?.trim();
    return value ? value : undefined;
}

function readEnvSecret(
    env: Record<string, string | undefined>,
    fieldName: string,
    fileFieldName: string
): string | undefined {
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

export async function resetAgentStateStoreForTests(): Promise<void> {
    const cached = cachedStore;
    cachedStore = undefined;
    if (cached) await disposeCachedStore(cached);
}

export function setAgentStateStoreFactoryForTests(
    factory:
        | ((backend: AgentStateBackend, key: string, env: Record<string, string | undefined>) => AgentStateStore)
        | undefined
): void {
    storeFactoryForTests = factory;
}

function getCachedAgentStateStore(env: Record<string, string | undefined> = process.env): CachedStore {
    const backend = readAgentStateBackend(env);
    const databaseUrl = backend === 'postgres' ? readAgentDatabaseUrl(env) : undefined;
    const key =
        backend === 'postgres'
            ? databaseUrl || ''
            : backend === 'memory'
              ? 'memory'
              : path.resolve(/* turbopackIgnore: true */ process.cwd(), readAgentSqlitePath(env));
    if (cachedStore) {
        if (cachedStore.backend === backend && cachedStore.key === key) return cachedStore;
        throw new Error(
            'Agent state store configuration cannot change after initialization. Restart the process first.'
        );
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
    if (backend === 'memory') {
        return cacheAgentStateStore(backend, key, new MemoryAgentStateStore());
    }
    return cacheAgentStateStore(backend, key, new SqliteAgentStateStore(key));
}

export function getAgentStateStore(env: Record<string, string | undefined> = process.env): AgentStateStore {
    return getCachedAgentStateStore(env).store;
}

export async function ensureAgentStateStoreReady(
    env: Record<string, string | undefined> = process.env,
    now = new Date()
): Promise<AgentStateStore> {
    const cached = getCachedAgentStateStore(env);
    await cached.initPromise;
    await recoverAgentStateIfDue(cached, env, now);
    return cached.store;
}

export async function recoverAgentStateOnStartup(
    env: Record<string, string | undefined> = process.env
): Promise<number> {
    const cached = getCachedAgentStateStore(env);
    if (!cached.startupRecoveryPromise) {
        cached.startupRecoveryPromise = (async () => {
            await cached.initPromise;
            if (cached.disposing) throw new Error('Agent state store is closing.');
            const recovered = await cached.store.recoverExpiredRequests();
            await cached.store.purgeExpiredRequests();
            await purgeExpiredImageSharesForStore(cached.store, new Date(), { purgeOrphanFiles: false });
            cached.lastRecoveryAtMs = Date.now();
            return recovered;
        })();
    }
    const recoveryPromise = cached.startupRecoveryPromise;
    try {
        return await recoveryPromise;
    } finally {
        if (cached.startupRecoveryPromise === recoveryPromise) cached.startupRecoveryPromise = undefined;
    }
}

async function recoverAgentStateIfDue(
    cached: CachedStore,
    env: Record<string, string | undefined>,
    now: Date
): Promise<void> {
    if (cached.disposing) {
        throw new Error('Agent state store is closing.');
    }
    const nowMs = now.getTime();
    const intervalMs = readAgentRecoveryIntervalMs(env);
    if (cached.recoveryPromise) {
        await cached.recoveryPromise;
        return;
    }
    if (cached.lastRecoveryAtMs !== undefined && nowMs - cached.lastRecoveryAtMs < intervalMs) {
        return;
    }
    cached.recoveryPromise = (async () => {
        try {
            await cached.store.recoverExpiredRequests(now);
            await cached.store.purgeExpiredRequests(now);
            await purgeExpiredImageSharesForStore(cached.store, now, { purgeOrphanFiles: false });
            cached.lastRecoveryAtMs = nowMs;
            return 0;
        } finally {
            cached.recoveryPromise = undefined;
        }
    })();
    await cached.recoveryPromise;
}
