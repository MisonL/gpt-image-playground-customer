import { ImageDB } from './db';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('ImageDB schema', () => {
    it('keeps full images and thumbnails in separate stores', () => {
        const imageDb = new ImageDB();

        assert.ok(imageDb.images);
        assert.ok(imageDb.thumbnails);
        assert.equal(imageDb.verno, 2);
    });
});
