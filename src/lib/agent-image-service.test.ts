import {
    assertAgentEditRouteAllowedFromFormData,
    buildEditRequestHash,
    completeAgentExecutionState,
    hydrateAgentReplayResponse
} from './agent-image-service';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentArtifactRecord, AgentStateStore } from './agent-state-store';

describe('buildEditRequestHash', () => {
    it('includes uploaded file bytes so same metadata with different content conflicts', async () => {
        const first = await buildEditRequestHash(makeEditForm([1, 2, 3, 4]));
        const second = await buildEditRequestHash(makeEditForm([9, 8, 7, 6]));

        assert.notEqual(first, second);
    });

    it('keeps the hash stable for identical edit form content', async () => {
        const first = await buildEditRequestHash(makeEditForm([1, 2, 3, 4]));
        const second = await buildEditRequestHash(makeEditForm([1, 2, 3, 4]));

        assert.equal(first, second);
    });
});

describe('assertAgentEditRouteAllowedFromFormData', () => {
    it('rejects auto-size edits when the source image dimensions are high resolution', async () => {
        await assert.rejects(
            () => assertAgentEditRouteAllowedFromFormData(makeEditFormWithImage(createPngWithDimensions(3072, 2048))),
            /\/api\/images/
        );
    });
});

describe('hydrateAgentReplayResponse', () => {
    it('rejects base64 replay when stored artifact filepath escapes the image directory', async () => {
        const store = createReplayStore([
            {
                id: 'artifact-escape',
                requestId: 'request-escape',
                filename: 'escape.png',
                filepath: '/etc/passwd',
                contentUrl: '/api/agent/artifacts/artifact-escape/content',
                metadataUrl: '/api/agent/artifacts/artifact-escape',
                outputFormat: 'png',
                mimeType: 'image/png',
                sizeBytes: 1,
                width: 1,
                height: 1,
                model: 'gpt-image-2',
                promptHash: 'hash',
                createdAt: '2026-05-12T00:00:00.000Z'
            }
        ]);

        await assert.rejects(
            () =>
                hydrateAgentReplayResponse(
                    store,
                    { requestId: 'request-escape', requestJson: { response_mode: 'base64' } },
                    {
                        request_id: 'request-escape',
                        idempotency_key: 'idem-escape',
                        cached: false,
                        images: [
                            {
                                id: 'artifact-escape',
                                filename: 'escape.png',
                                content_url: '/api/agent/artifacts/artifact-escape/content',
                                metadata_url: '/api/agent/artifacts/artifact-escape',
                                output_format: 'png',
                                mime_type: 'image/png',
                                size_bytes: 1,
                                width: 1,
                                height: 1
                            }
                        ],
                        created_at: '2026-05-12T00:00:00.000Z'
                    }
                ),
            /目录之外/
        );
    });
});

describe('completeAgentExecutionState', () => {
    it('does not ask the state store to upsert artifacts a second time', async () => {
        let completedArtifacts: AgentArtifactRecord[] | undefined;
        const artifact: AgentArtifactRecord = {
            id: 'artifact-complete-no-upsert',
            requestId: 'request-complete-no-upsert',
            filename: 'artifact-complete-no-upsert.png',
            filepath: '/tmp/artifact-complete-no-upsert.png',
            contentUrl: '/api/agent/artifacts/artifact-complete-no-upsert/content',
            metadataUrl: '/api/agent/artifacts/artifact-complete-no-upsert',
            outputFormat: 'png',
            mimeType: 'image/png',
            sizeBytes: 1,
            width: 1,
            height: 1,
            model: 'gpt-image-2',
            promptHash: 'hash',
            createdAt: '2026-05-12T00:00:00.000Z'
        };
        const store: AgentStateStore = {
            ...createReplayStore([]),
            async completeRequest(input) {
                completedArtifacts = input.artifacts;
            }
        };

        await completeAgentExecutionState(store, {
            response: {
                request_id: 'request-complete-no-upsert',
                idempotency_key: 'idem-complete-no-upsert',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.000Z'
            },
            stateResponse: {
                request_id: 'request-complete-no-upsert',
                idempotency_key: 'idem-complete-no-upsert',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.000Z'
            },
            artifacts: [artifact]
        });

        assert.deepEqual(completedArtifacts, []);
    });
});

function makeEditForm(bytes: number[]): FormData {
    return makeEditFormWithImage(Buffer.from(bytes));
}

function makeEditFormWithImage(buffer: Buffer): FormData {
    const formData = new FormData();
    formData.append('prompt', 'same prompt');
    formData.append('model', 'gpt-image-2');
    formData.append('response_mode', 'path');
    formData.append('image_0', new File([buffer], 'input.png', { type: 'image/png' }));
    return formData;
}

function createPngWithDimensions(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(24);
    buffer[0] = 0x89;
    buffer.write('PNG', 1, 'ascii');
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

function createReplayStore(artifacts: AgentArtifactRecord[]): AgentStateStore {
    return {
        async init() {},
        async recoverExpiredRequests() {
            return 0;
        },
        async purgeExpiredRequests() {
            return 0;
        },
        async beginRequest() {
            throw new Error('not implemented');
        },
        async refreshRequestLease() {
            return false;
        },
        async saveArtifacts() {},
        async completeRequest() {},
        async failRequest() {},
        async getRequest() {
            return undefined;
        },
        async getArtifact() {
            return undefined;
        },
        async listArtifactsForRequest() {
            return artifacts;
        },
        async deleteArtifact() {
            return false;
        }
    };
}
