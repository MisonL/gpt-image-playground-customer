import { GET } from './image/[filename]/route';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { createAccessToken } from '@/lib/server-runtime';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';

const originalAppPassword = process.env.APP_PASSWORD;

afterEach(() => {
    if (originalAppPassword === undefined) {
        delete process.env.APP_PASSWORD;
    } else {
        process.env.APP_PASSWORD = originalAppPassword;
    }
});

describe('GET /api/image/[filename]', () => {
    it('returns a missing page password code when the access cookie is absent', async () => {
        process.env.APP_PASSWORD = 'customer-password';
        const request = new NextRequest('http://localhost/api/image/sample.png');

        const response = await GET(request, { params: Promise.resolve({ filename: 'sample.png' }) });
        const result = (await response.json()) as { code?: string };

        assert.equal(response.status, 401);
        assert.equal(result.code, PAGE_PASSWORD_AUTH_ERROR_CODES.missing);
    });

    it('returns an invalid page password code when the access cookie is wrong', async () => {
        process.env.APP_PASSWORD = 'customer-password';
        const request = new NextRequest('http://localhost/api/image/sample.png', {
            headers: {
                Cookie: `gptImageAccess=${createAccessToken('other-password')}`
            }
        });

        const response = await GET(request, { params: Promise.resolve({ filename: 'sample.png' }) });
        const result = (await response.json()) as { code?: string };

        assert.equal(response.status, 401);
        assert.equal(result.code, PAGE_PASSWORD_AUTH_ERROR_CODES.invalid);
    });
});
