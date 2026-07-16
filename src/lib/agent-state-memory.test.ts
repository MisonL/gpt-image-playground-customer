import type { AgentImageResponse } from './agent-api-contracts';
import { MemoryAgentStateStore } from './agent-state-memory';
import { hashAgentPayload, type AgentArtifactRecord } from './agent-state-store';
import type { FeedbackRecord } from './feedback-store';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('MemoryAgentStateStore', () => {
    it('acquires, completes, and replays idempotent requests', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const requestJson = { prompt: 'memory image' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-memory-ok',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        const response: AgentImageResponse = {
            request_id: begin.record.requestId,
            idempotency_key: 'idem-memory-ok',
            cached: false,
            images: [],
            created_at: '2026-05-12T00:00:00.500Z'
        };
        const artifact = buildArtifact({ id: 'artifact-memory-ok', requestId: begin.record.requestId });
        await store.completeRequest({
            requestId: begin.record.requestId,
            response,
            artifacts: [artifact],
            now: new Date('2026-05-12T00:00:00.500Z')
        });

        const replay = await store.beginRequest({
            idempotencyKey: 'idem-memory-ok',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:01.000Z')
        });
        assert.equal(replay.type, 'replay');
        if (replay.type !== 'replay') throw new Error('expected replay');
        assert.deepEqual(replay.response, response);
        assert.deepEqual(await store.getArtifact('artifact-memory-ok'), artifact);
    });

    it('recovers expired running requests with artifact metadata as succeeded', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const requestJson = { prompt: 'memory recovery' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-memory-recovery',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 100,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');
        await store.saveArtifacts([
            buildArtifact({ id: 'artifact-memory-recovery', requestId: begin.record.requestId })
        ]);

        const recovered = await store.recoverExpiredRequests(new Date('2026-05-12T00:00:01.000Z'));
        const replay = await store.beginRequest({
            idempotencyKey: 'idem-memory-recovery',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 100,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:02.000Z')
        });

        assert.equal(recovered, 1);
        assert.equal(replay.type, 'replay');
    });

    it('keeps refreshed running requests out of recovery', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const requestJson = { prompt: 'memory lease refresh' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-memory-refresh',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 100,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');

        assert.equal(
            await store.refreshRequestLease({
                requestId: begin.record.requestId,
                leaseMs: 1000,
                now: new Date('2026-05-12T00:00:00.050Z')
            }),
            true
        );
        assert.equal(await store.recoverExpiredRequests(new Date('2026-05-12T00:00:00.200Z')), 0);

        const retry = await store.beginRequest({
            idempotencyKey: 'idem-memory-refresh',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 100,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.200Z')
        });
        assert.equal(retry.type, 'in_progress');
    });

    it('rejects artifact metadata for unknown requests', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();

        await assert.rejects(
            () => store.saveArtifacts([buildArtifact({ id: 'artifact-memory-orphan', requestId: 'missing-request' })]),
            /FOREIGN KEY/
        );
    });

    it('lists sorted artifact filepaths for cleanup protection', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const requestJson = { prompt: 'memory cleanup protection' };
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-memory-cleanup-protection',
            requestHash: hashAgentPayload(requestJson),
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');
        const firstPath = path.join(process.cwd(), 'generated-images', 'cleanup-a.png');
        const secondPath = path.join(process.cwd(), 'generated-images', 'cleanup-b.png');

        await store.saveArtifacts([
            buildArtifact({
                id: 'artifact-memory-cleanup-b',
                requestId: begin.record.requestId,
                filepath: secondPath
            }),
            buildArtifact({
                id: 'artifact-memory-cleanup-a',
                requestId: begin.record.requestId,
                filepath: firstPath
            })
        ]);

        assert.deepEqual(await store.listArtifactFilepaths(), [firstPath, secondPath]);
    });

    it('upserts and reads result feedback for page requests', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const first: FeedbackRecord = {
            targetType: 'page_request',
            targetId: 'web-feedback-request',
            value: 'usable',
            note: 'first mark',
            source: 'webui',
            updatedAt: '2026-05-12T00:00:00.000Z'
        };
        const second: FeedbackRecord = {
            ...first,
            value: 'needs_revision',
            note: 'needs copy changes',
            updatedAt: '2026-05-12T00:01:00.000Z'
        };

        await store.upsertFeedbackBatch([first, second, { ...first, note: 'stale retry' }]);

        assert.deepEqual(await store.readFeedback('page_request', 'web-feedback-request'), second);
        assert.deepEqual(
            await store.listFeedbackByTargets([{ targetType: 'page_request', targetId: 'web-feedback-request' }]),
            [second]
        );
        assert.equal(
            await store.deleteFeedbackByTargets([{ targetType: 'page_request', targetId: 'web-feedback-request' }], {
                deletedAt: '2026-05-12T00:00:30.000Z'
            }),
            0
        );
        assert.deepEqual(await store.readFeedback('page_request', 'web-feedback-request'), second);
        assert.equal(
            await store.deleteFeedbackByTargets([{ targetType: 'page_request', targetId: 'web-feedback-request' }]),
            1
        );
        assert.equal(await store.readFeedback('page_request', 'web-feedback-request'), undefined);
    });

    it('purges expired terminal requests and their artifact files', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const tempDir = path.join(process.cwd(), 'generated-images', '.memory-purge-test', crypto.randomUUID());
        const artifactPath = path.join(tempDir, 'artifact.png');
        await mkdir(tempDir, { recursive: true });
        await writeFile(artifactPath, 'image');
        const requestJson = { prompt: 'memory purge' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-memory-purge',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 1,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');
        const artifact = buildArtifact({
            id: 'artifact-memory-purge',
            requestId: begin.record.requestId,
            filepath: artifactPath
        });
        const response: AgentImageResponse = {
            request_id: begin.record.requestId,
            idempotency_key: 'idem-memory-purge',
            cached: false,
            images: [],
            created_at: '2026-05-12T00:00:00.500Z'
        };

        try {
            await store.completeRequest({
                requestId: begin.record.requestId,
                response,
                artifacts: [artifact],
                now: new Date('2026-05-12T00:00:00.500Z')
            });

            const purged = await store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));
            assert.equal(purged, 1);
            assert.equal(await store.getArtifact('artifact-memory-purge'), undefined);
            await assert.rejects(() => access(artifactPath));
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('purges feedback rows for expired agent requests and artifacts', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const requestJson = { prompt: 'memory feedback purge' };
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-memory-feedback-purge',
            requestHash: hashAgentPayload(requestJson),
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 1,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');
        const artifact = buildArtifact({ id: 'artifact-memory-feedback-purge', requestId: begin.record.requestId });
        await store.completeRequest({
            requestId: begin.record.requestId,
            response: {
                request_id: begin.record.requestId,
                idempotency_key: 'idem-memory-feedback-purge',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [artifact],
            now: new Date('2026-05-12T00:00:00.500Z')
        });
        await store.upsertFeedback({
            targetType: 'agent_request',
            targetId: begin.record.requestId,
            value: 'usable',
            source: 'agent',
            updatedAt: '2026-05-12T00:00:00.600Z'
        });
        await store.upsertFeedback({
            targetType: 'agent_artifact',
            targetId: artifact.id,
            value: 'needs_revision',
            source: 'agent',
            updatedAt: '2026-05-12T00:00:00.700Z'
        });

        assert.equal(await store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z')), 1);
        assert.equal(await store.readFeedback('agent_request', begin.record.requestId), undefined);
        assert.equal(await store.readFeedback('agent_artifact', artifact.id), undefined);
    });

    it('deletes artifact feedback when deleting artifact metadata', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const requestJson = { prompt: 'memory artifact feedback delete' };
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-memory-artifact-feedback-delete',
            requestHash: hashAgentPayload(requestJson),
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');
        const artifact = buildArtifact({ id: 'artifact-memory-feedback-delete', requestId: begin.record.requestId });
        await store.saveArtifacts([artifact]);
        await store.upsertFeedback({
            targetType: 'agent_artifact',
            targetId: artifact.id,
            value: 'usable',
            source: 'agent',
            updatedAt: '2026-05-12T00:00:00.000Z'
        });

        assert.equal(await store.deleteArtifact(artifact.id), true);
        assert.equal(await store.readFeedback('agent_artifact', artifact.id), undefined);
    });

    it('does not replace a different artifact row when filename collides', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const beginA = await store.beginRequest({
            idempotencyKey: 'idem-memory-collision-a',
            requestHash: hashAgentPayload({ prompt: 'collision a' }),
            mode: 'generate',
            requestJson: { prompt: 'collision a' },
            leaseMs: 1000,
            ttlSeconds: 60
        });
        const beginB = await store.beginRequest({
            idempotencyKey: 'idem-memory-collision-b',
            requestHash: hashAgentPayload({ prompt: 'collision b' }),
            mode: 'generate',
            requestJson: { prompt: 'collision b' },
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(beginA.type, 'acquired');
        assert.equal(beginB.type, 'acquired');
        if (beginA.type !== 'acquired' || beginB.type !== 'acquired') throw new Error('expected acquired');
        const first = buildArtifact({
            id: 'artifact-memory-a',
            requestId: beginA.record.requestId,
            filename: 'shared.png'
        });
        const second = buildArtifact({
            id: 'artifact-memory-b',
            requestId: beginB.record.requestId,
            filename: 'shared.png'
        });

        await store.saveArtifacts([first]);
        await assert.rejects(() => store.saveArtifacts([second]), /UNIQUE/);

        assert.deepEqual(await store.getArtifact('artifact-memory-a'), first);
        assert.equal(await store.getArtifact('artifact-memory-b'), undefined);
    });

    it('rejects attempts to rewrite an existing artifact id with different metadata', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        const beginA = await store.beginRequest({
            idempotencyKey: 'idem-memory-artifact-a',
            requestHash: hashAgentPayload({ prompt: 'artifact a' }),
            mode: 'generate',
            requestJson: { prompt: 'artifact a' },
            leaseMs: 1000,
            ttlSeconds: 60
        });
        const beginB = await store.beginRequest({
            idempotencyKey: 'idem-memory-artifact-b',
            requestHash: hashAgentPayload({ prompt: 'artifact b' }),
            mode: 'generate',
            requestJson: { prompt: 'artifact b' },
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(beginA.type, 'acquired');
        assert.equal(beginB.type, 'acquired');
        if (beginA.type !== 'acquired' || beginB.type !== 'acquired') throw new Error('expected acquired');
        const first = buildArtifact({
            id: 'artifact-memory-stable',
            requestId: beginA.record.requestId,
            filename: 'stable-a.png'
        });
        const rewritten = buildArtifact({
            id: 'artifact-memory-stable',
            requestId: beginB.record.requestId,
            filename: 'stable-b.png'
        });

        await store.saveArtifacts([first]);
        await assert.rejects(() => store.saveArtifacts([rewritten]), /artifact metadata conflict/);

        assert.deepEqual(await store.getArtifact('artifact-memory-stable'), first);
    });

    it('stores and reads image share metadata', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();

        await store.createImageShareRecord({
            token: 'c'.repeat(24),
            sourceFilename: 'source.png',
            contentFilename: `${'c'.repeat(24)}.png`,
            mimeType: 'image/png',
            sizeBytes: 12,
            createdAt: '2026-05-14T08:00:00.000Z',
            accessCodeRequired: true,
            expiresAt: '2026-05-14T09:00:00.000Z',
            accessCodeSalt: 'salt',
            accessCodeHash: 'hash'
        });

        const record = await store.readImageShareRecord('c'.repeat(24));
        assert.ok(record);
        assert.equal(record.sourceFilename, 'source.png');
        assert.equal(record.accessCodeRequired, true);
        assert.equal(record.expiresAt, '2026-05-14T09:00:00.000Z');
    });

    it('rejects inconsistent image share access code metadata', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();

        await assert.rejects(
            () =>
                store.createImageShareRecord({
                    token: 'f'.repeat(24),
                    sourceFilename: 'protected.png',
                    contentFilename: `${'f'.repeat(24)}.png`,
                    mimeType: 'image/png',
                    sizeBytes: 12,
                    createdAt: '2026-05-14T08:00:00.000Z',
                    accessCodeRequired: true
                }),
            /CHECK/
        );
        await assert.rejects(
            () =>
                store.createImageShareRecord({
                    token: '0'.repeat(24),
                    sourceFilename: 'public.png',
                    contentFilename: `${'0'.repeat(24)}.png`,
                    mimeType: 'image/png',
                    sizeBytes: 12,
                    createdAt: '2026-05-14T08:00:00.000Z',
                    accessCodeRequired: false,
                    accessCodeSalt: 'salt',
                    accessCodeHash: 'hash'
                }),
            /CHECK/
        );
    });

    it('deletes expired image share records and lists active share records', async () => {
        const store = new MemoryAgentStateStore();
        await store.init();
        await store.createImageShareRecord({
            token: 'd'.repeat(24),
            sourceFilename: 'expired.png',
            contentFilename: `${'d'.repeat(24)}.png`,
            mimeType: 'image/png',
            sizeBytes: 12,
            createdAt: '2026-05-14T08:00:00.000Z',
            accessCodeRequired: false,
            expiresAt: '2026-05-14T09:00:00.000Z'
        });
        await store.createImageShareRecord({
            token: 'e'.repeat(24),
            sourceFilename: 'active.png',
            contentFilename: `${'e'.repeat(24)}.png`,
            mimeType: 'image/png',
            sizeBytes: 12,
            createdAt: '2026-05-14T08:00:00.000Z',
            accessCodeRequired: false,
            expiresAt: '2026-05-14T10:00:00.000Z'
        });

        const expired = await store.deleteExpiredImageShareRecords('2026-05-14T09:00:01.000Z');
        const active = await store.listImageShareRecords();

        assert.deepEqual(
            expired.map((record) => record.token),
            ['d'.repeat(24)]
        );
        assert.deepEqual(
            active.map((record) => record.token),
            ['e'.repeat(24)]
        );
    });
});

function buildArtifact(input: {
    id: string;
    requestId: string;
    filename?: string;
    filepath?: string;
}): AgentArtifactRecord {
    return {
        id: input.id,
        requestId: input.requestId,
        filename: input.filename || `${input.id}.png`,
        filepath: input.filepath || path.join(process.cwd(), 'generated-images', `${input.id}.png`),
        contentUrl: `/api/agent/artifacts/${input.id}/content`,
        metadataUrl: `/api/agent/artifacts/${input.id}`,
        outputFormat: 'png',
        mimeType: 'image/png',
        sizeBytes: 1,
        width: 1,
        height: 1,
        model: 'gpt-image-2',
        promptHash: 'hash',
        createdAt: '2026-05-12T00:00:00.500Z'
    };
}
