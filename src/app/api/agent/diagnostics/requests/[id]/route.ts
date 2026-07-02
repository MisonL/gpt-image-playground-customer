import { readAgentRequestDiagnosticsByRequestId } from '../diagnostics-route-utils';
import { assertAgentAuthorized } from '@/lib/agent-auth';
import { createRequestId } from '@/lib/agent-state-store';
import { agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const responseRequestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const { id } = await params;
        const diagnostics = await readAgentRequestDiagnosticsByRequestId(id);
        if (!diagnostics) {
            return NextResponse.json({ found: false }, { status: 404, headers: { 'X-Request-Id': responseRequestId } });
        }
        return NextResponse.json({ found: true, diagnostics }, { headers: { 'X-Request-Id': responseRequestId } });
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), responseRequestId);
    }
}
