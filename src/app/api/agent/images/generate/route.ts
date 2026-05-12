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
                message: 'Idempotency-Key was already used with a different request body.',
                status: 409,
                retryable: false
            });
        }
        if (beginResult.type === 'in_progress') {
            throw new AgentApiError({
                code: 'request_in_progress',
                message: 'A request with this Idempotency-Key is still running.',
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
            appLogger.error('Failed to persist Agent generate artifact metadata.', error);
            const persistenceError = createArtifactPersistenceError();
            try {
                await deleteAgentExecutionFiles(execution);
            } catch (cleanupError) {
                appLogger.error('Failed to clean up Agent generate files after metadata persistence failure.', cleanupError);
            }
            await store.failRequest({ requestId, error: errorToAgentErrorBody(persistenceError, requestId) });
            throw persistenceError;
        }
        try {
            await completeAgentExecutionState(store, execution);
        } catch (error) {
            appLogger.error('Failed to persist Agent generate completion state.', error);
            throw createCompletionPersistenceError();
        }
        return NextResponse.json(execution.response, { headers });
    } catch (error) {
        const normalized = normalizeAgentError(error);
        return agentErrorResponse(normalized, requestId);
    }
}
