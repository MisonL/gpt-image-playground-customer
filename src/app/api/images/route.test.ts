import {
    PNG_BASE64,
    imageFormRequest,
    readSseEvents,
    startHangingImagesStreamUpstream,
    startImagesJsonUpstream,
    startImagesStreamFallbackUpstream,
    startResponsesImageUpstream,
    startResponsesStreamFailureThenJsonUpstream,
    startStreamingResponsesImageUpstream,
    startStreamingImageUpstream
} from './route-test-helpers';
import { clearAppLogEntriesForTest } from '@/lib/app-logger';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

let originalEnv: NodeJS.ProcessEnv;
const originalConsoleError = console.error;

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv) {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) {
            delete process.env[key];
        }
    }

    for (const [key, value] of Object.entries(snapshot)) {
        process.env[key] = value;
    }
}

beforeEach(() => {
    originalEnv = { ...process.env };
    console.error = () => {};
    for (const key of Object.keys(process.env)) {
        if (/^OPENAI_CHANNEL_\d+_/.test(key)) {
            delete process.env[key];
        }
    }
    delete process.env.APP_PASSWORD;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.OPENAI_CHANNEL_1_ID;
    delete process.env.OPENAI_CHANNEL_1_API_KEYS;
    delete process.env.OPENAI_CHANNEL_1_BASE_URL;
    delete process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE;
    delete process.env.OPENAI_CHANNEL_1_REQUEST_MODES;
    delete process.env.OPENAI_CHANNEL_1_MATSCA_APP_ID;
    delete process.env.OPENAI_CHANNEL_1_MATSCA_APP_SECRET;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_INTERVAL_MS;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_TIMEOUT_MS;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_MAX_PER_TICK;
    delete process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY;
    delete process.env.OPENAI_CHANNEL_QUEUE_ENABLED;
    delete process.env.OPENAI_CHANNEL_QUEUE_MAX_WAIT_MS;
    delete process.env.OPENAI_CHANNEL_QUEUE_MAX_SIZE;
    delete process.env.OPENAI_MAX_STREAMS_PER_CREDENTIAL;
    delete process.env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS;
    delete process.env.ENABLE_RESPONSES_IMAGE_BACKEND;
    delete process.env.IMAGE_GENERATION_BACKEND;
    delete process.env.OPENAI_RESPONSES_API_MODEL;
    delete process.env.IMAGE_STREAMING_STRATEGY;
    process.env.APP_LOG_LEVEL = 'warn';
    process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE = 'indexeddb';
    clearAppLogEntriesForTest();
});

afterEach(async () => {
    const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
    resetServerChannelStateForTests();
    clearAppLogEntriesForTest();
    restoreProcessEnv(originalEnv);
    console.error = originalConsoleError;
});

