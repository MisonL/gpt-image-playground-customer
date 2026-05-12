import { Pool, type PoolClient } from 'pg';
import { deleteFileIfExists, isArtifactFilepathAllowed } from './agent-file-utils';
import {
    addMilliseconds,
    addSeconds,
    buildRecoveredResponse,
    computeRetryAfterSeconds,
    createRequestId,
    isoDate,
    type AgentArtifactRecord,
    type AgentRequestRecord,
    type AgentStateStore,
    type BeginAgentRequestInput,
    type BeginAgentRequestResult,
    type CompleteAgentRequestInput,
    type FailAgentRequestInput
} from './agent-state-store';
import type { AgentImageResponse } from './agent-api-contracts';
import type { AgentErrorBody } from './api-error-response';

type PostgresRequestRow = {
    request_id: string;
    idempotency_key: string;
    request_hash: string;
    mode: 'generate' | 'edit';
    status: AgentRequestRecord['status'];
    request_json: unknown;
    response_json: unknown | null;
    error_json: unknown | null;
    locked_until: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
    expires_at: Date | string;
};

type PostgresArtifactRow = {
    id: string;
    request_id: string;
    filename: string;
    filepath: string;
    content_url: string;
    metadata_url: string;
    output_format: string;
    mime_type: string;
    size_bytes: number | string;
    width: number | null;
    height: number | null;
    model: string;
    prompt_hash: string;
    created_at: Date | string;
};

export class PostgresAgentStateStore implements AgentStateStore {
    private readonly pool: Pool;

    constructor(connectionString: string) {
        this.pool = new Pool({ connectionString });
    }

