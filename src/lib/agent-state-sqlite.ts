import type { AgentImageResponse } from './agent-api-contracts';
import {
    discardArtifactFiles,
    isArtifactFilepathAllowed,
    moveArtifactFilesForDeletion,
    restoreArtifactFiles
} from './agent-file-utils';
import {
    addMilliseconds,
    addSeconds,
    buildRecoveredResponse,
    computeRetryAfterSeconds,
    createRequestId,
    isoDate,
    parseJson,
    serializeJson,
    type AgentArtifactRecord,
    type AgentRequestRecord,
    type AgentStateStore,
    type BeginAgentRequestInput,
    type BeginAgentRequestResult,
    type CompleteAgentRequestInput,
    type FailAgentRequestInput
} from './agent-state-store';
import type { AgentErrorBody } from './api-error-response';
import type {
    FeedbackDeleteOptions,
    FeedbackRecord,
    FeedbackStateStore,
    FeedbackTarget,
    FeedbackTargetType,
    FeedbackValue,
    FeedbackSource
} from './feedback-store';
import type { ImageShareRecord, ImageShareStateStore } from './share-store';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type SqliteRequestRow = {
    request_id: string;
    idempotency_key: string;
    request_hash: string;
    mode: 'generate' | 'edit';
    status: AgentRequestRecord['status'];
    request_json: string;
    response_json: string | null;
    error_json: string | null;
    locked_until: string | null;
    created_at: string;
    updated_at: string;
    expires_at: string;
};

type SqliteArtifactRow = {
    id: string;
    request_id: string;
    filename: string;
    filepath: string;
    content_url: string;
    metadata_url: string;
    output_format: string;
    mime_type: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    model: string;
    prompt_hash: string;
    created_at: string;
};

type SqliteShareRow = {
    token: string;
    source_filename: string;
    content_filename: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
    access_code_required: number;
    expires_at: string | null;
    access_code_salt: string | null;
    access_code_hash: string | null;
};

type SqliteFeedbackRow = {
    target_type: FeedbackTargetType;
    target_id: string;
    value: FeedbackValue;
    note: string | null;
    source: FeedbackSource;
    updated_at: string;
};

type SqliteMigrationRow = {
    id: string;
    checksum?: string | null;
};

export class SqliteAgentStateStore implements AgentStateStore, ImageShareStateStore, FeedbackStateStore {
    private db: Database.Database | undefined;

    constructor(private readonly dbPath: string) {}

    async init(): Promise<void> {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('busy_timeout = 5000');
        runSqliteMigrations(this.db);
    }

    async recoverExpiredRequests(now = new Date()): Promise<number> {
        const db = this.requireDb();
        const nowIso = isoDate(now);
        const expiredRows = db
            .prepare(
                "SELECT * FROM agent_requests WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < ?"
            )
            .all(nowIso) as SqliteRequestRow[];
        const transaction = db.transaction(() => {
            for (const row of expiredRows) {
                const record = this.mapRequestRow(row);
                const artifacts = this.listArtifactsForRequestSync(record.requestId);
                if (artifacts.length > 0) {
                    db.prepare(
                        "UPDATE agent_requests SET status = 'succeeded', response_json = ?, error_json = NULL, locked_until = NULL, updated_at = ? WHERE request_id = ?"
                    ).run(serializeJson(buildRecoveredResponse(record, artifacts)), nowIso, record.requestId);
                } else if (record.errorJson) {
                    db.prepare(
                        "UPDATE agent_requests SET status = 'failed', locked_until = NULL, updated_at = ? WHERE request_id = ?"
                    ).run(nowIso, record.requestId);
                } else {
                    db.prepare(
                        "UPDATE agent_requests SET status = 'orphaned', locked_until = NULL, updated_at = ? WHERE request_id = ?"
                    ).run(nowIso, record.requestId);
                }
            }
            if (expiredRows.length > 0) {
                db.prepare(
                    'INSERT INTO agent_recovery_events (id, event_type, details_json, created_at) VALUES (?, ?, ?, ?)'
                ).run(
                    cryptoRandomId(),
                    'expired_running_requests',
                    serializeJson({ count: expiredRows.length }),
                    nowIso
                );
            }
        });
        transaction();
        return expiredRows.length;
    }

