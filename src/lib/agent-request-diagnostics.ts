import type { AppLogEntry } from './app-logger';
import {
    buildAgentRequestDiagnosticsRetention,
    readAgentStateBackend,
    type AgentImageResponse,
    type AgentRequestDiagnosticsRetention
} from './agent-api-contracts';
import type { AgentErrorBody } from './api-error-response';
import type { AgentArtifactRecord, AgentRequestRecord } from './agent-state-store';
import type { FeedbackResponse } from './feedback-store';
import { buildLogScopeDiagnostics, filterLogsByScope, resolveLogClientRequestIds } from './log-filter';

const MAX_DIAGNOSTIC_EVENTS = 30;
const DIAGNOSTIC_CONTEXT_FIELD_TYPES = {
    providerDialect: 'string',
    normalizedEventCount: 'number',
    reason: 'string',
    channel_id: 'string',
    image_backend: 'string',
    operation: 'string',
    stream_mode: 'string',
    streamingStrategy: 'string',
    streaming_strategy: 'string',
    partialImages: 'number',
    partial_images: 'number',
    upstream_status: 'number',
    upstream_event_type: 'string',
    transport_error: 'boolean'
} as const satisfies Record<string, 'string' | 'number' | 'boolean'>;

type DiagnosticContextFieldType =
    (typeof DIAGNOSTIC_CONTEXT_FIELD_TYPES)[keyof typeof DIAGNOSTIC_CONTEXT_FIELD_TYPES];
type DiagnosticContextValue = string | number | boolean;

export type AgentLogDiagnosticEvent = {
    id: number;
    at: string;
    level: AppLogEntry['level'];
    message: string;
    client_request_id?: string;
    filenames?: string[];
    diagnostics?: Record<string, DiagnosticContextValue>;
};

export type AgentRequestDiagnostics = {
    request: {
        request_id: string;
        idempotency_key: string;
        mode: AgentRequestRecord['mode'];
        status: AgentRequestRecord['status'];
        cached: boolean;
        created_at: string;
        updated_at: string;
        expires_at: string;
        locked_until?: string;
    };
    timeline: Array<{
        at: string;
        event: 'created' | 'updated' | 'locked_until' | 'expires';
    }>;
    artifacts: Array<{
        id: string;
        filename: string;
        content_url: string;
        metadata_url: string;
        output_format: string;
        mime_type: string;
        size_bytes: number;
        width: number | null;
        height: number | null;
        model: string;
        created_at: string;
    }>;
    response?: {
        request_id: string;
        idempotency_key: string;
        cached: boolean;
        image_count: number;
        artifact_ids: string[];
        content_urls: string[];
        created_at: string;
        timing?: AgentImageResponse['timing'];
        execution?: AgentImageResponse['execution'];
    };
    error?: {
        code: string;
        message: string;
        retryable: boolean;
        upstream_status?: number;
        diagnostics?: AgentErrorBody['error']['diagnostics'];
    };
    feedback?: FeedbackResponse;
    state_backend: ReturnType<typeof readAgentStateBackend>;
    diagnostics_retention: AgentRequestDiagnosticsRetention;
    diagnostics_boundary: {
        source: 'agent_state';
        not_page_request_log: true;
        raw_request_json_redacted: true;
        api_key_redacted: true;
    };
};

export function buildAgentRequestDiagnostics(input: {
    record: AgentRequestRecord;
    artifacts: AgentArtifactRecord[];
    env: Record<string, string | undefined>;
    feedback?: FeedbackResponse;
}): AgentRequestDiagnostics {
    return {
        request: {
            request_id: input.record.requestId,
            idempotency_key: input.record.idempotencyKey,
            mode: input.record.mode,
            status: input.record.status,
            cached: Boolean(input.record.responseJson),
            created_at: input.record.createdAt,
            updated_at: input.record.updatedAt,
            expires_at: input.record.expiresAt,
            ...(input.record.lockedUntil ? { locked_until: input.record.lockedUntil } : {})
        },
        timeline: buildAgentRequestTimeline(input.record),
        artifacts: input.artifacts.map(agentArtifactToDiagnostics),
        ...(input.record.responseJson ? { response: agentResponseToDiagnostics(input.record.responseJson) } : {}),
        ...(input.record.errorJson ? { error: agentErrorToDiagnostics(input.record.errorJson) } : {}),
        ...(input.feedback ? { feedback: input.feedback } : {}),
        state_backend: readAgentStateBackend(input.env),
        diagnostics_retention: buildAgentRequestDiagnosticsRetention(input.env),
        diagnostics_boundary: {
            source: 'agent_state',
            not_page_request_log: true,
            raw_request_json_redacted: true,
            api_key_redacted: true
        }
    };
}

