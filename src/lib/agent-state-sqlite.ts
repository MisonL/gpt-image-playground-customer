import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
import type { AgentImageResponse } from './agent-api-contracts';
import type { ImageShareRecord, ImageShareStateStore } from './share-store';

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

export class SqliteAgentStateStore implements AgentStateStore, ImageShareStateStore {
    private db: Database.Database | undefined;

    constructor(private readonly dbPath: string) {}

    async init(): Promise<void> {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(SQLITE_SCHEMA);
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
                db.prepare('INSERT INTO agent_recovery_events (id, event_type, details_json, created_at) VALUES (?, ?, ?, ?)').run(
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
                `SELECT r.request_id, a.filepath
                 FROM agent_requests r
                 LEFT JOIN agent_artifacts a ON a.request_id = r.request_id
                 WHERE r.expires_at < ? AND r.status IN ('succeeded', 'failed', 'orphaned')`
            )
            .all(nowIso) as Array<{ request_id: string; filepath: string | null }>;
        const requestIds = [...new Set(expiredRows.map((row) => row.request_id))];
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
            for (const requestId of requestIds) {
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
        const existing = this.getRequestRow(input.idempotencyKey);

        if (!existing) {
            const requestId = createRequestId();
            db.prepare(
                `INSERT INTO agent_requests
                    (request_id, idempotency_key, request_hash, mode, status, request_json, locked_until, created_at, updated_at, expires_at)
                 VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`
            ).run(
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
            return { type: 'acquired', record: this.mapRequestRow(this.getRequestRow(input.idempotencyKey)!) };
        }

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
        if ((existing.status === 'running' || existing.status === 'pending') && existing.locked_until && existing.locked_until > nowIso) {
            return { type: 'in_progress', record, retryAfterSeconds: computeRetryAfterSeconds(existing.locked_until, now) };
        }

        db.prepare(
            "UPDATE agent_requests SET status = 'running', locked_until = ?, updated_at = ?, expires_at = ? WHERE idempotency_key = ?"
        ).run(lockedUntil, nowIso, expiresAt, input.idempotencyKey);
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

    async getArtifact(id: string): Promise<AgentArtifactRecord | undefined> {
        const row = this.requireDb().prepare('SELECT * FROM agent_artifacts WHERE id = ?').get(id) as SqliteArtifactRow | undefined;
        return row ? this.mapArtifactRow(row) : undefined;
    }

    async listArtifactsForRequest(requestId: string): Promise<AgentArtifactRecord[]> {
        return this.listArtifactsForRequestSync(requestId);
    }

    async deleteArtifact(id: string): Promise<boolean> {
        const result = this.requireDb().prepare('DELETE FROM agent_artifacts WHERE id = ?').run(id);
        return result.changes > 0;
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
        const row = this.requireDb().prepare('SELECT * FROM image_shares WHERE token = ?').get(token) as SqliteShareRow | undefined;
        return row ? this.mapShareRow(row) : undefined;
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
                this.requireDb()
                    .prepare(
                        `INSERT INTO agent_artifacts
                        (id, request_id, filename, filepath, content_url, metadata_url, output_format, mime_type, size_bytes, width, height, model, prompt_hash, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) DO UPDATE SET
                        request_id = excluded.request_id,
                        filename = excluded.filename,
                        filepath = excluded.filepath,
                        content_url = excluded.content_url,
                        metadata_url = excluded.metadata_url,
                        output_format = excluded.output_format,
                        mime_type = excluded.mime_type,
                        size_bytes = excluded.size_bytes,
                        width = excluded.width,
                        height = excluded.height,
                        model = excluded.model,
                        prompt_hash = excluded.prompt_hash,
                        created_at = excluded.created_at`
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

function cryptoRandomId(): string {
    return crypto.randomUUID();
}

export const SQLITE_SCHEMA = `
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
    access_code_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_image_shares_expires_at ON image_shares(expires_at);
`;
