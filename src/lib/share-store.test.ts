import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let originalCwd = '';
let tempDir = '';

beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-share-'));
    process.chdir(tempDir);
});

afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
});

describe('image share store', () => {
    it('stores a copied image share with hashed access code and expiry', async () => {
        const {
            createImageShare,
            isImageShareExpired,
            readImageShare,
            readImageShareContent,
            verifyImageShareAccess
        } = await import('./share-store');
        const now = new Date('2026-05-14T08:00:00.000Z');

        const created = await createImageShare({
            imageBuffer: Buffer.from('image-bytes'),
            sourceFilename: 'source.png',
            mimeType: 'image/png',
            accessCode: '123456',
            expiresInMinutes: 60,
            now
        });

        assert.match(created.token, /^[a-f0-9]{24}$/);
        assert.equal(created.accessCodeRequired, true);
        assert.equal(created.expiresAt, '2026-05-14T09:00:00.000Z');

        const record = await readImageShare(created.token);
        assert.ok(record);
        assert.equal(record.sourceFilename, 'source.png');
        assert.equal(record.mimeType, 'image/png');
        assert.notEqual(record.accessCodeHash, '123456');
        assert.equal(verifyImageShareAccess(record, '123456'), true);
        assert.equal(verifyImageShareAccess(record, 'bad-code'), false);
        assert.equal(isImageShareExpired(record, new Date('2026-05-14T08:59:59.000Z')), false);
        assert.equal(isImageShareExpired(record, new Date('2026-05-14T09:00:01.000Z')), true);

        const content = await readImageShareContent(record);
        assert.equal(content.mimeType, 'image/png');
        assert.equal(content.buffer.toString(), 'image-bytes');
    });

    it('creates public shares without access code or expiry', async () => {
        const { createImageShare, isImageShareExpired, readImageShare, verifyImageShareAccess } = await import('./share-store');

        const created = await createImageShare({
            imageBuffer: Buffer.from('public-image'),
            sourceFilename: 'public.webp',
            mimeType: 'image/webp',
            expiresInMinutes: null,
            now: new Date('2026-05-14T08:00:00.000Z')
        });

        const record = await readImageShare(created.token);
        assert.ok(record);
        assert.equal(record.accessCodeRequired, false);
        assert.equal(record.expiresAt, undefined);
        assert.equal(verifyImageShareAccess(record, ''), true);
        assert.equal(isImageShareExpired(record, new Date('2027-05-14T08:00:00.000Z')), false);
    });

    it('rejects unsafe share tokens', async () => {
        const { readImageShare } = await import('./share-store');

        assert.equal(await readImageShare('../escape'), undefined);
    });

    it('resolves the share directory from the active working directory', async () => {
        const { createImageShare, getShareMetadataPathForTest, readImageShare } = await import('./share-store');

        const first = await createImageShare({
            imageBuffer: Buffer.from('first-image'),
            sourceFilename: 'first.png',
            mimeType: 'image/png',
            expiresInMinutes: null
        });
        const firstMetadataPath = getShareMetadataPathForTest(first.token);
        const secondDir = await mkdtemp(path.join(os.tmpdir(), 'image-share-second-'));

        try {
            process.chdir(secondDir);
            const second = await createImageShare({
                imageBuffer: Buffer.from('second-image'),
                sourceFilename: 'second.png',
                mimeType: 'image/png',
                expiresInMinutes: null
            });
            const secondMetadataPath = getShareMetadataPathForTest(second.token);

            assert.notEqual(path.dirname(secondMetadataPath), path.dirname(firstMetadataPath));
            assert.ok(await readImageShare(second.token));
            await stat(secondMetadataPath);
        } finally {
            process.chdir(tempDir);
            await rm(secondDir, { recursive: true, force: true });
        }
    });
});
