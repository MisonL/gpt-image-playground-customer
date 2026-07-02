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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const { id } = await params;
        const targetId = normalizeFeedbackTargetId(id);
        const store = await getFeedbackStore();
        const feedback = await store.readFeedback('page_request', targetId);
        return NextResponse.json(
            {
                target: { type: 'page_request', id: targetId },
                feedback: feedback ? feedbackRecordToResponse(feedback) : null
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
