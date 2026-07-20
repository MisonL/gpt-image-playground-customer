import { shouldRecommendImageStreaming } from './image-streaming-recommendation';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('image streaming recommendation', () => {
    it('recommends streaming only for an unstreamed high-quality large auto request', () => {
        assert.equal(
            shouldRecommendImageStreaming({
                streamingStrategy: 'auto',
                quality: 'high',
                width: 3072,
                height: 2048,
                streamEnabled: false
            }),
            true
        );
        assert.equal(
            shouldRecommendImageStreaming({
                streamingStrategy: 'auto',
                quality: 'medium',
                width: 3072,
                height: 2048,
                streamEnabled: false
            }),
            false
        );
    });
});