    async purgeExpiredRequests(now = new Date()): Promise<number> {
        const db = this.requireDb();
        const nowIso = isoDate(now);
        const expiredRows = db
            .prepare(
                `SELECT r.request_id, a.id AS artifact_id, a.filepath
                 FROM agent_requests r
                 LEFT JOIN agent_artifacts a ON a.request_id = r.request_id
                 WHERE r.expires_at < ? AND r.status IN ('succeeded', 'failed', 'orphaned')`
            )
            .all(nowIso) as Array<{ request_id: string; artifact_id: string | null; filepath: string | null }>;
        const requestIds = [...new Set(expiredRows.map((row) => row.request_id))];
        const artifactIds = [
            ...new Set(expiredRows.map((row) => row.artifact_id).filter((id): id is string => typeof id === 'string'))
        ];
        const artifactFilepaths = [
            ...new Set(
                expiredRows
                    .map((row) => row.filepath)
                    .filter(
                        (filepath): filepath is string =>
                            typeof filepath === 'string' && isArtifactFilepathAllowed(filepath)
                    )
            )
        ];
        const movedFiles = await moveArtifactFilesForDeletion(artifactFilepaths);
        const transaction = db.transaction(() => {
            for (const artifactId of artifactIds) {
                db.prepare("DELETE FROM result_feedback WHERE target_type = 'agent_artifact' AND target_id = ?").run(
                    artifactId
                );
            }
            for (const requestId of requestIds) {
                db.prepare("DELETE FROM result_feedback WHERE target_type = 'agent_request' AND target_id = ?").run(
                    requestId
                );
                db.prepare('DELETE FROM agent_artifacts WHERE request_id = ?').run(requestId);
                db.prepare('DELETE FROM agent_requests WHERE request_id = ?').run(requestId);
            }
        });
        try {
            transaction();
        } catch (error) {
            await restoreArtifactFiles(movedFiles);
            throw error;
        }
        await discardArtifactFiles(movedFiles);
        return requestIds.length;
    }

