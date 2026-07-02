import {
    buildOpenAIImageRequestOptions,
    createOpenAIImageClientOptions,
    readImageStreamDataIntervalTimeoutMs,
    readImageUpstreamMaxRetries,
    readImageUpstreamTimeoutMs,
    summarizeOpenAIImageTransport
} from './openai-image-transport';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('openai image transport settings', () => {
    it('uses long image defaults and disables automatic SDK retries', () => {
        assert.equal(readImageUpstreamTimeoutMs({}), 900_000);
        assert.equal(readImageStreamDataIntervalTimeoutMs({}), 900_000);
        assert.equal(readImageUpstreamMaxRetries({}), 0);
        assert.deepEqual(summarizeOpenAIImageTransport({}), {
            upstream_timeout_ms: 900_000,
            stream_data_interval_timeout_ms: 900_000,
            upstream_max_retries: 0
        });

        assert.deepEqual(createOpenAIImageClientOptions({ apiKey: 'key', baseURL: 'https://api.example/v1' }), {
            apiKey: 'key',
            baseURL: 'https://api.example/v1',
            defaultHeaders: undefined,
            timeout: 900_000,
            maxRetries: 0
        });
    });

    it('lets operators override timeout and retry policy explicitly', () => {
        const env = {
            IMAGE_UPSTREAM_TIMEOUT_MS: '1200000',
            IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS: '600000',
            IMAGE_UPSTREAM_MAX_RETRIES: '1'
        };

        assert.equal(readImageUpstreamTimeoutMs(env), 1_200_000);
        assert.equal(readImageStreamDataIntervalTimeoutMs(env), 600_000);
        assert.equal(readImageUpstreamMaxRetries(env), 1);
        assert.equal(buildOpenAIImageRequestOptions({ env }).timeout, 1_200_000);
        assert.equal(buildOpenAIImageRequestOptions({ env }).maxRetries, 1);
    });

    it('sends the idempotency key as an explicit upstream header', () => {
        const options = buildOpenAIImageRequestOptions({
            headers: { 'Idempotency-Key': 'configured-wrong-key', 'X-App-ID': 'app-id' },
            idempotencyKey: 'business-operation-key'
        });
        const headers = new Headers(options.headers as HeadersInit);

        assert.equal(options.idempotencyKey, 'business-operation-key');
        assert.equal(headers.get('idempotency-key'), 'business-operation-key');
        assert.equal(headers.get('x-app-id'), 'app-id');
    });

    it('rejects invalid transport env values explicitly', () => {
        assert.throws(() => readImageUpstreamTimeoutMs({ IMAGE_UPSTREAM_TIMEOUT_MS: '15s' }), /非负整数/);
        assert.throws(() => readImageUpstreamTimeoutMs({ IMAGE_UPSTREAM_TIMEOUT_MS: '0' }), /正整数/);
        assert.equal(readImageStreamDataIntervalTimeoutMs({ IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS: '0' }), 0);
        assert.throws(() => readImageUpstreamMaxRetries({ IMAGE_UPSTREAM_MAX_RETRIES: '-1' }), /非负整数/);
    });
});
