import { ChannelCapacityQueueError } from './channel-capacity-queue';
import {
    CHANNEL_REQUEST_MODES,
    type ChannelRequestMode,
    type ChannelRequestModeDecision
} from './channel-request-mode';
import { isChannelFailure, isChannelRequestModeFailure } from './channel-router';
import { RequestValidationError } from './image-request-utils';
import { NextResponse } from 'next/server';

export type AgentErrorCode =
    | 'validation_error'
    | 'unauthorized'
    | 'configuration_error'
    | 'idempotency_key_required'
    | 'idempotency_conflict'
    | 'request_in_progress'
    | 'artifact_not_found'
    | 'job_not_found'
    | 'job_expired'
    | 'upstream_rate_limited'
    | 'upstream_quota_exhausted'
    | 'channel_unavailable'
    | 'image_dimension_mismatch'
    | 'upstream_auth_failed'
    | 'upstream_unavailable'
    | 'unexpected_error';

export type AgentErrorDiagnostics = {
    elapsed_ms?: number;
    channel_request_mode?: ChannelRequestMode;
    channel_request_mode_fallback_applied?: boolean;
    route_decision?: ChannelRequestModeDecision;
    selected_channel_id?: string;
    upstream_host?: string;
    upstream_status?: number;
    upstream_event_type?: string;
    partial_image_count?: number;
    transport_error?: boolean;
    transport_error_kind?: AgentTransportErrorKind;
    retry_after_seconds?: number;
    retry_after_ms?: number;
    cooldown_until?: string;
    cooldown_target?: {
        channel_id: string;
        credential_id?: string;
        request_mode?: ChannelRequestMode;
    };
    channel_cooldown_scope?: 'credential' | 'channel';
    response_headers?: Record<string, string>;
};

export type AgentTransportErrorKind =
    | 'dns'
    | 'tls'
    | 'connect_timeout'
    | 'connection_refused'
    | 'socket_closed'
    | 'upstream_timeout'
    | 'sse_final_missing'
    | 'fetch_failed'
    | 'unknown_transport';

export type AgentErrorBody = {
    error: {
        code: AgentErrorCode;
        message: string;
        retryable: boolean;
        retry_after_seconds?: number;
        details?: Record<string, unknown>;
        upstream_status?: number;
        diagnostics?: AgentErrorDiagnostics;
        request_id: string;
    };
};

export function statusForAgentErrorCode(code: AgentErrorCode, upstreamStatus?: number): number {
    if (code === 'validation_error') return 422;
    if (code === 'unauthorized') return 401;
    if (code === 'idempotency_key_required') return 400;
    if (code === 'idempotency_conflict' || code === 'request_in_progress') return 409;
    if (code === 'artifact_not_found') return 404;
    if (code === 'job_not_found') return 404;
    if (code === 'job_expired') return 410;
    if (code === 'upstream_rate_limited') return 429;
    if (code === 'upstream_quota_exhausted') return 403;
    if (code === 'channel_unavailable') return 503;
    if (code === 'image_dimension_mismatch') return 502;
    if (code === 'upstream_auth_failed') return upstreamStatus === 403 ? 403 : 401;
    if (code === 'upstream_unavailable') return 502;
    return 500;
}

export class AgentApiError extends Error {
    readonly code: AgentErrorCode;
    readonly status: number;
    readonly retryable: boolean;
    readonly details?: Record<string, unknown>;
    readonly upstreamStatus?: number;
    readonly retryAfterSeconds?: number;
    readonly diagnostics?: AgentErrorDiagnostics;

    constructor(options: {
        code: AgentErrorCode;
        message: string;
        status: number;
        retryable?: boolean;
        details?: Record<string, unknown>;
        upstreamStatus?: number;
        retryAfterSeconds?: number;
        diagnostics?: AgentErrorDiagnostics;
    }) {
        super(options.message);
        this.name = 'AgentApiError';
        this.code = options.code;
        this.status = options.status;
        this.retryable = options.retryable ?? false;
        this.details = options.details;
        this.upstreamStatus = options.upstreamStatus;
        this.retryAfterSeconds = options.retryAfterSeconds;
        this.diagnostics = cleanDiagnostics(options.diagnostics);
    }
}

