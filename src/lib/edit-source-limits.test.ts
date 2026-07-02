import { hasReachedEditSourceImageLimit } from './edit-source-limits';
import { IMAGE_UPSTREAM_PROFILES } from './image-upstream-profile';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('hasReachedEditSourceImageLimit', () => {
    it('uses the active upstream profile upload limit for edit-source entry points', () => {
        assert.equal(
            hasReachedEditSourceImageLimit({
                currentCount: 8,
                maxImages: IMAGE_UPSTREAM_PROFILES.matsca.upload.maxImages
            }),
            true
        );
        assert.equal(
            hasReachedEditSourceImageLimit({
                currentCount: 8,
                maxImages: IMAGE_UPSTREAM_PROFILES['openai-compatible'].upload.maxImages
            }),
            false
        );
    });
});
