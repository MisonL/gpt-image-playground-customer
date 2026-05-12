import { AgentApiError, createAgentErrorBody, normalizeAgentError } from './api-error-response';
import { RequestValidationError } from './image-request-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('normalizeAgentError', () => {
    it('maps field validation errors into structured Agent errors', () => {
        const error = normalizeAgentError(new RequestValidationError(JSON.stringify({ fields: { n: 'bad' } }), 422));

        assert.equal(error.code, 'validation_error');
        assert.equal(error.status, 422);
        assert.equal(error.retryable, false);
        assert.deepEqual(error.details, { fields: { n: 'bad' } });
    });

    it('marks rate limits as retryable with upstream status', () => {
        const error = normalizeAgentError({ status: 429, message: 'rate limit' });

        assert.equal(error.code, 'upstream_rate_limited');
        assert.equal(error.retryable, true);
        assert.equal(error.upstreamStatus, 429);
    });
});

describe('createAgentErrorBody', () => {
    it('keeps stable error shape for agents', () => {
        const body = createAgentErrorBody(
            new AgentApiError({
                code: 'idempotency_conflict',
                message: 'conflict',
                status: 409
            }),
            'request-1'
        );

        assert.deepEqual(body, {
            error: {
                code: 'idempotency_conflict',
                message: 'conflict',
                retryable: false,
                request_id: 'request-1'
            }
        });
    });
});