    async beginRequest(input: BeginAgentRequestInput): Promise<BeginAgentRequestResult> {
        const db = this.requireDb();
        const now = input.now ?? new Date();
        const nowIso = isoDate(now);
        const lockedUntil = isoDate(addMilliseconds(now, input.leaseMs));
        const expiresAt = isoDate(addSeconds(now, input.ttlSeconds));
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = this.beginRequestInTransaction(input, now, nowIso, lockedUntil, expiresAt);
            db.exec('COMMIT');
            return result;
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    async refreshRequestLease(input: { requestId: string; leaseMs: number; now?: Date }): Promise<boolean> {
        const now = input.now ?? new Date();
        const result = this.requireDb()
            .prepare(
                "UPDATE agent_requests SET locked_until = ?, updated_at = ? WHERE request_id = ? AND status IN ('running', 'pending')"
            )
            .run(isoDate(addMilliseconds(now, input.leaseMs)), isoDate(now), input.requestId);
        return result.changes > 0;
    }

    private beginRequestInTransaction(
        input: BeginAgentRequestInput,
        now: Date,
        nowIso: string,
        lockedUntil: string,
        expiresAt: string
    ): BeginAgentRequestResult {
        const existing = this.getRequestRow(input.idempotencyKey);
        if (!existing) {
            const requestId = createRequestId();
            const insertResult = this.requireDb()
                .prepare(
                    `INSERT OR IGNORE INTO agent_requests
                        (request_id, idempotency_key, request_hash, mode, status, request_json, locked_until, created_at, updated_at, expires_at)
                     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`
                )
                .run(
                    requestId,
                    input.idempotencyKey,
                    input.requestHash,
                    input.mode,
                    serializeJson(input.requestJson),
                    lockedUntil,
                    nowIso,
                    nowIso,
                    expiresAt
                );
            if (insertResult.changes > 0) {
                const inserted = this.getRequestRow(input.idempotencyKey);
                if (!inserted) {
                    throw new Error('idempotency row disappeared during acquisition');
                }
                return { type: 'acquired', record: this.mapRequestRow(inserted) };
            }
        }
        const current = this.getRequestRow(input.idempotencyKey);
        if (!current) {
            throw new Error('idempotency row disappeared during acquisition');
        }
        return this.beginFromExistingRow(current, input, now, nowIso, lockedUntil, expiresAt);
    }

    private beginFromExistingRow(
        existing: SqliteRequestRow,
        input: BeginAgentRequestInput,
        now: Date,
        nowIso: string,
        lockedUntil: string,
        expiresAt: string
    ): BeginAgentRequestResult {
        const record = this.mapRequestRow(existing);
        if (existing.request_hash !== input.requestHash) {
            return { type: 'conflict', record };
        }
        if (existing.status === 'succeeded' && existing.response_json) {
            return { type: 'replay', record, response: JSON.parse(existing.response_json) as AgentImageResponse };
        }
        if (existing.status === 'failed' && existing.error_json) {
            return { type: 'failed', record, error: JSON.parse(existing.error_json) as AgentErrorBody };
        }
        if (
            (existing.status === 'running' || existing.status === 'pending') &&
            existing.locked_until &&
            existing.locked_until > nowIso
        ) {
            return {
                type: 'in_progress',
                record,
                retryAfterSeconds: computeRetryAfterSeconds(existing.locked_until, now)
            };
        }

        this.requireDb()
            .prepare(
                "UPDATE agent_requests SET status = 'running', locked_until = ?, updated_at = ?, expires_at = ? WHERE idempotency_key = ?"
            )
            .run(lockedUntil, nowIso, expiresAt, input.idempotencyKey);
        return { type: 'acquired', record: this.mapRequestRow(this.getRequestRow(input.idempotencyKey)!) };
    }

    async completeRequest(input: CompleteAgentRequestInput): Promise<void> {
        const db = this.requireDb();
        const nowIso = isoDate(input.now ?? new Date());
        const transaction = db.transaction(() => {
            this.insertArtifacts(input.artifacts);
            db.prepare(
                "UPDATE agent_requests SET status = 'succeeded', response_json = ?, error_json = NULL, locked_until = NULL, updated_at = ? WHERE request_id = ?"
            ).run(serializeJson(input.response), nowIso, input.requestId);
        });
        transaction();
    }

    async saveArtifacts(artifacts: AgentArtifactRecord[]): Promise<void> {
        const transaction = this.requireDb().transaction(() => this.insertArtifacts(artifacts));
        transaction();
    }

    async failRequest(input: FailAgentRequestInput): Promise<void> {
        const db = this.requireDb();
        const nowIso = isoDate(input.now ?? new Date());
        db.prepare(
            "UPDATE agent_requests SET status = 'failed', response_json = NULL, error_json = ?, locked_until = NULL, updated_at = ? WHERE request_id = ?"
        ).run(serializeJson(input.error), nowIso, input.requestId);
    }

    async getRequest(requestId: string): Promise<AgentRequestRecord | undefined> {
        const row = this.requireDb().prepare('SELECT * FROM agent_requests WHERE request_id = ?').get(requestId) as
            | SqliteRequestRow
            | undefined;
        return row ? this.mapRequestRow(row) : undefined;
    }

    async getRequestByIdempotencyKey(idempotencyKey: string): Promise<AgentRequestRecord | undefined> {
        const row = this.requireDb()
            .prepare('SELECT * FROM agent_requests WHERE idempotency_key = ?')
            .get(idempotencyKey) as SqliteRequestRow | undefined;
        return row ? this.mapRequestRow(row) : undefined;
    }

    async getArtifact(id: string): Promise<AgentArtifactRecord | undefined> {
        const row = this.requireDb().prepare('SELECT * FROM agent_artifacts WHERE id = ?').get(id) as
            | SqliteArtifactRow
            | undefined;
        return row ? this.mapArtifactRow(row) : undefined;
    }

    async listArtifactsForRequest(requestId: string): Promise<AgentArtifactRecord[]> {
        return this.listArtifactsForRequestSync(requestId);
    }

    async deleteArtifact(id: string): Promise<boolean> {
        const result = this.requireDb().transaction(() => {
            const deleteResult = this.requireDb().prepare('DELETE FROM agent_artifacts WHERE id = ?').run(id);
            if (deleteResult.changes > 0) {
                this.requireDb()
                    .prepare("DELETE FROM result_feedback WHERE target_type = 'agent_artifact' AND target_id = ?")
                    .run(id);
            }
            return deleteResult;
        })();
        return result.changes > 0;
    }

    async upsertFeedback(record: FeedbackRecord): Promise<void> {
        this.requireDb()
            .prepare(
                `INSERT INTO result_feedback (target_type, target_id, value, note, source, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(target_type, target_id) DO UPDATE SET
                    value = excluded.value,
                    note = excluded.note,
                    source = excluded.source,
                    updated_at = excluded.updated_at
                 WHERE result_feedback.updated_at <= excluded.updated_at`
            )
            .run(
                record.targetType,
                record.targetId,
                record.value,
                record.note ?? null,
                record.source,
                record.updatedAt
            );
    }

    async upsertFeedbackBatch(records: FeedbackRecord[]): Promise<void> {
        if (records.length === 0) return;
        const statement = this.requireDb().prepare(
            `INSERT INTO result_feedback (target_type, target_id, value, note, source, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(target_type, target_id) DO UPDATE SET
                value = excluded.value,
                note = excluded.note,
                source = excluded.source,
                updated_at = excluded.updated_at
             WHERE result_feedback.updated_at <= excluded.updated_at`
        );
        this.requireDb().transaction(() => {
            for (const record of records) {
                statement.run(
                    record.targetType,
                    record.targetId,
                    record.value,
                    record.note ?? null,
                    record.source,
                    record.updatedAt
                );
            }
        })();
    }

    async readFeedback(targetType: FeedbackTargetType, targetId: string): Promise<FeedbackRecord | undefined> {
        const row = this.requireDb()
            .prepare('SELECT * FROM result_feedback WHERE target_type = ? AND target_id = ?')
            .get(targetType, targetId) as SqliteFeedbackRow | undefined;
        return row ? this.mapFeedbackRow(row) : undefined;
    }

    async listFeedbackByTargets(targets: FeedbackTarget[]): Promise<FeedbackRecord[]> {
        const records: FeedbackRecord[] = [];
        for (const target of targets) {
            const record = await this.readFeedback(target.targetType, target.targetId);
            if (record) records.push(record);
        }
        return records;
    }

    async deleteFeedbackByTargets(targets: FeedbackTarget[], options: FeedbackDeleteOptions = {}): Promise<number> {
        let deleted = 0;
        for (const target of targets) {
            const result = options.deletedAt
                ? this.requireDb()
                      .prepare(
                          'DELETE FROM result_feedback WHERE target_type = ? AND target_id = ? AND updated_at <= ?'
                      )
                      .run(target.targetType, target.targetId, options.deletedAt)
                : this.requireDb()
                      .prepare('DELETE FROM result_feedback WHERE target_type = ? AND target_id = ?')
                      .run(target.targetType, target.targetId);
            deleted += result.changes;
        }
        return deleted;
    }

    async createImageShareRecord(record: ImageShareRecord): Promise<void> {
        this.requireDb()
            .prepare(
                `INSERT INTO image_shares
                    (token, source_filename, content_filename, mime_type, size_bytes, created_at, access_code_required, expires_at, access_code_salt, access_code_hash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                record.token,
                record.sourceFilename,
                record.contentFilename,
                record.mimeType,
                record.sizeBytes,
                record.createdAt,
                record.accessCodeRequired ? 1 : 0,
                record.expiresAt ?? null,
                record.accessCodeSalt ?? null,
                record.accessCodeHash ?? null
            );
    }

    async readImageShareRecord(token: string): Promise<ImageShareRecord | undefined> {
        const row = this.requireDb().prepare('SELECT * FROM image_shares WHERE token = ?').get(token) as
            | SqliteShareRow
            | undefined;
        return row ? this.mapShareRow(row) : undefined;
    }

    async deleteExpiredImageShareRecords(nowIso: string): Promise<ImageShareRecord[]> {
        const db = this.requireDb();
        const rows = db
            .prepare(
                'SELECT * FROM image_shares WHERE expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at ASC, token ASC'
            )
            .all(nowIso) as SqliteShareRow[];
        const transaction = db.transaction(() => {
            for (const row of rows) {
                db.prepare('DELETE FROM image_shares WHERE token = ?').run(row.token);
            }
        });
        transaction();
        return rows.map((row) => this.mapShareRow(row));
    }

    async listImageShareRecords(): Promise<ImageShareRecord[]> {
        const rows = this.requireDb()
            .prepare('SELECT * FROM image_shares ORDER BY created_at ASC, token ASC')
            .all() as SqliteShareRow[];
        return rows.map((row) => this.mapShareRow(row));
    }

    private requireDb(): Database.Database {
        if (!this.db) {
            throw new Error('SQLite Agent 状态库尚未初始化。');
        }
        return this.db;
    }

    private getRequestRow(idempotencyKey: string): SqliteRequestRow | undefined {
        return this.requireDb()
            .prepare('SELECT * FROM agent_requests WHERE idempotency_key = ?')
            .get(idempotencyKey) as SqliteRequestRow | undefined;
    }

    private insertArtifacts(artifacts: AgentArtifactRecord[]): void {
        artifacts.forEach((artifact) => {
            this.assertArtifactCanBeInserted(artifact);
            this.requireDb()
                .prepare(
                    `INSERT INTO agent_artifacts
                        (id, request_id, filename, filepath, content_url, metadata_url, output_format, mime_type, size_bytes, width, height, model, prompt_hash, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) DO NOTHING`
                )
                .run(
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
                );
        });
    }

    private assertArtifactCanBeInserted(artifact: AgentArtifactRecord): void {
        const existing = this.requireDb().prepare('SELECT * FROM agent_artifacts WHERE id = ?').get(artifact.id) as
            | SqliteArtifactRow
            | undefined;
        if (existing && !sameArtifactRecord(this.mapArtifactRow(existing), artifact)) {
            throw new Error('artifact metadata conflict');
        }
    }

    private listArtifactsForRequestSync(requestId: string): AgentArtifactRecord[] {
        const rows = this.requireDb()
            .prepare('SELECT * FROM agent_artifacts WHERE request_id = ? ORDER BY created_at ASC')
            .all(requestId) as SqliteArtifactRow[];
        return rows.map((row) => this.mapArtifactRow(row));
    }

    private mapRequestRow(row: SqliteRequestRow): AgentRequestRecord {
        return {
            requestId: row.request_id,
            idempotencyKey: row.idempotency_key,
            requestHash: row.request_hash,
            mode: row.mode,
            status: row.status,
            requestJson: JSON.parse(row.request_json) as unknown,
            responseJson: parseJson<AgentImageResponse>(row.response_json),
            errorJson: parseJson<AgentErrorBody>(row.error_json),
            ...(row.locked_until ? { lockedUntil: row.locked_until } : {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            expiresAt: row.expires_at
        };
    }

    private mapArtifactRow(row: SqliteArtifactRow): AgentArtifactRecord {
        return {
            id: row.id,
            requestId: row.request_id,
            filename: row.filename,
            filepath: row.filepath,
            contentUrl: row.content_url,
            metadataUrl: row.metadata_url,
            outputFormat: row.output_format,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            width: row.width,
            height: row.height,
            model: row.model,
            promptHash: row.prompt_hash,
            createdAt: row.created_at
        };
    }

    private mapShareRow(row: SqliteShareRow): ImageShareRecord {
        return {
            token: row.token,
            sourceFilename: row.source_filename,
            contentFilename: row.content_filename,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            createdAt: row.created_at,
            accessCodeRequired: Boolean(row.access_code_required),
            ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
            ...(row.access_code_salt ? { accessCodeSalt: row.access_code_salt } : {}),
            ...(row.access_code_hash ? { accessCodeHash: row.access_code_hash } : {})
        };
    }

    private mapFeedbackRow(row: SqliteFeedbackRow): FeedbackRecord {
        return {
            targetType: row.target_type,
            targetId: row.target_id,
            value: row.value,
            source: row.source,
            updatedAt: row.updated_at,
            ...(row.note ? { note: row.note } : {})
        };
    }
}

function cryptoRandomId(): string {
    return crypto.randomUUID();
}

type SqliteMigration = {
    id: string;
    sql: string;
};

const SQLITE_MIGRATION_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS state_schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
);`;

const SQLITE_MIGRATIONS: SqliteMigration[] = [
    {
        id: '001_agent_state_core',
        sql: `
CREATE TABLE IF NOT EXISTS agent_requests (
    request_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('generate', 'edit')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'orphaned')),
    request_json TEXT NOT NULL,
    response_json TEXT,
    error_json TEXT,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_requests_status_locked_until ON agent_requests(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_agent_requests_expires_at ON agent_requests(expires_at);

CREATE TABLE IF NOT EXISTS agent_artifacts (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    filename TEXT NOT NULL UNIQUE,
    filepath TEXT NOT NULL,
    content_url TEXT NOT NULL,
    metadata_url TEXT NOT NULL,
    output_format TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    model TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(request_id) REFERENCES agent_requests(request_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_request_id ON agent_artifacts(request_id);

CREATE TABLE IF NOT EXISTS agent_recovery_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
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
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    access_code_required INTEGER NOT NULL CHECK (access_code_required IN (0, 1)),
    expires_at TEXT,
    access_code_salt TEXT,
    access_code_hash TEXT,
    CHECK (
        (access_code_required = 0 AND access_code_salt IS NULL AND access_code_hash IS NULL)
        OR (access_code_required = 1 AND access_code_salt IS NOT NULL AND access_code_hash IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_image_shares_expires_at ON image_shares(expires_at);
`
    },
    {
        id: '003_result_feedback',
        sql: `
CREATE TABLE IF NOT EXISTS result_feedback (
    target_type TEXT NOT NULL CHECK (target_type IN ('page_request', 'agent_request', 'agent_artifact')),
    target_id TEXT NOT NULL,
    value TEXT NOT NULL CHECK (value IN ('usable', 'needs_revision')),
    note TEXT,
    source TEXT NOT NULL CHECK (source IN ('webui', 'agent')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_result_feedback_updated_at ON result_feedback(updated_at);
`
    }
];

function runSqliteMigrations(db: Database.Database): void {
    db.exec('BEGIN EXCLUSIVE');
    try {
        db.exec(SQLITE_MIGRATION_TABLE_SCHEMA);
        ensureSqliteMigrationChecksumColumn(db);
        const appliedRows = db
            .prepare('SELECT id, checksum FROM state_schema_migrations')
            .all() as SqliteMigrationRow[];
        const applied = new Map(appliedRows.map((row) => [row.id, row.checksum ?? null]));
        for (const migration of SQLITE_MIGRATIONS) {
            const checksum = migrationChecksum(migration.sql);
            if (applied.has(migration.id)) {
                if (applied.get(migration.id) !== checksum) {
                    throw new Error(`SQLite migration checksum mismatch: ${migration.id}`);
                }
                continue;
            }
            db.exec(migration.sql);
            db.prepare('INSERT INTO state_schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)').run(
                migration.id,
                checksum,
                isoDate(new Date())
            );
        }
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

export const SQLITE_SCHEMA = [SQLITE_MIGRATION_TABLE_SCHEMA, ...SQLITE_MIGRATIONS.map((migration) => migration.sql)]
    .map((sql) => sql.trim())
    .join('\n\n');

function ensureSqliteMigrationChecksumColumn(db: Database.Database): void {
    const columns = db.prepare('PRAGMA table_info(state_schema_migrations)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'checksum')) {
        db.exec('ALTER TABLE state_schema_migrations ADD COLUMN checksum TEXT');
    }
    for (const migration of SQLITE_MIGRATIONS) {
        db.prepare('UPDATE state_schema_migrations SET checksum = ? WHERE id = ? AND checksum IS NULL').run(
            migrationChecksum(migration.sql),
            migration.id
        );
    }
}

function migrationChecksum(sql: string): string {
    return crypto.createHash('sha256').update(sql.trim()).digest('hex');
}

function sameArtifactRecord(left: AgentArtifactRecord, right: AgentArtifactRecord): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
