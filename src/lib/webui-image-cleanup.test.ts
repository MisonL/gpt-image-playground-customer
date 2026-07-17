import {
    cleanupExpiredWebuiImages,
    readWebuiImageCleanupConfig,
    type WebuiImageCleanupFileOperations
} from './webui-image-cleanup';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, realpath, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const NOW = new Date('2026-07-16T00:00:00.000Z');
const OLD_TIME = new Date('2026-06-15T23:59:59.000Z');
const NEW_TIME = new Date('2026-06-16T00:00:01.000Z');

const OLD_WEBUI_FILENAME = '1781567999000-aaaaaaaaaaaaaaaa-0.png';
const NEW_WEBUI_FILENAME = '1781568001000-bbbbbbbbbbbbbbbb-0.webp';
const PROTECTED_AGENT_FILENAME = '1781567998000-cccccccccccccccc-0.png';
const SECOND_OLD_FILENAME = '1781567997000-dddddddddddddddd-0.jpeg';
const SYMLINK_FILENAME = '1781567996000-eeeeeeeeeeeeeeee-0.png';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('readWebuiImageCleanupConfig', () => {
    it('defaults cleanup to disabled with a 30 day retention window', () => {
        assert.deepEqual(readWebuiImageCleanupConfig({}), {
            enabled: false,
            retentionDays: 30,
            intervalMs: 21_600_000
        });
    });

    it('enables cleanup explicitly while keeping the 30 day default', () => {
        assert.deepEqual(
            readWebuiImageCleanupConfig({
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true'
            }),
            {
                enabled: true,
                retentionDays: 30,
                intervalMs: 21_600_000
            }
        );
    });

    it('accepts an explicit positive retention period', () => {
        assert.deepEqual(
            readWebuiImageCleanupConfig({
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'yes',
                WEBUI_IMAGE_RETENTION_DAYS: '45'
            }),
            {
                enabled: true,
                retentionDays: 45,
                intervalMs: 21_600_000
            }
        );
    });

    it('rejects invalid enabled values instead of silently disabling cleanup', () => {
        assert.throws(
            () =>
                readWebuiImageCleanupConfig({
                    WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'sometimes'
                }),
            /WEBUI_IMAGE_AUTO_CLEANUP_ENABLED/
        );
    });

    it('rejects non-positive retention when cleanup is enabled', () => {
        assert.throws(
            () =>
                readWebuiImageCleanupConfig({
                    WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true',
                    WEBUI_IMAGE_RETENTION_DAYS: '0'
                }),
            /WEBUI_IMAGE_RETENTION_DAYS/
        );
    });

    it('does not activate or validate retention while cleanup is disabled', () => {
        assert.deepEqual(
            readWebuiImageCleanupConfig({
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'off',
                WEBUI_IMAGE_RETENTION_DAYS: 'invalid'
            }),
            {
                enabled: false,
                retentionDays: 30,
                intervalMs: 21_600_000
            }
        );
    });
});

