import { assertAgentAuthorized } from '@/lib/agent-auth';
import { createRequestId } from '@/lib/agent-state-store';
import { AgentApiError, agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import {
    FeedbackValidationError,
    feedbackRecordToResponse,
    getFeedbackStore,
    normalizeFeedbackTargetId
} from '@/lib/feedback-store';
import { NextRequest, NextResponse } from 'next/server';

const MAX_PAGE_REQUEST_IDS = 50;

export async function POST(request: NextRequest) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const body = await readJsonBody(request);
        const ids = readPageRequestIds(body.ids);
        const store = await getFeedbackStore();
        const targets = ids.map((id) => ({ targetType: 'page_request' as const, targetId: id }));
        const feedback = await store.listFeedbackByTargets(targets);
        return NextResponse.json(
            {
                targets: ids.map((id) => ({ type: 'page_request', id })),
                feedback: feedback.map(feedbackRecordToResponse)
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
        throw new FeedbackValidationError('ids 必须是数组。');
    }
    if (value.some((id) => typeof id !== 'string')) {
        throw new FeedbackValidationError('ids 数组必须只包含字符串 ID。');
    }
    const uniqueIds = Array.from(new Set(value.map(normalizeFeedbackTargetId)));
    if (uniqueIds.length === 0 || uniqueIds.length > MAX_PAGE_REQUEST_IDS) {
        throw new FeedbackValidationError(`ids 必须包含 1 到 ${MAX_PAGE_REQUEST_IDS} 个元素。`);
    }
    return uniqueIds;
}
