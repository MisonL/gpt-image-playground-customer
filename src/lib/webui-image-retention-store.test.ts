import {
    SqliteWebuiImageRetentionStore,
    type PersistedWebuiImageCleanupStatus
} from './webui-image-retention-store';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const firstFilename = '1781567999000-aaaaaaaaaaaaaaaa-0.png';
const secondFilename = '1781567999001-bbbbbbbbbbbbbbbb-1.webp';
const publicRun: NonNullable<PersistedWebuiImageCleanupStatus['lastRun']> = {
    status: 'succeeded',
    startedAt: '2026-07-16T00:00:00.000Z',
    completedAt: '2026-07-16T00:00:01.000Z',
    cutoffAt: '2026-06-16T00:00:00.000Z',
    scannedCount: 4,
    protectedCount: 1,
    deletedCount: 2,
    failedCount: 0
};

describe('SqliteWebuiImageRetentionStore', () => {
    let tempDir = '';
    let dbPath = '';

    beforeEach(async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'webui-image-retention-'));
        dbPath = path.join(tempDir, 'webui-image-retention.sqlite');
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('persists batch permanent filenames and cleanup summaries across store instances', async () => {
        const first = new SqliteWebuiImageRetentionStore(dbPath);
        await first.init();
        await first.preserve([secondFilename, firstFilename, firstFilename]);
        await first.writeCleanupStatus({ lastRun: publicRun });

        const second = new SqliteWebuiImageRetentionStore(dbPath);
        await second.init();

        assert.deepEqual(await second.listPermanentFilenames(), [firstFilename, secondFilename]);
        assert.deepEqual(await second.readCleanupStatus(), { lastRun: publicRun });
    });

    it('releases stale markers without requiring the image file to exist', async () => {
        const store = new SqliteWebuiImageRetentionStore(dbPath);
        await store.init();
        await store.preserve([firstFilename]);

        await store.release([firstFilename]);

        assert.deepEqual(await store.listPermanentFilenames(), []);
    });

    it('does not persist failure filenames or absolute paths in cleanup status', async () => {
        const store = new SqliteWebuiImageRetentionStore(dbPath);
        await store.init();
        const contaminatedRun = {
            ...publicRun,
            failures: [
                {
                    filename: firstFilename,
                    message: 'permission denied at /private/generated-images'
                }
            ]
        };
        await store.writeCleanupStatus({
            lastRun: contaminatedRun
        });

        const database = new Database(dbPath, { readonly: true });
        const row = database
            .prepare('SELECT last_run_json FROM webui_image_cleanup_status WHERE id = 1')
            .get() as { last_run_json: string };
        database.close();

        assert.equal(row.last_run_json.includes(firstFilename), false);
        assert.equal(row.last_run_json.includes('/private/generated-images'), false);
    });
});
