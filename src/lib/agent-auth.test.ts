import { assertAgentAuthorized } from './agent-auth';
import { AgentApiError } from './api-error-response';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

    it('trims APP_PASSWORD before verifying password hashes', () => {
        const appPassword = 'customer-password';
        const passwordHash = crypto.createHash('sha256').update(appPassword).digest('hex');
        assert.doesNotThrow(() =>
            assertAgentAuthorized(new Headers({ 'X-App-Password-Hash': passwordHash }), { APP_PASSWORD: ' customer-password ' })
        );
    });
});
