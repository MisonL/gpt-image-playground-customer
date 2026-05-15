import { POST } from './route';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
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

describe('POST /api/auth-verify', () => {
    it('returns a page password error code for invalid password hashes', async () => {
        process.env.APP_PASSWORD = 'customer-password';
        const request = new NextRequest('http://localhost/api/auth-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordHash: '0'.repeat(64) })
        });

        const response = await POST(request);
        const result = (await response.json()) as { code?: string };

        assert.equal(response.status, 401);
        assert.equal(result.code, PAGE_PASSWORD_AUTH_ERROR_CODES.invalid);
    });
});
