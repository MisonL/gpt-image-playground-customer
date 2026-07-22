import { runAgentStateStartupRecovery, runServerStartup } from '../instrumentation';
import { MemoryAgentStateStore } from './agent-state-memory';
import {
    ensureAgentStateStoreReady,
    getAgentStateStore,
    readAgentDatabaseUrl,
    recoverAgentStateOnStartup,
    resetAgentStateStoreForTests,
    setAgentStateStoreFactoryForTests
} from './agent-state-runtime';
import type { AgentStateStore } from './agent-state-store';
import type { ImageShareStateStore } from './share-store';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

afterEach(() => {
    setAgentStateStoreFactoryForTests(undefined);
    resetAgentStateStoreForTests();
});

describe('agent-state-runtime recovery scheduling', () => {
    it('creates a memory store for ephemeral deployments', () => {
        const store = getAgentStateStore({ AGENT_STATE_BACKEND: 'memory' });

        assert.ok(store instanceof MemoryAgentStateStore);
    });

    it('throttles request-time recovery checks by interval', async () => {
        const store = createFakeStore();
        setAgentStateStoreFactoryForTests(() => store);
        const env = {
            AGENT_STATE_BACKEND: 'sqlite',
            AGENT_SQLITE_PATH: 'agent.sqlite',
            AGENT_RECOVERY_INTERVAL_MS: '1000'
        };

        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.000Z'));
        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.500Z'));
        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:01.001Z'));

        assert.equal(store.recoveryCalls, 2);
    });

    it('runs share cleanup with the request-time recovery cycle', async () => {
        const store = createFakeStore();
        setAgentStateStoreFactoryForTests(() => store);
        const env = {
            AGENT_STATE_BACKEND: 'sqlite',
            AGENT_SQLITE_PATH: 'agent.sqlite',
            AGENT_RECOVERY_INTERVAL_MS: '1000'
        };

        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.000Z'));
        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.500Z'));
        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:01.001Z'));

        assert.equal(store.shareCleanupCalls, 2);
    });

    it('always runs explicit startup recovery', async () => {
        const store = createFakeStore();
        setAgentStateStoreFactoryForTests(() => store);

        await recoverAgentStateOnStartup({ AGENT_STATE_BACKEND: 'sqlite', AGENT_SQLITE_PATH: 'agent.sqlite' });
        await recoverAgentStateOnStartup({ AGENT_STATE_BACKEND: 'sqlite', AGENT_SQLITE_PATH: 'agent.sqlite' });

        assert.equal(store.recoveryCalls, 2);
        assert.equal(store.shareCleanupCalls, 2);
    });

    it('allows the next request to retry recovery after a failed recovery attempt', async () => {
        const store = createFakeStore({ failFirstRecovery: true });
        setAgentStateStoreFactoryForTests(() => store);
        const env = {
            AGENT_STATE_BACKEND: 'sqlite',
            AGENT_SQLITE_PATH: 'agent.sqlite',
            AGENT_RECOVERY_INTERVAL_MS: '1000'
        };

        await assert.rejects(
            () => ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.000Z')),
            /recovery failed/
        );
        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.100Z'));

        assert.equal(store.recoveryCalls, 2);
    });

    it('clears a failed store init so the next request can retry after the environment recovers', async () => {
        let shouldFailInit = true;
        const store = createFakeStore({ failInit: () => shouldFailInit });
        setAgentStateStoreFactoryForTests(() => store);
        const env = {
            AGENT_STATE_BACKEND: 'sqlite',
            AGENT_SQLITE_PATH: 'agent.sqlite'
        };

        await assert.rejects(
            () => ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.000Z')),
            /init failed/
        );
        shouldFailInit = false;
        await ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.100Z'));

        assert.equal(store.initCalls, 2);
    });
});

