import { putImageThumbnail } from './image-thumbnail-cache';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('image thumbnail cache', () => {
    it('fails explicitly outside the browser runtime', async () => {
        await assert.rejects(
            () => putImageThumbnail({ filename: 'image.png', blob: new Blob(['not-an-image']) }),
            /browser runtime/
        );
    });
});