type ErrorDiagnosticsInput = AgentErrorDiagnostics & {
    upstreamStatus?: number;
    retryAfterSeconds?: number;
};

const DIAGNOSTIC_HEADER_ALLOWLIST = new Set([
    'content-type',
    'date',
    'retry-after',
    'server',
    'cf-ray',
    'x-request-id',
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset-tokens'
]);
const MAX_UPSTREAM_RETRY_AFTER_SECONDS = 3600;

function buildDiagnostics(error: unknown, input: ErrorDiagnosticsInput = {}): AgentErrorDiagnostics | undefined {
    const { upstreamStatus, retryAfterSeconds, ...base } = input;
    const upstreamStatusValue = base.upstream_status ?? upstreamStatus;
    const retryAfterSecondsValue = base.retry_after_seconds ?? retryAfterSeconds ?? readRetryAfterSeconds(error);
    const upstreamEventType = base.upstream_event_type ?? readStringField(error, 'upstreamEventType');
    const partialImageCount = base.partial_image_count ?? readNumberField(error, 'partialImageCount');
    const transportError = base.transport_error ?? (isTransportError(error) || undefined);
    const transportErrorKind = base.transport_error_kind ?? classifyTransportErrorKind(error);
    const responseHeaders = base.response_headers ?? readWhitelistedHeaders(error);
    return cleanDiagnostics({
        ...base,
        ...(upstreamStatusValue !== undefined ? { upstream_status: upstreamStatusValue } : {}),
        ...(upstreamEventType !== undefined ? { upstream_event_type: upstreamEventType } : {}),
        ...(partialImageCount !== undefined ? { partial_image_count: partialImageCount } : {}),
        ...(retryAfterSecondsValue !== undefined ? { retry_after_seconds: retryAfterSecondsValue } : {}),
        ...(transportError !== undefined ? { transport_error: transportError } : {}),
        ...(transportErrorKind !== undefined ? { transport_error_kind: transportErrorKind } : {}),
        ...(responseHeaders ? { response_headers: responseHeaders } : {})
    });
}

function cleanDiagnostics(diagnostics: AgentErrorDiagnostics | undefined): AgentErrorDiagnostics | undefined {
    if (!diagnostics) return undefined;
    const responseHeaders = readWhitelistedHeaderSource(diagnostics.response_headers);
    const retryAfterSeconds =
        diagnostics.retry_after_seconds !== undefined
            ? normalizeRetryAfterSeconds(diagnostics.retry_after_seconds)
            : undefined;
    const partialImageCount =
        diagnostics.partial_image_count !== undefined
            ? normalizeNonNegativeInteger(diagnostics.partial_image_count)
            : undefined;
    const retryAfterMs =
        diagnostics.retry_after_ms !== undefined ? normalizeNonNegativeInteger(diagnostics.retry_after_ms) : undefined;
    const cooldownTarget = cleanCooldownTarget(diagnostics.cooldown_target);
    const cleaned: AgentErrorDiagnostics = {
        ...(diagnostics.elapsed_ms !== undefined
            ? { elapsed_ms: Math.max(0, Math.round(diagnostics.elapsed_ms)) }
            : {}),
        ...(diagnostics.channel_request_mode ? { channel_request_mode: diagnostics.channel_request_mode } : {}),
        ...(diagnostics.channel_request_mode_fallback_applied !== undefined
            ? { channel_request_mode_fallback_applied: diagnostics.channel_request_mode_fallback_applied }
            : {}),
        ...(diagnostics.route_decision ? { route_decision: diagnostics.route_decision } : {}),
        ...(diagnostics.selected_channel_id ? { selected_channel_id: diagnostics.selected_channel_id } : {}),
        ...(diagnostics.upstream_host ? { upstream_host: diagnostics.upstream_host } : {}),
        ...(diagnostics.upstream_status !== undefined ? { upstream_status: diagnostics.upstream_status } : {}),
        ...(diagnostics.upstream_event_type ? { upstream_event_type: diagnostics.upstream_event_type } : {}),
        ...(partialImageCount !== undefined ? { partial_image_count: partialImageCount } : {}),
        ...(diagnostics.transport_error !== undefined ? { transport_error: diagnostics.transport_error } : {}),
        ...(diagnostics.transport_error_kind ? { transport_error_kind: diagnostics.transport_error_kind } : {}),
        ...(retryAfterSeconds !== undefined ? { retry_after_seconds: retryAfterSeconds } : {}),
        ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}),
        ...(diagnostics.cooldown_until ? { cooldown_until: diagnostics.cooldown_until } : {}),
        ...(cooldownTarget ? { cooldown_target: cooldownTarget } : {}),
        ...(diagnostics.channel_cooldown_scope ? { channel_cooldown_scope: diagnostics.channel_cooldown_scope } : {}),
        ...(responseHeaders ? { response_headers: responseHeaders } : {})
    };
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function cleanCooldownTarget(target: unknown): AgentErrorDiagnostics['cooldown_target'] | undefined {
    if (typeof target !== 'object' || target === null) return undefined;
    const source = target as Record<string, unknown>;
    const channelId = normalizeNonEmptyString(source.channel_id);
    if (!channelId) return undefined;
    const credentialId = normalizeNonEmptyString(source.credential_id);
    const requestMode = normalizeDiagnosticRequestMode(source.request_mode);
    return {
        channel_id: channelId,
        ...(credentialId ? { credential_id: credentialId } : {}),
        ...(requestMode ? { request_mode: requestMode } : {})
    };
}

