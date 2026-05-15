import { resolveActualCost } from './resolve';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('resolveActualCost', () => {
    it('does not query the new-api log endpoint for the official OpenAI API', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            throw new Error('fetch should not be called for api.openai.com');
        }) as typeof fetch;

        try {
            const result = await resolveActualCost({
                apiBaseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-test',
                model: 'gpt-image-2',
                startedAtMs: 1_778_737_200_000,
                finishedAtMs: 1_778_737_255_000,
                expectedImageCount: 1
            });

            assert.equal(result.source, 'unavailable');
            assert.equal(result.confidence, 'none');
            assert.equal(result.upstreamProvider, 'openai');
            assert.match(result.reason || '', /OpenAI/);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
