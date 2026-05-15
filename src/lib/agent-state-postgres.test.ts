import { POSTGRES_SCHEMA, PostgresAgentStateStore } from './agent-state-postgres';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
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
        assert.match(POSTGRES_SCHEMA, /idx_agent_requests_status_locked_until/);
        assert.match(POSTGRES_SCHEMA, /idx_agent_artifacts_request_id/);
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
});

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
