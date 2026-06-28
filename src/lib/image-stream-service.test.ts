import { clearAppLogEntriesForTest, readAppLogEntries } from './app-logger';
import { createImageStreamResponse } from './image-stream-service';
import { readSseEvents, upstreamEvents } from './sse-test-utils';
import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, beforeEach, describe, it } from 'node:test';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function resolveActualCost() {
    return Promise.resolve({
        currency: 'usd-equivalent' as const,
        source: 'unavailable' as const,
        confidence: 'none' as const,
        upstreamProvider: 'unknown' as const,
        reason: 'test'
    });
}

const originalLogLevel = process.env.APP_LOG_LEVEL;
const originalInfo = console.info;

beforeEach(() => {
    process.env.APP_LOG_LEVEL = 'info';
    clearAppLogEntriesForTest();
    console.info = () => {};
});

afterEach(() => {
    clearAppLogEntriesForTest();
    if (originalLogLevel === undefined) {
        delete process.env.APP_LOG_LEVEL;
    } else {
        process.env.APP_LOG_LEVEL = originalLogLevel;
    }
    console.info = originalInfo;
});

async function startImageDownloadServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer((request, response) => {
        if (request.url === '/partial.png') {
            const bytes = Buffer.from(PNG_BASE64, 'base64');
            response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(bytes.byteLength) });
            response.end(bytes);
            return;
        }
        if (request.url === '/oversized-partial.png') {
            response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(26 * 1024 * 1024) });
            response.end(Buffer.from(PNG_BASE64, 'base64'));
            return;
        }
        if (request.url === '/text-partial.txt') {
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end('not an image');
            return;
        }
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

