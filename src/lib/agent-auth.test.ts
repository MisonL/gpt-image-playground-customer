import { assertAgentAuthorized } from './agent-auth';
import { AgentApiError } from './api-error-response';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('assertAgentAuthorized', () => {
    it('accepts the configured bearer token', () => {
        assert.doesNotThrow(() =>
            assertAgentAuthorized(new Headers({ Authorization: 'Bearer secret-token' }), { AGENT_API_TOKEN: 'secret-token' })
        );
    });

    it('rejects bearer tokens with the wrong value', () => {
        assert.throws(
            () => assertAgentAuthorized(new Headers({ Authorization: 'Bearer wrong-token' }), { AGENT_API_TOKEN: 'secret-token' }),
            (error) => error instanceof AgentApiError && error.code === 'unauthorized'
        );
    });

    it('rejects missing bearer tokens without falling back to password auth', () => {
        assert.throws(
            () => assertAgentAuthorized(new Headers(), { AGENT_API_TOKEN: 'secret-token', APP_PASSWORD: 'password' }),
            (error) => error instanceof AgentApiError && error.code === 'unauthorized'
        );
    });
});
