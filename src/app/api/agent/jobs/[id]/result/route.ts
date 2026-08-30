import { assertAgentAuthorized } from '@/lib/agent-auth';
import { assertReadableJobRecord, readAgentJobState, readJobResult } from '@/lib/agent-job-service';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { computeRetryAfterSeconds, createRequestId } from '@/lib/agent-state-store';
import {
    AgentApiError,
    agentErrorResponse,
    normalizeAgentError,
    storedAgentErrorResponse
} from '@/lib/api-error-response';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
    let requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const { id } = await context.params;
        const store = await ensureAgentStateStoreReady();
        const record = assertReadableJobRecord(await store.getRequest(id), id);
        requestId = record.requestId;
        const result = await readJobResult(store, record);
        if (result.type === 'response') {
            return NextResponse.json(result.response, { headers: { 'X-Request-Id': requestId } });
        }
        if (result.type === 'stored_error') {
            return storedAgentErrorResponse(result.error);
        }
        throw createJobInProgressError(record);
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}

function createJobInProgressError(record: Parameters<typeof readAgentJobState>[0]): AgentApiError {
    const retryAfterSeconds = computeRetryAfterSeconds(record.lockedUntil, new Date());
    return new AgentApiError({
        code: 'request_in_progress',
        message: 'Agent job 仍在排队或运行中。',
        status: 409,
        retryable: true,
        retryAfterSeconds
    });
}