export function buildPageRequestDiagnostics(input: {
    logs: AppLogEntry[];
    clientRequestId: string;
    filenames?: string[];
}): {
    scope: {
        request_ids: string[];
        filenames: string[];
        filename_matched_request_ids: string[];
        copy_text: string;
    };
    matched_log_count: number;
    events: AgentLogDiagnosticEvent[];
} {
    const filenames = input.filenames ?? [];
    const resolvedClientRequestIds = resolveLogClientRequestIds({
        logs: input.logs,
        clientRequestIds: [input.clientRequestId],
        filenames
    });
    const matchedLogs = filterLogsByScope({
        logs: input.logs,
        clientRequestIds: [input.clientRequestId],
        filenames
    });
    const scope = buildLogScopeDiagnostics({
        clientRequestIds: [input.clientRequestId],
        filenames,
        resolvedClientRequestIds
    });
    return {
        scope: {
            request_ids: scope.requestIds,
            filenames: scope.filenames,
            filename_matched_request_ids: scope.filenameMatchedRequestIds,
            copy_text: scope.copyText
        },
        matched_log_count: matchedLogs.length,
        events: matchedLogs.slice(-MAX_DIAGNOSTIC_EVENTS).map(logEntryToDiagnosticEvent)
    };
}

function buildAgentRequestTimeline(record: AgentRequestRecord): AgentRequestDiagnostics['timeline'] {
    const timeline: AgentRequestDiagnostics['timeline'] = [{ at: record.createdAt, event: 'created' }];
    if (record.lockedUntil) timeline.push({ at: record.lockedUntil, event: 'locked_until' });
    timeline.push({ at: record.updatedAt, event: 'updated' });
    timeline.push({ at: record.expiresAt, event: 'expires' });
    return timeline.sort((left, right) => left.at.localeCompare(right.at));
}

function agentArtifactToDiagnostics(artifact: AgentArtifactRecord): AgentRequestDiagnostics['artifacts'][number] {
    return {
        id: artifact.id,
        filename: artifact.filename,
        content_url: artifact.contentUrl,
        metadata_url: artifact.metadataUrl,
        output_format: artifact.outputFormat,
        mime_type: artifact.mimeType,
        size_bytes: artifact.sizeBytes,
        width: artifact.width,
        height: artifact.height,
        model: artifact.model,
        created_at: artifact.createdAt
    };
}

function agentResponseToDiagnostics(
    response: NonNullable<AgentRequestRecord['responseJson']>
): NonNullable<AgentRequestDiagnostics['response']> {
    return {
        request_id: response.request_id,
        idempotency_key: response.idempotency_key,
        cached: response.cached,
        image_count: response.images.length,
        artifact_ids: response.images.map((image) => image.id),
        content_urls: response.images.map((image) => image.content_url),
        created_at: response.created_at,
        ...(response.timing ? { timing: response.timing } : {}),
        ...(response.execution ? { execution: response.execution } : {})
    };
}

function agentErrorToDiagnostics(
    errorBody: NonNullable<AgentRequestRecord['errorJson']>
): NonNullable<AgentRequestDiagnostics['error']> {
    return {
        code: errorBody.error.code,
        message: errorBody.error.message,
        retryable: errorBody.error.retryable,
        ...(errorBody.error.upstream_status !== undefined ? { upstream_status: errorBody.error.upstream_status } : {}),
        ...(errorBody.error.diagnostics ? { diagnostics: errorBody.error.diagnostics } : {})
    };
}

function logEntryToDiagnosticEvent(entry: AppLogEntry): AgentLogDiagnosticEvent {
    const diagnostics = sanitizeContext(entry.context);
    return {
        id: entry.id,
        at: entry.at,
        level: entry.level,
        message: entry.message,
        ...(entry.clientRequestId ? { client_request_id: entry.clientRequestId } : {}),
        ...(entry.filenames ? { filenames: entry.filenames } : {}),
        ...(diagnostics ? { diagnostics } : {})
    };
}

function sanitizeContext(context: string | undefined): Record<string, DiagnosticContextValue> | undefined {
    if (!context) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(context);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const sanitized: Record<string, DiagnosticContextValue> = {};
    for (const [key, value] of Object.entries(parsed)) {
        const expectedType =
            DIAGNOSTIC_CONTEXT_FIELD_TYPES[key as keyof typeof DIAGNOSTIC_CONTEXT_FIELD_TYPES];
        if (!expectedType) continue;
        if (isDiagnosticContextValue(value, expectedType)) {
            sanitized[key] = value;
        }
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isDiagnosticContextValue(value: unknown, expectedType: DiagnosticContextFieldType): value is DiagnosticContextValue {
    if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === expectedType;
}
