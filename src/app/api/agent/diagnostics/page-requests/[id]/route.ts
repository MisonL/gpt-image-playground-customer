import { assertAgentAuthorized } from '@/lib/agent-auth';
import {
    buildPageRequestDiagnosticsNoMatchNote,
    buildPageRequestDiagnosticsRetention
} from '@/lib/agent-api-contracts';
import { buildPageRequestDiagnostics } from '@/lib/agent-request-diagnostics';
import { createRequestId } from '@/lib/agent-state-store';
import { AgentApiError, agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { readAppLogEntries } from '@/lib/app-logger';
import { FeedbackValidationError, normalizeFeedbackTargetId } from '@/lib/feedback-store';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FILENAME_FILTERS = 20;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const { id } = await params;
        const clientRequestId = normalizeFeedbackTargetId(id);
        const filenames = readFilenameFilters(request);
        const diagnosticsRetention = buildPageRequestDiagnosticsRetention(process.env);
        const diagnostics = buildPageRequestDiagnostics({
            logs: readAppLogEntries(),
            clientRequestId,
            filenames
        });
        const diagnosticsNote = buildPageRequestDiagnosticsNoMatchNote({
            matchedLogCount: diagnostics.matched_log_count,
            retention: diagnosticsRetention
        });
        return NextResponse.json(
            {
                ...diagnostics,
                diagnostics_retention: diagnosticsRetention,
                ...(diagnosticsNote ? { diagnostics_note: diagnosticsNote } : {})
            },
            { headers: { 'X-Request-Id': requestId } }
        );
    } catch (error) {
        if (error instanceof FeedbackValidationError) {
            return agentErrorResponse(
                new AgentApiError({
                    code: 'validation_error',
                    message: error.message,
                    status: 422,
                    retryable: false
                }),
                requestId
            );
        }
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}

function readFilenameFilters(request: NextRequest): string[] {
    const values = new URL(request.url).searchParams.getAll('filename').map((value) => value.trim()).filter(Boolean);
    if (values.length > MAX_FILENAME_FILTERS) {
        throw new FeedbackValidationError('filename 过滤条件数量无效。');
    }
    return Array.from(new Set(values));
}