describe('runAgentStateStartupRecovery', () => {
    it('fails startup when agent state recovery fails', async () => {
        const logs: Array<{ level: 'info' | 'error'; message: string }> = [];
        await assert.rejects(
            () =>
                runAgentStateStartupRecovery({
                    recoverAgentStateOnStartup: async () => {
                        throw new Error('startup recovery failed');
                    },
                    appLogger: {
                        info(message) {
                            logs.push({ level: 'info', message });
                        },
                        error(message) {
                            logs.push({ level: 'error', message });
                        }
                    }
                }),
            /startup recovery failed/
        );
        assert.deepEqual(
            logs.map((entry) => entry.level),
            ['info', 'error']
        );
    });

    it('logs startup recovery completion', async () => {
        const logs: Array<{ level: 'info' | 'error'; message: string; context?: unknown }> = [];
        await runAgentStateStartupRecovery({
            recoverAgentStateOnStartup: async () => 3,
            appLogger: {
                info(message, context) {
                    logs.push({ level: 'info', message, context });
                },
                error(message, context) {
                    logs.push({ level: 'error', message, context });
                }
            }
        });

        assert.equal(logs.length, 2);
        assert.equal(logs[0]?.message, '开始执行 Agent 状态启动恢复。');
        assert.equal(logs[1]?.message, 'Agent 状态启动恢复完成。');
    });
});

describe('runServerStartup', () => {
    it('starts WebUI cleanup after Agent state recovery without blocking server startup', async () => {
        const events: string[] = [];
        let cleanupStarted = false;
        let releaseCleanup: (() => void) | undefined;
        const cleanup = new Promise<void>((resolve) => {
            releaseCleanup = resolve;
        });
        let startupSettled = false;
        const startup = runServerStartup({
            recoverAgentStateOnStartup: async () => {
                events.push('agent-recovery');
                return 0;
            },
            startWebuiImageCleanupScheduler: async () => {
                cleanupStarted = true;
                events.push('webui-cleanup-start');
                await cleanup;
            },
            appLogger: {
                info() {},
                error() {}
            }
        });
        void startup.then(() => {
            startupSettled = true;
        });

        try {
            await waitFor(() => cleanupStarted);

            assert.equal(startupSettled, true);
            assert.deepEqual(events, ['agent-recovery', 'webui-cleanup-start']);
        } finally {
            releaseCleanup?.();
            await startup;
        }
    });

    it('logs WebUI cleanup startup failures without rejecting server startup', async () => {
        const logs: Array<{ level: 'info' | 'error'; message: string; context?: unknown }> = [];
        let resolveFailureLogged: (() => void) | undefined;
        const failureLogged = new Promise<void>((resolve) => {
            resolveFailureLogged = resolve;
        });

        await runServerStartup({
            recoverAgentStateOnStartup: async () => 0,
            startWebuiImageCleanupScheduler: async () => {
                throw new Error('cleanup startup failed');
            },
            appLogger: {
                info(message, context) {
                    logs.push({ level: 'info', message, context });
                },
                error(message, context) {
                    logs.push({ level: 'error', message, context });
                    resolveFailureLogged?.();
                }
            }
        });
        await failureLogged;

        assert.equal(logs.at(-1)?.level, 'error');
        assert.equal(logs.at(-1)?.message, 'WebUI 图片自动清理启动失败。');
        assert.ok(logs.at(-1)?.context instanceof Error);
        assert.match((logs.at(-1)?.context as Error).message, /cleanup startup failed/);
    });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) throw new Error('condition not met before timeout');
        await delay(5);
    }
}

