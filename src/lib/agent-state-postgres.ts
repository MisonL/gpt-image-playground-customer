import crypto from 'crypto';
import { Pool, type PoolClient } from 'pg';
import {
    discardMovedFile,
    isArtifactFilepathAllowed,
    moveFileIfExists,
    restoreMovedFile,
    type MovedFileForDeletion
} from './agent-file-utils';
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
import type { ImageShareRecord, ImageShareStateStore } from './share-store';

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

type PostgresShareRow = {
    token: string;
    source_filename: string;
    content_filename: string;
    mime_type: string;
    size_bytes: number | string;
    created_at: Date | string;
    access_code_required: boolean;
    expires_at: Date | string | null;
    access_code_salt: string | null;
    access_code_hash: string | null;
};

type PostgresMigrationRow = {
    id: string;
    checksum: string | null;
};

export class PostgresAgentStateStore implements AgentStateStore, ImageShareStateStore {
    private readonly pool: Pool;

    constructor(connectionString: string) {
        this.pool = new Pool({ connectionString });
    }

    async init(): Promise<void> {
        await runPostgresMigrations(this.pool);
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
        let transactionStarted = false;
        let movedFiles: MovedFileForDeletion[] = [];
        try {
            await client.query('BEGIN');
            transactionStarted = true;
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
            movedFiles = await moveArtifactFilesForDeletion([...new Set(artifactFilepaths)]);
            if (requestIds.length > 0) {
                await client.query('DELETE FROM agent_artifacts WHERE request_id = ANY($1)', [requestIds]);
                await client.query('DELETE FROM agent_requests WHERE request_id = ANY($1)', [requestIds]);
            }
            await client.query('COMMIT');
            transactionStarted = false;
            await discardArtifactFiles(movedFiles);
            return requestIds.length;
        } catch (error) {
            if (transactionStarted) {
                await client.query('ROLLBACK').catch(() => {});
            }
            await restoreArtifactFiles(movedFiles);
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

    async createImageShareRecord(record: ImageShareRecord): Promise<void> {
        await this.pool.query(
            `INSERT INTO image_shares
                (token, source_filename, content_filename, mime_type, size_bytes, created_at, access_code_required, expires_at, access_code_salt, access_code_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                record.token,
                record.sourceFilename,
                record.contentFilename,
                record.mimeType,
                record.sizeBytes,
                record.createdAt,
                record.accessCodeRequired,
                record.expiresAt ?? null,
                record.accessCodeSalt ?? null,
                record.accessCodeHash ?? null
            ]
        );
    }

    async readImageShareRecord(token: string): Promise<ImageShareRecord | undefined> {
        const result = await this.pool.query('SELECT * FROM image_shares WHERE token = $1', [token]);
        const row = result.rows[0] as PostgresShareRow | undefined;
        return row ? this.mapShareRow(row) : undefined;
    }

    async deleteExpiredImageShareRecords(nowIso: string): Promise<ImageShareRecord[]> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                'DELETE FROM image_shares WHERE expires_at IS NOT NULL AND expires_at < $1 RETURNING *',
                [nowIso]
            );
            await client.query('COMMIT');
            return (result.rows as PostgresShareRow[]).map((row) => this.mapShareRow(row));
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async listImageShareRecords(): Promise<ImageShareRecord[]> {
        const result = await this.pool.query('SELECT * FROM image_shares ORDER BY created_at ASC, token ASC');
        return (result.rows as PostgresShareRow[]).map((row) => this.mapShareRow(row));
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
            if (!conflicted.rows[0]) {
                throw new Error('idempotency conflict row disappeared during acquisition');
            }
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

    private mapShareRow(row: PostgresShareRow): ImageShareRecord {
        return {
            token: row.token,
            sourceFilename: row.source_filename,
            contentFilename: row.content_filename,
            mimeType: row.mime_type,
            sizeBytes: Number(row.size_bytes),
            createdAt: toIso(row.created_at),
            accessCodeRequired: row.access_code_required,
            ...(row.expires_at ? { expiresAt: toIso(row.expires_at) } : {}),
            ...(row.access_code_salt ? { accessCodeSalt: row.access_code_salt } : {}),
            ...(row.access_code_hash ? { accessCodeHash: row.access_code_hash } : {})
        };
    }

    private async insertArtifacts(client: PoolClient, artifacts: AgentArtifactRecord[]): Promise<void> {
        for (const artifact of artifacts) {
            await this.assertArtifactCanBeInserted(client, artifact);
            await client.query(
                `INSERT INTO agent_artifacts
                    (id, request_id, filename, filepath, content_url, metadata_url, output_format, mime_type, size_bytes, width, height, model, prompt_hash, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (id) DO NOTHING`,
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

    private async assertArtifactCanBeInserted(client: PoolClient, artifact: AgentArtifactRecord): Promise<void> {
        const result = await client.query('SELECT * FROM agent_artifacts WHERE id = $1', [artifact.id]);
        const existing = result.rows[0] as PostgresArtifactRow | undefined;
        if (existing && !sameArtifactRecord(this.mapArtifactRow(existing), artifact)) {
            throw new Error('artifact metadata conflict');
        }
    }

    private async listArtifactsForRequestInTransaction(client: PoolClient, requestId: string): Promise<AgentArtifactRecord[]> {
        const result = await client.query('SELECT * FROM agent_artifacts WHERE request_id = $1 ORDER BY created_at ASC', [
            requestId
        ]);
        return (result.rows as PostgresArtifactRow[]).map((row) => this.mapArtifactRow(row));
    }
}

async function moveArtifactFilesForDeletion(filepaths: string[]): Promise<MovedFileForDeletion[]> {
    const movedFiles: MovedFileForDeletion[] = [];
    try {
        for (const filepath of filepaths) {
            const moved = await moveFileIfExists(filepath);
            if (moved) {
                movedFiles.push(moved);
            }
        }
        return movedFiles;
    } catch (error) {
        await restoreArtifactFiles(movedFiles);
        throw error;
    }
}

async function restoreArtifactFiles(files: MovedFileForDeletion[]): Promise<void> {
    await Promise.allSettled(files.map((file) => restoreMovedFile(file)));
}

async function discardArtifactFiles(files: MovedFileForDeletion[]): Promise<void> {
    await Promise.allSettled(files.map((file) => discardMovedFile(file)));
}

function toIso(value: Date | string | null): string {
    if (!value) return '';
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type PostgresMigration = {
    id: string;
    sql: string;
};

const POSTGRES_MIGRATION_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS state_schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL
);`;

const POSTGRES_MIGRATIONS: PostgresMigration[] = [
    {
        id: '001_agent_state_core',
        sql: `
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
`
    },
    {
        id: '002_image_shares',
        sql: `
CREATE TABLE IF NOT EXISTS image_shares (
    token TEXT PRIMARY KEY,
    source_filename TEXT NOT NULL,
    content_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    access_code_required BOOLEAN NOT NULL,
    expires_at TIMESTAMPTZ,
    access_code_salt TEXT,
    access_code_hash TEXT,
    CHECK (
        (access_code_required = FALSE AND access_code_salt IS NULL AND access_code_hash IS NULL)
        OR (access_code_required = TRUE AND access_code_salt IS NOT NULL AND access_code_hash IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_image_shares_expires_at ON image_shares(expires_at);
`
    }
];

async function runPostgresMigrations(pool: Pool): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(POSTGRES_MIGRATION_TABLE_SCHEMA);
        await ensurePostgresMigrationChecksumColumn(client);
        await client.query('LOCK TABLE state_schema_migrations IN EXCLUSIVE MODE');
        const appliedResult = await client.query('SELECT id, checksum FROM state_schema_migrations');
        const applied = new Map((appliedResult.rows as PostgresMigrationRow[]).map((row) => [row.id, row.checksum]));
        for (const migration of POSTGRES_MIGRATIONS) {
            const checksum = migrationChecksum(migration.sql);
            if (applied.has(migration.id)) {
                if (applied.get(migration.id) !== checksum) {
                    throw new Error(`PostgreSQL migration checksum mismatch: ${migration.id}`);
                }
                continue;
            }
            for (const statement of splitSqlStatements(migration.sql)) {
                await client.query(statement);
            }
            await client.query('INSERT INTO state_schema_migrations (id, checksum, applied_at) VALUES ($1, $2, $3)', [
                migration.id,
                checksum,
                isoDate(new Date())
            ]);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

export const POSTGRES_SCHEMA = [
    POSTGRES_MIGRATION_TABLE_SCHEMA,
    ...POSTGRES_MIGRATIONS.map((migration) => migration.sql)
]
    .map((sql) => sql.trim())
    .join('\n\n');

async function ensurePostgresMigrationChecksumColumn(client: PoolClient): Promise<void> {
    await client.query('ALTER TABLE state_schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
    for (const migration of POSTGRES_MIGRATIONS) {
        await client.query('UPDATE state_schema_migrations SET checksum = $1 WHERE id = $2 AND checksum IS NULL', [
            migrationChecksum(migration.sql),
            migration.id
        ]);
    }
    await client.query('ALTER TABLE state_schema_migrations ALTER COLUMN checksum SET NOT NULL');
}

function splitSqlStatements(sql: string): string[] {
    return sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

function migrationChecksum(sql: string): string {
    return crypto.createHash('sha256').update(sql.trim()).digest('hex');
}

function sameArtifactRecord(left: AgentArtifactRecord, right: AgentArtifactRecord): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
