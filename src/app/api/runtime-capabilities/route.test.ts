import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ENABLE_RESPONSES_IMAGE_BACKEND;
});

afterEach(() => {
    process.env = originalEnv;
});

describe('GET /api/runtime-capabilities', () => {
    it('exposes the experimental Responses image backend flag without enabling it by default', async () => {
        const { GET } = await import('./route');

        const disabled = (await (await GET()).json()) as Record<string, { enabled: boolean; mode?: string }>;
        assert.equal(disabled.responsesImageBackend.enabled, false);
        assert.equal(disabled.responsesImageBackend.mode, 'experimental');

        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        const enabled = (await (await GET()).json()) as Record<string, { enabled: boolean; mode?: string }>;
        assert.equal(enabled.responsesImageBackend.enabled, true);
        assert.equal(enabled.responsesImageBackend.mode, 'experimental');
    });
});
