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
    | 'upstream_rate_limited'
    | 'upstream_auth_failed'
    | 'upstream_unavailable'
    | 'unexpected_error';

export type AgentErrorBody = {
    error: {
        code: AgentErrorCode;
        message: string;
        retryable: boolean;
        details?: Record<string, unknown>;
        upstream_status?: number;
        request_id: string;
    };
};

export function statusForAgentErrorCode(code: AgentErrorCode, upstreamStatus?: number): number {
    if (code === 'validation_error') return 422;
    if (code === 'unauthorized') return 401;
    if (code === 'idempotency_key_required') return 400;
    if (code === 'idempotency_conflict' || code === 'request_in_progress') return 409;
    if (code === 'artifact_not_found') return 404;
    if (code === 'upstream_rate_limited') return 429;
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

    constructor(options: {
        code: AgentErrorCode;
        message: string;
        status: number;
        retryable?: boolean;
        details?: Record<string, unknown>;
        upstreamStatus?: number;
        retryAfterSeconds?: number;
    }) {
        super(options.message);
        this.name = 'AgentApiError';
        this.code = options.code;
        this.status = options.status;
        this.retryable = options.retryable ?? false;
        this.details = options.details;
        this.upstreamStatus = options.upstreamStatus;
        this.retryAfterSeconds = options.retryAfterSeconds;
    }
}

function readNumberField(error: unknown, field: string): number | undefined {
    if (typeof error !== 'object' || error === null || !(field in error)) return undefined;
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : undefined;
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
    } else if (lowerMessage.includes('image file')) {
        fields.image_0 = message;
    } else if (lowerMessage.includes('mask')) {
        fields.mask = message;
    } else if (lowerMessage.includes('size')) {
        fields.size = message;
    } else if (lowerMessage.includes('quality')) {
        fields.quality = message;
    }
    return Object.keys(fields).length > 0 ? { fields } : undefined;
}

export function createAgentErrorBody(error: AgentApiError, requestId: string): AgentErrorBody {
    return {
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.details ? { details: error.details } : {}),
            ...(error.upstreamStatus ? { upstream_status: error.upstreamStatus } : {}),
            request_id: requestId
        }
    };
}

export function agentErrorResponse(error: AgentApiError, requestId: string): NextResponse<AgentErrorBody> {
    const headers: Record<string, string> = {
        'X-Request-Id': requestId
    };
    if (error.retryAfterSeconds) {
        headers['Retry-After'] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(createAgentErrorBody(error, requestId), { status: error.status, headers });
}

export function storedAgentErrorResponse(errorBody: AgentErrorBody): NextResponse<AgentErrorBody> {
    return NextResponse.json(errorBody, {
        status: statusForAgentErrorCode(errorBody.error.code, errorBody.error.upstream_status),
        headers: { 'X-Request-Id': errorBody.error.request_id }
    });
}

export function normalizeAgentError(error: unknown): AgentApiError {
    if (error instanceof AgentApiError) return error;
    if (error instanceof RequestValidationError) {
        const details = parseValidationDetails(error.message) ?? inferValidationDetails(error.message);
        return new AgentApiError({
            code: error.status >= 500 ? 'configuration_error' : 'validation_error',
            message: details ? 'Request validation failed.' : error.message,
            status: error.status === 400 ? 422 : error.status,
            retryable: false,
            ...(details ? { details } : {})
        });
    }

    const status = readNumberField(error, 'status') ?? readNumberField(error, 'statusCode');
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    if (status === 401 || status === 403) {
        return new AgentApiError({
            code: 'upstream_auth_failed',
            message,
            status,
            retryable: false,
            upstreamStatus: status
        });
    }
    if (status === 429) {
        return new AgentApiError({
            code: 'upstream_rate_limited',
            message,
            status,
            retryable: true,
            upstreamStatus: status,
            retryAfterSeconds: 30
        });
    }
    if (status && [500, 502, 503, 504, 520, 522, 523, 524].includes(status)) {
        return new AgentApiError({
            code: 'upstream_unavailable',
            message,
            status: 502,
            retryable: true,
            upstreamStatus: status,
            retryAfterSeconds: 15
        });
    }

    return new AgentApiError({
        code: 'unexpected_error',
        message,
        status: 500,
        retryable: false
    });
}
