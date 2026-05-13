import { assertArtifactFilepathAllowed } from './agent-file-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';

describe('assertArtifactFilepathAllowed', () => {
    it('accepts artifact files under the generated image directory', () => {
        assert.doesNotThrow(() => assertArtifactFilepathAllowed(path.join(process.cwd(), 'generated-images', 'image.png')));
    });

    it('rejects artifact file paths outside the generated image directory', () => {
        assert.throws(() => assertArtifactFilepathAllowed('/etc/passwd'), /目录之外/);
    });
});
