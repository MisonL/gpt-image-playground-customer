import { assertAgentAuthorized } from '@/lib/agent-auth';
import { AgentApiError, agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { assertArtifactFilepathAllowed } from '@/lib/agent-file-utils';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { createRequestId } from '@/lib/agent-state-store';
import fs from 'fs/promises';
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
                message: '产物不存在。',
                status: 404,
                retryable: false
            });
        }
        assertArtifactFilepathAllowed(artifact.filepath);
        let fileBuffer: Buffer;
        try {
            fileBuffer = await fs.readFile(artifact.filepath);
        } catch (error) {
            if (isMissingArtifactFileError(error)) {
                throw new AgentApiError({
                    code: 'artifact_not_found',
                    message: '产物内容不存在。',
                    status: 404,
                    retryable: false
                });
            }
            throw error;
        }
        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': artifact.mimeType,
                'Content-Length': fileBuffer.length.toString(),
                'X-Request-Id': requestId
            }
        });
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}

function isMissingArtifactFileError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    );
}
