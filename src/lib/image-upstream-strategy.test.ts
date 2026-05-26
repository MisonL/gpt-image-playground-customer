import {
    readImageGenerationBackend,
    readImageStreamingStrategy,
    resolveImageStreamEnabled,
    shouldRecommendImageStreaming
} from './image-upstream-strategy';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function formData(values: Record<string, string> = {}): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) {
        data.append(key, value);
    }
    return data;
}

function readErrorStatus(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
        return error.status;
    }
    return undefined;
}

describe('image upstream strategy', () => {
    it('uses Images API and auto streaming strategy by default', () => {
        assert.equal(readImageGenerationBackend(formData()), 'images-api');
        assert.equal(readImageStreamingStrategy(formData(), {}), 'auto');
        assert.equal(
            resolveImageStreamEnabled({
                imageBackend: 'images-api',
                requestedStream: false,
                streamingStrategy: 'auto'
            }),
            false
        );
    });

    it('accepts legacy and canonical backend names', () => {
        assert.equal(readImageGenerationBackend(formData({ imageBackend: 'images' })), 'images-api');
        assert.equal(readImageGenerationBackend(formData({ image_backend: 'images-api' })), 'images-api');
        assert.equal(readImageGenerationBackend(formData({ imageBackend: 'responses' })), 'responses-image-generation');
        assert.equal(
            readImageGenerationBackend(formData({ image_backend: 'responses-image-generation' })),
            'responses-image-generation'
        );
    });

    it('uses IMAGE_GENERATION_BACKEND as the default backend when the request omits it', () => {
        assert.equal(
            readImageGenerationBackend(formData(), { IMAGE_GENERATION_BACKEND: 'responses' }),
            'responses-image-generation'
        );
        assert.equal(readImageGenerationBackend(formData(), { IMAGE_GENERATION_BACKEND: 'images-api' }), 'images-api');
    });

    it('lets request backend override IMAGE_GENERATION_BACKEND', () => {
        assert.equal(
            readImageGenerationBackend(formData({ imageBackend: 'images' }), {
                IMAGE_GENERATION_BACKEND: 'responses-image-generation'
            }),
            'images-api'
        );
    });

    it('lets request streaming strategy override env strategy', () => {
        assert.equal(
            readImageStreamingStrategy(formData({ imageStreamingStrategy: 'newapi-keepalive-sse' }), {
                IMAGE_STREAMING_STRATEGY: 'off'
            }),
            'newapi-keepalive-sse'
        );
    });

    it('reports invalid env defaults as server configuration errors', () => {
        assert.throws(
            () => readImageGenerationBackend(formData(), { IMAGE_GENERATION_BACKEND: 'not-a-backend' }),
            (error) => error instanceof Error && readErrorStatus(error) === 500 && /IMAGE_GENERATION_BACKEND/.test(error.message)
        );
        assert.throws(
            () => readImageStreamingStrategy(formData(), { IMAGE_STREAMING_STRATEGY: 'not-a-strategy' }),
            (error) => error instanceof Error && readErrorStatus(error) === 500 && /IMAGE_STREAMING_STRATEGY/.test(error.message)
        );
    });

    it('keeps explicit page stream requests enabled under auto strategy', () => {
        assert.equal(
            resolveImageStreamEnabled({
                imageBackend: 'images-api',
                requestedStream: true,
                streamingStrategy: 'auto'
            }),
            true
        );
    });

    it('rejects explicit stream requests when streaming is off', () => {
        assert.throws(
            () =>
                resolveImageStreamEnabled({
                    imageBackend: 'images-api',
                    requestedStream: true,
                    streamingStrategy: 'off'
                }),
            /已关闭/
        );
    });

    it('rejects incompatible backend and streaming strategy combinations', () => {
        assert.throws(
            () =>
                resolveImageStreamEnabled({
                    imageBackend: 'images-api',
                    requestedStream: true,
                    streamingStrategy: 'responses-sse'
                }),
            /Images API/
        );

        assert.throws(
            () =>
                resolveImageStreamEnabled({
                    imageBackend: 'responses-image-generation',
                    requestedStream: true,
                    streamingStrategy: 'openai-sse'
                }),
            /Responses image_generation/
        );
    });

    it('supports explicit force-sse without the legacy stream field', () => {
        assert.equal(
            resolveImageStreamEnabled({
                imageBackend: 'images-api',
                requestedStream: false,
                streamingStrategy: 'force-sse'
            }),
            true
        );
    });

    it('recommends streaming only for high quality large auto strategy requests', () => {
        assert.equal(
            shouldRecommendImageStreaming({
                streamingStrategy: 'auto',
                quality: 'high',
                width: 3072,
                height: 2048,
                streamEnabled: false
            }),
            true
        );
        assert.equal(
            shouldRecommendImageStreaming({
                streamingStrategy: 'auto',
                quality: 'high',
                width: 2048,
                height: 2049,
                streamEnabled: false
            }),
            true
        );
        assert.equal(
            shouldRecommendImageStreaming({
                streamingStrategy: 'auto',
                quality: 'high',
                width: 2048,
                height: 2048,
                streamEnabled: false
            }),
            false
        );
        assert.equal(
            shouldRecommendImageStreaming({
                streamingStrategy: 'newapi-keepalive-sse',
                quality: 'high',
                width: 3072,
                height: 2048,
                streamEnabled: false
            }),
            false
        );
        assert.equal(
            shouldRecommendImageStreaming({
                streamingStrategy: 'auto',
                quality: 'high',
                width: 3072,
                height: 2048,
                streamEnabled: true
            }),
            false
        );
    });
});
