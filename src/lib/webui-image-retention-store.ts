import { isValidImageFilename } from './image-request-utils';
import { resolveImageOutputDir } from './server-runtime';
import type { PublicWebuiImageCleanupRun } from './webui-image-cleanup-runtime';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const WEBUI_IMAGE_RETENTION_STATE_DIRECTORY = '.webui-state';
export const WEBUI_IMAGE_RETENTION_DATABASE_FILENAME = 'webui-image-retention.sqlite';
export const WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE = 'WebUI 图片自动清理执行失败。';

export const WEBUI_IMAGE_RETENTION_SCHEMA = `
    CREATE TABLE IF NOT EXISTS webui_image_retention (
        filename TEXT PRIMARY KEY NOT NULL,
        saved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webui_image_cleanup_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_run_json TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
    );
`;

type CleanupStatusRow = {
    last_run_json: string | null;
    last_error: string | null;
};

export type WebuiImageRetentionAction = 'preserve' | 'release';

export type PersistedWebuiImageCleanupStatus = {
    lastRun?: PublicWebuiImageCleanupRun;
    lastError?: string;
};

export class SqliteWebuiImageRetentionStore {
    private db: Database.Database | undefined;

    constructor(private readonly dbPath: string) {}

    async init(): Promise<void> {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(WEBUI_IMAGE_RETENTION_SCHEMA);
    }

    async preserve(filenames: readonly string[], now = new Date()): Promise<void> {
        const uniqueFilenames = normalizeFilenames(filenames);
        if (uniqueFilenames.length === 0) return;

        const db = this.requireDb();
        const statement = db.prepare(
            `INSERT INTO webui_image_retention (filename, saved_at)
             VALUES (?, ?)
             ON CONFLICT(filename) DO NOTHING`
        );
        const savedAt = now.toISOString();
        db.transaction(() => {
            for (const filename of uniqueFilenames) {
                statement.run(filename, savedAt);
            }
        })();
    }

    async release(filenames: readonly string[]): Promise<void> {
        await this.remove(filenames);
    }

    async remove(filenames: readonly string[]): Promise<void> {
        const uniqueFilenames = normalizeFilenames(filenames);
        if (uniqueFilenames.length === 0) return;

        const db = this.requireDb();
        const statement = db.prepare('DELETE FROM webui_image_retention WHERE filename = ?');
        db.transaction(() => {
            for (const filename of uniqueFilenames) {
                statement.run(filename);
            }
        })();
    }

    async listPermanentFilenames(): Promise<string[]> {
        const rows = this.requireDb()
            .prepare('SELECT filename FROM webui_image_retention ORDER BY filename ASC')
            .all() as Array<{ filename: string }>;
        return rows.map((row) => row.filename);
    }

    async writeCleanupStatus(status: PersistedWebuiImageCleanupStatus, now = new Date()): Promise<void> {
        const publicRun = status.lastRun ? normalizePublicRun(status.lastRun) : undefined;
        this.requireDb()
            .prepare(
                `INSERT INTO webui_image_cleanup_status (id, last_run_json, last_error, updated_at)
                 VALUES (1, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                    last_run_json = excluded.last_run_json,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at`
            )
            .run(
                publicRun ? JSON.stringify(publicRun) : null,
                status.lastError ? WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE : null,
                now.toISOString()
            );
    }

    async readCleanupStatus(): Promise<PersistedWebuiImageCleanupStatus> {
        const row = this.requireDb()
            .prepare('SELECT last_run_json, last_error FROM webui_image_cleanup_status WHERE id = 1')
            .get() as CleanupStatusRow | undefined;
        if (!row) return {};

        return {
            ...(row.last_run_json ? { lastRun: parsePublicRun(row.last_run_json) } : {}),
            ...(row.last_error ? { lastError: readCleanupError(row.last_error) } : {})
        };
    }

    private requireDb(): Database.Database {
        if (!this.db) {
            throw new Error('WebUI 图片保留状态库尚未初始化。');
        }
        return this.db;
    }
}

const cachedStores = new Map<string, Promise<SqliteWebuiImageRetentionStore>>();

export function resolveWebuiImageRetentionDatabasePath(
    env: Record<string, string | undefined> = process.env
): string {
    return path.join(
        resolveImageOutputDir(env),
        WEBUI_IMAGE_RETENTION_STATE_DIRECTORY,
        WEBUI_IMAGE_RETENTION_DATABASE_FILENAME
    );
}

export async function getWebuiImageRetentionStore(
    env: Record<string, string | undefined> = process.env
): Promise<SqliteWebuiImageRetentionStore> {
    const dbPath = resolveWebuiImageRetentionDatabasePath(env);
    const cachedStore = cachedStores.get(dbPath);
    if (cachedStore) return await cachedStore;

    const store = new SqliteWebuiImageRetentionStore(dbPath);
    const readyStore = store.init().then(() => store);
    cachedStores.set(dbPath, readyStore);
    try {
        return await readyStore;
    } catch (error) {
        if (cachedStores.get(dbPath) === readyStore) {
            cachedStores.delete(dbPath);
        }
        throw error;
    }
}

export function resetWebuiImageRetentionStoresForTests(): void {
    cachedStores.clear();
}

function normalizeFilenames(filenames: readonly string[]): string[] {
    const uniqueFilenames = [...new Set(filenames)];
    for (const filename of uniqueFilenames) {
        if (!isValidImageFilename(filename)) {
            throw new Error('WebUI 图片保留状态包含无效文件名。');
        }
    }
    return uniqueFilenames;
}

function parsePublicRun(value: string): PublicWebuiImageCleanupRun {
    try {
        return normalizePublicRun(JSON.parse(value));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error('WebUI 图片清理状态格式无效。');
        }
        throw error;
    }
}

function normalizePublicRun(value: unknown): PublicWebuiImageCleanupRun {
    if (!value || typeof value !== 'object') {
        throw new Error('WebUI 图片清理状态格式无效。');
    }
    const run = value as Partial<PublicWebuiImageCleanupRun>;
    if (
        (run.status !== 'succeeded' && run.status !== 'failed') ||
        !isNonEmptyString(run.startedAt) ||
        !isNonEmptyString(run.completedAt) ||
        !isNonEmptyString(run.cutoffAt) ||
        !isCount(run.scannedCount) ||
        !isCount(run.protectedCount) ||
        !isCount(run.deletedCount) ||
        !isCount(run.failedCount)
    ) {
        throw new Error('WebUI 图片清理状态格式无效。');
    }
    return {
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        cutoffAt: run.cutoffAt,
        scannedCount: run.scannedCount,
        protectedCount: run.protectedCount,
        deletedCount: run.deletedCount,
        failedCount: run.failedCount
    };
}

function readCleanupError(value: string): string {
    if (value !== WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE) {
        throw new Error('WebUI 图片清理状态格式无效。');
    }
    return value;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
