#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC';
const originalEnv = { ...process.env };
function restoreProcessEnv() {
    for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
}
function configureRouteEnv() {
    for (const key of [
        'APP_PASSWORD',
        'OPENAI_API_KEY',
        'OPENAI_API_BASE_URL',
        'OPENAI_UPSTREAM_PROXY_URL',
        'OPENAI_CHANNEL_1_API_KEYS',
        'OPENAI_CHANNEL_1_BASE_URL',
        'IMAGE_GENERATION_BACKEND',
        'IMAGE_STREAMING_STRATEGY'
    ]) {
        delete process.env[key];
    }
    process.env.APP_LOG_LEVEL = 'warn';
    process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE = 'indexeddb';
    process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
    process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-5.4';
}
function imageRequest(input) {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
        mode: 'generate',
        prompt: input.prompt || 'local image upstream compatibility smoke',
        model: 'gpt-image-2',
        n: '1',
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
        apiBaseUrl: input.apiBaseUrl,
        apiKey: 'local-smoke-key',
        clientRequestId: input.clientRequestId || 'image-upstream-compat-smoke'
    })) {
        formData.append(key, value);
    }
    if (input.imageBackend) formData.append('imageBackend', input.imageBackend);
    if (input.imageStreamingStrategy) formData.append('imageStreamingStrategy', input.imageStreamingStrategy);
    if (input.responsesModel) formData.append('responsesModel', input.responsesModel);
    if (input.stream) {
        formData.append('stream', 'true');
        formData.append('partial_images', '2');
    }
    return new Request('http://localhost/api/images', { method: 'POST', body: formData });
}
async function readBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}
function sendJson(response, status, payload) {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
}
function sendSse(response, events) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of events) {
        if (event.comment) response.write(`: ${event.comment}\n\n`);
        if (event.event) response.write(`event: ${event.event}\n`);
        if ('data' in event) response.write(`data: ${JSON.stringify(event.data)}\n\n`);
    }
    response.write('data: [DONE]\n\n');
    response.end();
}
function costLogResponse() {
    const now = Math.floor(Date.now() / 1000);
    return {
        success: true,
        data: [{ id: now, type: 2, model_name: 'gpt-image-2', quota: 3750, created_at: now, request_id: 'local-smoke' }]
    };
}
async function startMockUpstream(handler) {
    const calls = [];
    const server = http.createServer(async (request, response) => {
        try {
            if (request.method === 'GET' && request.url === '/api/log/token') {
                sendJson(response, 200, costLogResponse());
                return;
            }
            const body = await readBody(request);
            calls.push({ method: request.method, url: request.url, body });
            await handler({ body, request, response });
        } catch (error) {
            sendJson(response, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        calls,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}
function assertPath(request, expectedPath) {
    assert.equal(request.method, 'POST');
    assert.equal(request.url?.endsWith(expectedPath), true);
}
async function readJsonImage(response) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const body = await response.json();
    assert.equal(Array.isArray(body.images), true);
    assert.equal(body.images.length, 1);
    assert.equal(body.images[0].b64_json, PNG_BASE64);
    return body;
}
async function readSseImages(response, expectedTypes) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const events = (await response.text())
        .split('\n\n')
        .map((part) => part.trim())
        .filter((part) => part.startsWith('data: ') && part !== 'data: [DONE]')
        .map((part) => JSON.parse(part.slice('data: '.length)));
    assert.deepEqual(
        events.map((event) => event.type),
        expectedTypes
    );
    const done = events.at(-1);
    assert.equal(done?.type, 'done');
    assert.equal(done.images.length, 1);
    assert.equal(done.images[0].b64_json, PNG_BASE64);
    return events;
}
function completedImageEvent(type, data) {
    return { event: type, data: { type, ...data } };
}
function responsesOutputItemDone(result) {
    return {
        event: 'response.output_item.done',
        data: { type: 'response.output_item.done', item: { type: 'image_generation_call', status: 'completed', result } }
    };
}
const cases = [
    {
        name: 'original new-api Images API JSON',
        form: { stream: false, clientRequestId: 'smoke-images-json' },
        handle: ({ body, request, response }) => {
            assertPath(request, '/v1/images/generations');
            assert.equal(JSON.parse(body).stream, false);
            sendJson(response, 200, {
                created: Math.floor(Date.now() / 1000),
                data: [{ b64_json: PNG_BASE64 }],
                usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
            });
        },
        verify: async (response) => {
            await readJsonImage(response);
        }
    },
    {
        name: 'sub2api Images API JSON',
        form: { stream: false, clientRequestId: 'smoke-sub2api-images-json' },
        handle: ({ body, request, response }) => {
            assertPath(request, '/v1/images/generations');
            const requestJson = JSON.parse(body);
            assert.equal(requestJson.stream, false);
            assert.equal(Object.hasOwn(requestJson, 'partial_images'), false);
            sendJson(response, 200, {
                created: Math.floor(Date.now() / 1000),
                data: [{ b64_json: PNG_BASE64 }],
                usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
            });
        },
        verify: async (response) => {
            await readJsonImage(response);
        }
    },
    {
        name: 'gaoren new-api Images SSE keepalive',
        form: { stream: true, imageStreamingStrategy: 'newapi-keepalive-sse', clientRequestId: 'smoke-gaoren-keepalive' },
        handle: ({ body, request, response }) => {
            assertPath(request, '/v1/images/generations');
            const requestJson = JSON.parse(body);
            assert.equal(requestJson.stream, true);
            assert.equal(requestJson.partial_images, 2);
            sendSse(response, [
                { comment: 'keepalive' },
                completedImageEvent('image_generation.partial_image', {
                    b64_json: 'gaoren-partial-base64',
                    partial_image_index: 0
                }),
                completedImageEvent('image_generation.completed', { b64_json: PNG_BASE64 })
            ]);
        },
        verify: async (response) => {
            const events = await readSseImages(response, ['partial_image', 'completed', 'done']);
            assert.equal(events[0].b64_json, 'gaoren-partial-base64');
        }
    },
    {
        name: 'gaoren new-api JSON-as-SSE completed event',
        form: { stream: true, imageStreamingStrategy: 'newapi-keepalive-sse', clientRequestId: 'smoke-gaoren-json-as-sse' },
        handle: ({ request, response }) => {
            assertPath(request, '/v1/images/generations');
            sendSse(response, [completedImageEvent('image_generation.completed', { data: [{ b64_json: PNG_BASE64 }] })]);
        },
        verify: async (response) => {
            await readSseImages(response, ['completed', 'done']);
        }
    },
    {
        name: 'sub2api Images SSE',
        form: { stream: true, imageStreamingStrategy: 'openai-sse', clientRequestId: 'smoke-sub2api-images-sse' },
        handle: ({ request, response }) => {
            assertPath(request, '/v1/images/generations');
            sendSse(response, [
                { event: 'image.generation.chunk', data: { b64_json: 'sub2api-partial-base64' } },
                { event: 'image.generation.result', data: { data: [{ b64_json: PNG_BASE64 }] } }
            ]);
        },
        verify: async (response) => {
            const events = await readSseImages(response, ['partial_image', 'completed', 'done']);
            assert.equal(events[0].b64_json, 'sub2api-partial-base64');
        }
    },
    {
        name: 'sub2api Responses image_generation bridge JSON',
        form: {
            stream: false,
            imageBackend: 'responses-image-generation',
            responsesModel: 'gpt-5.4',
            clientRequestId: 'smoke-responses-bridge-json'
        },
        handle: ({ body, request, response }) => {
            assertPath(request, '/v1/responses');
            const requestJson = JSON.parse(body);
            assert.equal(requestJson.model, 'gpt-5.4');
            assert.equal(requestJson.stream, false);
            assert.equal(requestJson.tool_choice.type, 'image_generation');
            sendJson(response, 200, {
                output: [{ type: 'image_generation_call', status: 'completed', result: PNG_BASE64 }],
                usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 }
            });
        },
        verify: async (response) => {
            await readJsonImage(response);
        }
    },
    {
        name: 'GPT2Image Responses image_generation SSE',
        form: {
            stream: true,
            imageBackend: 'responses',
            imageStreamingStrategy: 'responses-sse',
            responsesModel: 'gpt-5.4',
            clientRequestId: 'smoke-gpt2image-responses-sse'
        },
        handle: ({ body, request, response }) => {
            assertPath(request, '/v1/responses');
            const requestJson = JSON.parse(body);
            assert.equal(requestJson.stream, true);
            assert.equal(requestJson.tools[0].partial_images, 2);
            sendSse(response, [
                completedImageEvent('response.image_generation_call.partial_image', {
                    partial_image_b64: 'gpt2image-partial-base64',
                    partial_image_index: 0
                }),
                completedImageEvent('response.image_generation_call.completed', { item_id: 'ig_smoke' }),
                responsesOutputItemDone(`data:image/png;base64,${PNG_BASE64}`),
                completedImageEvent('response.completed', {
                    response: { output: [{ type: 'image_generation_call', status: 'completed', result: PNG_BASE64 }] }
                })
            ]);
        },
        verify: async (response) => {
            const events = await readSseImages(response, ['partial_image', 'completed', 'done']);
            assert.equal(events[0].b64_json, 'gpt2image-partial-base64');
        }
    }
];

async function runCase(POST, testCase) {
    const upstream = await startMockUpstream(testCase.handle);
    try {
        const response = await POST(imageRequest({ ...testCase.form, apiBaseUrl: upstream.baseUrl }));
        await testCase.verify(response, upstream.calls);
        console.log(`[pass] ${testCase.name}`);
    } finally {
        await upstream.close();
    }
}

async function main() {
    configureRouteEnv();
    const { POST } = await import('../src/app/api/images/route.ts');
    try {
        for (const testCase of cases) await runCase(POST, testCase);
        console.log('image upstream compatibility local fixture smoke passed');
    } finally {
        restoreProcessEnv();
    }
}

main().catch((error) => {
    restoreProcessEnv();
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
});
