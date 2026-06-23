import { buildAgentJobStatusResponse, startAgentGenerateJob } from './agent-job-service';
import {
    buildGenerateRequestHash,
    parseAgentGenerateRequest,
    prepareAgentGenerate,
    resolveExistingAgentRequest,
    readIdempotencyKey
} from './agent-image-service';
import { readAgentLeaseMs, readAgentRequestTtlSeconds } from './agent-api-contracts';
import { AgentApiError, agentErrorResponse, normalizeAgentError } from './api-error-response';
import { assertAgentAuthorized } from './agent-auth';
import { ensureAgentStateStoreReady } from './agent-state-runtime';
import { createRequestId, type BeginAgentRequestResult } from './agent-state-store';
import { NextRequest, NextResponse } from 'next/server';

export async function createAgentGenerateJobResponse(
    request: NextRequest,
    options: { transportEndpoint: string }
): Promise<NextResponse> {
    let requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const imageRequest = await parseAgentGenerateRequest(request);
        const idempotencyKey = readIdempotencyKey(request.headers);
        const requestHash = buildGenerateRequestHash(imageRequest);
        const store = await ensureAgentStateStoreReady();
        const existingResponse = jobBeginResultResponse(
            resolveExistingAgentRequest(await store.getRequestByIdempotencyKey(idempotencyKey), requestHash)
        );
        if (existingResponse) return existingResponse;
        const preparation = prepareAgentGenerate(imageRequest, request.headers);
        const leaseMs = readAgentLeaseMs(process.env);
        const beginResult = await store.beginRequest({
            idempotencyKey,
            requestHash,
            mode: 'generate',
            requestJson: imageRequest,
            leaseMs,
            ttlSeconds: readAgentRequestTtlSeconds(process.env)
        });

        const storedResponse = jobBeginResultResponse(beginResult);
        if (storedResponse) return storedResponse;

        requestId = beginResult.record.requestId;
        startAgentGenerateJob({
            store,
            request: imageRequest,
            headers: new Headers(request.headers),
            requestId,
            idempotencyKey,
            leaseMs,
            preparation,
            transportEndpoint: options.transportEndpoint
        });
        return runningJobResponse(beginResult.record, 5, false);
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}

function createIdempotencyConflictError(): AgentApiError {
    return new AgentApiError({
        code: 'idempotency_conflict',
        message: 'Idempotency-Key 已被不同请求正文使用。',
        status: 409,
        retryable: false
    });
}

function jobBeginResultResponse(beginResult: BeginAgentRequestResult | undefined): NextResponse | undefined {
    if (!beginResult || beginResult.type === 'acquired') return undefined;
    if (beginResult.type === 'conflict') {
        throw createIdempotencyConflictError();
    }
    if (beginResult.type === 'replay' || beginResult.type === 'failed') {
        return NextResponse.json(buildAgentJobStatusResponse(beginResult.record), {
            status: 202,
            headers: {
                'X-Idempotent-Replay': 'true',
                'X-Request-Id': beginResult.record.requestId
            }
        });
    }
    return runningJobResponse(beginResult.record, beginResult.retryAfterSeconds, true);
}

function runningJobResponse(
    record: Parameters<typeof buildAgentJobStatusResponse>[0],
    retryAfterSeconds: number,
    replay: boolean
) {
    return NextResponse.json(buildAgentJobStatusResponse(record, { retryAfterSeconds }), {
        status: 202,
        headers: {
            'Retry-After': String(retryAfterSeconds),
            'X-Request-Id': record.requestId,
            ...(replay ? { 'X-Idempotent-Replay': 'true' } : {})
        }
    });
}
