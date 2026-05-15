import { POSTGRES_SCHEMA, PostgresAgentStateStore } from './agent-state-postgres';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Pool } from 'pg';

describe('PostgresAgentStateStore schema contract', () => {
    it('uses JSONB for request, response, error, and recovery event details', () => {
        assert.match(POSTGRES_SCHEMA, /request_json JSONB NOT NULL/);
        assert.match(POSTGRES_SCHEMA, /response_json JSONB/);
        assert.match(POSTGRES_SCHEMA, /error_json JSONB/);
        assert.match(POSTGRES_SCHEMA, /details_json JSONB NOT NULL/);
    });

    it('uses unique keys and indexes required for idempotency and artifact lookup', () => {
        assert.match(POSTGRES_SCHEMA, /idempotency_key TEXT NOT NULL UNIQUE/);
        assert.match(POSTGRES_SCHEMA, /filename TEXT NOT NULL UNIQUE/);
        assert.match(POSTGRES_SCHEMA, /content_filename TEXT NOT NULL UNIQUE/);
        assert.match(POSTGRES_SCHEMA, /idx_agent_requests_status_locked_until/);
        assert.match(POSTGRES_SCHEMA, /idx_agent_artifacts_request_id/);
        assert.match(POSTGRES_SCHEMA, /idx_image_shares_expires_at/);
    });

    it('uses SKIP LOCKED for recovery selection so concurrent workers do not block each other', () => {
        const source = readFileSync(new URL('./agent-state-postgres.ts', import.meta.url), 'utf8');

        assert.match(source, /FOR UPDATE SKIP LOCKED/);
    });

    it('uses conflict-safe insertion for first idempotency acquisition', () => {
        const source = readFileSync(new URL('./agent-state-postgres.ts', import.meta.url), 'utf8');

        assert.match(source, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
    });
});

const livePostgresUrl = process.env.AGENT_POSTGRES_TEST_DATABASE_URL;

describe('PostgresAgentStateStore live concurrency contract', { skip: livePostgresUrl ? false : 'AGENT_POSTGRES_TEST_DATABASE_URL is not set' }, () => {
    it('allows only one winner for concurrent identical idempotency acquisition', async () => {
        assert.ok(livePostgresUrl);
        const schemaName = `agent_pg_${crypto.randomUUID().replaceAll('-', '')}`;
        const schema = quoteIdent(schemaName);
        const pool = new Pool({ connectionString: livePostgresUrl, max: 2 });
        const admin = await pool.connect();
        const connectionString = `${livePostgresUrl}${livePostgresUrl.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schemaName}`;
        const store = new PostgresAgentStateStore(connectionString);

        try {
            await admin.query(`CREATE SCHEMA ${schema}`);
            await store.init();
            const inputs = Array.from({ length: 6 }, () =>
                store.beginRequest({
                    idempotencyKey: 'same-idempotency-key',
                    requestHash: 'same-request-hash',
                    mode: 'generate' as const,
                    requestJson: { prompt: 'same prompt' },
                    leaseMs: 60_000,
                    ttlSeconds: 60,
                    now: new Date('2026-05-12T00:00:00.000Z')
                })
            );

            const results = await Promise.all(inputs);
            assert.equal(results.filter((result) => result.type === 'acquired').length, 1);
            assert.equal(results.filter((result) => result.type === 'in_progress').length, 5);

            const count = await admin.query(
                `SELECT COUNT(*)::int AS count FROM ${schema}.agent_requests WHERE idempotency_key = $1`,
                ['same-idempotency-key']
            );
            assert.equal(count.rows[0].count, 1);
        } finally {
            await store.close();
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
            admin.release();
            await pool.end();
        }
    });

    it('skips rows locked by another recovery worker', async () => {
        assert.ok(livePostgresUrl);
        const schemaName = `agent_pg_${crypto.randomUUID().replaceAll('-', '')}`;
        const schema = quoteIdent(schemaName);
        const pool = new Pool({ connectionString: livePostgresUrl, max: 3 });
        const admin = await pool.connect();
        const workerA = await pool.connect();
        const workerB = await pool.connect();

        try {
            await admin.query(`CREATE SCHEMA ${schema}`);
            await workerA.query(`SET search_path TO ${schema}`);
            await workerA.query(POSTGRES_SCHEMA);
            await insertExpiredRunningRequest(workerA, 'locked-1');
            await insertExpiredRunningRequest(workerA, 'locked-2');

            await workerA.query('BEGIN');
            const locked = await selectExpiredForRecovery(workerA);
            assert.equal(locked.rowCount, 2);

            await workerB.query('BEGIN');
            await workerB.query(`SET search_path TO ${schema}`);
            const skipped = await selectExpiredForRecovery(workerB);
            assert.equal(skipped.rowCount, 0);

            await workerA.query('COMMIT');
            const availableAfterCommit = await selectExpiredForRecovery(workerB);
            assert.equal(availableAfterCommit.rowCount, 2);
            await workerB.query('ROLLBACK');
        } finally {
            await rollbackIfOpen(workerA);
            await rollbackIfOpen(workerB);
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
            workerA.release();
            workerB.release();
            admin.release();
            await pool.end();
        }
    });

    it('purges expired terminal requests and their artifact files', async () => {
        assert.ok(livePostgresUrl);
        const { store, admin, pool, cleanup } = await createLivePostgresStore();
        const artifactPath = path.join(process.cwd(), 'generated-images', '.pg-purge-test', `${crypto.randomUUID()}.png`);

        try {
            await mkdir(path.dirname(artifactPath), { recursive: true });
            await writeFile(artifactPath, 'stale image');
            const begin = await store.beginRequest({
                idempotencyKey: 'pg-purge-file',
                requestHash: 'pg-purge-file-hash',
                mode: 'generate',
                requestJson: { prompt: 'pg purge file' },
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
                    idempotency_key: 'pg-purge-file',
                    cached: false,
                    images: [],
                    created_at: '2026-05-12T00:00:00.500Z'
                },
                artifacts: [
                    buildArtifact({
                        id: 'pg-artifact-purge-file',
                        requestId: begin.record.requestId,
                        filepath: artifactPath
                    })
                ],
                now: new Date('2026-05-12T00:00:00.500Z')
            });

            const purged = await store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));

            assert.equal(purged, 1);
            assert.equal(await store.getArtifact('pg-artifact-purge-file'), undefined);
            await assert.rejects(() => access(artifactPath));
        } finally {
            await rm(path.dirname(artifactPath), { recursive: true, force: true });
            await cleanup();
            admin.release();
            await pool.end();
        }
    });

    it('purges directory artifact paths through the same relocation flow', async () => {
        assert.ok(livePostgresUrl);
        const { store, admin, pool, cleanup } = await createLivePostgresStore();
        const artifactPath = path.join(process.cwd(), 'generated-images', '.pg-purge-test', `${crypto.randomUUID()}-dir`);

        try {
            await mkdir(artifactPath, { recursive: true });
            const begin = await store.beginRequest({
                idempotencyKey: 'pg-purge-directory-artifact',
                requestHash: 'pg-purge-directory-artifact-hash',
                mode: 'generate',
                requestJson: { prompt: 'pg purge directory artifact' },
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
                    idempotency_key: 'pg-purge-directory-artifact',
                    cached: false,
                    images: [],
                    created_at: '2026-05-12T00:00:00.500Z'
                },
                artifacts: [
                    buildArtifact({
                        id: 'pg-artifact-purge-directory-artifact',
                        requestId: begin.record.requestId,
                        filepath: artifactPath
                    })
                ],
                now: new Date('2026-05-12T00:00:00.500Z')
            });

            const purged = await store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z'));
            assert.equal(purged, 1);
            await assert.rejects(() => access(artifactPath));
            assert.equal(await store.getArtifact('pg-artifact-purge-directory-artifact'), undefined);
            const entries = await readdir(path.dirname(artifactPath));
            assert.deepEqual(
                entries.filter((entry) => entry.startsWith(`${path.basename(artifactPath)}.purge-`)),
                []
            );
        } finally {
            await rm(artifactPath, { recursive: true, force: true });
            await cleanup();
            admin.release();
            await pool.end();
        }
    });

    it('restores moved artifact files when purge fails after file relocation', async () => {
        assert.ok(livePostgresUrl);
        const { store, admin, pool, cleanup, schema } = await createLivePostgresStore();
        const artifactPath = path.join(process.cwd(), 'generated-images', '.pg-purge-test', `${crypto.randomUUID()}.png`);

        try {
            await mkdir(path.dirname(artifactPath), { recursive: true });
            await writeFile(artifactPath, 'stale image');
            const begin = await store.beginRequest({
                idempotencyKey: 'pg-purge-restore-file',
                requestHash: 'pg-purge-restore-file-hash',
                mode: 'generate',
                requestJson: { prompt: 'pg purge restore file' },
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
                    idempotency_key: 'pg-purge-restore-file',
                    cached: false,
                    images: [],
                    created_at: '2026-05-12T00:00:00.500Z'
                },
                artifacts: [
                    buildArtifact({
                        id: 'pg-artifact-purge-restore-file',
                        requestId: begin.record.requestId,
                        filepath: artifactPath
                    })
                ],
                now: new Date('2026-05-12T00:00:00.500Z')
            });

            await admin.query(
                `CREATE TABLE ${schema}.${quoteIdent('pg_purge_blockers_restore')} (
                    request_id TEXT NOT NULL REFERENCES ${schema}.${quoteIdent('agent_requests')}(request_id)
                )`
            );
            await admin.query(
                `INSERT INTO ${schema}.${quoteIdent('pg_purge_blockers_restore')} (request_id) VALUES ($1)`,
                [begin.record.requestId]
            );

            await assert.rejects(() => store.purgeExpiredRequests(new Date('2026-05-12T00:00:02.000Z')));
            await assert.doesNotReject(() => access(artifactPath));
            assert.ok(await store.getArtifact('pg-artifact-purge-restore-file'));
        } finally {
            await rm(path.dirname(artifactPath), { recursive: true, force: true });
            await cleanup();
            admin.release();
            await pool.end();
        }
    });

    it('stores and reads image share metadata', async () => {
        assert.ok(livePostgresUrl);
        const { store, admin, pool, cleanup } = await createLivePostgresStore();

        try {
            await store.createImageShareRecord({
                token: 'a'.repeat(24),
                sourceFilename: 'source.png',
                contentFilename: 'a'.repeat(24) + '.png',
                mimeType: 'image/png',
                sizeBytes: 12,
                createdAt: '2026-05-14T08:00:00.000Z',
                accessCodeRequired: true,
                expiresAt: '2026-05-14T09:00:00.000Z',
                accessCodeSalt: 'salt',
                accessCodeHash: 'hash'
            });

            const record = await store.readImageShareRecord('a'.repeat(24));
            assert.ok(record);
            assert.equal(record.sourceFilename, 'source.png');
            assert.equal(record.accessCodeRequired, true);
            assert.equal(record.expiresAt, '2026-05-14T09:00:00.000Z');
        } finally {
            await cleanup();
            admin.release();
            await pool.end();
        }
    });
});

