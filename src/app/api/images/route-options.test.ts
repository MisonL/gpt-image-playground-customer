import {
    PNG_BASE64,
    imageFormRequest,
    startImagesJsonUpstream,
    startResponsesImageUpstream,
    startResponsesStreamFailureThenJsonUpstream
} from './route-test-helpers';
import { registerRouteTestLifecycle } from './route-test-setup';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

registerRouteTestLifecycle();

describe('POST /api/images request validation and extensions', { concurrency: false }, () => {
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

    it('rejects page SSE client request ids with control characters before contacting upstream', async () => {
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
                    clientRequestId: 'bad\nrequest'
                })
            );

            assert.equal(response.status, 400);
            const body = (await response.json()) as Record<string, unknown>;
            assert.match(String(body.error), /clientRequestId/);
            assert.match(String(body.error), /控制字符/);
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
                    imageStreamingStrategy: 'force-sse',
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
