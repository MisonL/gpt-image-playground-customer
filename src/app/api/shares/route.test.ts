import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { createAccessToken } from '@/lib/server-runtime';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from './route';

const originalAppPassword = process.env.APP_PASSWORD;
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

function createShareRequest(form: FormData, options: { accessToken?: string | null } = {}) {
    const headers = new Headers();
    const accessToken = options.accessToken === undefined ? createAccessToken('customer-password') : options.accessToken;
    if (accessToken) headers.set('Cookie', `gptImageAccess=${accessToken}`);
    return new NextRequest('http://localhost/api/shares', { method: 'POST', headers, body: form });
}

describe('POST /api/shares', { concurrency: false }, () => {
    it('creates a share from an uploaded image without returning secrets', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = 'customer-password';
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
        assert.equal(typeof body.url, 'string');
        assert.ok(body.url.includes(`/share/${body.token}`));
        assert.equal('accessCodeHash' in body, false);
        assert.equal('accessCodeSalt' in body, false);
    });

    it('rejects unauthenticated share creation when a page password is configured', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = 'customer-password';
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
        process.env.APP_PASSWORD = 'customer-password';
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: 'invalid-access-token' }));
        assert.equal(response.status, 401);
        const body = await response.json();
        assert.equal(body.code, PAGE_PASSWORD_AUTH_ERROR_CODES.invalid);
    });

    it('allows share creation when no page password is configured', async () => {
        await withTempCwd();
        delete process.env.APP_PASSWORD;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: null }));
        assert.equal(response.status, 201);
    });

    it('treats blank access codes as public shares', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = 'customer-password';
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
        process.env.APP_PASSWORD = 'customer-password';
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
        process.env.APP_PASSWORD = 'customer-password';
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
        process.env.APP_PASSWORD = 'customer-password';
        const form = new FormData();
        form.set('sourceFilename', 'result.png');

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'image_required');
    });

    it('rejects bytes that are not a real image even when the upload declares image/png', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = 'customer-password';
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
        process.env.APP_PASSWORD = 'customer-password';
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('expiresInMinutes', '-1');
        form.set('image', new File([VALID_PNG_BYTES], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_expiry');
    });
});
