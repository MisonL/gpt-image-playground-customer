import { POST } from './route';
import {
    getWebuiImageRetentionStore,
    resetWebuiImageRetentionStoresForTests
} from '@/lib/webui-image-retention-store';
import { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const validFilename = '1781567999000-aaaaaaaaaaaaaaaa-0.png';
const missingFilename = '1781567999001-bbbbbbbbbbbbbbbb-1.webp';
let originalEnv: NodeJS.ProcessEnv;
let originalCwd = '';
let tempDir = '';

beforeEach(async () => {
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-delete-route-'));
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

describe('POST /api/image-delete', { concurrency: false }, () => {
    it('removes the permanent marker after deleting an image successfully', async () => {
        const filepath = await writeOutputFile(validFilename);
        const store = await getWebuiImageRetentionStore();
        await store.preserve([validFilename]);

        const response = await POST(jsonRequest({ filenames: [validFilename] }));
        const body = (await response.json()) as {
            results: Array<{ filename: string; success: boolean; error?: string }>;
        };

        assert.equal(response.status, 200);
        assert.deepEqual(body.results, [{ filename: validFilename, success: true }]);
        await assert.rejects(() => access(filepath));
        assert.deepEqual(await store.listPermanentFilenames(), []);
    });

    it('keeps a permanent marker when the file was not deleted', async () => {
        const store = await getWebuiImageRetentionStore();
        await store.preserve([missingFilename]);

        const response = await POST(jsonRequest({ filenames: [missingFilename] }));

        assert.equal(response.status, 207);
        assert.deepEqual(await store.listPermanentFilenames(), [missingFilename]);
    });
});

function jsonRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/image-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

async function writeOutputFile(filename: string): Promise<string> {
    const outputDir = path.join(tempDir, 'generated-images');
    await mkdir(outputDir, { recursive: true });
    const filepath = path.join(outputDir, filename);
    await writeFile(filepath, 'image');
    return filepath;
}

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv): void {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(snapshot)) {
        process.env[key] = value;
    }
}
