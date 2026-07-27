import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/smoke-hf-space-memory.mjs');

describe('HF Space memory smoke script validation', () => {
  it('publishes the temporary container only on the IPv4 loopback interface', () => {
    const source = readFileSync(scriptPath, 'utf8');

    assert.match(source, /`127\.0\.0\.1:\$\{hostPort\}:4783`/);
    assert.doesNotMatch(source, /^\s*`\$\{hostPort\}:4783`,?$/m);
  });

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

  it('rejects out-of-range host ports before Docker access', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, HF_SPACE_SMOKE_PORT: '65536' }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /HF_SPACE_SMOKE_PORT/);
    assert.match(result.stderr, /65535/);
    assert.equal(result.stdout.trim(), '');
  });

  it('reports the underlying spawn error when Docker is unavailable', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: '' }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /docker build/);
    assert.match(result.stderr, /failed to start/);
    assert.match(result.stderr, /ENOENT/);
  });
});
