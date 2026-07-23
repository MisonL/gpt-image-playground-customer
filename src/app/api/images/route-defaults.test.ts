import {
    PNG_BASE64,
    imageFormRequest,
    readSseEvents,
    startImagesJsonUpstream,
    startResponsesImageUpstream,
    startStreamingImageUpstream,
    startStreamingResponsesImageUpstream
} from './route-test-helpers';
import { registerRouteTestLifecycle } from './route-test-setup';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

registerRouteTestLifecycle();

describe('POST /api/images backend defaults and security boundaries', { concurrency: false }, () => {
    it('normalizes non-streamed page image bytes to the requested output format', async () => {
        const { POST } = await import('./route');
        const upstream = await startImagesJsonUpstream(async () => ({ data: [{ b64_json: PNG_BASE64 }] }));

        try {
            const response = await POST(
                imageFormRequest({
                    apiBaseUrl: upstream.baseUrl,
                    apiKey: 'test-key',
                    stream: false,
                    streamMode: 'non_stream',
                    outputFormat: 'webp'
                })
            );

            assert.equal(response.status, 200);
            const body = (await response.json()) as { images?: Array<Record<string, unknown>> };
            assert.equal(body.images?.[0]?.output_format, 'webp');
            assert.equal(
                Buffer.from(String(body.images?.[0]?.b64_json || ''), 'base64').toString('ascii', 8, 12),
                'WEBP'
            );
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
            assert.equal(
                upstreamJson.input?.[0]?.content?.some((item) => item.type === 'input_image'),
                true
            );
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


});
