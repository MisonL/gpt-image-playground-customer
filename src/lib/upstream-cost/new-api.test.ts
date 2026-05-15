import { NewApiCostResolver, matchNewApiCostLog, quotaToUsdEquivalent } from './new-api';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const baseInput = {
    model: 'gpt-image-2',
    startedAtMs: 1_778_737_200_000,
    finishedAtMs: 1_778_737_255_000
};

describe('quotaToUsdEquivalent', () => {
    it('converts new-api quota to the default USD-equivalent amount', () => {
        assert.equal(quotaToUsdEquivalent(3750), 0.0075);
        assert.equal(quotaToUsdEquivalent(75000), 0.15);
    });
});

describe('matchNewApiCostLog', () => {
    it('returns a high-confidence actual cost when exactly one log matches', () => {
        const result = matchNewApiCostLog({
            ...baseInput,
            logs: [
                { id: 1, type: 2, model_name: 'gpt-5.5', quota: 10, created_at: 1778737200 },
                { id: 2, type: 2, model_name: 'gpt-image-2', quota: 3750, created_at: 1778737230, request_id: 'req-1' }
            ]
        });

        assert.deepEqual(result, {
            actualAmount: 0.0075,
            actualQuota: 3750,
            currency: 'usd-equivalent',
            source: 'new-api-log-token',
            confidence: 'high',
            upstreamProvider: 'new-api',
            matchedLogId: 2,
            matchedRequestId: 'req-1'
        });
    });

    it('does not hard-match when more than one candidate log is present', () => {
        const result = matchNewApiCostLog({
            ...baseInput,
            logs: [
                { id: 2, type: 2, model_name: 'gpt-image-2', quota: 3750, created_at: 1778737230 },
                { id: 3, type: 2, model_name: 'gpt-image-2', quota: 3750, created_at: 1778737231 }
            ]
        });

        assert.equal(result.source, 'unavailable');
        assert.equal(result.confidence, 'low');
        assert.match(result.reason || '', /2 条候选/);
    });

    it('returns unavailable when no log matches the request window', () => {
        const result = matchNewApiCostLog({
            ...baseInput,
            logs: [{ id: 2, type: 2, model_name: 'gpt-image-2', quota: 3750, created_at: 1778730000 }]
        });

        assert.equal(result.source, 'unavailable');
        assert.equal(result.confidence, 'none');
    });

    it('requires the new-api consume log type', () => {
        const result = matchNewApiCostLog({
            ...baseInput,
            logs: [{ id: 2, model_name: 'gpt-image-2', quota: 3750, created_at: 1778737230 }]
        });

        assert.equal(result.source, 'unavailable');
        assert.equal(result.confidence, 'none');
    });
});

describe('NewApiCostResolver', () => {
    it('returns unavailable when the log endpoint is not present or fails', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;
        try {
            const result = await new NewApiCostResolver().resolve({
                apiBaseUrl: 'https://example.test/v1',
                apiKey: 'sk-test',
                model: 'gpt-image-2',
                startedAtMs: baseInput.startedAtMs,
                finishedAtMs: baseInput.finishedAtMs,
                expectedImageCount: 1
            });

            assert.equal(result.source, 'unavailable');
            assert.equal(result.confidence, 'none');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
