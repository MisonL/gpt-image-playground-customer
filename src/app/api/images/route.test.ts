import {
    PNG_BASE64,
    imageFormRequest,
    readSseEvents,
    startHangingImagesStreamUpstream,
    startImagesAcceptedTaskStreamFallbackUpstream,
    startImagesJsonUpstream,
    startImagesStreamFallbackUpstream,
    startStreamingImageUpstream
} from './route-test-helpers';
import { registerRouteTestLifecycle } from './route-test-setup';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

registerRouteTestLifecycle();

describe('POST /api/images Images API streaming', { concurrency: false }, () => {
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
        let observedIdempotencyKey: string | string[] | undefined;
        const upstream = await startImagesJsonUpstream(async (body, _url, request) => {
            if (request.method === 'POST') {
                upstreamBodies.push(body);
                observedIdempotencyKey = request.headers['idempotency-key'];
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
            assert.equal(observedIdempotencyKey, 'client-route-stream');
        } finally {
            await upstream.close();
        }
    });

    it('passes force_request through page generation and lets upstream decide small sizes', async () => {
        const { POST } = await import('./route');
        const upstreamBodies: string[] = [];
        const upstream = await startImagesJsonUpstream(async (body, _url, request) => {
            if (request.method === 'POST') {
                upstreamBodies.push(body);
            }
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_CHANNEL_1_ID = 'json-force';
        process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
        process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream';

        try {
            const response = await POST(
                imageFormRequest({
                    streamMode: 'auto',
                    size: '512x512',
                    forceRequest: 'true',
                    clientRequestId: 'force-small-size'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(upstreamBodies.length, 1);
            const upstreamJson = JSON.parse(upstreamBodies[0] || '{}') as Record<string, unknown>;
            assert.equal(upstreamJson.size, '512x512');
        } finally {
            await upstream.close();
        }
    });

    it('uses the lower-cost non-streaming channel request mode for page auto streaming by default', async () => {
        const { POST } = await import('./route');
        const upstreamBodies: string[] = [];
        const upstream = await startImagesJsonUpstream(async (body, _url, request) => {
            if (request.method === 'POST') {
                upstreamBodies.push(body);
            }
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_CHANNEL_1_ID = 'mixed';
        process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
        process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream,images-sse';

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

    it('retries accepted async image tasks with the same upstream idempotency key', async () => {
        const { POST } = await import('./route');
        const observedIdempotencyKeys: Array<string | string[] | undefined> = [];
        let upstreamCalls = 0;
        const upstream = await startImagesJsonUpstream(async (_body, _url, request) => {
            if (request.method !== 'POST') {
                return { data: [{ b64_json: PNG_BASE64 }] };
            }
            upstreamCalls += 1;
            observedIdempotencyKeys.push(request.headers['idempotency-key']);
            if (upstreamCalls === 1) {
                return {
                    object: 'image.task',
                    status: 'pending',
                    task_id: 'sync-gen-task',
                    poll_url: '/api/image-tasks?ids=sync-gen-task'
                };
            }
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_CHANNEL_1_ID = 'json-task';
        process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
        process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream';

        try {
            const response = await POST(
                imageFormRequest({
                    streamMode: 'auto',
                    clientRequestId: 'accepted-task-retry-key'
                })
            );

            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            assert.equal(upstreamCalls, 2);
            assert.deepEqual(observedIdempotencyKeys, ['accepted-task-retry-key', 'accepted-task-retry-key']);
        } finally {
            await upstream.close();
        }
    });

    it('retries accepted async edit tasks with the same upstream idempotency key', async () => {
        const { POST } = await import('./route');
        const observedIdempotencyKeys: Array<string | string[] | undefined> = [];
        let upstreamCalls = 0;
        const upstream = await startImagesJsonUpstream(async (_body, _url, request) => {
            if (request.method !== 'POST') {
                return { data: [{ b64_json: PNG_BASE64 }] };
            }
            upstreamCalls += 1;
            observedIdempotencyKeys.push(request.headers['idempotency-key']);
            if (upstreamCalls === 1) {
                return {
                    object: 'image.task',
                    status: 'pending',
                    task_id: 'sync-edit-task',
                    poll_url: '/api/image-tasks?ids=sync-edit-task'
                };
            }
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_CHANNEL_1_ID = 'json-edit-task';
        process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
        process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream';

        try {
            const response = await POST(
                imageFormRequest({
                    mode: 'edit',
                    streamMode: 'auto',
                    clientRequestId: 'accepted-edit-task-retry-key'
                })
            );

            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            assert.equal(upstreamCalls, 2);
            assert.deepEqual(observedIdempotencyKeys, ['accepted-edit-task-retry-key', 'accepted-edit-task-retry-key']);
        } finally {
            await upstream.close();
        }
    });

    it('fails explicit page stream requests instead of falling back to non-streaming request modes', async () => {
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
                    streamMode: 'stream',
                    imageStreamingStrategy: 'openai-sse'
                })
            );

            assert.equal(response.status, 503);
            const body = (await response.json()) as { error?: string };
            assert.match(body.error || '', /images-sse/);
            assert.equal(upstreamBodies.length, 0);
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
            process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream,images-sse';
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
            process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream,images-sse';
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
            if (request.method === 'POST' && request.url?.endsWith('/images/generations')) {
                upstreamBody = body;
                upstreamAppId = request.headers['x-app-id'];
                upstreamAppSecret = request.headers['x-app-secret'];
            }
            return {
                data: [{ b64_json: PNG_BASE64 }]
            };
        });

        try {
            process.env.OPENAI_CHANNEL_1_ID = 'matsca';
            process.env.OPENAI_CHANNEL_1_API_KEYS = 'test-key';
            process.env.OPENAI_CHANNEL_1_BASE_URL = upstream.baseUrl;
            process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE = 'matsca';
            process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream';
            process.env.OPENAI_CHANNEL_1_MATSCA_APP_ID = 'app-id';
            process.env.OPENAI_CHANNEL_1_MATSCA_APP_SECRET = 'app-secret';
            process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
            process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
            const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
            resetServerChannelStateForTests();
            const { POST } = await import('./route');

            const response = await POST(
                imageFormRequest({
                    streamMode: 'non_stream',
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

    it('returns upstream diagnostics when JSON Images responses omit image data', async () => {
        const { POST } = await import('./route');
        const upstream = await startImagesJsonUpstream(async () => ({ data: [{ status: 'done' }] }));

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    streamMode: 'non_stream'
                })
            );

            assert.equal(response.status, 502);
            const body = (await response.json()) as {
                error?: string;
                diagnostics?: { category?: string; structure?: unknown };
            };
            assert.match(body.error || '', /不是 OpenAI Images 格式/);
            assert.equal(body.diagnostics?.category, 'unknown_response_format');
            assert.equal(JSON.stringify(body.diagnostics).includes('test-key'), false);
        } finally {
            await upstream.close();
        }
    });

    it('falls back from force-sse auto streaming without a final image and skips streaming for the same mark', async () => {
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
                    imageStreamingStrategy: 'force-sse',
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
                    imageStreamingStrategy: 'force-sse',
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
                    imageStreamingStrategy: 'force-sse',
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

    it('retries accepted async image tasks after force-sse auto stream fallback with the same idempotency key', async () => {
        const { POST } = await import('./route');
        const upstream = await startImagesAcceptedTaskStreamFallbackUpstream();

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    streamMode: 'auto',
                    imageStreamingStrategy: 'force-sse',
                    clientRequestId: 'client-route-auto-fallback-task'
                })
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-type'), 'text/event-stream');
            const events = await readSseEvents(response);
            assert.deepEqual(
                events.map((event) => event.type),
                ['partial_image', 'completed', 'done']
            );
            assert.equal(events[2].fallback_used, true);
            assert.deepEqual(
                upstream.calls.map((call) => call.stream),
                [true, false, false]
            );
            assert.deepEqual(
                upstream.calls.map((call) => call.idempotencyKey),
                [
                    'client-route-auto-fallback-task',
                    'client-route-auto-fallback-task',
                    'client-route-auto-fallback-task'
                ]
            );
        } finally {
            await upstream.close();
        }
    });

    it('does not mark force-sse auto streaming unavailable when the page SSE request is aborted', async () => {
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
                    imageStreamingStrategy: 'force-sse',
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


});
