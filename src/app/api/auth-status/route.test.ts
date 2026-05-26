import { GET } from './route';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const originalAppPassword = process.env.APP_PASSWORD;

afterEach(() => {
    if (originalAppPassword === undefined) {
        delete process.env.APP_PASSWORD;
    } else {
        process.env.APP_PASSWORD = originalAppPassword;
    }
});

describe('GET /api/auth-status', () => {
    it('treats blank APP_PASSWORD as disabled', async () => {
        process.env.APP_PASSWORD = '   ';

        const response = await GET();
        const body = (await response.json()) as { passwordRequired?: boolean };

        assert.equal(body.passwordRequired, false);
    });
});
