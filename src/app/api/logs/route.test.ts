import { GET } from './route';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';

const originalAppPassword = process.env.APP_PASSWORD;
const originalAppLogLevel = process.env.APP_LOG_LEVEL;

afterEach(() => {
    if (originalAppPassword === undefined) {
        delete process.env.APP_PASSWORD;
    } else {
        process.env.APP_PASSWORD = originalAppPassword;
    }
    if (originalAppLogLevel === undefined) {
        delete process.env.APP_LOG_LEVEL;
    } else {
        process.env.APP_LOG_LEVEL = originalAppLogLevel;
    }
});

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

describe('GET /api/logs', () => {
    it('rejects log streaming when APP_PASSWORD is not configured', async () => {
        delete process.env.APP_PASSWORD;
        const request = new NextRequest('http://localhost/api/logs');

        const response = await GET(request);

        assert.equal(response.status, 403);
    });

    it('rejects password hashes sent in the query string', async () => {
        process.env.APP_PASSWORD = 'customer-password';
        const request = new NextRequest(`http://localhost/api/logs?passwordHash=${sha256('customer-password')}`);

        const response = await GET(request);

        assert.equal(response.status, 401);
    });

    it('accepts password hashes sent as a bearer token', async () => {
        process.env.APP_PASSWORD = 'customer-password';
        process.env.APP_LOG_LEVEL = 'warn';
        const request = new NextRequest('http://localhost/api/logs', {
            headers: {
                Authorization: `Bearer ${sha256('customer-password')}`
            }
        });

        const response = await GET(request);
        assert.ok(response.body);
        const reader = response.body.getReader();
        const chunk = await reader.read();
        await reader.cancel();

        assert.equal(response.status, 200);
        assert.ok(chunk.value);
        assert.match(new TextDecoder().decode(chunk.value), /^: connected/);
    });
});
