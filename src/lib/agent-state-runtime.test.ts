import {
    ensureAgentStateStoreReady,
    recoverAgentStateOnStartup,
    resetAgentStateStoreForTests,
    setAgentStateStoreFactoryForTests
} from './agent-state-runtime';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { AgentStateStore } from './agent-state-store';

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
});

function createFakeStore(options: { failFirstRecovery?: boolean } = {}): AgentStateStore & { recoveryCalls: number } {
    return {
        recoveryCalls: 0,
        async init() {},
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
