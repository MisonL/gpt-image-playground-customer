import { assertArtifactFilepathAllowed } from './agent-file-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';

describe('assertArtifactFilepathAllowed', () => {
    it('accepts artifact files under the generated image directory', () => {
        assert.doesNotThrow(() => assertArtifactFilepathAllowed(path.resolve('generated-images', 'image.png')));
    });

    it('rejects artifact file paths outside the generated image directory', () => {
        assert.throws(() => assertArtifactFilepathAllowed(path.resolve('outside-file.png')), /目录之外/);
    });

    it('rejects path traversal attempts under the generated image directory', () => {
        assert.throws(() => assertArtifactFilepathAllowed(path.join('generated-images', '..', '..', 'outside-file.png')), /目录之外/);
        assert.throws(() => assertArtifactFilepathAllowed('generated-images/../../../outside-file.png'), /目录之外/);
    });
});