describe('cleanupExpiredWebuiImages', () => {
    it('deletes only expired unprotected top-level image files', async () => {
        const outputDir = await createTempDirectory();
        const outsideDir = await createTempDirectory();
        const oldWebuiPath = await createFile(outputDir, OLD_WEBUI_FILENAME, OLD_TIME);
        const newWebuiPath = await createFile(outputDir, NEW_WEBUI_FILENAME, NEW_TIME);
        const protectedAgentPath = await createFile(outputDir, PROTECTED_AGENT_FILENAME, OLD_TIME);
        const invalidPath = await createFile(outputDir, 'legacy-image.png', OLD_TIME);
        const shareDir = path.join(outputDir, '.shares');
        await mkdir(shareDir, { recursive: true });
        const sharePath = await createFile(shareDir, SECOND_OLD_FILENAME, OLD_TIME);
        const outsidePath = await createFile(outsideDir, 'outside.png', OLD_TIME);
        const symlinkPath = path.join(outputDir, SYMLINK_FILENAME);
        await symlink(outsidePath, symlinkPath);

        const result = await cleanupExpiredWebuiImages({
            outputDir,
            retentionDays: 30,
            protectedArtifactFilepaths: [protectedAgentPath],
            now: NOW
        });

        assert.deepEqual(result, {
            status: 'succeeded',
            startedAt: NOW.toISOString(),
            completedAt: NOW.toISOString(),
            cutoffAt: '2026-06-16T00:00:00.000Z',
            scannedCount: 3,
            protectedCount: 1,
            deletedCount: 1,
            failedCount: 0,
            failures: []
        });
        await assert.rejects(() => access(oldWebuiPath));
        await access(newWebuiPath);
        await access(protectedAgentPath);
        await access(invalidPath);
        await access(sharePath);
        await access(symlinkPath);
        await access(outsidePath);
    });

    it('reports individual deletion failures and continues with other candidates', async () => {
        const outputDir = await createTempDirectory();
        const failingPath = await createFile(outputDir, OLD_WEBUI_FILENAME, OLD_TIME);
        const deletedPath = await createFile(outputDir, SECOND_OLD_FILENAME, OLD_TIME);
        const canonicalFailingPath = await realpath(failingPath);
        const fileOperations: Partial<WebuiImageCleanupFileOperations> = {
            async unlink(filepath) {
                if (filepath === canonicalFailingPath) {
                    throw new Error('permission denied');
                }
                await unlink(filepath);
            }
        };

        const result = await cleanupExpiredWebuiImages({
            outputDir,
            retentionDays: 30,
            protectedArtifactFilepaths: [],
            now: NOW,
            fileOperations
        });

        assert.equal(result.status, 'failed');
        assert.equal(result.scannedCount, 2);
        assert.equal(result.protectedCount, 0);
        assert.equal(result.deletedCount, 1);
        assert.equal(result.failedCount, 1);
        assert.deepEqual(result.failures, [
            {
                filename: OLD_WEBUI_FILENAME,
                message: 'permission denied'
            }
        ]);
        await access(failingPath);
        await assert.rejects(() => access(deletedPath));
    });

    it('protects artifacts when output and artifact paths use different realpath aliases', async () => {
        const outputDir = await createTempDirectory();
        const filename = PROTECTED_AGENT_FILENAME;
        const filepath = await createFile(outputDir, filename, OLD_TIME);
        const canonicalPath = path.join(await realpath(outputDir), filename);

        const result = await cleanupExpiredWebuiImages({
            outputDir,
            retentionDays: 30,
            protectedArtifactFilepaths: [canonicalPath],
            now: NOW
        });

        assert.equal(result.protectedCount, 1);
        assert.equal(result.deletedCount, 0);
        await access(filepath);
    });

    it('rechecks permanent protection inside the filename lock before deleting an expired file', async () => {
        const outputDir = await createTempDirectory();
        const filepath = await createFile(outputDir, OLD_WEBUI_FILENAME, OLD_TIME);
        const events: string[] = [];

        const result = await cleanupExpiredWebuiImages({
            outputDir,
            retentionDays: 30,
            protectedArtifactFilepaths: [],
            now: NOW,
            withFilenameLock: async (filename, operation) => {
                events.push(`lock:${filename}`);
                return await operation();
            },
            isFilenameProtected: async (filename) => {
                events.push(`check:${filename}`);
                return filename === OLD_WEBUI_FILENAME;
            }
        });

        assert.equal(result.protectedCount, 1);
        assert.equal(result.deletedCount, 0);
        assert.deepEqual(events, [`lock:${OLD_WEBUI_FILENAME}`, `check:${OLD_WEBUI_FILENAME}`]);
        await access(filepath);
    });

    it('fails visibly when a protected artifact path cannot be canonicalized', async () => {
        const outputDir = await createTempDirectory();
        const protectedPath = path.join(outputDir, PROTECTED_AGENT_FILENAME);
        const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });

        await assert.rejects(
            () =>
                cleanupExpiredWebuiImages({
                    outputDir,
                    retentionDays: 30,
                    protectedArtifactFilepaths: [protectedPath],
                    now: NOW,
                    fileOperations: {
                        async realpath(filepath) {
                            if (filepath === protectedPath) throw permissionError;
                            return await realpath(filepath);
                        }
                    }
                }),
            /permission denied/
        );
    });
});

async function createTempDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'webui-image-cleanup-'));
    tempDirs.push(directory);
    return directory;
}

async function createFile(directory: string, filename: string, modifiedAt: Date): Promise<string> {
    const filepath = path.join(directory, filename);
    await writeFile(filepath, 'image');
    await utimes(filepath, modifiedAt, modifiedAt);
    return filepath;
}
