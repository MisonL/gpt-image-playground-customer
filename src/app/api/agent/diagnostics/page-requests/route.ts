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

const MAX_PAGE_REQUEST_IDS = 50;
const MAX_FILENAME_FILTERS = 20;

export async function POST(request: NextRequest) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const body = await readJsonBody(request);
        const ids = readPageRequestIds(body.ids);
        const filenames = readFilenameFilters(body.filenames);
        const logs = readAppLogEntries();
        const diagnosticsRetention = buildPageRequestDiagnosticsRetention(process.env);
        return NextResponse.json(
            {
                targets: ids.map((id) => ({ type: 'page_request', id })),
                diagnostics_retention: diagnosticsRetention,
                diagnostics: ids.map((id) => {
                    const diagnostics = buildPageRequestDiagnostics({
                        logs,
                        clientRequestId: id,
                        filenames
                    });
                    const diagnosticsNote = buildPageRequestDiagnosticsNoMatchNote({
                        matchedLogCount: diagnostics.matched_log_count,
                        retention: diagnosticsRetention
                    });
                    return {
                        client_request_id: id,
                        ...diagnostics,
                        diagnostics_retention: diagnosticsRetention,
                        ...(diagnosticsNote ? { diagnostics_note: diagnosticsNote } : {})
                    };
                })
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

async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
    try {
        return readBodyObject(await request.json());
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new FeedbackValidationError('请求体必须是有效 JSON。');
        }
        throw error;
    }
}

function readBodyObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new FeedbackValidationError('请求体必须是 JSON 对象。');
    }
    return value as Record<string, unknown>;
}

function readPageRequestIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new FeedbackValidationError('ids 数量无效。');
    }
    if (value.some((id) => typeof id !== 'string')) {
        throw new FeedbackValidationError('ids 数组必须只包含字符串 ID。');
    }
    const uniqueIds = Array.from(new Set(value.map(normalizeFeedbackTargetId)));
    if (uniqueIds.length === 0 || uniqueIds.length > MAX_PAGE_REQUEST_IDS) {
        throw new FeedbackValidationError('ids 数量无效。');
    }
    return uniqueIds;
}

function readFilenameFilters(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_FILENAME_FILTERS) {
        throw new FeedbackValidationError('filename 过滤条件数量无效。');
    }
    return Array.from(
        new Set(
            value.map((filename) => {
                if (typeof filename !== 'string') {
                    throw new FeedbackValidationError('filename 过滤条件必须是字符串。');
                }
                return filename.trim();
            })
        )
    ).filter(Boolean);
}
