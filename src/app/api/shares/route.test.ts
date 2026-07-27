import { POST as getShareContent } from './[token]/content/route';
import { GET as getShare } from './[token]/route';
import { POST } from './route';
import { resetAgentStateStoreForTests } from '@/lib/agent-state-runtime';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { createAccessToken } from '@/lib/server-runtime';
import { createImageShare } from '@/lib/share-store';
import { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const originalAppPassword = process.env.APP_PASSWORD;
const PAGE_PASSWORD_FIXTURE = ['customer', 'access', 'code'].join('-');
const VALID_PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR42mP8z8AABQMBgADeT7UAAAAASUVORK5CYII=',
    'base64'
);
let previousCwd = '';
let tempDir = '';

async function withTempCwd() {
    previousCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-route-'));
    process.chdir(tempDir);
}

afterEach(async () => {
    await resetAgentStateStoreForTests();
    if (previousCwd) process.chdir(previousCwd);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    previousCwd = '';
    tempDir = '';
    if (originalAppPassword === undefined) {
        delete process.env.APP_PASSWORD;
    } else {
        process.env.APP_PASSWORD = originalAppPassword;
    }
});

function createShareRequest(form: FormData, options: { accessToken?: string | null; url?: string } = {}) {
    const headers = new Headers();
    const accessToken =
        options.accessToken === undefined ? createAccessToken(PAGE_PASSWORD_FIXTURE) : options.accessToken;
    if (accessToken) headers.set('Cookie', `gptImageAccess=${accessToken}`);
    return new NextRequest(options.url ?? 'http://localhost/api/shares', { method: 'POST', headers, body: form });
}

function params(token: string) {
    return { params: Promise.resolve({ token }) };
}

describe('POST /api/shares', { concurrency: false }, () => {
    it('creates a share from an uploaded image without returning secrets', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('accessCode', '12345678');
        form.set('expiresInMinutes', '60');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 201);
        const body = await response.json();

        assert.match(body.token, /^[a-f0-9]{24}$/);
        assert.equal(body.accessCodeRequired, true);
        assert.equal(body.url, `/share/${body.token}`);
        assert.equal('accessCodeHash' in body, false);
        assert.equal('accessCodeSalt' in body, false);
    });

    it('returns a same-deployment share path instead of an internal Docker listener origin', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { url: 'http://0.0.0.0:4783/api/shares' }));
        assert.equal(response.status, 201);
        const body = await response.json();

        assert.equal(body.url, `/share/${body.token}`);
    });

    it('keeps a deployment path prefix in the returned share path', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(
            createShareRequest(form, { url: 'https://internal.example.test/playground/api/shares' })
        );
        assert.equal(response.status, 201);
        const body = await response.json();

        assert.equal(body.url, `/playground/share/${body.token}`);
    });

    it('rejects unauthenticated share creation when a page access code is configured', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: null }));
        assert.equal(response.status, 401);
        const body = await response.json();
        assert.equal(body.code, PAGE_PASSWORD_AUTH_ERROR_CODES.missing);
    });

    it('rejects share creation with an invalid page access token', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: 'invalid-access-token' }));
        assert.equal(response.status, 401);
        const body = await response.json();
        assert.equal(body.code, PAGE_PASSWORD_AUTH_ERROR_CODES.invalid);
    });

    it('allows share creation when no page access code is configured', async () => {
        await withTempCwd();
        delete process.env.APP_PASSWORD;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: null }));
        assert.equal(response.status, 201);
    });

    it('allows share creation when APP_PASSWORD is blank', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = '   ';
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: null }));
        assert.equal(response.status, 201);
    });

    it('treats blank access codes as public shares', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('accessCode', '   ');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 201);
        const body = await response.json();
        assert.equal(body.accessCodeRequired, false);
    });

    it('creates a public share with an expiry', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('expiresInMinutes', '60');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 201);
        const body = await response.json();

        assert.equal(body.accessCodeRequired, false);
        assert.equal(typeof body.expiresAt, 'string');
        assert.ok(Number.isFinite(new Date(body.expiresAt).getTime()));
    });

    it('rejects short access codes', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('accessCode', '1234567');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_access_code');
    });

    it('rejects missing image uploads', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'image_required');
    });

    it('rejects bytes that are not a real image even when the upload declares image/png', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([Buffer.from('not-a-real-png')], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_image_content');
    });

    it('rejects invalid expiry values', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('expiresInMinutes', '-1');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_expiry');
    });

    it('rejects unsafe source filenames before storing share metadata', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', '../secret.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_source_filename');
    });

    it('rejects non-string source filenames before storing share metadata', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', new File([Buffer.from('not-a-name')], 'name.txt', { type: 'text/plain' }));
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_source_filename');
    });

    it('rejects overlong source filenames before storing share metadata', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = PAGE_PASSWORD_FIXTURE;
        const form = new FormData();
        form.set('sourceFilename', `${'a'.repeat(201)}.png`);
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_source_filename');
    });
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

        const response = await getShare(
            new Request(`http://localhost/api/shares/${record.token}`),
            params(record.token)
        );
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
            expiresInMinutes: 1,
            now: new Date(Date.now() - 120_000)
        });

        const response = await getShare(
            new Request(`http://localhost/api/shares/${record.token}`),
            params(record.token)
        );
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
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                body: JSON.stringify({})
            }),
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
        assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(ok.headers.get('content-disposition'), 'inline; filename="shared-image.png"');
        assert.equal(await ok.text(), 'protected-image');
    });

    it('uses the detected image MIME type for public content filenames', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('public-image'),
            sourceFilename: 'invoice.html',
            mimeType: 'image/png',
            accessCode: undefined,
            expiresInMinutes: null
        });

        const response = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({})
            }),
            params(record.token)
        );

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('content-disposition'), 'inline; filename="invoice.png"');
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
            expiresInMinutes: 1,
            now: new Date(Date.now() - 120_000)
        });

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
