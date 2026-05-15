import { createImageShare } from '@/lib/share-store';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { POST as getShareContent } from './shares/[token]/content/route';
import { GET as getShare } from './shares/[token]/route';

let previousCwd = '';
let tempDir = '';

async function withTempCwd() {
    previousCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-content-route-'));
    process.chdir(tempDir);
}

function params(token: string) {
    return { params: Promise.resolve({ token }) };
}

afterEach(async () => {
    if (previousCwd) process.chdir(previousCwd);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    previousCwd = '';
    tempDir = '';
});

describe('share metadata and content routes', { concurrency: false }, () => {
    it('returns public metadata without hashes', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('image-bytes'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: '12345678',
            expiresInMinutes: 60
        });

        const response = await getShare(new Request(`http://localhost/api/shares/${record.token}`), params(record.token));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.token, record.token);
        assert.equal(body.accessCodeRequired, true);
        assert.equal(body.expired, false);
        assert.equal(body.sourceFilename, 'shared-image');
        assert.equal('accessCodeHash' in body, false);
        assert.equal('accessCodeSalt' in body, false);
    });

    it('marks expired metadata without serving content', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('expired-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: undefined,
            expiresInMinutes: null
        });
        const expiredRecord = { ...record, expiresAt: new Date(Date.now() - 60_000).toISOString() };
        await fs.writeFile(path.join(tempDir, 'generated-images', '.shares', `${record.token}.json`), `${JSON.stringify(expiredRecord)}\n`);

        const response = await getShare(new Request(`http://localhost/api/shares/${record.token}`), params(record.token));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.expired, true);
    });

    it('serves protected content only with the correct access code', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('protected-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: '12345678',
            expiresInMinutes: null
        });

        const missing = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, { method: 'POST', body: JSON.stringify({}) }),
            params(record.token)
        );
        assert.equal(missing.status, 401);

        const wrong = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accessCode: 'bad' })
            }),
            params(record.token)
        );
        assert.equal(wrong.status, 401);

        const ok = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accessCode: '12345678' })
            }),
            params(record.token)
        );
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get('content-type'), 'image/png');
        assert.match(ok.headers.get('cache-control') || '', /no-store/);
        assert.equal(ok.headers.get('surrogate-control'), 'no-store');
        assert.equal(ok.headers.get('content-disposition'), 'inline; filename="shared-image.png"');
        assert.equal(await ok.text(), 'protected-image');
    });

    it('rate limits repeated wrong access codes', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('protected-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: '12345678',
            expiresInMinutes: null
        });

        for (let attempt = 0; attempt < 10; attempt += 1) {
            await getShareContent(
                new Request(`http://localhost/api/shares/${record.token}/content`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ accessCode: 'bad-code' })
                }),
                params(record.token)
            );
        }

        const response = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accessCode: 'bad-code' })
            }),
            params(record.token)
        );
        assert.equal(response.status, 429);
    });

    it('clears stale access failures when a token is retried after the window', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('protected-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: '12345678',
            expiresInMinutes: null
        });
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;

        try {
            for (let attempt = 0; attempt < 10; attempt += 1) {
                await getShareContent(
                    new Request(`http://localhost/api/shares/${record.token}/content`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ accessCode: 'bad-code' })
                    }),
                    params(record.token)
                );
            }

            now += 15 * 60 * 1000 + 1;
            const response = await getShareContent(
                new Request(`http://localhost/api/shares/${record.token}/content`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ accessCode: '12345678' })
                }),
                params(record.token)
            );
            assert.equal(response.status, 200);
        } finally {
            Date.now = originalNow;
        }
    });

    it('does not serve expired content', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('expired-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: undefined,
            expiresInMinutes: null
        });
        const expiredRecord = { ...record, expiresAt: new Date(Date.now() - 60_000).toISOString() };
        await fs.writeFile(path.join(tempDir, 'generated-images', '.shares', `${record.token}.json`), `${JSON.stringify(expiredRecord)}\n`);

        const response = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({})
            }),
            params(record.token)
        );
        assert.equal(response.status, 410);
    });
});
