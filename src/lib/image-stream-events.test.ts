import {
    normalizeUpstreamImageStreamEvent,
    normalizeUpstreamImageStreamEventWithDiagnostics
} from './image-stream-events';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
    });

    it('maps Responses output item image results to completed events', () => {
        assert.deepEqual(
            normalizeUpstreamImageStreamEvent({
                type: 'response.output_item.done',
                item: {
                    type: 'image_generation_call',
                    result: 'responses-final-base64'
                }
            }),
            [
                {
                    type: 'completed',
                    b64Json: 'responses-final-base64'
                }
            ]
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
                            result: 'responses-final-a'
                        },
                        {
                            type: 'message',
                            content: [{ type: 'output_text', text: 'done' }]
                        },
                        {
                            type: 'image_generation_call',
                            result: 'data:image/png;base64,responses-final-b'
                        }
                    ]
                }
            }),
            [
                {
                    type: 'completed',
                    b64Json: 'responses-final-a',
                    usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 }
                },
                {
                    type: 'completed',
                    b64Json: 'responses-final-b',
                    usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 }
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
                data: [{ url: 'data:image/png;base64,final-base64' }]
            }),
            [
                {
                    type: 'completed',
                    b64Json: 'final-base64'
                }
            ]
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

    it('fails explicitly when a completed image event only has a remote URL', () => {
        assert.throws(
            () =>
                normalizeUpstreamImageStreamEvent({
                    type: 'image_generation.completed',
                    url: 'https://example.test/image.png'
                }),
            /b64_json/
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
                    result: 'responses-final'
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
