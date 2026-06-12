import { SQLITE_SCHEMA, SqliteAgentStateStore } from './agent-state-sqlite';
import type { AgentImageResponse } from './agent-api-contracts';
import { hashAgentPayload, type AgentArtifactRecord } from './agent-state-store';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
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

    it('upserts feedback rows by target type and id', async () => {
        const first = {
            targetType: 'page_request' as const,
            targetId: 'web-sqlite-feedback',
            value: 'usable' as const,
            note: 'works for review',
            source: 'webui' as const,
            updatedAt: '2026-05-12T00:00:00.000Z'
        };
        const second = {
            ...first,
            value: 'needs_revision' as const,
            note: 'needs crop fix',
            updatedAt: '2026-05-12T00:02:00.000Z'
        };

        await store.upsertFeedbackBatch([first, second, { ...first, note: 'stale retry' }]);

        assert.deepEqual(await store.readFeedback('page_request', 'web-sqlite-feedback'), second);
        assert.equal(
            await store.deleteFeedbackByTargets([{ targetType: 'page_request', targetId: 'web-sqlite-feedback' }], {
                deletedAt: '2026-05-12T00:01:00.000Z'
            }),
            0
        );
        assert.deepEqual(await store.readFeedback('page_request', 'web-sqlite-feedback'), second);
        assert.equal(await store.deleteFeedbackByTargets([{ targetType: 'page_request', targetId: 'web-sqlite-feedback' }]), 1);
        assert.equal(await store.readFeedback('page_request', 'web-sqlite-feedback'), undefined);
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

    it('keeps refreshed running requests out of recovery', async () => {
        const requestJson = { prompt: 'sqlite lease refresh' };
        const requestHash = hashAgentPayload(requestJson);
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-sqlite-refresh',
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
        await store.recoverExpiredRequests(new Date('2026-05-12T00:00:00.200Z'));

        const retry = await store.beginRequest({
            idempotencyKey: 'idem-sqlite-refresh',
            requestHash,
            mode: 'generate',
            requestJson,
            leaseMs: 100,
            ttlSeconds: 60,
            now: new Date('2026-05-12T00:00:00.200Z')
        });
        assert.equal(retry.type, 'in_progress');
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

    it('purges feedback rows for expired agent requests and artifacts', async () => {
        const requestJson = { prompt: 'sqlite feedback purge' };
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-sqlite-feedback-purge',
            requestHash: hashAgentPayload(requestJson),
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 1,
            now: new Date('2026-05-12T00:00:00.000Z')
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');
        const artifact = buildArtifact({
            id: 'artifact-sqlite-feedback-purge',
            requestId: begin.record.requestId,
            filename: 'sqlite-feedback-purge.png'
        });
        await store.completeRequest({
            requestId: begin.record.requestId,
            response: {
                request_id: begin.record.requestId,
                idempotency_key: 'idem-sqlite-feedback-purge',
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
        const requestJson = { prompt: 'sqlite artifact feedback delete' };
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-sqlite-artifact-feedback-delete',
            requestHash: hashAgentPayload(requestJson),
            mode: 'generate',
            requestJson,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(begin.type, 'acquired');
        if (begin.type !== 'acquired') throw new Error('expected acquired');
        const artifact = buildArtifact({
            id: 'artifact-sqlite-feedback-delete',
            requestId: begin.record.requestId,
            filename: 'sqlite-feedback-delete.png'
        });
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

    it('purges directory artifact paths through the same relocation flow', async () => {
        const requestJson = { prompt: 'purge directory artifact' };
        const requestHash = hashAgentPayload(requestJson);
        const artifactBaseName = `purge-directory-artifact-${crypto.randomUUID()}`;
        const artifactParentPath = path.join(process.cwd(), 'generated-images', '.sqlite-purge-dir-test');
        const artifactPath = path.join(artifactParentPath, artifactBaseName);
        await mkdir(artifactPath, { recursive: true });
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-purge-directory-artifact',
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
                idempotency_key: 'idem-purge-directory-artifact',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [
                {
                    id: 'artifact-purge-directory-artifact',
                    requestId: begin.record.requestId,
                    filename: 'purge-directory-artifact',
                    filepath: artifactPath,
                    contentUrl: '/api/agent/artifacts/artifact-purge-directory-artifact/content',
                    metadataUrl: '/api/agent/artifacts/artifact-purge-directory-artifact',
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
            const purged = await store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));
            assert.equal(purged, 1);
            await assert.rejects(() => access(artifactPath));
            assert.equal(await store.getArtifact('artifact-purge-directory-artifact'), undefined);
            const entries = await readdir(artifactParentPath);
            assert.deepEqual(entries.filter((entry) => entry.startsWith(`${artifactBaseName}.purge-`)), []);
        } finally {
            await rm(artifactParentPath, { recursive: true, force: true });
        }
    });

    it('does not replace a different artifact row when filename collides', async () => {
        const requestJsonA = { prompt: 'file collision A' };
        const requestJsonB = { prompt: 'file collision B' };
        const beginA = await store.beginRequest({
            idempotencyKey: 'idem-collision-a',
            requestHash: hashAgentPayload(requestJsonA),
            mode: 'generate',
            requestJson: requestJsonA,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        const beginB = await store.beginRequest({
            idempotencyKey: 'idem-collision-b',
            requestHash: hashAgentPayload(requestJsonB),
            mode: 'generate',
            requestJson: requestJsonB,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(beginA.type, 'acquired');
        assert.equal(beginB.type, 'acquired');
        if (beginA.type !== 'acquired' || beginB.type !== 'acquired') throw new Error('expected acquired');

        const sharedFilename = 'shared-name.png';
        await store.completeRequest({
            requestId: beginA.record.requestId,
            response: {
                request_id: beginA.record.requestId,
                idempotency_key: 'idem-collision-a',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [
                buildArtifact({
                    id: 'artifact-collision-a',
                    requestId: beginA.record.requestId,
                    filename: sharedFilename
                })
            ]
        });

        await assert.rejects(
            () =>
                store.completeRequest({
                    requestId: beginB.record.requestId,
                    response: {
                        request_id: beginB.record.requestId,
                        idempotency_key: 'idem-collision-b',
                        cached: false,
                        images: [],
                        created_at: '2026-05-12T00:00:00.600Z'
                    },
                    artifacts: [
                        buildArtifact({
                            id: 'artifact-collision-b',
                            requestId: beginB.record.requestId,
                            filename: sharedFilename
                        })
                    ]
                }),
            /UNIQUE/
        );
        assert.ok(await store.getArtifact('artifact-collision-a'));
        assert.equal(await store.getArtifact('artifact-collision-b'), undefined);
    });

    it('restores moved artifact files when purge fails after file relocation', async () => {
        const requestJson = { prompt: 'purge restore on failure' };
        const requestHash = hashAgentPayload(requestJson);
        const artifactPath = path.join(process.cwd(), 'generated-images', '.sqlite-purge-test', `${crypto.randomUUID()}.png`);
        await mkdir(path.dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, 'stale image');
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-purge-restore-file',
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
                idempotency_key: 'idem-purge-restore-file',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [
                {
                    id: 'artifact-purge-restore-file',
                    requestId: begin.record.requestId,
                    filename: 'sqlite-purge-restore.png',
                    filepath: artifactPath,
                    contentUrl: '/api/agent/artifacts/artifact-purge-restore-file/content',
                    metadataUrl: '/api/agent/artifacts/artifact-purge-restore-file',
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
        try {
            const db = (store as unknown as { db: { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): void } } }).db;
            db.exec(
                "CREATE TRIGGER purge_fail_guard BEFORE DELETE ON agent_requests BEGIN SELECT RAISE(ABORT, 'purge failed'); END;"
            );
            await assert.rejects(() => store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z')), /purge failed/);
            await assert.doesNotReject(() => access(artifactPath));
            assert.ok(await store.getArtifact('artifact-purge-restore-file'));
        } finally {
            const db = (store as unknown as { db: { exec(sql: string): void } }).db;
            db.exec('DROP TRIGGER IF EXISTS purge_fail_guard');
            await rm(path.dirname(artifactPath), { recursive: true, force: true });
        }
    });

    it('continues purging expired requests after a guarded purge failure', async () => {
        const requestJson = { prompt: 'purge after guarded failure' };
        const begin = await store.beginRequest({
            idempotencyKey: 'idem-purge-after-guarded-failure',
            requestHash: hashAgentPayload(requestJson),
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
                idempotency_key: 'idem-purge-after-guarded-failure',
                cached: false,
                images: [],
                created_at: '2026-05-12T00:00:00.500Z'
            },
            artifacts: [],
            now: new Date('2026-05-12T00:00:00.500Z')
        });

        await assert.doesNotReject(() => store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z')));
    });

    it('stores and reads image share metadata', async () => {
        await store.createImageShareRecord({
            token: 'b'.repeat(24),
            sourceFilename: 'source.png',
            contentFilename: `${'b'.repeat(24)}.png`,
            mimeType: 'image/png',
            sizeBytes: 12,
            createdAt: '2026-05-14T08:00:00.000Z',
            accessCodeRequired: true,
            expiresAt: '2026-05-14T09:00:00.000Z',
            accessCodeSalt: 'salt',
            accessCodeHash: 'hash'
        });

        const record = await store.readImageShareRecord('b'.repeat(24));
        assert.ok(record);
        assert.equal(record.sourceFilename, 'source.png');
        assert.equal(record.accessCodeRequired, true);
        assert.equal(record.expiresAt, '2026-05-14T09:00:00.000Z');
    });

    it('rejects invalid protected image share metadata at the schema boundary', async () => {
        const db = new Database(path.join(tempDir, 'invalid-share-schema.sqlite'));
        db.exec(SQLITE_SCHEMA);

        try {
            assert.throws(
                () =>
                    db.prepare(
                        `INSERT INTO image_shares
                            (token, source_filename, content_filename, mime_type, size_bytes, created_at, access_code_required)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`
                    ).run('f'.repeat(24), 'source.png', `${'f'.repeat(24)}.png`, 'image/png', 12, '2026-05-14T08:00:00.000Z', 1),
                /CHECK/
            );
        } finally {
            db.close();
        }
    });

    it('rejects applied migration checksum drift', async () => {
        const dbPath = path.join(tempDir, 'migration-checksum-drift.sqlite');
        const db = new Database(dbPath);
        db.exec(`
            CREATE TABLE state_schema_migrations (
                id TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );
            INSERT INTO state_schema_migrations (id, checksum, applied_at)
            VALUES ('001_agent_state_core', 'bad-checksum', '2026-05-14T08:00:00.000Z');
        `);
        db.close();
        const drifted = new SqliteAgentStateStore(dbPath);

        await assert.rejects(() => drifted.init(), /checksum/);
    });

    it('rejects attempts to rewrite an existing artifact id with different metadata', async () => {
        const requestJsonA = { prompt: 'stable artifact A' };
        const requestJsonB = { prompt: 'stable artifact B' };
        const beginA = await store.beginRequest({
            idempotencyKey: 'idem-stable-artifact-a',
            requestHash: hashAgentPayload(requestJsonA),
            mode: 'generate',
            requestJson: requestJsonA,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        const beginB = await store.beginRequest({
            idempotencyKey: 'idem-stable-artifact-b',
            requestHash: hashAgentPayload(requestJsonB),
            mode: 'generate',
            requestJson: requestJsonB,
            leaseMs: 1000,
            ttlSeconds: 60
        });
        assert.equal(beginA.type, 'acquired');
        assert.equal(beginB.type, 'acquired');
        if (beginA.type !== 'acquired' || beginB.type !== 'acquired') throw new Error('expected acquired');
        const first = buildArtifact({
            id: 'artifact-stable-sqlite',
            requestId: beginA.record.requestId,
            filename: 'stable-sqlite-a.png'
        });
        const rewritten = buildArtifact({
            id: 'artifact-stable-sqlite',
            requestId: beginB.record.requestId,
            filename: 'stable-sqlite-b.png'
        });

        await store.saveArtifacts([first]);
        await assert.rejects(() => store.saveArtifacts([rewritten]), /artifact metadata conflict/);

        assert.deepEqual(await store.getArtifact('artifact-stable-sqlite'), first);
    });

    it('deletes expired image share records and lists active share records', async () => {
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

        assert.equal(expired.some((record) => record.token === 'd'.repeat(24)), true);
        assert.equal(active.some((record) => record.token === 'e'.repeat(24)), true);
    });

    it('records schema migrations and keeps repeated init idempotent', async () => {
        const dbPath = path.join(tempDir, 'migration-idempotent.sqlite');
        const first = new SqliteAgentStateStore(dbPath);
        await first.init();
        const second = new SqliteAgentStateStore(dbPath);
        await second.init();
        const db = new Database(dbPath, { readonly: true });

        try {
            const rows = db
                .prepare('SELECT id FROM state_schema_migrations ORDER BY id ASC')
                .all() as Array<{ id: string }>;
            assert.deepEqual(
                rows.map((row) => row.id),
                ['001_agent_state_core', '002_image_shares', '003_result_feedback']
            );
        } finally {
            db.close();
        }
    });
});

function buildArtifact(input: {
    id: string;
    requestId: string;
    filename: string;
}): AgentArtifactRecord {
    return {
        id: input.id,
        requestId: input.requestId,
        filename: input.filename,
        filepath: path.join(process.cwd(), 'generated-images', `${input.id}.png`),
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
