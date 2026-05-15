import { SqliteAgentStateStore } from './agent-state-sqlite';
import { hashAgentPayload, type AgentArtifactRecord, type AgentImageResponse } from './agent-state-store';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

describe('SqliteAgentStateStore', () => {
    let tempDir = '';
    let store: SqliteAgentStateStore;

    before(async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-state-sqlite-'));
        store = new SqliteAgentStateStore(path.join(tempDir, 'agent.sqlite'));
        await store.init();
    });

    after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('acquires, completes, and replays idempotent requests', async () => {
        const requestJson = { prompt: 'test' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-1',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        const artifact: AgentArtifactRecord = {
            id: 'artifact-1',
            requestId: begin.record.requestId,
            filename: '1715400000000-abcdef1234567890-0.png',
            filepath: '/tmp/image.png',
            contentUrl: '/api/agent/artifacts/artifact-1/content',
            metadataUrl: '/api/agent/artifacts/artifact-1',
            outputFormat: 'png',
            mimeType: 'image/png',
            sizeBytes: 4,
            width: 1,
            height: 1,
            model: 'gpt-image-2',
            promptHash: 'hash',
            createdAt: '2026-05-12T00:00:01.000Z'
        };
        const response: AgentImageResponse = {
            request_id: begin.record.requestId,
            idempotency_key: 'idem-1',
            cached: false,
            images: [],
            created_at: '2026-05-12T00:00:01.000Z'
        };
        await store.completeRequest({ requestId: begin.record.requestId, response, artifacts: [artifact] });

        const replay = await store.beginRequest({
            idempotencyKey: 'idem-1',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:02.000Z')
        });
        assert.equal(replay.type, 'replay');
        if (replay.type !== 'replay') throw new Error('expected replay');
        assert.equal(replay.response.request_id, begin.record.requestId);
        assert.deepEqual(await store.getArtifact('artifact-1'), artifact);
    });

    it('rejects the same idempotency key with a different request hash', async () => {
        const result = await store.beginRequest({
            idempotencyKey: 'idem-1',
            requestHash: hashAgentPayload({ prompt: 'different' }),
            mode: 'generate',
            requestJson: { prompt: 'different' },
            leaseMs: 1000,
            ttlSeconds: 60
        });

        assert.equal(result.type, 'conflict');
    });

    it('rejects artifact metadata for unknown requests', async () => {
        await assert.rejects(
            () =>
                store.saveArtifacts([
                    {
                        id: 'artifact-missing-request',
                        requestId: 'missing-request',
                        filename: '1715400000000-missing-0.png',
                        filepath: '/tmp/missing.png',
                        contentUrl: '/api/agent/artifacts/artifact-missing-request/content',
                        metadataUrl: '/api/agent/artifacts/artifact-missing-request',
                        outputFormat: 'png',
                        mimeType: 'image/png',
                        sizeBytes: 1,
                        width: 1,
                        height: 1,
                        model: 'gpt-image-2',
                        promptHash: 'hash',
                        createdAt: '2026-05-12T00:00:00.000Z'
                    }
                ]),
            /FOREIGN KEY/
        );
    });

    it('replays stored failures without reacquiring the same idempotency key', async () => {
        const requestJson = { prompt: 'stored failure' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-stored-failure',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        await store.failRequest({
            requestId: begin.record.requestId,
            error: {
                error: {
                    code: 'unexpected_error',
                    message: 'stored failure',
                    retryable: true,
                    request_id: begin.record.requestId
                }
            }
        });

        const replay = await store.beginRequest({
            idempotencyKey: 'idem-stored-failure',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(replay.type, 'failed');
        if (replay.type !== 'failed') throw new Error('expected failed');
        assert.equal(replay.error.error.message, 'stored failure');
    });

    it('marks expired running requests as orphaned', async () => {
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-expired',
            requestHash: hashAgentPayload({ prompt: 'expired' }),
            mode: 'generate',
            requestJson: { prompt: 'expired' },
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');

        const recovered = await store.recoverExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));
        assert.ok(recovered >= 1);

        const reacquired = await store.beginRequest({
            idempotencyKey: 'idem-expired',
            requestHash: hashAgentPayload({ prompt: 'expired' }),
            mode: 'generate',
            requestJson: { prompt: 'expired' },
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:03.000Z')
        });
        assert.equal(reacquired.type, 'acquired');
    });

    it('recovers expired running requests with artifact metadata as succeeded', async () => {
        const requestJson = { prompt: 'recover artifact' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-recover-artifact',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        await store.saveArtifacts([
            {
                id: 'artifact-recovered',
                requestId: begin.record.requestId,
                filename: '1715400000000-recovered-0.png',
                filepath: '/tmp/recovered.png',
                contentUrl: '/api/agent/artifacts/artifact-recovered/content',
                metadataUrl: '/api/agent/artifacts/artifact-recovered',
                outputFormat: 'png',
                mimeType: 'image/png',
                sizeBytes: 8,
                width: 2,
                height: 2,
                model: 'gpt-image-2',
                promptHash: 'hash',
                createdAt: '2026-05-12T00:00:01.000Z'
            }
        ]);

        const recovered = await store.recoverExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));
        assert.ok(recovered >= 1);

        const replay = await store.beginRequest({
            idempotencyKey: 'idem-recover-artifact',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:03.000Z')
        });
        assert.equal(replay.type, 'replay');
        if (replay.type !== 'replay') throw new Error('expected replay');
        assert.equal(replay.response.request_id, begin.record.requestId);
        assert.equal(replay.response.images[0].id, 'artifact-recovered');
    });

    it('purges expired terminal requests and their artifact metadata', async () => {
        const requestJson = { prompt: 'purge expired' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-purge-expired',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 1,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        await store.completeRequest({
            requestId: begin.record.requestId,
            response: {
                request_id: begin.record.requestId,
                idempotency_key: 'idem-purge-expired',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [
                {
                    id: 'artifact-purge-expired',
                    requestId: begin.record.requestId,
                    filename: '1715400000000-purge-0.png',
                    filepath: '/tmp/purge.png',
                    contentUrl: '/api/agent/artifacts/artifact-purge-expired/content',
                    metadataUrl: '/api/agent/artifacts/artifact-purge-expired',
                    outputFormat: 'png',
                    mimeType: 'image/png',
                    sizeBytes: 1,
                    width: 1,
                    height: 1,
                    model: 'gpt-image-2',
                    promptHash: 'hash',
                    createdAt: '2026-05-12T00:00:00.500Z'
                }
            ],
            now: new Date('2026-05-12T00:00:00.500Z')
        });

        const purged = await store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));

        assert.equal(purged, 1);
        assert.equal(await store.getArtifact('artifact-purge-expired'), undefined);
    });

    it('deletes artifact files when purging expired terminal requests', async () => {
        const requestJson = { prompt: 'purge file' };
        const requestHash = hashAgentPayload(requestJson);
        const artifactPath = path.join(process.cwd(), 'generated-images', 'purge-file.png');
        await mkdir(path.dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, 'stale image');
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-purge-file',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 1,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        await store.completeRequest({
            requestId: begin.record.requestId,
            response: {
                request_id: begin.record.requestId,
                idempotency_key: 'idem-purge-file',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [
                {
                    id: 'artifact-purge-file',
                    requestId: begin.record.requestId,
                    filename: 'purge-file.png',
                    filepath: artifactPath,
                    contentUrl: '/api/agent/artifacts/artifact-purge-file/content',
                    metadataUrl: '/api/agent/artifacts/artifact-purge-file',
                    outputFormat: 'png',
                    mimeType: 'image/png',
                    sizeBytes: 10,
                    width: 1,
                    height: 1,
                    model: 'gpt-image-2',
                    promptHash: 'hash',
                    createdAt: '2026-05-12T00:00:00.500Z'
                }
            ],
            now: new Date('2026-05-12T00:00:00.500Z')
        });

        const purged = await store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));

        assert.equal(purged, 1);
        await assert.rejects(() => access(artifactPath));
    });

    it('keeps metadata when artifact file deletion fails during purge', async () => {
        const requestJson = { prompt: 'purge blocked file' };
        const requestHash = hashAgentPayload(requestJson);
        const artifactPath = path.join(process.cwd(), 'generated-images', 'purge-blocked-dir');
        await mkdir(artifactPath, { recursive: true });
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-purge-blocked-file',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 1,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        await store.completeRequest({
            requestId: begin.record.requestId,
            response: {
                request_id: begin.record.requestId,
                idempotency_key: 'idem-purge-blocked-file',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [
                {
                    id: 'artifact-purge-blocked-file',
                    requestId: begin.record.requestId,
                    filename: 'purge-blocked-dir',
                    filepath: artifactPath,
                    contentUrl: '/api/agent/artifacts/artifact-purge-blocked-file/content',
                    metadataUrl: '/api/agent/artifacts/artifact-purge-blocked-file',
                    outputFormat: 'png',
                    mimeType: 'image/png',
                    sizeBytes: 10,
                    width: 1,
                    height: 1,
                    model: 'gpt-image-2',
                    promptHash: 'hash',
                    createdAt: '2026-05-12T00:00:00.500Z'
                }
            ],
            now: new Date('2026-05-12T00:00:00.500Z')
        });

        try {
            await assert.rejects(() => store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z')));
            assert.ok(await store.getArtifact('artifact-purge-blocked-file'));
        } finally {
            await rm(artifactPath, { recursive: true, force: true });
        }
    });
});
