import { GET, POST } from './route';
import {
    getWebuiImageRetentionStore,
    resetWebuiImageRetentionStoresForTests
} from '@/lib/webui-image-retention-store';
import { createAccessToken } from '@/lib/server-runtime';
import { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const PAGE_PASSWORD_FIXTURE = ['customer', 'access', 'code'].join('-');
const validFilename = '1781567999000-aaaaaaaaaaaaaaaa-0.png';
const missingFilename = '1781567999001-bbbbbbbbbbbbbbbb-1.webp';
const symlinkFilename = '1781567999002-cccccccccccccccc-2.png';
let originalEnv: NodeJS.ProcessEnv;
let originalCwd = '';
let tempDir = '';

beforeEach(async () => {
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-retention-route-'));
    process.chdir(tempDir);
    delete process.env.APP_PASSWORD;
    resetWebuiImageRetentionStoresForTests();
});

afterEach(async () => {
    resetWebuiImageRetentionStoresForTests();
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
    restoreProcessEnv(originalEnv);
});

describe('GET and POST /api/image-retention', { concurrency: false }, () => {
    it('preserves valid top-level files in one batch and reports invalid files', async () => {
        await writeOutputFile(validFilename);

        const response = await POST(
            jsonRequest({
                action: 'preserve',
                filenames: [validFilename, '../outside.png', missingFilename]
            })
        );
        const body = (await response.json()) as {
            results: Array<{ filename: string; success: boolean; error?: string }>;
        };

        assert.equal(response.status, 207);
        assert.deepEqual(body.results, [
            { filename: validFilename, success: true },
            { filename: '../outside.png', success: false, error: '文件名格式无效。' },
            { filename: missingFilename, success: false, error: '文件不存在。' }
        ]);

        const store = await getWebuiImageRetentionStore();
        assert.deepEqual(await store.listPermanentFilenames(), [validFilename]);

        const listResponse = await GET(new NextRequest('http://localhost/api/image-retention'));
        assert.equal(listResponse.status, 200);
        assert.deepEqual(await listResponse.json(), { filenames: [validFilename] });
    });

    it('rejects preserve requests for symbolic links', async () => {
        const outputDir = await outputDirectory();
        const targetPath = path.join(tempDir, 'outside.png');
        await writeFile(targetPath, 'outside');
        await symlink(targetPath, path.join(outputDir, symlinkFilename));

        const response = await POST(
            jsonRequest({
                action: 'preserve',
                filenames: [symlinkFilename]
            })
        );
        const body = (await response.json()) as {
            results: Array<{ filename: string; success: boolean; error?: string }>;
        };

        assert.equal(response.status, 207);
        assert.deepEqual(body.results, [
            { filename: symlinkFilename, success: false, error: '文件必须是常规文件。' }
        ]);
    });

    it('releases stale markers without requiring the source file to exist', async () => {
        const store = await getWebuiImageRetentionStore();
        await store.preserve([missingFilename]);

        const response = await POST(
            jsonRequest({
                action: 'release',
                filenames: [missingFilename]
            })
        );
        const body = (await response.json()) as {
            results: Array<{ filename: string; success: boolean; error?: string }>;
        };

        assert.equal(response.status, 200);
        assert.deepEqual(body.results, [{ filename: missingFilename, success: true }]);
        assert.deepEqual(await store.listPermanentFilenames(), []);
    });

    it('rejects malformed or oversized retention batches before writing state', async () => {
        const malformed = await POST(jsonRequest({ action: 'preserve', filenames: [1] }));
        assert.equal(malformed.status, 400);

        const oversized = await POST(
            jsonRequest({
                action: 'preserve',
                filenames: Array.from({ length: 101 }, (_, index) =>
                    `1781567999${String(index).padStart(3, '0')}-aaaaaaaaaaaaaaaa-0.png`
                )
            })
        );
        assert.equal(oversized.status, 400);

        const store = await getWebuiImageRetentionStore();
        assert.deepEqual(await store.listPermanentFilenames(), []);
    });

    it('requires a valid password hash for POST and an access cookie for GET', async () => {
        await writeOutputFile(validFilename);
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;

        const missingHash = await POST(
            jsonRequest({
                action: 'preserve',
                filenames: [validFilename]
            })
        );
        assert.equal(missingHash.status, 401);

        const invalidHash = await POST(
            jsonRequest({
                action: 'preserve',
                filenames: [validFilename],
                passwordHash: '0'.repeat(64)
            })
        );
        assert.equal(invalidHash.status, 401);

        const authorizedPost = await POST(
            jsonRequest({
                action: 'preserve',
                filenames: [validFilename],
                passwordHash: sha256(PAGE_PASSWORD_FIXTURE)
            })
        );
        assert.equal(authorizedPost.status, 200);

        const missingCookie = await GET(new NextRequest('http://localhost/api/image-retention'));
        assert.equal(missingCookie.status, 401);

        const accessCookie = createAccessToken(PAGE_PASSWORD_FIXTURE);
        const authorizedGet = await GET(
            new NextRequest('http://localhost/api/image-retention', {
                headers: { Cookie: `gptImageAccess=${accessCookie}` }
            })
        );
        assert.equal(authorizedGet.status, 200);
    });
});

function jsonRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/image-retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

async function outputDirectory(): Promise<string> {
    const directory = path.join(tempDir, 'generated-images');
    await mkdir(directory, { recursive: true });
    return directory;
}

async function writeOutputFile(filename: string): Promise<void> {
    await writeFile(path.join(await outputDirectory(), filename), 'image');
}

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv): void {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(snapshot)) {
        process.env[key] = value;
    }
}

function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