describe('createImageStreamResponse', () => {
    it('emits the stable client SSE contract for normalized upstream image events', async () => {
        const response = createImageStreamResponse({
            stream: upstreamEvents([
                { b64_json: 'partial-base64' },
                {
                    data: [{ b64_json: PNG_BASE64 }],
                    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
                }
            ]),
            modeLabel: '生成',
            outputFormat: 'png',
            storageMode: 'indexeddb',
            apiKey: 'test-key',
            model: 'gpt-image-2',
            startedAtMs: 1000,
            clientRequestId: 'client-1',
            requestLogContext: { clientRequestId: 'client-1' },
            resolveActualCost,
            logProviderDiagnostics: false
        });

        assert.equal(response.headers.get('content-type'), 'text/event-stream');
        assert.equal(response.headers.get('x-client-request-id'), 'client-1');

        const events = await readSseEvents(response);
        assert.equal(events.length, 3);
        assert.deepEqual(events[0], {
            type: 'partial_image',
            index: 0,
            b64_json: 'partial-base64'
        });
        assert.equal(events[1].type, 'completed');
        assert.equal(events[1].index, 0);
        assert.equal(events[1].b64_json, PNG_BASE64);
        assert.equal(events[1].output_format, 'png');
        assert.equal(events[1].client_request_id, 'client-1');

        const doneEvent = events[2];
        assert.equal(doneEvent.type, 'done');
        assert.deepEqual(doneEvent.usage, { input_tokens: 1, output_tokens: 2, total_tokens: 3 });
        assert.equal(doneEvent.client_request_id, 'client-1');
        assert.equal(Array.isArray(doneEvent.images), true);
        assert.equal((doneEvent.images as Array<Record<string, unknown>>)[0].b64_json, PNG_BASE64);
    });

    it('can suppress provider dialect diagnostics for isolated stream tests', async () => {
        const response = createImageStreamResponse({
            stream: upstreamEvents([
                {
                    type: 'image.generation.result',
                    data: [{ b64_json: PNG_BASE64 }]
                },
                {
                    type: 'unknown.completed',
                    data: [{ status: 'done' }]
                }
            ]),
            modeLabel: '生成',
            outputFormat: 'png',
            storageMode: 'indexeddb',
            apiKey: 'test-key',
            model: 'gpt-image-2',
            startedAtMs: 1000,
            clientRequestId: 'client-2',
            requestLogContext: { clientRequestId: 'client-2' },
            resolveActualCost,
            logProviderDiagnostics: false
        });

        await response.text();

        const logText = readAppLogEntries()
            .map((entry) => `${entry.message}\n${entry.context || ''}`)
            .join('\n');
        assert.equal(logText, '');
        assert.doesNotMatch(logText, new RegExp(PNG_BASE64));
    });

    it('materializes same-origin URL partial images before emitting client SSE', async () => {
        const downloadServer = await startImageDownloadServer();
        try {
            const response = createImageStreamResponse({
                stream: upstreamEvents([
                    {
                        type: 'agent.partial_image',
                        url: '/partial.png',
                        partial_image_index: 0
                    },
                    {
                        data: [{ b64_json: PNG_BASE64 }]
                    }
                ]),
                modeLabel: '生成',
                outputFormat: 'png',
                storageMode: 'indexeddb',
                apiBaseUrl: downloadServer.baseUrl,
                apiKey: 'test-key',
                model: 'gpt-image-2',
                startedAtMs: 1000,
                resolveActualCost
            });

            const events = await readSseEvents(response);

            assert.deepEqual(
                events.map((event) => event.type),
                ['partial_image', 'completed', 'done']
            );
            assert.equal(events[0].b64_json, PNG_BASE64);
        } finally {
            await downloadServer.close();
        }
    });

    it('skips URL partial images that cannot be safely materialized', async () => {
        const response = createImageStreamResponse({
            stream: upstreamEvents([
                {
                    type: 'agent.partial_image',
                    url: 'https://other.example.test/partial.png',
                    partial_image_index: 0
                },
                {
                    data: [{ b64_json: PNG_BASE64 }]
                }
            ]),
            modeLabel: '生成',
            outputFormat: 'png',
            storageMode: 'indexeddb',
            apiBaseUrl: 'https://api.example.test/v1',
            apiKey: 'test-key',
            model: 'gpt-image-2',
            startedAtMs: 1000,
            resolveActualCost,
            logProviderDiagnostics: false
        });

        const events = await readSseEvents(response);

        assert.deepEqual(
            events.map((event) => event.type),
            ['completed', 'done']
        );
    });

    it('skips unsafe same-origin URL partial downloads without emitting invalid client events', async () => {
        const downloadServer = await startImageDownloadServer();
        try {
            for (const imageUrl of ['/oversized-partial.png', '/text-partial.txt']) {
                const response = createImageStreamResponse({
                    stream: upstreamEvents([
                        {
                            type: 'agent.partial_image',
                            url: imageUrl,
                            partial_image_index: 0
                        },
                        {
                            data: [{ b64_json: PNG_BASE64 }]
                        }
                    ]),
                    modeLabel: '生成',
                    outputFormat: 'png',
                    storageMode: 'indexeddb',
                    apiBaseUrl: downloadServer.baseUrl,
                    apiKey: 'test-key',
                    model: 'gpt-image-2',
                    startedAtMs: 1000,
                    resolveActualCost,
                    logProviderDiagnostics: false
                });

                const events = await readSseEvents(response);
                assert.deepEqual(
                    events.map((event) => event.type),
                    ['completed', 'done']
                );
            }
        } finally {
            await downloadServer.close();
        }
    });

    it('materializes same-origin URL images returned by non-streaming fallback', async () => {
        const downloadServer = await startImageDownloadServer();
        async function* failingStream() {
            yield {
                type: 'agent.partial_image',
                b64_json: 'partial-before-fallback',
                partial_image_index: 0
            };
            throw new Error('stream failed before final image');
        }

        try {
            const response = createImageStreamResponse({
                stream: failingStream(),
                modeLabel: '生成',
                outputFormat: 'png',
                storageMode: 'indexeddb',
                apiBaseUrl: downloadServer.baseUrl,
                apiKey: 'test-key',
                model: 'gpt-image-2',
                startedAtMs: 1000,
                resolveActualCost,
                fallbackOnError: async () => ({
                    created: 1,
                    data: [{ url: '/partial.png' }]
                }),
                logProviderDiagnostics: false
            });

            const events = await readSseEvents(response);

            assert.deepEqual(
                events.map((event) => event.type),
                ['partial_image', 'completed', 'done']
            );
            assert.equal(events[1].b64_json, PNG_BASE64);
            assert.equal(events[2].fallback_used, true);
        } finally {
            await downloadServer.close();
        }
    });

    it('fails explicitly when the page SSE upstream stream stays idle past the configured interval', async () => {
        const originalTimeout = process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS;
        process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = '1';
        let returnCalled = false;
        const stream: AsyncIterable<unknown> = {
            [Symbol.asyncIterator]() {
                return {
                    next: () => new Promise<IteratorResult<unknown>>(() => {}),
                    return: async () => {
                        returnCalled = true;
                        return { done: true, value: undefined };
                    }
                };
            }
        };

        try {
            const response = createImageStreamResponse({
                stream,
                modeLabel: '生成',
                outputFormat: 'png',
                storageMode: 'indexeddb',
                apiKey: 'test-key',
                model: 'gpt-image-2',
                startedAtMs: 1000,
                resolveActualCost,
                logProviderDiagnostics: false
            });

            const events = await readSseEvents(response);

            assert.deepEqual(
                events.map((event) => event.type),
                ['error']
            );
            assert.match(String(events[0].error), /图片流式上游超过 1ms 未返回数据/);
            assert.equal(events[0].status, 502);
            assert.equal(returnCalled, true);
        } finally {
            if (originalTimeout === undefined) {
                delete process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS;
            } else {
                process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = originalTimeout;
            }
        }
    });

    it('deduplicates repeated Responses final image items by item id', async () => {
        const response = createImageStreamResponse({
            stream: upstreamEvents([
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 }
                },
                {
                    type: 'response.completed',
                    response: {
                        output: [{ id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 }]
                    }
                }
            ]),
            modeLabel: '生成',
            outputFormat: 'png',
            storageMode: 'indexeddb',
            apiKey: 'test-key',
            model: 'gpt-image-2',
            startedAtMs: 1000,
            resolveActualCost,
            logProviderDiagnostics: false
        });

        const events = await readSseEvents(response);

        assert.deepEqual(
            events.map((event) => event.type),
            ['completed', 'done']
        );
        assert.equal((events[1].images as Array<Record<string, unknown>>).length, 1);
    });

    it('keeps separate Responses final items when their base64 payloads match', async () => {
        const response = createImageStreamResponse({
            stream: upstreamEvents([
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_same_payload_a', type: 'image_generation_call', result: PNG_BASE64 }
                },
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_same_payload_b', type: 'image_generation_call', result: PNG_BASE64 }
                }
            ]),
            modeLabel: '生成',
            outputFormat: 'png',
            storageMode: 'indexeddb',
            apiKey: 'test-key',
            model: 'gpt-image-2',
            startedAtMs: 1000,
            resolveActualCost,
            logProviderDiagnostics: false
        });

        const events = await readSseEvents(response);

        assert.deepEqual(
            events.map((event) => event.type),
            ['completed', 'completed', 'done']
        );
        assert.equal((events[2].images as Array<Record<string, unknown>>).length, 2);
    });

    it('deduplicates repeated Responses final image items within a single event', async () => {
        const response = createImageStreamResponse({
            stream: upstreamEvents([
                {
                    type: 'response.completed',
                    data: [],
                    response: {
                        output: [
                            { id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 },
                            { id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 }
                        ]
                    }
                }
            ]),
            modeLabel: '生成',
            outputFormat: 'png',
            storageMode: 'indexeddb',
            apiKey: 'test-key',
            model: 'gpt-image-2',
            startedAtMs: 1000,
            resolveActualCost,
            logProviderDiagnostics: false
        });

        const events = await readSseEvents(response);

        assert.deepEqual(
            events.map((event) => event.type),
            ['completed', 'done']
        );
        assert.equal((events[1].images as Array<Record<string, unknown>>).length, 1);
    });
});
