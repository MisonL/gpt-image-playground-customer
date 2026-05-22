import { collectOpenAiImagesFromStream } from './image-stream-collector';
import { upstreamEvents } from './sse-test-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

describe('collectOpenAiImagesFromStream', () => {
    it('deduplicates repeated final image payloads from Responses streams', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
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
            ])
        );

        assert.equal(result.data?.length, 1);
        assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
    });

    it('keeps separate Responses final items when their base64 payloads match', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_same_payload_a', type: 'image_generation_call', result: PNG_BASE64 }
                },
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_same_payload_b', type: 'image_generation_call', result: PNG_BASE64 }
                }
            ])
        );

        assert.equal(result.data?.length, 2);
        assert.deepEqual(
            result.data?.map((item) => item.b64_json),
            [PNG_BASE64, PNG_BASE64]
        );
    });

    it('deduplicates repeated final image payloads within a single Responses event', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
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
            ])
        );

        assert.equal(result.data?.length, 1);
        assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
    });
});
