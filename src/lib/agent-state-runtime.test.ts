import {
    ensureAgentStateStoreReady,
    readAgentDatabaseUrl,
    recoverAgentStateOnStartup,
    resetAgentStateStoreForTests,
    setAgentStateStoreFactoryForTests
} from './agent-state-runtime';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { AgentStateStore } from './agent-state-store';
import { runAgentStateStartupRecovery } from '../instrumentation';

afterEach(() => {
    setAgentStateStoreFactoryForTests(undefined);
    resetAgentStateStoreForTests();
});

describe('agent-state-runtime recovery scheduling', () => {
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

    it('always runs explicit startup recovery', async () => {
        const store = createFakeStore();
        setAgentStateStoreFactoryForTests(() => store);

        await recoverAgentStateOnStartup({ AGENT_STATE_BACKEND: 'sqlite', AGENT_SQLITE_PATH: 'agent.sqlite' });
        await recoverAgentStateOnStartup({ AGENT_STATE_BACKEND: 'sqlite', AGENT_SQLITE_PATH: 'agent.sqlite' });

        assert.equal(store.recoveryCalls, 2);
    });

    it('allows the next request to retry recovery after a failed recovery attempt', async () => {
        const store = createFakeStore({ failFirstRecovery: true });
        setAgentStateStoreFactoryForTests(() => store);
        const env = {
            AGENT_STATE_BACKEND: 'sqlite',
            AGENT_SQLITE_PATH: 'agent.sqlite',
            AGENT_RECOVERY_INTERVAL_MS: '1000'
        };

        await assert.rejects(() => ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.000Z')), /recovery failed/);
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

        await assert.rejects(() => ensureAgentStateStoreReady(env, new Date('2026-05-12T00:00:00.000Z')), /init failed/);
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
        assert.deepEqual(logs.map((entry) => entry.level), ['info', 'error']);
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

describe('readAgentDatabaseUrl', () => {
    it('prefers an explicit AGENT_DATABASE_URL', () => {
        assert.equal(
            readAgentDatabaseUrl({ AGENT_DATABASE_URL: 'postgres://gpt_image:password@postgres:5432/gpt_image_playground' }),
            'postgres://gpt_image:password@postgres:5432/gpt_image_playground'
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
                AGENT_DB_PASSWORD: 'database password'
            }),
            'postgres://gpt_image:database%20password@postgres:5432/gpt_image_playground'
        );
    });

    it('builds a PostgreSQL URL from individual environment fields', () => {
        assert.equal(
            readAgentDatabaseUrl({
                AGENT_DB_HOST: 'postgres',
                AGENT_DB_PORT: '5432',
                AGENT_DB_NAME: 'gpt_image_playground',
                AGENT_DB_USER: 'gpt_image',
                AGENT_DB_PASSWORD: 'database password'
            }),
            'postgres://gpt_image:database%20password@postgres:5432/gpt_image_playground'
        );
    });
});

function createFakeStore(
    options: { failFirstRecovery?: boolean; failInit?: () => boolean } = {}
): AgentStateStore & { recoveryCalls: number; initCalls: number } {
    return {
        initCalls: 0,
        recoveryCalls: 0,
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
        async saveArtifacts() {},
        async completeRequest() {},
        async failRequest() {},
        async getArtifact() {
            return undefined;
        },
        async listArtifactsForRequest() {
            return [];
        },
        async deleteArtifact() {
            return false;
        }
    };
}
