import {
    normalizeUpstreamImageStreamEvent,
    normalizeUpstreamImageStreamEventWithDiagnostics
} from './image-stream-events';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const GIF_BASE64 = 'R0lGODlhAQABAAAAACw=';

describe('normalizeUpstreamImageStreamEvent', () => {
    it('keeps official image generation partial and completed events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'image_generation.partial_image',
                partial_image_index: 1,
                b64_json: 'partial-base64'
            }),
            [
                {
                    type: 'partial_image',
                    partialImageIndex: 1,
                    b64Json: 'partial-base64'
                }
            ]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'image_generation.completed',
                b64_json: 'final-base64',
                usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
            }),
            [
                {
                    type: 'completed',
                    b64Json: 'final-base64',
                    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
                }
            ]
        );
    });

    it('ignores OtokAPI progress chunks when no image payload is present', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'image.generation.chunk',
                status: 'processing'
            }),
            []
        );
    });

    it('maps OtokAPI result events with data array images to completed events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'image.generation.result',
                data: [{ b64_json: 'final-a' }, { b64_json: 'final-b' }],
                usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 }
            }),
            [
                {
                    type: 'completed',
                    b64Json: 'final-a',
                    usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 }
                },
                {
                    type: 'completed',
                    b64Json: 'final-b',
                    usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 }
                }
            ]
        );
    });

    it('handles SDK-parsed OtokAPI result data when the SSE event name is dropped', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                created: 1710000000,
                data: [{ b64_json: 'final-base64' }]
            }),
            [
                {
                    type: 'completed',
                    b64Json: 'final-base64'
                }
            ]
        );
    });

    it('handles SDK-wrapped OtokAPI result data when the SSE event name is retained separately', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'image.generation.result',
                data: {
                    data: [{ b64_json: 'final-base64' }],
                    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
                }
            }),
            [
                {
                    type: 'completed',
                    b64Json: 'final-base64',
                    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
                }
            ]
        );
    });

    it('maps Responses image partial events to stable partial image events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.image_generation_call.partial_image',
                partial_image_b64: 'responses-partial-base64',
                partial_image_index: 0
            }),
            [
                {
                    type: 'partial_image',
                    b64Json: 'responses-partial-base64',
                    partialImageIndex: 0
                }
            ]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.image_generation_call.partial_image',
                b64_json: 'responses-partial-b64-json',
                partial_image_index: 1
            }),
            [
                {
                    type: 'partial_image',
                    b64Json: 'responses-partial-b64-json',
                    partialImageIndex: 1
                }
            ]
        );
    });

    it('maps Responses output item image results to completed events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.output_item.done',
                item: {
                    type: 'image_generation_call',
                    result: PNG_BASE64
                }
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64
                }
            ]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.output_item.done',
                item: {
                    type: 'image_generation_call',
                    result: `data:image/png;base64,${PNG_BASE64}`
                }
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64
                }
            ]
        );
    });

    it('uses a bounded dedupe key when Responses image call ids are missing', () => {
        const payload = 'A'.repeat(1024);
        const result = normalizeUpstreamImageStreamEventWithDiagnostics({
            type: 'response.output_item.done',
            item: {
                type: 'image_generation_call',
                result: payload
            }
        });

        assert.equal(result.events.length, 1);
        const [event] = result.events;
        assert.equal(event.type, 'completed');
        if (event.type !== 'completed') return;
        assert.match(event.dedupeKey || '', /^responses:result:fingerprint:\d+:[a-f0-9]{64}$/);
        assert.equal(event.dedupeKey?.includes(payload), false);
        assert.ok((event.dedupeKey || '').length < 256);
    });

    it('keeps distinct bounded dedupe keys when same-length Responses payloads differ by one byte', () => {
        const first = 'A'.repeat(1000);
        const second = `${first.slice(0, 100)}B${first.slice(101)}`;
        const readDedupeKey = (payload: string) => {
            const result = normalizeUpstreamImageStreamEventWithDiagnostics({
                type: 'response.output_item.done',
                item: {
                    type: 'image_generation_call',
                    result: payload
                }
            });
            const [event] = result.events;
            assert.equal(event.type, 'completed');
            if (event.type !== 'completed') return undefined;
            return event.dedupeKey;
        };

        assert.equal(first.length, second.length);
        assert.notEqual(readDedupeKey(first), readDedupeKey(second));
    });

    it('recognizes Responses image generation completed markers without requiring them to carry final images', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.image_generation_call.completed',
                item_id: 'ig_123'
            }),
            []
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.image_generation_call.completed',
                item: {
                    type: 'image_generation_call',
                    result: PNG_BASE64
                }
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64
                }
            ]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.image_generation_call.completed',
                result: PNG_BASE64
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64
                }
            ]
        );
    });

    it('ignores Responses output item done events when they do not carry image results', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.output_item.done',
                item: {
                    type: 'message',
                    content: [{ type: 'output_text', text: 'done' }]
                }
            }),
            []
        );
    });

    it('fails explicitly when Responses output item done reports a failed image result', () => {
        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'response.output_item.done',
                    item: {
                        type: 'image_generation_call',
                        status: 'failed',
                        error: {
                            code: 'content_policy_violation',
                            message: 'blocked by upstream policy'
                        }
                    }
                }),
            /blocked by upstream policy/
        );

        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'response.completed',
                    response: {
                        output: [
                            {
                                type: 'image_generation_call',
                                status: 'failed',
                                error: {
                                    message: 'responses completed image failed'
                                }
                            }
                        ]
                    }
                }),
            /responses completed image failed/
        );
    });

    it('fails explicitly when Responses output item done lacks a final image result', () => {
        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'response.output_item.done',
                    item: {
                        type: 'image_generation_call',
                        status: 'completed'
                    }
                }),
            /image_generation_call\.result/
        );
    });

    it('maps GPT2Image Responses URL results to completed image URL events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.output_item.done',
                item: {
                    type: 'image_generation_call',
                    status: 'completed',
                    result: 'https://example.test/image.png'
                }
            }),
            [{ type: 'completed', imageUrl: 'https://example.test/image.png' }]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.output_item.done',
                item: {
                    type: 'image_generation_call',
                    url: '/api/storage/generations/image.png'
                }
            }),
            [{ type: 'completed', imageUrl: '/api/storage/generations/image.png' }]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.image_generation_call.completed',
                url: 'https://example.test/image.png'
            }),
            [{ type: 'completed', imageUrl: 'https://example.test/image.png' }]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.completed',
                response: {
                    output: [
                        {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: 'https://example.test/image.png'
                        }
                    ]
                }
            }),
            [{ type: 'completed', imageUrl: 'https://example.test/image.png' }]
        );
    });

    it('maps Responses completed output image results and usage to completed events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.completed',
                response: {
                    usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 },
                    output: [
                        {
                            type: 'image_generation_call',
                            result: PNG_BASE64
                        },
                        {
                            type: 'message',
                            content: [{ type: 'output_text', text: 'done' }]
                        },
                        {
                            type: 'image_generation_call',
                            result: `data:image/gif;base64,${GIF_BASE64}`
                        }
                    ]
                }
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64,
                    usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 }
                },
                {
                    type: 'completed',
                    b64Json: GIF_BASE64,
                    usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 }
                }
            ]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.completed',
                usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ]
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64,
                    usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 }
                }
            ]
        );
    });

    it('treats SDK-parsed OtokAPI root image data as a partial chunk when the SSE event name is dropped', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                b64_json: 'partial-base64'
            }),
            [
                {
                    type: 'partial_image',
                    b64Json: 'partial-base64'
                }
            ]
        );
    });

    it('extracts image data from data URLs when relays return url format', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'image.generation.result',
                data: [{ url: `data:image/png;base64,${PNG_BASE64}` }]
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64
                }
            ]
        );
    });

    it('rejects non-image data URLs and non-base64 Responses image results', () => {
        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'response.output_item.done',
                    item: {
                        type: 'image_generation_call',
                        result: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
                    }
                }),
            /image_generation_call\.result/
        );

        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'response.output_item.done',
                    item: {
                        type: 'image_generation_call',
                        result: '<script>alert(1)</script>'
                    }
                }),
            /image_generation_call\.result/
        );
    });

    it('fails explicitly when a completed image event has no image payload', () => {
        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'image.generation.result',
                    data: [{ status: 'done' }]
                }),
            /b64_json/
        );
    });

    it('maps completed image events with URL results to completed image URL events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'image_generation.completed',
                url: 'https://example.test/image.png'
            }),
            [{ type: 'completed', imageUrl: 'https://example.test/image.png' }]
        );
    });

    it('ignores GPT2Image Agent SSE task events and keeps the final Agent image result', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'agent.event',
                event: {
                    kind: 'web_search',
                    status: 'completed',
                    title: 'search done'
                }
            }),
            []
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'agent.partial_image',
                partial_image_index: 0,
                b64_json: 'agent-partial-base64'
            }),
            [
                {
                    type: 'partial_image',
                    partialImageIndex: 0,
                    b64Json: 'agent-partial-base64'
                }
            ]
        );

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'agent.completed',
                data: [{ b64_json: PNG_BASE64, output_role: 'final' }]
            }),
            [
                {
                    type: 'completed',
                    b64Json: PNG_BASE64
                }
            ]
        );
    });

    it('fails explicitly when a Responses stream reports response.failed', () => {
        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'response.failed',
                    response: {
                        error: {
                            code: 'invalid_prompt',
                            message: 'blocked by upstream policy'
                        }
                    }
                }),
            /blocked by upstream policy/
        );
    });

    it('limits Responses image traversal depth for deeply nested payloads', () => {
        let payload: Record<string, unknown> = {
            type: 'image_generation_call',
            result: 'deep-final'
        };
        for (let index = 0; index < 20000; index += 1) {
            payload = { item: payload };
        }

        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.output_item.done',
                item: payload
            }),
            []
        );
    });

    it('ignores SSE keepalive comments and non-object events', () => {
        assert.deepEqual(normalizeUpstreamImageStreamEvent(':'), []);
        assert.deepEqual(normalizeUpstreamImageStreamEvent(null), []);
    });

    it('reports provider dialect diagnostics without treating unknown completed-like payloads as success', () => {
        assert.equal(
            normalizeUpstreamImageStreamEventWithDiagnostics({
                type: 'image_generation.completed',
                b64_json: 'official-final'
            }).providerDialect,
            'official_image_event'
        );
        assert.equal(
            normalizeUpstreamImageStreamEventWithDiagnostics({
                type: 'image.generation.result',
                data: [{ b64_json: 'otokapi-final' }]
            }).providerDialect,
            'otokapi_image_event'
        );
        assert.equal(
            normalizeUpstreamImageStreamEventWithDiagnostics({
                type: 'response.output_item.done',
                item: {
                    type: 'image_generation_call',
                    result: PNG_BASE64
                }
            }).providerDialect,
            'responses_image_event'
        );
        assert.equal(
            normalizeUpstreamImageStreamEventWithDiagnostics({
                data: [{ b64_json: 'sdk-final' }]
            }).providerDialect,
            'sdk_parsed_fallback'
        );

        const unknown = normalizeUpstreamImageStreamEventWithDiagnostics({
            type: 'image.generation.completed',
            data: [{ b64_json: 'unknown-final' }]
        });

        assert.equal(unknown.providerDialect, 'unknown_ignored_event');
        assert.deepEqual(unknown.events, []);
    });
});
