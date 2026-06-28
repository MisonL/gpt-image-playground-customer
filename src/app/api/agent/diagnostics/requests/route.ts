import { readAgentRequestDiagnosticsByLookup } from './diagnostics-route-utils';
import { assertAgentAuthorized } from '@/lib/agent-auth';
import { createRequestId } from '@/lib/agent-state-store';
import { agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const diagnostics = await readAgentRequestDiagnosticsByLookup(request);
        if (!diagnostics) {
            return NextResponse.json({ found: false }, { status: 404, headers: { 'X-Request-Id': requestId } });
        }
        return NextResponse.json({ found: true, diagnostics }, { headers: { 'X-Request-Id': requestId } });
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}
