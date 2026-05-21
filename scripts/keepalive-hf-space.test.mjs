import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/keepalive-hf-space.mjs');

describe('HF Space keepalive script validation', () => {
    it('rejects non-integer timeout env values before network access', () => {
        const result = runKeepalive({ HF_SPACE_KEEPALIVE_TIMEOUT_MS: '1000abc' });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /HF_SPACE_KEEPALIVE_TIMEOUT_MS/);
        assert.match(result.stderr, /integer/);
        assert.equal(result.stdout.trim(), '');
    });

    it('rejects keepalive URLs with embedded credentials before network access', () => {
        const result = runKeepalive({ HF_SPACE_KEEPALIVE_URL: 'https://user:secret@example-demo.hf.space' });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /HF_SPACE_KEEPALIVE_URL/);
        assert.match(result.stderr, /plain Space origin/);
        assert.doesNotMatch(result.stderr, /secret/);
        assert.equal(result.stdout.trim(), '');
    });
});

function runKeepalive(env) {
    return spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ...env }
    });
}
