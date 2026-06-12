import { buildAgentRequestDiagnostics } from '@/lib/agent-request-diagnostics';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import type { AgentRequestRecord } from '@/lib/agent-state-store';
import { AgentApiError } from '@/lib/api-error-response';
import { appLogger } from '@/lib/app-logger';
import {
    feedbackRecordToResponse,
    isFeedbackStateStore,
    normalizeFeedbackTargetId,
    type FeedbackResponse,
    type FeedbackStateStore
} from '@/lib/feedback-store';

export async function readAgentRequestDiagnosticsByRequestId(requestId: string) {
    const normalizedRequestId = normalizeFeedbackTargetId(requestId);
    const store = await ensureAgentStateStoreReady();
    const record = await store.getRequest(normalizedRequestId);
    return record ? buildDiagnosticsForRecord(record) : undefined;
}

export async function readAgentRequestDiagnosticsByLookup(request: Request) {
    const searchParams = new URL(request.url).searchParams;
    const requestId = searchParams.get('request_id')?.trim();
    const idempotencyKey = searchParams.get('idempotency_key')?.trim();
    if (requestId && idempotencyKey) {
        throw new AgentApiError({
            code: 'validation_error',
            message: 'request_id 和 idempotency_key 只能提供一个。',
            status: 422,
            retryable: false
        });
    }
    if (requestId) {
        return readAgentRequestDiagnosticsByRequestId(requestId);
    }
    if (idempotencyKey) {
        const normalizedIdempotencyKey = normalizeFeedbackTargetId(idempotencyKey);
        const store = await ensureAgentStateStoreReady();
        const record = await store.getRequestByIdempotencyKey(normalizedIdempotencyKey);
        return record ? buildDiagnosticsForRecord(record) : undefined;
    }
    throw new AgentApiError({
        code: 'validation_error',
        message: '必须提供 request_id 或 idempotency_key 查询参数。',
        status: 422,
        retryable: false
    });
}

async function buildDiagnosticsForRecord(record: AgentRequestRecord) {
    const store = await ensureAgentStateStoreReady();
    const artifacts = await store.listArtifactsForRequest(record.requestId);
    const feedback = isFeedbackStateStore(store) ? await readDiagnosticsFeedback(store, record.requestId) : undefined;
    return buildAgentRequestDiagnostics({
        record,
        artifacts,
        env: process.env,
        ...(feedback ? { feedback } : {})
    });
}

async function readDiagnosticsFeedback(
    store: FeedbackStateStore,
    requestId: string
): Promise<FeedbackResponse | undefined> {
    try {
        const value = await store.readFeedback('agent_request', requestId);
        return value ? feedbackRecordToResponse(value) : undefined;
    } catch (error) {
        appLogger.warn('读取 Agent request feedback 失败，继续返回无 feedback 的诊断。', {
            requestId,
            error: error instanceof Error ? error.message : String(error)
        });
        return undefined;
    }
}
