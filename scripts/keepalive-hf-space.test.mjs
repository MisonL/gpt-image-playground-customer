import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/keepalive-hf-space.mjs');
const tempDirectories = [];

after(() => {
    for (const directory of tempDirectories) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    }
});

describe('HF Space keepalive script validation', () => {
    it('rejects non-integer timeout env values before network access', () => {
        const result = runKeepalive({ HF_SPACE_KEEPALIVE_TIMEOUT_MS: '1000abc' });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /HF_SPACE_KEEPALIVE_TIMEOUT_MS/);
        assert.match(result.stderr, /integer/);
        assert.equal(result.stdout.trim(), '');
    });

    it('rejects non-integer retry attempt values before network access', () => {
        const result = runKeepalive({ HF_SPACE_KEEPALIVE_MAX_ATTEMPTS: 'two' });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /HF_SPACE_KEEPALIVE_MAX_ATTEMPTS/);
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

    it('retries failed keepalive attempts before reporting success', () => {
        const preloadPath = writeFetchStub(`
            let count = 0;
            globalThis.fetch = async () => {
                count += 1;
                if (count === 1) {
                    return new Response(JSON.stringify({ error: 'warming' }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return new Response(JSON.stringify({ passwordRequired: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            };
        `);
        const result = runKeepalive(
            {
                HF_SPACE_KEEPALIVE_URL: 'https://misonl-gpt-image-playground-customer.hf.space',
                HF_SPACE_KEEPALIVE_PATH: '/api/auth-status',
                HF_SPACE_KEEPALIVE_MAX_ATTEMPTS: '2',
                HF_SPACE_KEEPALIVE_RETRY_DELAY_MS: '1',
                HF_SPACE_KEEPALIVE_TIMEOUT_MS: '1000'
            },
            ['--import', preloadPath]
        );

        assert.equal(result.status, 0);
        assert.match(result.stderr, /"attempt": "1\/2"/);
        assert.match(result.stdout, /"ok": true/);
        assert.match(result.stdout, /"attempt": "2\/2"/);
    });

    it('prints a timeout-specific final error when every attempt aborts', () => {
        const preloadPath = writeFetchStub(`
            globalThis.fetch = async (url, options) =>
                new Promise((resolve, reject) => {
                    options.signal.addEventListener('abort', () => {
                        reject(new DOMException('This operation was aborted', 'AbortError'));
                    });
                });
        `);
        const result = runKeepalive(
            {
                HF_SPACE_KEEPALIVE_MAX_ATTEMPTS: '1',
                HF_SPACE_KEEPALIVE_TIMEOUT_MS: '1000'
            },
            ['--import', preloadPath]
        );

        assert.equal(result.status, 1);
        assert.match(result.stderr, /Keepalive request timed out after 1000ms/);
        assert.doesNotMatch(result.stderr, /This operation was aborted/);
        assert.equal((result.stderr.match(/"ok": false/g) || []).length, 1);
    });
});

function runKeepalive(env, nodeArgs = []) {
    return spawnSync(process.execPath, [...nodeArgs, scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ...env }
    });
}

function writeFetchStub(source) {
    const directory = mkdtempSync(join(tmpdir(), 'hf-keepalive-fetch-'));
    tempDirectories.push(directory);
    const filePath = join(directory, 'fetch-stub.mjs');
    writeFileSync(filePath, source);
    return filePath;
}
