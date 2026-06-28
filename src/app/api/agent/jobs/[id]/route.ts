import { assertAgentAuthorized } from '@/lib/agent-auth';
import { assertReadableJobRecord, buildAgentJobStatusResponse, readAgentJobState } from '@/lib/agent-job-service';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { createRequestId, computeRetryAfterSeconds } from '@/lib/agent-state-store';
import { agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
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
        const retryAfterSeconds = readRetryAfterSeconds(record);
        return NextResponse.json(buildAgentJobStatusResponse(record, { retryAfterSeconds }), {
            headers: { 'X-Request-Id': requestId }
        });
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}

function readRetryAfterSeconds(record: Parameters<typeof readAgentJobState>[0]): number | undefined {
    if (readAgentJobState(record) !== 'running') return undefined;
    return computeRetryAfterSeconds(record.lockedUntil, new Date());
}