async function createLivePostgresStore() {
    assert.ok(livePostgresUrl);
    const schemaName = `agent_pg_${crypto.randomUUID().replaceAll('-', '')}`;
    const schema = quoteIdent(schemaName);
    const pool = new Pool({ connectionString: livePostgresUrl });
    const admin = await pool.connect();
    const connectionString = `${livePostgresUrl}${livePostgresUrl.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schemaName}`;
    const store = new PostgresAgentStateStore(connectionString);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await store.init();
    return {
        store,
        admin,
        pool,
        schema,
        async cleanup() {
            await store.close();
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
    };
}

function buildArtifact(input: { id: string; requestId: string; filepath: string }) {
    return {
        id: input.id,
        requestId: input.requestId,
        filename: `${input.id}.png`,
        filepath: input.filepath,
        contentUrl: `/api/agent/artifacts/${input.id}/content`,
        metadataUrl: `/api/agent/artifacts/${input.id}`,
        outputFormat: 'png',
        mimeType: 'image/png',
        sizeBytes: 10,
        width: 1,
        height: 1,
        model: 'gpt-image-2',
        promptHash: 'hash',
        createdAt: '2026-05-12T00:00:00.500Z'
    };
}

function quoteIdent(value: string): string {
    if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
        throw new Error('invalid identifier');
    }
    return `"${value}"`;
}

async function insertExpiredRunningRequest(client: { query: Pool['query'] }, suffix: string): Promise<void> {
    await client.query(
        `INSERT INTO agent_requests
            (request_id, idempotency_key, request_hash, mode, status, request_json, locked_until, created_at, updated_at, expires_at)
         VALUES ($1, $2, $3, 'generate', 'running', $4, $5, $6, $7, $8)`,
        [
            crypto.randomUUID(),
            `idem-${suffix}`,
            `hash-${suffix}`,
            { prompt: suffix },
            '2026-05-12T00:00:01.000Z',
            '2026-05-12T00:00:00.000Z',
            '2026-05-12T00:00:00.000Z',
            '2026-05-13T00:00:00.000Z'
        ]
    );
}

function selectExpiredForRecovery(client: { query: Pool['query'] }) {
    return client.query(
        "SELECT request_id FROM agent_requests WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < $1 FOR UPDATE SKIP LOCKED",
        ['2026-05-12T00:00:02.000Z']
    );
}

async function rollbackIfOpen(client: { query: Pool['query'] }): Promise<void> {
    try {
        await client.query('ROLLBACK');
    } catch {
        // The cleanup path must not hide the original test failure.
    }
}
