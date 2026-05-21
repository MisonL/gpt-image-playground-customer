import type { AgentGenerateRequest, AgentJobState, AgentJobStatusResponse } from './agent-api-contracts';
import {
    completeAgentExecutionState,
    createArtifactPersistenceError,
    createCompletionPersistenceError,
    deleteAgentExecutionFiles,
    errorToAgentErrorBody,
    executeAgentGenerate,
    hydrateAgentReplayResponse,
    saveAgentExecutionArtifacts
} from './agent-image-service';
import { AgentApiError, toTerminalAgentErrorBody, type AgentErrorBody } from './api-error-response';
import type { AgentRequestRecord, AgentStateStore } from './agent-state-store';
import { appLogger } from './app-logger';

const DEFAULT_JOB_RETRY_AFTER_SECONDS = 5;
const MAX_JOB_LEASE_REFRESH_INTERVAL_MS = 30_000;

export function buildAgentJobStatusResponse(
    record: AgentRequestRecord,
    options: { now?: Date; retryAfterSeconds?: number } = {}
): AgentJobStatusResponse {
    const state = readAgentJobState(record, options.now);
    return {
        job: {
            id: record.requestId,
            request_id: record.requestId,
            idempotency_key: record.idempotencyKey,
            mode: record.mode,
            state,
            created_at: record.createdAt,
            updated_at: record.updatedAt,
            expires_at: record.expiresAt,
            ...(state !== 'expired' ? { result_url: `/api/agent/jobs/${record.requestId}/result` } : {}),
            ...(state === 'running' || state === 'queued'
                ? { retry_after_seconds: options.retryAfterSeconds ?? DEFAULT_JOB_RETRY_AFTER_SECONDS }
                : {}),
            ...(state === 'failed' && record.errorJson ? { error: summarizeJobError(record.errorJson) } : {})
        }
    };
}

export function readAgentJobState(record: AgentRequestRecord, now = new Date()): AgentJobState {
    if (isExpiredJobRecord(record, now)) return 'expired';
    if (record.status === 'pending') return 'queued';
    if (record.status === 'running') return 'running';
    if (record.status === 'succeeded') return 'succeeded';
    if (record.status === 'failed') return 'failed';
    return 'expired';
}

export function assertReadableJobRecord(record: AgentRequestRecord | undefined, id: string): AgentRequestRecord {
    if (!record) {
        throw new AgentApiError({
            code: 'job_not_found',
            message: 'Agent job 不存在。',
            status: 404,
            retryable: false,
            details: { id }
        });
    }
    if (readAgentJobState(record) === 'expired') {
        throw new AgentApiError({
            code: 'job_expired',
            message: 'Agent job 已过期。',
            status: 410,
            retryable: false,
            details: { id }
        });
    }
    return record;
}

export async function readJobResult(
    store: AgentStateStore,
    record: AgentRequestRecord
): Promise<ResponseReadyResult> {
    if (record.status === 'succeeded' && record.responseJson) {
        return {
            type: 'response',
            response: await hydrateAgentReplayResponse(store, record, record.responseJson, record.responseJson.cached)
        };
    }
    if (record.status === 'failed' && record.errorJson) {
        return { type: 'stored_error', error: toTerminalJobErrorBody(record.errorJson) };
    }
    return { type: 'running' };
}

export function startAgentGenerateJob(options: {
    store: AgentStateStore;
    request: AgentGenerateRequest;
    headers: Headers;
    requestId: string;
    idempotencyKey: string;
    leaseMs: number;
}): void {
    void runAgentGenerateJob(options).catch((error) => {
        appLogger.error('Agent generate job 后台执行失败。', error);
    });
}

type ResponseReadyResult =
    | { type: 'response'; response: unknown }
    | { type: 'stored_error'; error: AgentErrorBody }
    | { type: 'running' };

async function runAgentGenerateJob(options: {
    store: AgentStateStore;
    request: AgentGenerateRequest;
    headers: Headers;
    requestId: string;
    idempotencyKey: string;
    leaseMs: number;
}): Promise<void> {
    let heartbeat: { stop: () => void } | undefined;
    try {
        heartbeat = startAgentJobLeaseHeartbeat(options.store, options.requestId, options.leaseMs);
        const execution = await executeAgentGenerate({
            request: options.request,
            headers: options.headers,
            requestId: options.requestId,
            idempotencyKey: options.idempotencyKey,
            cached: false
        });
        await persistAgentJobSuccess(options.store, execution, options.requestId);
    } catch (error) {
        await failAgentJob(options.store, options.requestId, error);
    } finally {
        heartbeat?.stop();
    }
}

function startAgentJobLeaseHeartbeat(store: AgentStateStore, requestId: string, leaseMs: number): { stop: () => void } {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
        throw new Error('leaseMs must be a positive number.');
    }
    const intervalMs = Math.max(100, Math.min(MAX_JOB_LEASE_REFRESH_INTERVAL_MS, Math.floor(leaseMs / 2)));
    const timer = setInterval(() => {
        void store.refreshRequestLease({ requestId, leaseMs }).catch((error) => {
            appLogger.error('刷新 Agent job lease 失败。', error);
        });
    }, intervalMs);
    timer.unref?.();
    return {
        stop: () => clearInterval(timer)
    };
}

async function persistAgentJobSuccess(
    store: AgentStateStore,
    execution: Awaited<ReturnType<typeof executeAgentGenerate>>,
    requestId: string
): Promise<void> {
    try {
        await saveAgentExecutionArtifacts(store, execution);
    } catch (error) {
        appLogger.error('保存 Agent job 产物元数据失败。', error);
        await cleanupFailedAgentJob(store, execution, requestId);
        return;
    }
    try {
        await completeAgentExecutionState(store, execution);
    } catch (error) {
        appLogger.error('保存 Agent job 完成状态失败。', error);
        await failAgentJob(store, requestId, createCompletionPersistenceError());
    }
}

async function cleanupFailedAgentJob(
    store: AgentStateStore,
    execution: Awaited<ReturnType<typeof executeAgentGenerate>>,
    requestId: string
): Promise<void> {
    try {
        await deleteAgentExecutionFiles(execution);
    } catch (error) {
        appLogger.error('Agent job 产物元数据保存失败后清理文件失败。', error);
    }
    await failAgentJob(store, requestId, createArtifactPersistenceError());
}

async function failAgentJob(store: AgentStateStore, requestId: string, error: unknown): Promise<void> {
    try {
        await store.failRequest({ requestId, error: errorToAgentErrorBody(error, requestId) });
    } catch (storeError) {
        appLogger.error('保存 Agent job 失败状态失败。', storeError);
    }
}

function isExpiredJobRecord(record: AgentRequestRecord, now: Date): boolean {
    return new Date(record.expiresAt).getTime() <= now.getTime();
}

function summarizeJobError(errorBody: AgentErrorBody) {
    const error = toTerminalJobError(errorBody);
    return {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.details ? { details: error.details } : {}),
        ...(error.upstream_status !== undefined ? { upstream_status: error.upstream_status } : {}),
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {})
    };
}

function toTerminalJobErrorBody(errorBody: AgentErrorBody): AgentErrorBody {
    return toTerminalAgentErrorBody(errorBody);
}

function toTerminalJobError(errorBody: AgentErrorBody): AgentErrorBody['error'] {
    return toTerminalAgentErrorBody(errorBody).error;
}
