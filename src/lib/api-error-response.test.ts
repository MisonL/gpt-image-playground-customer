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

    it('maps upstream image input errors to agent-correctable validation errors', () => {
        const error = normalizeAgentError({
            status: 400,
            message: 'The image data you provided does not represent a valid image.'
        });

        assert.equal(error.code, 'validation_error');
        assert.equal(error.status, 422);
        assert.equal(error.retryable, false);
        assert.equal(error.upstreamStatus, 400);
        assert.deepEqual(error.details, {
            fields: {
                image_0: 'The image data you provided does not represent a valid image.'
            }
        });
    });

    it('maps upstream connection errors to retryable unavailable errors', () => {
        const error = normalizeAgentError(
            Object.assign(new Error('Connection error.'), {
                name: 'APIConnectionError'
            })
        );

        assert.equal(error.code, 'upstream_unavailable');
        assert.equal(error.status, 502);
        assert.equal(error.retryable, true);
        assert.equal(error.retryAfterSeconds, 15);
        assert.equal(error.upstreamStatus, undefined);
        assert.equal(error.diagnostics?.transport_error, true);
        assert.equal(error.diagnostics?.channel_cooldown_scope, 'channel');
    });

    it('adds sanitized upstream diagnostics without inventing an HTTP status', () => {
        const error = normalizeAgentError(
            Object.assign(new Error('Connection error.'), {
                name: 'APIConnectionError',
                headers: {
                    'cf-ray': 'abc-SJC',
                    authorization: 'Bearer secret'
                }
            }),
            {
                elapsed_ms: 1234,
                selected_channel_id: 'channel-a',
                upstream_host: 'api.example.test'
            }
        );
        const body = createAgentErrorBody(error, 'request-2');

        assert.equal(body.error.upstream_status, undefined);
        assert.equal(body.error.diagnostics?.elapsed_ms, 1234);
        assert.equal(body.error.diagnostics?.selected_channel_id, 'channel-a');
        assert.equal(body.error.diagnostics?.upstream_host, 'api.example.test');
        assert.equal(body.error.diagnostics?.transport_error, true);
        assert.deepEqual(body.error.diagnostics?.response_headers, { 'cf-ray': 'abc-SJC' });
        assert.equal(JSON.stringify(body).includes('secret'), false);
    });

    it('filters caller-provided diagnostic response headers through the allowlist', () => {
        const error = normalizeAgentError(new Error('diagnostics'), {
            response_headers: {
                'cf-ray': 'abc-SJC',
                authorization: 'Bearer secret',
                'x-api-key': 'secret'
            }
        });
        const body = createAgentErrorBody(error, 'request-3');

        assert.deepEqual(body.error.diagnostics?.response_headers, { 'cf-ray': 'abc-SJC' });
        assert.equal(JSON.stringify(body).includes('secret'), false);
    });

    it('copies upstream status and retry timing into diagnostics', () => {
        const error = normalizeAgentError({
            status: 524,
            message: 'timeout',
            headers: {
                'retry-after': '7',
                server: 'cloudflare'
            }
        });

        assert.equal(error.code, 'upstream_unavailable');
        assert.equal(error.upstreamStatus, 524);
        assert.equal(error.retryAfterSeconds, 7);
        assert.equal(error.diagnostics?.upstream_status, 524);
        assert.equal(error.diagnostics?.retry_after_seconds, 7);
        assert.equal(error.diagnostics?.channel_cooldown_scope, 'channel');
        assert.deepEqual(error.diagnostics?.response_headers, {
            'retry-after': '7',
            server: 'cloudflare'
        });
    });

    it('falls back when upstream retry-after headers are unsafe', () => {
        const error = normalizeAgentError({
            status: 429,
            message: 'rate limit',
            headers: {
                'retry-after': '999999999999999999999'
            }
        });

        assert.equal(error.code, 'upstream_rate_limited');
        assert.equal(error.retryAfterSeconds, 30);
        assert.equal(error.diagnostics?.retry_after_seconds, 30);
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
