import { createImageStreamResponse } from './image-stream-service';
import { clearAppLogEntriesForTest, readAppLogEntries } from './app-logger';
import { readSseEvents, upstreamEvents } from './sse-test-utils';
import assert from 'node:assert/strict';
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
            resolveActualCost
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

    it('logs provider dialect diagnostics without raw image payloads', async () => {
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
            resolveActualCost
        });

        await response.text();

        const logText = readAppLogEntries()
            .map((entry) => `${entry.message}\n${entry.context || ''}`)
            .join('\n');
        assert.match(logText, /"providerDialect": "otokapi_image_event"/);
        assert.match(logText, /"providerDialect": "unknown_ignored_event"/);
        assert.doesNotMatch(logText, new RegExp(PNG_BASE64));
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
            resolveActualCost
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
            resolveActualCost
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
            resolveActualCost
        });

        const events = await readSseEvents(response);

        assert.deepEqual(
            events.map((event) => event.type),
            ['completed', 'done']
        );
        assert.equal((events[1].images as Array<Record<string, unknown>>).length, 1);
    });
});
