import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/smoke-hf-space-memory.mjs');

describe('HF Space memory smoke script validation', () => {
  it('rejects invalid ready timeout values before Docker access', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, HF_SPACE_SMOKE_READY_TIMEOUT_MS: '45s' }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /HF_SPACE_SMOKE_READY_TIMEOUT_MS/);
    assert.match(result.stderr, /positive integer/);
    assert.equal(result.stdout.trim(), '');
  });
});
