import {
    buildGenerateRequestHash,
    completeAgentExecutionState,
    createArtifactPersistenceError,
    createCompletionPersistenceError,
    deleteAgentExecutionFiles,
    errorToAgentErrorBody,
    executeAgentGenerate,
    hydrateAgentReplayResponse,
    parseAgentGenerateRequest,
    readIdempotencyKey,
    saveAgentExecutionArtifacts
} from '@/lib/agent-image-service';
import { readAgentLeaseMs, readAgentRequestTtlSeconds } from '@/lib/agent-api-contracts';
import { AgentApiError, agentErrorResponse, normalizeAgentError, storedAgentErrorResponse } from '@/lib/api-error-response';
import { assertAgentAuthorized } from '@/lib/agent-auth';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { createRequestId } from '@/lib/agent-state-store';
import { appLogger } from '@/lib/app-logger';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    let requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const imageRequest = await parseAgentGenerateRequest(request);
        const idempotencyKey = readIdempotencyKey(request.headers);
        const store = await ensureAgentStateStoreReady();
        const beginResult = await store.beginRequest({
            idempotencyKey,
            requestHash: buildGenerateRequestHash(imageRequest),
            mode: 'generate',
            requestJson: imageRequest,
            leaseMs: readAgentLeaseMs(process.env),
            ttlSeconds: readAgentRequestTtlSeconds(process.env)
        });

        if (beginResult.type === 'replay') {
            const response = await hydrateAgentReplayResponse(store, beginResult.record, beginResult.response);
            return NextResponse.json(response, { headers: { 'X-Idempotent-Replay': 'true' } });
        }
        if (beginResult.type === 'failed') {
            requestId = beginResult.record.requestId;
            return storedAgentErrorResponse(beginResult.error);
        }
        if (beginResult.type === 'conflict') {
            throw new AgentApiError({
                code: 'idempotency_conflict',
                message: 'Idempotency-Key 已被不同请求正文使用。',
                status: 409,
                retryable: false
            });
        }
        if (beginResult.type === 'in_progress') {
            throw new AgentApiError({
                code: 'request_in_progress',
                message: '使用该 Idempotency-Key 的请求仍在运行。',
                status: 409,
                retryable: true,
                retryAfterSeconds: beginResult.retryAfterSeconds
            });
        }

        requestId = beginResult.record.requestId;
        const execution = await executeAgentGenerate({
            request: imageRequest,
            headers: request.headers,
            requestId,
            idempotencyKey,
            cached: false
        }).catch(async (error) => {
            const errorBody = errorToAgentErrorBody(error, requestId);
            await store.failRequest({ requestId, error: errorBody });
            throw normalizeAgentError(error);
        });
        const headers: Record<string, string> = { 'X-Request-Id': requestId };
        try {
            await saveAgentExecutionArtifacts(store, execution);
        } catch (error) {
            appLogger.error('保存 Agent 生成产物元数据失败。', error);
            const persistenceError = createArtifactPersistenceError();
            try {
                await deleteAgentExecutionFiles(execution);
            } catch (cleanupError) {
                appLogger.error('产物元数据保存失败后清理 Agent 生成文件失败。', cleanupError);
            }
            await store.failRequest({ requestId, error: errorToAgentErrorBody(persistenceError, requestId) });
            throw persistenceError;
        }
        try {
            await completeAgentExecutionState(store, execution);
        } catch (error) {
            appLogger.error('保存 Agent 生成完成状态失败。', error);
            throw createCompletionPersistenceError();
        }
        return NextResponse.json(execution.response, { headers });
    } catch (error) {
        const normalized = normalizeAgentError(error);
        return agentErrorResponse(normalized, requestId);
    }
}