function normalizeDiagnosticRequestMode(value: unknown): ChannelRequestMode | undefined {
    if (typeof value !== 'string') return undefined;
    return CHANNEL_REQUEST_MODES.includes(value as ChannelRequestMode) ? (value as ChannelRequestMode) : undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumberField(error: unknown, field: string): number | undefined {
    if (typeof error !== 'object' || error === null || !(field in error)) return undefined;
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : undefined;
}

function readStringField(error: unknown, field: string): string | undefined {
    if (typeof error !== 'object' || error === null || !(field in error)) return undefined;
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
}

function readNestedErrorStringField(error: unknown, field: string): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const nested = (error as Record<string, unknown>).error;
    return readStringField(nested, field);
}

function readRetryAfterSeconds(error: unknown): number | undefined {
    const fromField = readNumberField(error, 'retryAfterSeconds');
    const normalizedField = fromField !== undefined ? normalizeRetryAfterSeconds(fromField) : undefined;
    if (normalizedField !== undefined) return normalizedField;
    const headers = readWhitelistedHeaders(error);
    const retryAfter = headers?.['retry-after'];
    if (!retryAfter || !/^\d+$/.test(retryAfter)) return undefined;
    return normalizeRetryAfterSeconds(Number(retryAfter));
}

function normalizeRetryAfterSeconds(value: number): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    if (!Number.isSafeInteger(rounded) || rounded < 1 || rounded > MAX_UPSTREAM_RETRY_AFTER_SECONDS) return undefined;
    return rounded;
}

function normalizeNonNegativeInteger(value: number): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    if (!Number.isSafeInteger(rounded) || rounded < 0) return undefined;
    return rounded;
}

function readWhitelistedHeaders(error: unknown): Record<string, string> | undefined {
    const headers = readHeadersSource(error);
    return readWhitelistedHeaderSource(headers);
}