    async init(): Promise<void> {
        await this.pool.query(POSTGRES_SCHEMA);
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    async recoverExpiredRequests(now = new Date()): Promise<number> {
        const client = await this.pool.connect();
        const nowIso = isoDate(now);
        try {
            await client.query('BEGIN');
            const expiredResult = await client.query(
                "SELECT * FROM agent_requests WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < $1 FOR UPDATE SKIP LOCKED",
                [nowIso]
            );
            for (const row of expiredResult.rows as PostgresRequestRow[]) {
                const record = this.mapRequestRow(row);
                const artifacts = await this.listArtifactsForRequestInTransaction(client, record.requestId);
                if (artifacts.length > 0) {
                    await client.query(
                        "UPDATE agent_requests SET status = 'succeeded', response_json = $1, error_json = NULL, locked_until = NULL, updated_at = $2 WHERE request_id = $3",
                        [buildRecoveredResponse(record, artifacts), nowIso, record.requestId]
                    );
                } else if (record.errorJson) {
                    await client.query(
                        "UPDATE agent_requests SET status = 'failed', locked_until = NULL, updated_at = $1 WHERE request_id = $2",
                        [nowIso, record.requestId]
                    );
                } else {
                    await client.query(
                        "UPDATE agent_requests SET status = 'orphaned', locked_until = NULL, updated_at = $1 WHERE request_id = $2",
                        [nowIso, record.requestId]
                    );
                }
            }
            if (expiredResult.rowCount && expiredResult.rowCount > 0) {
                await client.query(
                    'INSERT INTO agent_recovery_events (id, event_type, details_json, created_at) VALUES ($1, $2, $3, $4)',
                    [
                        crypto.randomUUID(),
                        'expired_running_requests',
                        { count: expiredResult.rowCount },
                        nowIso
                    ]
                );
            }
            await client.query('COMMIT');
            return expiredResult.rowCount ?? 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async purgeExpiredRequests(now = new Date()): Promise<number> {
        const client = await this.pool.connect();
        const nowIso = isoDate(now);
        try {
            await client.query('BEGIN');
            const expiredResult = await client.query(
                "SELECT request_id FROM agent_requests WHERE expires_at < $1 AND status IN ('succeeded', 'failed', 'orphaned') FOR UPDATE SKIP LOCKED",
                [nowIso]
            );
            const requestIds = expiredResult.rows.map((row: { request_id: string }) => row.request_id);
            const artifactFilepaths =
                requestIds.length > 0
                    ? (
                          await client.query('SELECT filepath FROM agent_artifacts WHERE request_id = ANY($1)', [requestIds])
	                      ).rows
	                          .map((row: { filepath: string | null }) => row.filepath)
	                          .filter(
	                              (filepath): filepath is string =>
	                                  typeof filepath === 'string' && isArtifactFilepathAllowed(filepath)
	                          )
	                    : [];
            await Promise.all([...new Set(artifactFilepaths)].map((filepath) => deleteFileIfExists(filepath)));
            if (requestIds.length > 0) {
                await client.query('DELETE FROM agent_artifacts WHERE request_id = ANY($1)', [requestIds]);
                await client.query('DELETE FROM agent_requests WHERE request_id = ANY($1)', [requestIds]);
            }
            await client.query('COMMIT');
            return requestIds.length;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async beginRequest(input: BeginAgentRequestInput): Promise<BeginAgentRequestResult> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await this.beginRequestInTransaction(client, input);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async completeRequest(input: CompleteAgentRequestInput): Promise<void> {
        const client = await this.pool.connect();
        const nowIso = isoDate(input.now ?? new Date());
        try {
            await client.query('BEGIN');
            await this.insertArtifacts(client, input.artifacts);
            await client.query(
                "UPDATE agent_requests SET status = 'succeeded', response_json = $1, error_json = NULL, locked_until = NULL, updated_at = $2 WHERE request_id = $3",
                [input.response, nowIso, input.requestId]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async saveArtifacts(artifacts: AgentArtifactRecord[]): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.insertArtifacts(client, artifacts);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async failRequest(input: FailAgentRequestInput): Promise<void> {
        await this.pool.query(
            "UPDATE agent_requests SET status = 'failed', response_json = NULL, error_json = $1, locked_until = NULL, updated_at = $2 WHERE request_id = $3",
            [input.error, isoDate(input.now ?? new Date()), input.requestId]
        );
    }

    async getArtifact(id: string): Promise<AgentArtifactRecord | undefined> {
        const result = await this.pool.query('SELECT * FROM agent_artifacts WHERE id = $1', [id]);
        const row = result.rows[0] as PostgresArtifactRow | undefined;
        return row ? this.mapArtifactRow(row) : undefined;
    }

    async listArtifactsForRequest(requestId: string): Promise<AgentArtifactRecord[]> {
        const result = await this.pool.query('SELECT * FROM agent_artifacts WHERE request_id = $1 ORDER BY created_at ASC', [
            requestId
        ]);
        return (result.rows as PostgresArtifactRow[]).map((row) => this.mapArtifactRow(row));
    }

    async deleteArtifact(id: string): Promise<boolean> {
        const result = await this.pool.query('DELETE FROM agent_artifacts WHERE id = $1', [id]);
        return (result.rowCount ?? 0) > 0;
    }

    private async beginRequestInTransaction(
        client: PoolClient,
        input: BeginAgentRequestInput
    ): Promise<BeginAgentRequestResult> {
        const now = input.now ?? new Date();
        const nowIso = isoDate(now);
        const lockedUntil = isoDate(addMilliseconds(now, input.leaseMs));
        const expiresAt = isoDate(addSeconds(now, input.ttlSeconds));
        const existingResult = await client.query('SELECT * FROM agent_requests WHERE idempotency_key = $1 FOR UPDATE', [
            input.idempotencyKey
        ]);
        const existing = existingResult.rows[0] as PostgresRequestRow | undefined;

        if (!existing) {
            const requestId = createRequestId();
            const insertResult = await client.query(
                `INSERT INTO agent_requests
                    (request_id, idempotency_key, request_hash, mode, status, request_json, locked_until, created_at, updated_at, expires_at)
                 VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, $9)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING *`,
                [
                    requestId,
                    input.idempotencyKey,
                    input.requestHash,
                    input.mode,
                    input.requestJson,
                    lockedUntil,
                    nowIso,
                    nowIso,
                    expiresAt
                ]
            );
            if (insertResult.rowCount && insertResult.rowCount > 0) {
                return { type: 'acquired', record: this.mapRequestRow(insertResult.rows[0] as PostgresRequestRow) };
            }
            const conflicted = await client.query('SELECT * FROM agent_requests WHERE idempotency_key = $1 FOR UPDATE', [
                input.idempotencyKey
            ]);
            return this.beginFromExistingRow(conflicted.rows[0] as PostgresRequestRow, input, now, nowIso, lockedUntil, expiresAt, client);
        }

        return this.beginFromExistingRow(existing, input, now, nowIso, lockedUntil, expiresAt, client);
    }

    private async beginFromExistingRow(
        existing: PostgresRequestRow,
        input: BeginAgentRequestInput,
        now: Date,
        nowIso: string,
        lockedUntil: string,
        expiresAt: string,
        client: PoolClient
    ): Promise<BeginAgentRequestResult> {
        const record = this.mapRequestRow(existing);
        if (existing.request_hash !== input.requestHash) {
            return { type: 'conflict', record };
        }
        if (existing.status === 'succeeded' && existing.response_json) {
            return { type: 'replay', record, response: existing.response_json as AgentImageResponse };
        }
        if (existing.status === 'failed' && existing.error_json) {
            return { type: 'failed', record, error: existing.error_json as AgentErrorBody };
        }
        const lockedUntilIso = toIso(existing.locked_until);
        if ((existing.status === 'running' || existing.status === 'pending') && lockedUntilIso && lockedUntilIso > nowIso) {
            return { type: 'in_progress', record, retryAfterSeconds: computeRetryAfterSeconds(lockedUntilIso, now) };
        }

        await client.query(
            "UPDATE agent_requests SET status = 'running', locked_until = $1, updated_at = $2, expires_at = $3 WHERE idempotency_key = $4",
            [lockedUntil, nowIso, expiresAt, input.idempotencyKey]
        );
        const updated = await client.query('SELECT * FROM agent_requests WHERE idempotency_key = $1', [input.idempotencyKey]);
        return { type: 'acquired', record: this.mapRequestRow(updated.rows[0] as PostgresRequestRow) };
    }

    private mapRequestRow(row: PostgresRequestRow): AgentRequestRecord {
        return {
            requestId: row.request_id,
            idempotencyKey: row.idempotency_key,
            requestHash: row.request_hash,
            mode: row.mode,
            status: row.status,
            requestJson: row.request_json,
            responseJson: row.response_json ? (row.response_json as AgentImageResponse) : undefined,
            errorJson: row.error_json ? (row.error_json as AgentErrorBody) : undefined,
            ...(row.locked_until ? { lockedUntil: toIso(row.locked_until) } : {}),
            createdAt: toIso(row.created_at),
            updatedAt: toIso(row.updated_at),
            expiresAt: toIso(row.expires_at)
        };
    }

    private mapArtifactRow(row: PostgresArtifactRow): AgentArtifactRecord {
        return {
            id: row.id,
            requestId: row.request_id,
            filename: row.filename,
            filepath: row.filepath,
            contentUrl: row.content_url,
            metadataUrl: row.metadata_url,
            outputFormat: row.output_format,
            mimeType: row.mime_type,
            sizeBytes: Number(row.size_bytes),
            width: row.width,
            height: row.height,
            model: row.model,
            promptHash: row.prompt_hash,
            createdAt: toIso(row.created_at)
        };
    }

    private async insertArtifacts(client: PoolClient, artifacts: AgentArtifactRecord[]): Promise<void> {
        for (const artifact of artifacts) {
            await client.query(
                `INSERT INTO agent_artifacts
                    (id, request_id, filename, filepath, content_url, metadata_url, output_format, mime_type, size_bytes, width, height, model, prompt_hash, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (id) DO UPDATE SET
                    filename = EXCLUDED.filename,
                    filepath = EXCLUDED.filepath,
                    content_url = EXCLUDED.content_url,
                    metadata_url = EXCLUDED.metadata_url,
                    size_bytes = EXCLUDED.size_bytes,
                    width = EXCLUDED.width,
                    height = EXCLUDED.height`,
                [
                    artifact.id,
                    artifact.requestId,
                    artifact.filename,
                    artifact.filepath,
                    artifact.contentUrl,
                    artifact.metadataUrl,
                    artifact.outputFormat,
                    artifact.mimeType,
                    artifact.sizeBytes,
                    artifact.width,
                    artifact.height,
                    artifact.model,
                    artifact.promptHash,
                    artifact.createdAt
                ]
            );
        }
    }

    private async listArtifactsForRequestInTransaction(client: PoolClient, requestId: string): Promise<AgentArtifactRecord[]> {
        const result = await client.query('SELECT * FROM agent_artifacts WHERE request_id = $1 ORDER BY created_at ASC', [
            requestId
        ]);
        return (result.rows as PostgresArtifactRow[]).map((row) => this.mapArtifactRow(row));
    }
}

function toIso(value: Date | string | null): string {
    if (!value) return '';
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_requests (
    request_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('generate', 'edit')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'orphaned')),
    request_json JSONB NOT NULL,
    response_json JSONB,
    error_json JSONB,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_requests_status_locked_until ON agent_requests(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_agent_requests_expires_at ON agent_requests(expires_at);

CREATE TABLE IF NOT EXISTS agent_artifacts (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES agent_requests(request_id),
    filename TEXT NOT NULL UNIQUE,
    filepath TEXT NOT NULL,
    content_url TEXT NOT NULL,
    metadata_url TEXT NOT NULL,
    output_format TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    model TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_request_id ON agent_artifacts(request_id);

CREATE TABLE IF NOT EXISTS agent_recovery_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    details_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
`;
