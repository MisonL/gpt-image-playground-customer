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
                    item: { type: 'image_generation_call', result: PNG_BASE64 }
                },
                {
                    type: 'response.completed',
                    response: {
                        output: [{ type: 'image_generation_call', result: PNG_BASE64 }]
                    }
                }
            ])
        );

        assert.equal(result.data?.length, 1);
        assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
    });

    it('deduplicates repeated final image payloads within a single Responses event', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
                {
                    type: 'response.completed',
                    data: [{ b64_json: PNG_BASE64 }],
                    response: {
                        output: [{ type: 'image_generation_call', result: PNG_BASE64 }]
                    }
                }
            ])
        );

        assert.equal(result.data?.length, 1);
        assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
    });
});
