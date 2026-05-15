import { readEditQuality, readGenerateQuality } from './image-request-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('image request quality defaults', () => {
    it('defaults image generation to high quality', () => {
        assert.equal(readGenerateQuality(new FormData()), 'high');
    });

    it('keeps image editing quality on auto by default', () => {
        assert.equal(readEditQuality(new FormData()), 'auto');
    });
});