function readWhitelistedHeaderSource(headers: unknown): Record<string, string> | undefined {
    if (!headers) return undefined;
    const result: Record<string, string> = {};
    for (const name of DIAGNOSTIC_HEADER_ALLOWLIST) {
        const value = readHeaderValue(headers, name);
        if (value) {
            result[name] = value;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function readHeadersSource(error: unknown): unknown {
    if (typeof error !== 'object' || error === null) return undefined;
    const object = error as Record<string, unknown>;
    if (object.headers) return object.headers;
    const response = object.response;
    if (typeof response !== 'object' || response === null) return undefined;
    return (response as Record<string, unknown>).headers;
}

function readHeaderValue(headers: unknown, name: string): string | undefined {
    if (headers instanceof Headers) {
        return headers.get(name) || undefined;
    }
    if (typeof headers !== 'object' || headers === null) return undefined;
    const entries = Object.entries(headers as Record<string, unknown>);
    const match = entries.find(([key]) => key.toLowerCase() === name);
    const value = match?.[1];
    return typeof value === 'string' && value ? value : undefined;
}

function parseValidationDetails(message: string): Record<string, unknown> | undefined {
    try {
        const parsed = JSON.parse(message);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function inferValidationDetails(message: string): Record<string, unknown> | undefined {
    const fields: Record<string, string> = {};
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('response_mode')) {
        fields.response_mode = message;
    } else if (lowerMessage.includes('missing required parameter: prompt') || lowerMessage.includes('prompt')) {
        fields.prompt = message;
    } else if (lowerMessage.startsWith('n ')) {
        fields.n = message;
    } else if (lowerMessage.includes('model')) {
        fields.model = message;
    } else if (lowerMessage.includes('image file') || lowerMessage.includes('image data')) {
        fields.image_0 = message;
    } else if (lowerMessage.includes('mask')) {
        fields.mask = message;
    } else if (lowerMessage.includes('size')) {
        fields.size = message;
    } else if (lowerMessage.includes('quality')) {
        fields.quality = message;
    } else if (lowerMessage.includes('partial_images')) {
        fields.partial_images = message;
    }
    return Object.keys(fields).length > 0 ? { fields } : undefined;
}

function isTransportError(error: unknown): boolean {
    const name = readStringField(error, 'name') || readConstructorName(error);
    if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;
    const code = readStringField(error, 'code') || readCauseChainString(error, 'code');
    if (
        code === 'ENOTFOUND' ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'EAI_AGAIN'
    ) {
        return true;
    }
    const message = (readStringField(error, 'message') || '')
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/, '');
    return (
        message.includes('connection error') ||
        message.includes('request timed out') ||
        message.includes('fetch failed')
    );
}

function classifyTransportErrorKind(error: unknown): AgentTransportErrorKind | undefined {
    const name = readStringField(error, 'name') || readConstructorName(error);
    const code = readStringField(error, 'code') || readCauseChainString(error, 'code');
    const message = (readStringField(error, 'message') || '').trim().toLowerCase();

    if (
        name === 'MissingFinalImageStreamResultError' ||
        message.includes('未返回最终图片') ||
        message.includes('missing final') ||
        message.includes('final image')
    ) {
        return 'sse_final_missing';
    }
    if (isAcceptedImageTaskError(error)) {
        return 'upstream_timeout';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
    if (
        code === 'CERT_HAS_EXPIRED' ||
        code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
        message.includes('certificate') ||
        message.includes('tls')
    ) {
        return 'tls';
    }
    if (code === 'ECONNREFUSED') return 'connection_refused';
    if (code === 'ECONNRESET' || message.includes('socket hang up') || message.includes('other side closed')) {
        return 'socket_closed';
    }
    if (name === 'APIConnectionTimeoutError' || code === 'ETIMEDOUT' || message.includes('connect timeout')) {
        return 'connect_timeout';
    }
    if (message.includes('request timed out') || message.includes('upstream timeout') || message.includes('timeout')) {
        return 'upstream_timeout';
    }
    if (message.includes('fetch failed')) return 'fetch_failed';
    if (isTransportError(error)) return 'unknown_transport';
    return undefined;
}

function readConstructorName(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const constructorValue = (error as { constructor?: unknown }).constructor;
    return typeof constructorValue === 'function' ? constructorValue.name : undefined;
}

function readCauseChainString(error: unknown, fieldName: string, depth = 0): string | undefined {
    if (depth > 4 || typeof error !== 'object' || error === null || !('cause' in error)) return undefined;
    const cause = (error as { cause?: unknown }).cause;
    return readStringField(cause, fieldName) || readCauseChainString(cause, fieldName, depth + 1);
}

export function createAgentErrorBody(error: AgentApiError, requestId: string): AgentErrorBody {
    const diagnostics = error.retryable ? error.diagnostics : stripRetryDiagnostics(error.diagnostics);
    return {
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.retryable && error.retryAfterSeconds ? { retry_after_seconds: error.retryAfterSeconds } : {}),
            ...(error.details ? { details: error.details } : {}),
            ...(error.upstreamStatus ? { upstream_status: error.upstreamStatus } : {}),
            ...(diagnostics ? { diagnostics } : {}),
            request_id: requestId
        }
    };
}

export function agentErrorResponse(error: AgentApiError, requestId: string): NextResponse<AgentErrorBody> {
    const headers: Record<string, string> = {
        'X-Request-Id': requestId
    };
    if (error.retryable && error.retryAfterSeconds) {
        headers['Retry-After'] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(createAgentErrorBody(error, requestId), { status: error.status, headers });
}

export function storedAgentErrorResponse(
    errorBody: AgentErrorBody,
    headers: Record<string, string> = {}
): NextResponse<AgentErrorBody> {
    const terminalError = toTerminalAgentErrorBody(errorBody);
    return NextResponse.json(terminalError, {
        status: statusForAgentErrorCode(terminalError.error.code, terminalError.error.upstream_status),
        headers: { ...headers, 'X-Request-Id': terminalError.error.request_id }
    });
}

export function toTerminalAgentErrorBody(errorBody: AgentErrorBody): AgentErrorBody {
    return {
        error: {
            ...stripTerminalRetryDiagnostics(errorBody.error),
            retryable: false
        }
    };
}

function stripTerminalRetryDiagnostics(error: AgentErrorBody['error']): AgentErrorBody['error'] {
    const withoutTopLevelRetry = { ...error };
    delete withoutTopLevelRetry.retry_after_seconds;
    if (!error.diagnostics?.retry_after_seconds) return withoutTopLevelRetry;
    const diagnostics = stripRetryDiagnostics(error.diagnostics);
    return {
        ...withoutTopLevelRetry,
        diagnostics
    };
}

function stripRetryDiagnostics(diagnostics: AgentErrorDiagnostics | undefined): AgentErrorDiagnostics | undefined {
    if (!diagnostics?.retry_after_seconds) return diagnostics;
    const stripped = { ...diagnostics };
    delete stripped.retry_after_seconds;
    return Object.keys(stripped).length > 0 ? stripped : undefined;
}

export function normalizeAgentError(error: unknown, diagnostics: AgentErrorDiagnostics = {}): AgentApiError {
    if (error instanceof AgentApiError) return error;
    if (error instanceof RequestValidationError) {
        const details = error.details ?? parseValidationDetails(error.message) ?? inferValidationDetails(error.message);
        const channelUnavailable =
            error.code === 'channel_unavailable' ||
            (error.status === 503 &&
                (error.message.includes('当前没有支持') || error.message.includes('当前没有可用')) &&
                error.message.includes('健康渠道'));
        return new AgentApiError({
            code: channelUnavailable
                ? 'channel_unavailable'
                : error.status >= 500
                  ? 'configuration_error'
                  : 'validation_error',
            message: details ? '请求校验失败。' : error.message,
            status: channelUnavailable ? 503 : error.status === 400 ? 422 : error.status,
            retryable: false,
            ...(details ? { details } : {}),
            diagnostics: buildDiagnostics(error, diagnostics)
        });
    }

    const status = readNumberField(error, 'status') ?? readNumberField(error, 'statusCode');
    const message =
        error instanceof Error
            ? error.message
            : (readStringField(error, 'message') ?? readNestedErrorStringField(error, 'message') ?? '发生未知错误。');
    const upstreamCode =
        readStringField(error, 'code') ||
        readStringField(error, 'errorCode') ||
        readNestedErrorStringField(error, 'code');
    if (upstreamCode === 'INSUFFICIENT_BALANCE' || message.toLowerCase().includes('insufficient account balance')) {
        return new AgentApiError({
            code: 'upstream_quota_exhausted',
            message: '上游渠道余额不足，当前无法生成图片。',
            status: 403,
            retryable: false,
            upstreamStatus: status ?? 403,
            diagnostics: buildDiagnostics(error, { ...diagnostics, upstreamStatus: status ?? 403 })
        });
    }
    if (isAcceptedImageTaskError(error)) {
        return new AgentApiError({
            code: 'upstream_unavailable',
            message,
            status: 502,
            retryable: false,
            upstreamStatus: status,
            diagnostics: buildDiagnostics(error, {
                ...diagnostics,
                ...(status !== undefined ? { upstreamStatus: status } : {})
            })
        });
    }
    if (status === 404) {
        return new AgentApiError({
            code: 'upstream_unavailable',
            message,
            status: 502,
            retryable: false,
            upstreamStatus: 404,
            diagnostics: buildDiagnostics(error, { ...diagnostics, upstreamStatus: 404 })
        });
    }
    if (isChannelRequestModeFailure(error, diagnostics.channel_request_mode)) {
        const retryAfterSeconds = readRetryAfterSeconds(error) ?? 15;
        return new AgentApiError({
            code: 'upstream_unavailable',
            message,
            status: 502,
            retryable: true,
            upstreamStatus: 403,
            retryAfterSeconds,
            diagnostics: buildDiagnostics(error, {
                ...diagnostics,
                upstreamStatus: 403,
                retryAfterSeconds,
                channel_cooldown_scope: 'channel'
            })
        });
    }
    if (error instanceof ChannelCapacityQueueError) {
        const retryAfterSeconds = Math.max(1, Math.ceil(Number(error.details.max_wait_ms ?? 30_000) / 1000));
        return new AgentApiError({
            code: 'upstream_rate_limited',
            message,
            status: 429,
            retryable: error.retryable,
            details: {
                code: error.code,
                ...error.details
            },
            retryAfterSeconds,
            diagnostics: buildDiagnostics(error, {
                ...diagnostics,
                retryAfterSeconds
            })
        });
    }
    if (status === 401 || status === 403) {
        return new AgentApiError({
            code: 'upstream_auth_failed',
            message,
            status,
            retryable: false,
            upstreamStatus: status,
            diagnostics: buildDiagnostics(error, {
                ...diagnostics,
                upstreamStatus: status,
                channel_cooldown_scope: 'credential'
            })
        });
    }
    if (status === 400) {
        return new AgentApiError({
            code: 'validation_error',
            message: '上游拒绝了请求参数。',
            status: 422,
            retryable: false,
            details: inferValidationDetails(message),
            upstreamStatus: status,
            diagnostics: buildDiagnostics(error, { ...diagnostics, upstreamStatus: status })
        });
    }
    if (status === 429) {
        const retryAfterSeconds = readRetryAfterSeconds(error) ?? 30;
        return new AgentApiError({
            code: 'upstream_rate_limited',
            message,
            status,
            retryable: true,
            upstreamStatus: status,
            retryAfterSeconds,
            diagnostics: buildDiagnostics(error, {
                ...diagnostics,
                upstreamStatus: status,
                retryAfterSeconds,
                channel_cooldown_scope: 'credential'
            })
        });
    }
    if (status && [500, 502, 503, 504, 520, 522, 523, 524].includes(status)) {
        const retryAfterSeconds = readRetryAfterSeconds(error) ?? 15;
        return new AgentApiError({
            code: 'upstream_unavailable',
            message,
            status: 502,
            retryable: true,
            upstreamStatus: status,
            retryAfterSeconds,
            diagnostics: buildDiagnostics(error, {
                ...diagnostics,
                upstreamStatus: status,
                retryAfterSeconds,
                channel_cooldown_scope: 'channel'
            })
        });
    }
    if (isChannelFailure(error)) {
        const retryAfterSeconds = readRetryAfterSeconds(error) ?? 15;
        return new AgentApiError({
            code: 'upstream_unavailable',
            message,
            status: 502,
            retryable: true,
            retryAfterSeconds,
            diagnostics: buildDiagnostics(error, {
                ...diagnostics,
                retryAfterSeconds,
                channel_cooldown_scope: 'channel',
                transport_error: true
            })
        });
    }

    return new AgentApiError({
        code: 'unexpected_error',
        message,
        status: 500,
        retryable: false,
        diagnostics: buildDiagnostics(error, diagnostics)
    });
}

function isAcceptedImageTaskError(error: unknown): boolean {
    const name = readStringField(error, 'name') || readConstructorName(error);
    return name === 'AcceptedImageTaskResponseError' || name === 'AcceptedImageTaskStreamResultError';
}
