import {
    AgentApiError,
    type AgentErrorDiagnostics,
    agentErrorResponse,
    createAgentErrorBody,
    normalizeAgentError,
    toTerminalAgentErrorBody
} from './api-error-response';
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

    it('uses explicit RequestValidationError details without encoding them in the message', () => {
        const error = normalizeAgentError(
            new RequestValidationError('Agent edit 请求包含不支持的字段。', 422, {
                fields: { imageBackend: 'Agent edit 不接受该字段。' }
            })
        );

        assert.equal(error.code, 'validation_error');
        assert.equal(error.message, '请求校验失败。');
        assert.deepEqual(error.details, {
            fields: { imageBackend: 'Agent edit 不接受该字段。' }
        });
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
        assert.equal(error.diagnostics?.transport_error_kind, 'unknown_transport');
        assert.equal(error.diagnostics?.channel_cooldown_scope, 'channel');
    });

    it('classifies transport failures into machine-readable kinds', () => {
        assert.equal(
            normalizeAgentError(Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' })).diagnostics
                ?.transport_error_kind,
            'dns'
        );
        assert.equal(
            normalizeAgentError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })).diagnostics
                ?.transport_error_kind,
            'socket_closed'
        );
        assert.equal(
            normalizeAgentError(Object.assign(new Error('流式图片响应未返回最终图片 b64_json。'), {
                name: 'MissingFinalImageStreamResultError',
                status: 502
            })).diagnostics?.transport_error_kind,
            'sse_final_missing'
        );
    });

    it('adds sanitized upstream diagnostics without inventing an HTTP status', () => {
        const unsafeCooldownTarget = {
            channel_id: ' channel-a ',
            credential_id: ' credential-a ',
            request_mode: 'images-non-stream',
            api_key: 'secret'
        } as unknown as NonNullable<AgentErrorDiagnostics['cooldown_target']>;
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
                upstream_host: 'api.example.test',
                retry_after_ms: 15000,
                cooldown_until: '2026-06-11T00:00:15.000Z',
                cooldown_target: unsafeCooldownTarget
            }
        );
        const body = createAgentErrorBody(error, 'request-2');

        assert.equal(body.error.upstream_status, undefined);
        assert.equal(body.error.diagnostics?.elapsed_ms, 1234);
        assert.equal(body.error.diagnostics?.selected_channel_id, 'channel-a');
        assert.equal(body.error.diagnostics?.upstream_host, 'api.example.test');
        assert.equal(body.error.diagnostics?.transport_error, true);
        assert.equal(body.error.diagnostics?.retry_after_ms, 15000);
        assert.equal(body.error.diagnostics?.cooldown_until, '2026-06-11T00:00:15.000Z');
        assert.deepEqual(body.error.diagnostics?.cooldown_target, {
            channel_id: 'channel-a',
            credential_id: 'credential-a',
            request_mode: 'images-non-stream'
        });
        assert.deepEqual(body.error.diagnostics?.response_headers, { 'cf-ray': 'abc-SJC' });
        assert.equal(JSON.stringify(body).includes('secret'), false);
    });

    it('drops invalid cooldown target diagnostics', () => {
        const error = normalizeAgentError(new Error('diagnostics'), {
            retry_after_ms: 15000,
            cooldown_target: {
                channel_id: 'channel-a',
                request_mode: 'invalid-mode'
            } as unknown as NonNullable<AgentErrorDiagnostics['cooldown_target']>
        });
        const body = createAgentErrorBody(error, 'request-invalid-cooldown-target');

        assert.equal(body.error.diagnostics?.retry_after_ms, 15000);
        assert.deepEqual(body.error.diagnostics?.cooldown_target, { channel_id: 'channel-a' });
    });

    it('drops cooldown targets without a valid channel id', () => {
        const error = normalizeAgentError(new Error('diagnostics'), {
            retry_after_ms: 15000,
            cooldown_target: {
                channel_id: ' ',
                request_mode: 'images-non-stream'
            } as unknown as NonNullable<AgentErrorDiagnostics['cooldown_target']>
        });
        const body = createAgentErrorBody(error, 'request-blank-cooldown-target');

        assert.equal(body.error.diagnostics?.retry_after_ms, 15000);
        assert.equal(body.error.diagnostics?.cooldown_target, undefined);
    });

    it('drops cooldown target diagnostics that are not objects', () => {
        const error = normalizeAgentError(new Error('diagnostics'), {
            retry_after_ms: 15000,
            cooldown_target: 'channel-a' as unknown as NonNullable<AgentErrorDiagnostics['cooldown_target']>
        });
        const body = createAgentErrorBody(error, 'request-string-cooldown-target');

        assert.equal(body.error.diagnostics?.retry_after_ms, 15000);
        assert.equal(body.error.diagnostics?.cooldown_target, undefined);
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

    it('removes retry timing from terminal failed replays', () => {
        const terminal = toTerminalAgentErrorBody({
            error: {
                code: 'upstream_unavailable',
                message: 'Connection error.',
                retryable: true,
                diagnostics: {
                    retry_after_seconds: 15,
                    transport_error: true,
                    channel_cooldown_scope: 'channel'
                },
                request_id: 'request-terminal'
            }
        });

        assert.equal(terminal.error.retryable, false);
        assert.equal(terminal.error.diagnostics?.retry_after_seconds, undefined);
        assert.equal(terminal.error.diagnostics?.transport_error, true);
        assert.equal(terminal.error.diagnostics?.channel_cooldown_scope, 'channel');
    });

    it('removes retry timing from any non-retryable error body', () => {
        const body = createAgentErrorBody(
            new AgentApiError({
                code: 'unexpected_error',
                message: 'terminal',
                status: 500,
                retryable: false,
                diagnostics: {
                    retry_after_seconds: 10,
                    upstream_event_type: 'image_generation.partial_image',
                    partial_image_count: 1
                }
            }),
            'request-non-retryable'
        );

        assert.equal(body.error.retryable, false);
        assert.equal(body.error.diagnostics?.retry_after_seconds, undefined);
        assert.equal(body.error.diagnostics?.upstream_event_type, 'image_generation.partial_image');
        assert.equal(body.error.diagnostics?.partial_image_count, 1);
    });

    it('does not emit Retry-After headers for non-retryable errors', () => {
        const response = agentErrorResponse(
            new AgentApiError({
                code: 'unexpected_error',
                message: 'terminal',
                status: 500,
                retryable: false,
                retryAfterSeconds: 10
            }),
            'request-non-retryable-header'
        );

        assert.equal(response.headers.get('Retry-After'), null);
    });
});
