import { assertAgentAuthorized } from '@/lib/agent-auth';
import { AgentApiError, agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { deleteAgentArtifactFiles } from '@/lib/agent-image-service';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { artifactRecordToResponseItem, createRequestId } from '@/lib/agent-state-store';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const { id } = await params;
        const store = await ensureAgentStateStoreReady();
        const artifact = await store.getArtifact(id);
        if (!artifact) {
            throw new AgentApiError({
                code: 'artifact_not_found',
                message: 'Artifact not found.',
                status: 404,
                retryable: false
            });
        }
        return NextResponse.json({ artifact: artifactRecordToResponseItem(artifact) }, { headers: { 'X-Request-Id': requestId } });
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const { id } = await params;
        const store = await ensureAgentStateStoreReady();
        const deleted = await deleteAgentArtifactFiles(store, id);
        if (!deleted) {
            throw new AgentApiError({
                code: 'artifact_not_found',
                message: 'Artifact not found.',
                status: 404,
                retryable: false
            });
        }
        return NextResponse.json({ deleted: true, id }, { headers: { 'X-Request-Id': requestId } });
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}
