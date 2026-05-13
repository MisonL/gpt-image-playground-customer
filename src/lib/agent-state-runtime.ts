import path from 'path';
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
    const key =
        backend === 'postgres'
            ? env.AGENT_DATABASE_URL || ''
            : path.resolve(/* turbopackIgnore: true */ process.cwd(), readAgentSqlitePath(env));
    if (cachedStore && cachedStore.backend === backend && cachedStore.key === key) {
        return cachedStore.store;
    }
    if (storeFactoryForTests) {
        const store = storeFactoryForTests(backend, key, env);
        cachedStore = { backend, key, store, initPromise: store.init() };
        return store;
    }
    if (backend === 'postgres') {
        if (!env.AGENT_DATABASE_URL) {
            throw new Error('AGENT_STATE_BACKEND=postgres 时必须设置 AGENT_DATABASE_URL。');
        }
        const store = new PostgresAgentStateStore(env.AGENT_DATABASE_URL);
        cachedStore = { backend, key, store, initPromise: store.init() };
        return store;
    }
    const store = new SqliteAgentStateStore(key);
    cachedStore = { backend, key, store, initPromise: store.init() };
    return store;
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