describe('POST /api/images streaming', { concurrency: false }, () => {
    it('normalizes OtokAPI image stream events into the stable client SSE contract', async () => {
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'image.generation.chunk',
                    data: { b64_json: 'partial-base64' }
                },
                {
                    event: 'image.generation.result',
                    data: {
                        data: [{ b64_json: PNG_BASE64 }],
                        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
                    }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.equal(events.length, 3);
            assert.equal(events[0].type, 'partial_image');
            assert.equal(events[0].b64_json, 'partial-base64');
            assert.equal(events[1].type, 'completed');
            assert.equal(events[1].b64_json, PNG_BASE64);
            assert.equal(events[1].output_format, 'webp');
            assert.equal(events[2].type, 'done');
            assert.equal((events[2].images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('uses a non-streaming channel request mode when page auto streaming has no SSE channel', async () => {
        const { POST } = await import('./route');
        const upstreamBodies: string[] = [];
        const upstream = await startImagesJsonUpstream(async (body, _url, request) => {
            if (request.method === 'POST') {
                upstreamBodies.push(body);
            }
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_CHANNEL_1_ID = 'json-only';
        process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
        process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream';

        try {
            const response = await POST(
                imageFormRequest({
                    streamMode: 'auto'
                })
            );

            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            assert.equal(upstreamBodies.length, 1);
            const upstreamJson = JSON.parse(upstreamBodies[0] || '{}') as Record<string, unknown>;
            assert.equal(upstreamJson.stream, false);
            assert.equal(Object.hasOwn(upstreamJson, 'partial_images'), false);
        } finally {
            await upstream.close();
        }
    });

    it('keeps the stable SSE contract for SDK-parsed multi-image results without partial events', async () => {
        const { POST } = await import('./route');
        const upstream = await startStreamingImageUpstream(async () => [
            {
                data: {
                    data: [{ b64_json: PNG_BASE64 }, { b64_json: PNG_BASE64 }]
                }
            }
        ]);

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'completed', 'done']
            );
            assert.equal((events[2].images as Array<Record<string, unknown>>).length, 2);
        } finally {
            await upstream.close();
        }
    });

    it('normalizes JSON Images responses returned to stream requests into the stable SSE contract', async () => {
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startImagesJsonUpstream(async (body) => {
            if (!body) return { ok: true };
            upstreamBody = body;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true,
                    imageStreamingStrategy: 'newapi-keepalive-sse'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            assert.equal(events[0].b64_json, PNG_BASE64);
            assert.equal((events[1].images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('allows Matsca-compatible Images API streams to request four partial images', async () => {
        let upstreamBody = '';
        let upstreamAppId: string | string[] | undefined;
        let upstreamAppSecret: string | string[] | undefined;
        const upstream = await startStreamingImageUpstream(async (body, _url, request) => {
            upstreamBody = body;
            upstreamAppId = request.headers['x-app-id'];
            upstreamAppSecret = request.headers['x-app-secret'];
            return [
                {
                    event: 'image.generation.result',
                    data: {
                        data: [{ b64_json: PNG_BASE64 }]
                    }
                }
            ];
        });

        try {
            process.env.OPENAI_CHANNEL_1_ID = 'matsca';
            process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
            process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
            process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE = 'matsca';
            process.env.OPENAI_CHANNEL_1_MATSCA_APP_ID = 'app-id';
            process.env.OPENAI_CHANNEL_1_MATSCA_APP_SECRET = 'app-secret';
            process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
            process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
            const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
            resetServerChannelStateForTests();
            const { POST } = await import('./route');

            const response = await POST(
                imageFormRequest({
                    stream: true,
                    partialImages: '4'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            await readSseEvents(response);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.partial_images, 4);
            assert.equal(upstreamAppId, 'app-id');
            assert.equal(upstreamAppSecret, 'app-secret');
        } finally {
            await upstream.close();
        }
    });

    it('keeps same-credential page SSE requests queued until the active stream is released', async () => {
        const upstream = await startHangingImagesStreamUpstream();

        try {
            process.env.OPENAI_CHANNEL_1_ID = 'official';
            process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
            process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
            process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
            process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
            process.env.OPENAI_MAX_STREAMS_PER_CREDENTIAL = '1';
            process.env.OPENAI_CHANNEL_QUEUE_MAX_WAIT_MS = '1000';
            const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
            resetServerChannelStateForTests();
            const { POST } = await import('./route');

            const firstResponse = await POST(
                imageFormRequest({
                    stream: true,
                    clientRequestId: 'client-route-queue-1'
                })
            );
            await upstream.waitForStreamRequest();
            assert.equal(upstream.calls.length, 1);

            const secondPromise = POST(
                imageFormRequest({
                    stream: true,
                    clientRequestId: 'client-route-queue-2'
                })
            );
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.equal(upstream.calls.length, 1);

            await firstResponse.body?.cancel();
            const secondResponse = await secondPromise;
            assert.equal(secondResponse.status, 200);
            assert.equal(secondResponse.headers.get('X-Channel-Queue-Queued'), 'true');
            assert.equal(upstream.calls.length, 2);
            await secondResponse.body?.cancel();
        } finally {
            await upstream.close();
        }
    });

    it('allows Matsca-compatible JSON generation fields through server channels', async () => {
        let upstreamBody = '';
        let upstreamAppId: string | string[] | undefined;
        let upstreamAppSecret: string | string[] | undefined;
        const upstream = await startImagesJsonUpstream(async (body, _url, request) => {
            upstreamBody = body;
            upstreamAppId = request.headers['x-app-id'];
            upstreamAppSecret = request.headers['x-app-secret'];
            return {
                data: [{ b64_json: PNG_BASE64 }]
            };
        });

        try {
            process.env.OPENAI_CHANNEL_1_ID = 'matsca';
            process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
            process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
            process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE = 'matsca';
            process.env.OPENAI_CHANNEL_1_MATSCA_APP_ID = 'app-id';
            process.env.OPENAI_CHANNEL_1_MATSCA_APP_SECRET = 'app-secret';
            process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
            process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
            const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
            resetServerChannelStateForTests();
            const { POST } = await import('./route');

            const response = await POST(
                imageFormRequest({
                    n: '4',
                    size: '123x456',
                    background: 'transparent'
                })
            );

            assert.equal(response.status, 200);
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.n, 4);
            assert.equal(upstreamJson.size, '123x456');
            assert.equal(upstreamJson.background, 'transparent');
            assert.equal(upstreamAppId, 'app-id');
            assert.equal(upstreamAppSecret, 'app-secret');
        } finally {
            await upstream.close();
        }
    });

    it('falls back from auto streaming without a final image and skips streaming for the same mark', async () => {
        const { POST } = await import('./route');
        const { getServerChannelState } = await import('@/lib/server-channel-router');
        const upstream = await startImagesStreamFallbackUpstream();
        const otherUpstream = await startImagesStreamFallbackUpstream();

        try {
            const first = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    streamMode: 'auto',
                    clientRequestId: 'client-route-auto-fallback-1'
                })
            );

            assert.equal(first.status, 200);
            assert.equal(first.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(first);
            assert.deepEqual(
                events.map((event) => event.type),
                ['partial_image', 'completed', 'done']
            );
            assert.equal(events[2].fallback_used, true);
            assert.deepEqual(
                upstream.calls.map((call) => call.stream),
                [true, false]
            );
            assert.equal(getServerChannelState().streamingAvailability.summary().mark_count, 1);

            const second = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    streamMode: 'auto',
                    clientRequestId: 'client-route-auto-fallback-2'
                })
            );

            assert.equal(second.status, 200);
            assert.notEqual(second.headers.get('content-type'), 'text/event-stream');
            const body = (await second.json()) as { images?: Array<Record<string, unknown>> };
            assert.equal(body.images?.[0]?.b64_json, PNG_BASE64);
            assert.deepEqual(
                upstream.calls.map((call) => call.stream),
                [true, false, false]
            );

            const third = await POST(
                imageFormRequest({
                    apiBaseUrl: otherUpstream.baseUrl,
                    apiKey: 'test-key',
                    streamMode: 'auto',
                    clientRequestId: 'client-route-auto-fallback-3'
                })
            );

            assert.equal(third.status, 200);
            assert.equal(third.headers.get('content-type'), 'text/event-stream');
            await readSseEvents(third);
            assert.deepEqual(
                otherUpstream.calls.map((call) => call.stream),
                [true, false]
            );
        } finally {
            await upstream.close();
            await otherUpstream.close();
        }
    });

    it('does not mark auto streaming unavailable when the page SSE request is aborted', async () => {
        const { POST } = await import('./route');
        const { getServerChannelState } = await import('@/lib/server-channel-router');
        const upstream = await startHangingImagesStreamUpstream();
        const abortController = new AbortController();

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    streamMode: 'auto',
                    clientRequestId: 'client-route-auto-abort',
                    signal: abortController.signal
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const reader = response.body?.getReader();
            assert.ok(reader);
            await upstream.waitForStreamRequest();
            abortController.abort();
            await reader.cancel();
            await new Promise((resolve) => setTimeout(resolve, 25));

            assert.deepEqual(
                upstream.calls.map((call) => call.stream),
                [true]
            );
            assert.equal(getServerChannelState().streamingAvailability.summary().mark_count, 0);
        } finally {
            abortController.abort();
            await upstream.close();
        }
    });

    it('returns an explicit SSE error when the upstream completed event has no image payload', async () => {
        const { POST } = await import('./route');
        const upstream = await startStreamingImageUpstream(async () => [
            {
                event: 'image.generation.result',
                data: {
                    data: [{ status: 'done' }]
                }
            }
        ]);

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.equal(events.length, 1);
            assert.equal(events[0].type, 'error');
            assert.match(String(events[0].error), /b64_json/);
        } finally {
            await upstream.close();
        }
    });

    it('turns upstream stream failures into the stable SSE error contract', async () => {
        const { POST } = await import('./route');
        const upstream = await startStreamingImageUpstream(async () => [
            {
                event: 'image.generation.chunk',
                data: { b64_json: 'partial-before-failure' }
            },
            { abortAfter: true, data: { status: 'upstream connection closed' } }
        ]);

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['partial_image', 'error']
            );
            assert.match(String(events[1].error), /terminated|aborted|closed|stream/i);
        } finally {
            await upstream.close();
        }
    });

    it('keeps the stable SSE contract for streaming edits', async () => {
        const { POST } = await import('./route');
        let upstreamUrl = '';
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body, url) => {
            upstreamUrl = url;
            upstreamBody = body;
            return [
                {
                    event: 'image_edit.partial_image',
                    data: { type: 'image_edit.partial_image', b64_json: 'edit-partial-base64' }
                },
                {
                    event: 'image_edit.completed',
                    data: {
                        type: 'image_edit.completed',
                        b64_json: PNG_BASE64,
                        usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 }
                    }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['partial_image', 'completed', 'done']
            );
            assert.equal(events[0].b64_json, 'edit-partial-base64');
            assert.equal(events[1].b64_json, PNG_BASE64);
            assert.equal(events[1].output_format, 'webp');
            assert.equal((events[2].images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);
            assert.equal(upstreamUrl, '/v1/images/edits');
            assert.match(upstreamBody, /name="image\[\]"/);
            assert.match(upstreamBody, /name="stream"/);
            assert.match(upstreamBody, /name="partial_images"/);
        } finally {
            await upstream.close();
        }
    });

    it('accepts snake_case image streaming strategy on page SSE edit requests', async () => {
        const { POST } = await import('./route');
        let upstreamUrl = '';
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body, url) => {
            upstreamUrl = url;
            upstreamBody = body;
            return [
                {
                    event: 'image_edit.completed',
                    data: { type: 'image_edit.completed', b64_json: PNG_BASE64 }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: true,
                    imageStreamingStrategy: 'force-sse',
                    imageStreamingStrategyField: 'image_streaming_strategy'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            assert.equal(upstreamUrl, '/v1/images/edits');
            assert.match(upstreamBody, /name="stream"/);
            assert.match(upstreamBody, /name="partial_images"/);
        } finally {
            await upstream.close();
        }
    });

    it('rejects explicit image stream requests when the server strategy disables streaming', async () => {
        process.env.IMAGE_STREAMING_STRATEGY = 'off';
        const { POST } = await import('./route');
        let upstreamCalls = 0;
        const upstream = await startStreamingImageUpstream(async () => {
            upstreamCalls += 1;
            return [];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true
                })
            );

            assert.equal(response.status, 400);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /流式兼容模式已关闭/);
            assert.equal(upstreamCalls, 0);
        } finally {
            await upstream.close();
        }
    });

    it('lets request streaming strategy override a disabled server strategy', async () => {
        process.env.IMAGE_STREAMING_STRATEGY = 'off';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'image_generation.completed',
                    data: { type: 'image_generation.completed', b64_json: PNG_BASE64 }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true,
                    imageStreamingStrategy: 'newapi-keepalive-sse'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('uses force-sse to stream even when the request omits the legacy stream field', async () => {
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'image_generation.completed',
                    data: { type: 'image_generation.completed', b64_json: PNG_BASE64 }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    imageStreamingStrategy: 'force-sse'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('normalizes gaoren JSON-as-SSE completed image payloads into the stable client SSE contract', async () => {
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'image_generation.completed',
                    data: {
                        type: 'image_generation.completed',
                        data: [{ b64_json: PNG_BASE64 }]
                    }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true,
                    imageStreamingStrategy: 'newapi-keepalive-sse'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            assert.equal(events[0].b64_json, PNG_BASE64);
            assert.equal((events[1].images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('rejects the experimental Responses API backend when the feature flag is disabled', async () => {
        const { POST } = await import('./route');
        const response = await POST(
                imageFormRequest({
                    apiBaseUrl: 'http://127.0.0.1:1/v1',
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses'
                })
        );

        assert.equal(response.status, 400);
        const body = (await response.json()) as Record<string, unknown>;
        assert.match(String(body.error), /ENABLE_RESPONSES_IMAGE_BACKEND/);
    });

    it('requires a separate Responses API top-level model for the experimental backend', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        const { POST } = await import('./route');
        const response = await POST(
                imageFormRequest({
                    apiBaseUrl: 'http://127.0.0.1:1/v1',
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses'
                })
        );

        assert.equal(response.status, 400);
        const body = (await response.json()) as Record<string, unknown>;
        assert.match(String(body.error), /OPENAI_RESPONSES_API_MODEL|responsesModel/);
    });

    it('rejects unsupported Responses API backend request shapes before contacting upstream', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');

        const multiImage = await POST(
                imageFormRequest({
                    apiBaseUrl: 'http://127.0.0.1:1/v1',
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses',
                    n: '2'
                })
        );
        assert.equal(multiImage.status, 400);
        assert.match(String(((await multiImage.json()) as Record<string, unknown>).error), /单张生成/);
    });

    it('rejects multi-image edit requests for the Responses API backend before contacting upstream', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        const edit = await POST(
                imageFormRequest({
                    apiBaseUrl: 'http://127.0.0.1:1/v1',
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses',
                    n: '2',
                    mode: 'edit'
                })
        );
        assert.equal(edit.status, 400);
        assert.match(String(((await edit.json()) as Record<string, unknown>).error), /单张编辑/);
    });

    it('uses the Responses API image backend only when the flag and request opt-in are both present', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return {
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ],
                usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
            };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses-image-generation'
                })
            );

            assert.equal(response.status, 200);
            const body = (await response.json()) as { images?: Array<Record<string, unknown>>; usage?: unknown };
            assert.equal(body.images?.[0]?.b64_json, PNG_BASE64);
            assert.deepEqual(body.usage, { input_tokens: 1, output_tokens: 2, total_tokens: 3 });

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-4.1');
            assert.equal(upstreamJson.stream, false);
            assert.equal(
                upstreamJson.tool_choice && (upstreamJson.tool_choice as Record<string, unknown>).type,
                'image_generation'
            );
            assert.equal(Array.isArray(upstreamJson.tools), true);
        } finally {
            await upstream.close();
        }
    });

    it('returns a 502 JSON error when non-streaming Responses image_generation fails upstream', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        const upstream = await startResponsesImageUpstream(async () => ({
            output: [
                {
                    type: 'image_generation_call',
                    status: 'failed',
                    error: {
                        code: 'content_policy_violation',
                        message: 'blocked by upstream policy'
                    }
                }
            ]
        }));

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses-image-generation'
                })
            );

            assert.equal(response.status, 502);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /blocked by upstream policy/);
        } finally {
            await upstream.close();
        }
    });

    it('fails non-streaming Images API JSON results that only contain a remote URL', async () => {
        const { POST } = await import('./route');
        const upstream = await startImagesJsonUpstream(async () => ({
            data: [{ url: 'https://example.test/final.png' }]
        }));

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream'
                })
            );

            assert.equal(response.status, 502);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /同源/);
            assert.equal(JSON.stringify(body).includes('https://example.test/final.png'), false);
        } finally {
            await upstream.close();
        }
    });

    it('streams Responses API image_generation events through the stable page SSE contract', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'response.image_generation_call.partial_image',
                    data: {
                        type: 'response.image_generation_call.partial_image',
                        partial_image_b64: 'responses-partial-base64',
                        partial_image_index: 0
                    }
                },
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        item: {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true,
                    imageBackend: 'responses',
                    imageStreamingStrategy: 'responses-sse'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['partial_image', 'completed', 'done']
            );
            assert.equal(events[0].b64_json, 'responses-partial-base64');
            assert.equal(events[1].b64_json, PNG_BASE64);
            assert.equal((events[2].images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-4.1');
            assert.equal(upstreamJson.stream, true);
            const tools = upstreamJson.tools as Array<Record<string, unknown>>;
            assert.equal(tools[0].type, 'image_generation');
            assert.equal(tools[0].partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('rejects partial image counts outside the Responses streaming contract', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');

        const response = await POST(
            imageFormRequest({
                apiBaseUrl: 'https://img.matsca.com/v1',
                apiKey: 'test-key',
                stream: true,
                imageBackend: 'responses',
                imageStreamingStrategy: 'responses-sse',
                partialImages: '4'
            })
        );

        assert.equal(response.status, 400);
        const body = (await response.json()) as Record<string, unknown>;
        assert.match(String(body.error), /Responses API.*partial_images/);
    });

    it('keeps separate Responses final items when their base64 payloads match', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        const upstream = await startStreamingResponsesImageUpstream(async () => [
            {
                event: 'response.output_item.done',
                data: {
                    type: 'response.output_item.done',
                    item: {
                        id: 'ig_same_payload_a',
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                }
            },
            {
                event: 'response.output_item.done',
                data: {
                    type: 'response.output_item.done',
                    item: {
                        id: 'ig_same_payload_b',
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                }
            }
        ]);

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true,
                    imageBackend: 'responses',
                    imageStreamingStrategy: 'responses-sse'
                })
            );

            assert.equal(response.status, 200);
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'completed', 'done']
            );
            assert.equal((events[2].images as Array<Record<string, unknown>>).length, 2);
        } finally {
            await upstream.close();
        }
    });

    it('uses force-sse for Responses image_generation without the legacy stream field', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        item: {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    imageBackend: 'responses-image-generation',
                    imageStreamingStrategy: 'force-sse'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            assert.equal(events[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.model, 'gpt-4.1');
            const tools = upstreamJson.tools as Array<Record<string, unknown>>;
            assert.equal(tools[0].type, 'image_generation');
            assert.equal(tools[0].partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('turns failed Responses image_generation calls into the stable page SSE error contract', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        const upstream = await startStreamingResponsesImageUpstream(async () => [
            {
                event: 'response.output_item.done',
                data: {
                    type: 'response.output_item.done',
                    item: {
                        type: 'image_generation_call',
                        status: 'failed',
                        error: {
                            code: 'content_policy_violation',
                            message: 'blocked by upstream policy'
                        }
                    }
                }
            }
        ]);

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true,
                    imageBackend: 'responses',
                    imageStreamingStrategy: 'responses-sse'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['error']
            );
            assert.equal(events[0].status, 502);
            assert.match(String(events[0].error), /blocked by upstream policy/);
        } finally {
            await upstream.close();
        }
    });

    it('uses IMAGE_GENERATION_BACKEND as the route default when the request omits imageBackend', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.IMAGE_GENERATION_BACKEND = 'responses';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return {
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ]
            };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream'
                })
            );

            assert.equal(response.status, 200);
            const body = (await response.json()) as { images?: Array<Record<string, unknown>> };
            assert.equal(body.images?.[0]?.b64_json, PNG_BASE64);
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-4.1');
            assert.equal(upstreamJson.stream, false);
        } finally {
            await upstream.close();
        }
    });

    it('downloads same-origin GPT2Image URL results before persisting Images API JSON responses', async () => {
        const { POST } = await import('./route');
        let imageDownloadCount = 0;
        const upstream = await startImagesJsonUpstream(async (_body, url) => {
            if (url === '/generated/final.png') {
                imageDownloadCount += 1;
                return Buffer.from(PNG_BASE64, 'base64');
            }
            return { data: [{ url: '/generated/final.png' }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream'
                })
            );

            assert.equal(response.status, 200);
            const body = (await response.json()) as { images?: Array<Record<string, unknown>> };
            assert.equal(body.images?.[0]?.b64_json, PNG_BASE64);
            assert.equal(imageDownloadCount, 1);
        } finally {
            await upstream.close();
        }
    });

    it('rejects cross-origin GPT2Image URL results before downloading them', async () => {
        const { POST } = await import('./route');
        const upstream = await startImagesJsonUpstream(async () => {
            return { data: [{ url: 'https://other.example.test/generated/final.png' }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream'
                })
            );

            assert.equal(response.status, 502);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /同源/);
        } finally {
            await upstream.close();
        }
    });

    it('applies the image backend env default to edit requests', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        process.env.IMAGE_GENERATION_BACKEND = 'responses';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return {
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ]
            };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: false,
                    streamMode: 'non_stream'
                })
            );

            assert.equal(response.status, 200);
            const body = (await response.json()) as { images?: Array<Record<string, unknown>> };
            assert.equal(body.images?.[0]?.b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as {
                tools?: Array<Record<string, unknown>>;
                input?: Array<{ content?: Array<Record<string, unknown>> }>;
            };
            assert.equal(upstreamJson.tools?.[0]?.type, 'image_generation');
            assert.equal(upstreamJson.tools?.[0]?.action, 'edit');
            assert.equal(upstreamJson.input?.[0]?.content?.some((item) => item.type === 'input_image'), true);
        } finally {
            await upstream.close();
        }
    });

    it('applies Responses streaming strategy env defaults to edit streams', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        process.env.IMAGE_GENERATION_BACKEND = 'responses';
        process.env.IMAGE_STREAMING_STRATEGY = 'responses-sse';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        item: { type: 'image_generation_call', status: 'completed', result: PNG_BASE64 }
                    }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(
                upstreamJson.tool_choice && (upstreamJson.tool_choice as Record<string, unknown>).type,
                'image_generation'
            );
            assert.equal(Array.isArray(upstreamJson.tools), true);
        } finally {
            await upstream.close();
        }
    });

    it('accepts snake-case Responses backend controls on edit page SSE requests', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startStreamingResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return [
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        item: { type: 'image_generation_call', status: 'completed', result: PNG_BASE64 }
                    }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: true,
                    imageBackend: 'responses-image-generation',
                    imageBackendField: 'image_backend',
                    imageStreamingStrategy: 'responses-sse',
                    imageStreamingStrategyField: 'image_streaming_strategy',
                    partialImages: '1'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(
                upstreamJson.tool_choice && (upstreamJson.tool_choice as Record<string, unknown>).type,
                'image_generation'
            );
        } finally {
            await upstream.close();
        }
    });

    it('lets explicit edit backend and streaming strategy override env defaults', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        process.env.IMAGE_GENERATION_BACKEND = 'responses';
        process.env.IMAGE_STREAMING_STRATEGY = 'responses-sse';
        const { POST } = await import('./route');
        let upstreamUrl = '';
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body, url) => {
            upstreamUrl = url;
            upstreamBody = body;
            return [
                {
                    event: 'image_edit.completed',
                    data: { type: 'image_edit.completed', b64_json: PNG_BASE64 }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: true,
                    imageBackend: 'images-api',
                    imageStreamingStrategy: 'auto'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            assert.equal(upstreamUrl, '/v1/images/edits');
            assert.match(upstreamBody, /name="stream"/);
            assert.match(upstreamBody, /name="partial_images"/);
        } finally {
            await upstream.close();
        }
    });

    it('rejects incompatible edit backend and streaming strategy defaults before contacting upstream', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        process.env.IMAGE_GENERATION_BACKEND = 'responses';
        process.env.IMAGE_STREAMING_STRATEGY = 'newapi-keepalive-sse';
        const { POST } = await import('./route');
        let upstreamCalls = 0;
        const upstream = await startStreamingImageUpstream(async () => {
            upstreamCalls += 1;
            return [
                {
                    event: 'image_edit.completed',
                    data: { type: 'image_edit.completed', b64_json: PNG_BASE64 }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: true
                })
            );

            assert.equal(response.status, 400);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /Responses image_generation/);
            assert.equal(upstreamCalls, 0);
        } finally {
            await upstream.close();
        }
    });

    it('keeps Images API edit streams available when env defaults stay on Images API', async () => {
        process.env.IMAGE_GENERATION_BACKEND = 'images-api';
        process.env.IMAGE_STREAMING_STRATEGY = 'auto';
        const { POST } = await import('./route');
        let upstreamUrl = '';
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream(async (body, url) => {
            upstreamUrl = url;
            upstreamBody = body;
            return [
                {
                    event: 'image_edit.completed',
                    data: { type: 'image_edit.completed', b64_json: PNG_BASE64 }
                }
            ];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
            assert.equal(upstreamUrl, '/v1/images/edits');
            assert.match(upstreamBody, /name="stream"/);
            assert.match(upstreamBody, /name="partial_images"/);
        } finally {
            await upstream.close();
        }
    });

    it('reports invalid image upstream env configuration as a server error before contacting upstream', async () => {
        process.env.IMAGE_STREAMING_STRATEGY = 'not-a-strategy';
        const { POST } = await import('./route');
        let upstreamCalls = 0;
        const upstream = await startStreamingImageUpstream(async () => {
            upstreamCalls += 1;
            return [];
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false
                })
            );

            assert.equal(response.status, 500);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /IMAGE_STREAMING_STRATEGY/);
            assert.equal(upstreamCalls, 0);
        } finally {
            await upstream.close();
        }
    });

    it('rejects remote plain-http API base URLs before forwarding API keys', async () => {
        const { POST } = await import('./route');

        const response = await POST(
            imageFormRequest({
                apiBaseUrl: 'http://api.example.com/v1',
                apiKey: 'test-key',
                stream: false
            })
        );

        assert.equal(response.status, 400);
        const body = (await response.json()) as Record<string, unknown>;
        assert.match(String(body.error), /远程 HTTP API URL/);
    });

    it('treats blank APP_PASSWORD as disabled for page SSE auth', async () => {
        process.env.APP_PASSWORD = '   ';
        const { POST } = await import('./route');
        const upstream = await startStreamingImageUpstream(async () => [
            {
                event: 'image_generation.completed',
                data: { type: 'image_generation.completed', b64_json: PNG_BASE64 }
            }
        ]);

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: true
                })
            );

            assert.equal(response.status, 200);
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['completed', 'done']
            );
        } finally {
            await upstream.close();
        }
    });

    it('rejects overlong page SSE client request ids before contacting upstream', async () => {
        const { POST } = await import('./route');
        let upstreamCalls = 0;
        const upstream = await startImagesJsonUpstream(async () => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    clientRequestId: 'x'.repeat(129)
                })
            );

            assert.equal(response.status, 400);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /clientRequestId/);
            assert.match(String(body.error), /128/);
            assert.equal(upstreamCalls, 0);
        } finally {
            await upstream.close();
        }
    });

    it('rejects invalid gpt-image-2 custom size boundaries before contacting upstream', async () => {
        const { POST } = await import('./route');
        let upstreamCalls = 0;
        const upstream = await startImagesJsonUpstream(async () => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });

        try {
            for (const { size, pattern } of [
                { size: '512x512', pattern: /至少/ },
                { size: '3840x3840', pattern: /不能超过/ },
                { size: '2049x2048', pattern: /16 的倍数/ }
            ]) {
                const response = await POST(
                    imageFormRequest({
                        apiBaseUrl: upstream.baseUrl,
                        apiKey: 'test-key',
                        size
                    })
                );

                assert.equal(response.status, 400);
                const body = (await response.json()) as Record<string, unknown>;
                assert.match(String(body.error), /size 对 gpt-image-2 无效/);
                assert.match(String(body.error), pattern);
            }
            assert.equal(upstreamCalls, 0);
        } finally {
            await upstream.close();
        }
    });

    it('lets request responsesModel override the experimental backend env model', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1-env';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return {
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ]
            };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses',
                    responsesModel: 'gpt-4.1-request'
                })
            );

            assert.equal(response.status, 200);
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-4.1-request');
        } finally {
            await upstream.close();
        }
    });

    it('passes GPT2Image-compatible extended fields to the Responses image backend', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1-env';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return {
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ]
            };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses',
                    size: '1536x864',
                    outputFormat: 'webp',
                    outputCompression: '85',
                    promptOptimization: 'false',
                    gptModel: 'gpt-5.4-mini',
                    thinking: 'high'
                })
            );

            assert.equal(response.status, 200);
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-5.4-mini');
            const tools = upstreamJson.tools as Array<Record<string, unknown>>;
            assert.equal(tools[0].size, '1536x864');
            assert.equal(tools[0].output_format, 'webp');
            assert.equal(tools[0].output_compression, 85);
            assert.equal(tools[0].prompt_optimization, false);
            assert.equal(tools[0].thinking, 'high');
        } finally {
            await upstream.close();
        }
    });

    it('passes GPT2Image-compatible edit fields to the Images API backend', async () => {
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startImagesJsonUpstream(async (body) => {
            if (!body) return { ok: true };
            upstreamBody = body;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: false,
                    streamMode: 'non_stream',
                    outputFormat: 'webp',
                    outputCompression: '85',
                    forceWeb: 'true'
                })
            );

            assert.equal(response.status, 200);
            assert.match(upstreamBody, /name="output_format"/);
            assert.match(upstreamBody, /\r\nwebp\r\n/);
            assert.match(upstreamBody, /name="output_compression"/);
            assert.match(upstreamBody, /\r\n85\r\n/);
            assert.match(upstreamBody, /name="force_web"/);
            assert.match(upstreamBody, /\r\ntrue\r\n/);
            assert.match(upstreamBody, /name="moderation"/);
            assert.match(upstreamBody, /\r\nauto\r\n/);
        } finally {
            await upstream.close();
        }
    });

    it('passes reference images and GPT2Image-compatible fields to the Responses edit backend', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1-env';
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startResponsesImageUpstream(async (body) => {
            upstreamBody = body;
            return {
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ]
            };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: false,
                    streamMode: 'non_stream',
                    imageBackend: 'responses',
                    size: '1536x864',
                    outputFormat: 'webp',
                    outputCompression: '85',
                    promptOptimization: 'false',
                    gptModel: 'gpt-5.4-mini',
                    thinking: 'high'
                })
            );

            assert.equal(response.status, 200);
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-5.4-mini');
            assert.equal(upstreamJson.stream, false);
            const input = upstreamJson.input as Array<Record<string, unknown>>;
            assert.equal(input[0].role, 'user');
            const content = input[0].content as Array<Record<string, unknown>>;
            assert.equal(content[0].type, 'input_text');
            assert.equal(content[0].text, 'route stream contract');
            assert.equal(content[1].type, 'input_image');
            assert.match(String(content[1].image_url), /^data:image\/png;base64,/);
            const tools = upstreamJson.tools as Array<Record<string, unknown>>;
            assert.equal(tools[0].type, 'image_generation');
            assert.equal(tools[0].size, '1536x864');
            assert.equal(tools[0].output_format, 'webp');
            assert.equal(tools[0].output_compression, 85);
            assert.equal(tools[0].prompt_optimization, false);
            assert.equal(tools[0].thinking, 'high');
        } finally {
            await upstream.close();
        }
    });

    it('rejects edit masks without transparent pixels before contacting upstream', async () => {
        const { POST } = await import('./route');
        let upstreamCalls = 0;
        const upstream = await startImagesJsonUpstream(async () => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: false,
                    streamMode: 'non_stream',
                    mask: new File([Buffer.from(PNG_BASE64, 'base64')], 'mask.png', { type: 'image/png' })
                })
            );

            assert.equal(response.status, 400);
            const body = await response.json();
            assert.match(body.error, /mask 必须包含透明区域/);
            assert.equal(upstreamCalls, 0);
        } finally {
            await upstream.close();
        }
    });

    it('falls back when Responses edit stream setup fails before returning SSE', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const { POST } = await import('./route');
        const upstream = await startResponsesStreamFailureThenJsonUpstream();

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    streamMode: 'auto',
                    imageBackend: 'responses'
                })
            );

            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type') || '', /application\/json/);
            const body = (await response.json()) as { images?: Array<Record<string, unknown>> };
            assert.equal(body.images?.[0]?.b64_json, PNG_BASE64);
            assert.equal(upstream.calls[0]?.stream, true);
            assert.equal(upstream.calls[upstream.calls.length - 1]?.stream, false);
        } finally {
            await upstream.close();
        }
    });

    it('passes GPT2Image force_web aliases through to the Images API backend', async () => {
        const { POST } = await import('./route');
        let upstreamBody = '';
        const upstream = await startImagesJsonUpstream(async (body) => {
            if (!body) return { ok: true };
            upstreamBody = body;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    forceWeb: 'true'
                })
            );

            assert.equal(response.status, 200);
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.force_web, true);
        } finally {
            await upstream.close();
        }
    });
});