describe('readAgentDatabaseUrl', () => {
    const DB_PASSWORD_FIXTURE = ['database', 'password'].join(' ');
    const ENCODED_DB_PASSWORD_FIXTURE = encodeURIComponent(DB_PASSWORD_FIXTURE);
    const EXPLICIT_DATABASE_URL_FIXTURE = `postgres://gpt_image:${ENCODED_DB_PASSWORD_FIXTURE}@postgres:5432/gpt_image_playground`;

    it('prefers an explicit AGENT_DATABASE_URL', () => {
        assert.equal(
            readAgentDatabaseUrl({ AGENT_DATABASE_URL: EXPLICIT_DATABASE_URL_FIXTURE }),
            EXPLICIT_DATABASE_URL_FIXTURE
        );
    });

    it('falls back to split PostgreSQL fields when AGENT_DATABASE_URL is blank', () => {
        assert.equal(
            readAgentDatabaseUrl({
                AGENT_DATABASE_URL: '   ',
                AGENT_DB_HOST: 'postgres',
                AGENT_DB_PORT: '5432',
                AGENT_DB_NAME: 'gpt_image_playground',
                AGENT_DB_USER: 'gpt_image',
                AGENT_DB_PASSWORD: DB_PASSWORD_FIXTURE
            }),
            `postgres://gpt_image:${ENCODED_DB_PASSWORD_FIXTURE}@postgres:5432/gpt_image_playground`
        );
    });

    it('builds a PostgreSQL URL from individual environment fields', () => {
        assert.equal(
            readAgentDatabaseUrl({
                AGENT_DB_HOST: 'postgres',
                AGENT_DB_PORT: '5432',
                AGENT_DB_NAME: 'gpt_image_playground',
                AGENT_DB_USER: 'gpt_image',
                AGENT_DB_PASSWORD: DB_PASSWORD_FIXTURE
            }),
            `postgres://gpt_image:${ENCODED_DB_PASSWORD_FIXTURE}@postgres:5432/gpt_image_playground`
        );
    });

    it('escapes split PostgreSQL user, password, and database fields', () => {
        const databaseName = ['gpt', 'image playground'].join('/');
        const databaseUser = ['gpt', 'image'].join('@');
        const databaseCredential = ['p', 'ss/word:?#'].join('@');
        const url = readAgentDatabaseUrl({
            AGENT_DB_HOST: 'postgres',
            AGENT_DB_PORT: '5432',
            AGENT_DB_NAME: databaseName,
            AGENT_DB_USER: databaseUser,
            AGENT_DB_PASSWORD: databaseCredential
        });

        assert.equal(
            url,
            `postgres://${encodeURIComponent(databaseUser)}:${encodeURIComponent(databaseCredential)}@postgres:5432/${encodeURIComponent(databaseName)}`
        );
    });
});

function createFakeStore(options: { failFirstRecovery?: boolean; failInit?: () => boolean } = {}): AgentStateStore &
    ImageShareStateStore & {
        recoveryCalls: number;
        initCalls: number;
        shareCleanupCalls: number;
    } {
    return {
        initCalls: 0,
        recoveryCalls: 0,
        shareCleanupCalls: 0,
        async init() {
            this.initCalls += 1;
            if (options.failInit?.()) {
                throw new Error('init failed');
            }
        },
        async recoverExpiredRequests() {
            this.recoveryCalls += 1;
            if (options.failFirstRecovery && this.recoveryCalls === 1) {
                throw new Error('recovery failed');
            }
            return 0;
        },
        async purgeExpiredRequests() {
            return 0;
        },
        async beginRequest() {
            throw new Error('not implemented');
        },
        async refreshRequestLease() {
            return false;
        },
        async saveArtifacts() {},
        async completeRequest() {},
        async failRequest() {},
        async getArtifact() {
            return undefined;
        },
        async getRequest() {
            return undefined;
        },
        async getRequestByIdempotencyKey() {
            return undefined;
        },
        async listArtifactsForRequest() {
            return [];
        },
        async listArtifactFilepaths() {
            return [];
        },
        async deleteArtifact() {
            return false;
        },
        async createImageShareRecord() {},
        async readImageShareRecord() {
            return undefined;
        },
        async deleteExpiredImageShareRecords() {
            this.shareCleanupCalls += 1;
            return [];
        },
        async listImageShareRecords() {
            return [];
        }
    };
}
