import { readAgentLeaseMs, readAgentRequestTtlSeconds } from '@/lib/agent-api-contracts';
import { assertAgentAuthorized } from '@/lib/agent-auth';
import {
    agentBeginResultResponse,
    buildGenerateRequestHash,
    completeAgentExecutionState,
    createArtifactPersistenceError,
    createCompletionPersistenceError,
    deleteAgentExecutionFiles,
    errorToAgentErrorBody,
    executeAgentGenerate,
    parseAgentGenerateRequest,
    prepareAgentGenerate,
    readIdempotencyKey,
    resolveExistingAgentRequest,
    saveAgentExecutionArtifacts
} from '@/lib/agent-image-service';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { createRequestId } from '@/lib/agent-state-store';
import { agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { appLogger } from '@/lib/app-logger';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    let requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const imageRequest = await parseAgentGenerateRequest(request);
        const idempotencyKey = readIdempotencyKey(request.headers);
        const requestHash = buildGenerateRequestHash(imageRequest);
        const store = await ensureAgentStateStoreReady();
        const existingResult = resolveExistingAgentRequest(
            await store.getRequestByIdempotencyKey(idempotencyKey),
            requestHash
        );
        if (existingResult) {
            return await agentBeginResultResponse(existingResult, store);
        }
        const preparation = prepareAgentGenerate(imageRequest, request.headers);
        const beginResult = await store.beginRequest({
            idempotencyKey,
            requestHash,
            mode: 'generate',
            requestJson: imageRequest,
            leaseMs: readAgentLeaseMs(process.env),
            ttlSeconds: readAgentRequestTtlSeconds(process.env)
        });

        const storedResult = await agentBeginResultResponse(beginResult, store);
        if (storedResult) {
            return storedResult;
        }

        requestId = beginResult.record.requestId;
        const execution = await executeAgentGenerate({
            request: imageRequest,
            headers: request.headers,
            requestId,
            idempotencyKey,
            cached: false,
            preparation,
            abortSignal: request.signal
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
