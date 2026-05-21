import { buildAgentJobStatusResponse, startAgentGenerateJob } from '@/lib/agent-job-service';
import {
    buildGenerateRequestHash,
    parseAgentGenerateRequest,
    readIdempotencyKey
} from '@/lib/agent-image-service';
import { readAgentLeaseMs, readAgentRequestTtlSeconds } from '@/lib/agent-api-contracts';
import { AgentApiError, agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { assertAgentAuthorized } from '@/lib/agent-auth';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { createRequestId } from '@/lib/agent-state-store';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    let requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const imageRequest = await parseAgentGenerateRequest(request);
        const idempotencyKey = readIdempotencyKey(request.headers);
        const store = await ensureAgentStateStoreReady();
        const leaseMs = readAgentLeaseMs(process.env);
        const beginResult = await store.beginRequest({
            idempotencyKey,
            requestHash: buildGenerateRequestHash(imageRequest),
            mode: 'generate',
            requestJson: imageRequest,
            leaseMs,
            ttlSeconds: readAgentRequestTtlSeconds(process.env)
        });

        if (beginResult.type === 'conflict') {
            throw createIdempotencyConflictError();
        }
        if (beginResult.type === 'replay' || beginResult.type === 'failed') {
            requestId = beginResult.record.requestId;
            return NextResponse.json(buildAgentJobStatusResponse(beginResult.record), {
                status: 202,
                headers: { 'X-Idempotent-Replay': 'true', 'X-Request-Id': requestId }
            });
        }
        if (beginResult.type === 'in_progress') {
            requestId = beginResult.record.requestId;
            return runningJobResponse(beginResult.record, beginResult.retryAfterSeconds, true);
        }

        requestId = beginResult.record.requestId;
        startAgentGenerateJob({
            store,
            request: imageRequest,
            headers: new Headers(request.headers),
            requestId,
            idempotencyKey,
            leaseMs
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

function runningJobResponse(record: Parameters<typeof buildAgentJobStatusResponse>[0], retryAfterSeconds: number, replay: boolean) {
    return NextResponse.json(buildAgentJobStatusResponse(record, { retryAfterSeconds }), {
        status: 202,
        headers: {
            'Retry-After': String(retryAfterSeconds),
            'X-Request-Id': record.requestId,
            ...(replay ? { 'X-Idempotent-Replay': 'true' } : {})
        }
    });
}
