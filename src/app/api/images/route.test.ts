import {
    PNG_BASE64,
    imageFormRequest,
    readSseEvents,
    startImagesJsonUpstream,
    startResponsesImageUpstream,
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
    delete process.env.APP_PASSWORD;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.OPENAI_CHANNEL_1_API_KEYS;
    delete process.env.OPENAI_CHANNEL_1_BASE_URL;
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
            assert.equal(events[1].output_format, 'png');
            assert.equal(events[2].type, 'done');
            assert.equal((events[2].images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);
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
            assert.equal(events[1].output_format, 'png');
            assert.equal((events[2].images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);
            assert.equal(upstreamUrl, '/v1/images/edits');
            assert.match(upstreamBody, /name="image\[\]"/);
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
                imageBackend: 'responses',
                n: '2'
            })
        );
        assert.equal(multiImage.status, 400);
        assert.match(String(((await multiImage.json()) as Record<string, unknown>).error), /单张生成/);

        const edit = await POST(
            imageFormRequest({
                apiBaseUrl: 'http://127.0.0.1:1/v1',
                apiKey: 'test-key',
                stream: false,
                imageBackend: 'responses',
                mode: 'edit'
            })
        );
        assert.equal(edit.status, 400);
        assert.match(String(((await edit.json()) as Record<string, unknown>).error), /只支持 generate/);
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
                    stream: false
                })
            );

            assert.equal(response.status, 502);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /base64/);
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
                    stream: false
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

    it('does not apply the generate backend env default to edit requests', async () => {
        process.env.IMAGE_GENERATION_BACKEND = 'responses';
        const { POST } = await import('./route');
        let upstreamUrl = '';
        const upstream = await startImagesJsonUpstream(async (_body, url) => {
            upstreamUrl = url;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    mode: 'edit',
                    stream: false
                })
            );

            assert.equal(response.status, 200);
            const body = (await response.json()) as { images?: Array<Record<string, unknown>> };
            assert.equal(body.images?.[0]?.b64_json, PNG_BASE64);
            assert.equal(upstreamUrl, '/v1/images/edits');
        } finally {
            await upstream.close();
        }
    });

    it('does not apply Responses-only streaming strategy env defaults to edit streams', async () => {
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

    it('rejects invalid gpt-image-2 custom sizes before contacting upstream', async () => {
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
                    size: '2049x2048'
                })
            );

            assert.equal(response.status, 400);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /size 对 gpt-image-2 无效/);
            assert.match(String(body.error), /16 的倍数/);
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
});
