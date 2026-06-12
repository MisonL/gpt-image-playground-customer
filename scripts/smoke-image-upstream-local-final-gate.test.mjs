import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = fileURLToPath(new URL('./smoke-image-upstream-local-final-gate.mjs', import.meta.url));
const LOCAL_GATE_CASE_TIMEOUT_MS = '60000';

describe('local image upstream final gate smoke launcher', () => {
    it('runs all independent upstream cases against the local fixture', () => {
        const result = spawnSync(process.execPath, [scriptPath, '--timeout-ms', LOCAL_GATE_CASE_TIMEOUT_MS], {
            cwd: repoRoot,
            encoding: 'utf8'
        });

        assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
        assert.equal(result.stderr.trim(), '');
        assert.doesNotMatch(result.stdout, /local-fixture-key/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.local_fixture, true);
        assert.equal(report.final_gate_satisfied, true);
        assert.equal(report.independent_targets.configuration_complete, true);
        assert.equal(report.results.length, 6);
        assert.deepEqual(
            report.results.map((item) => item.id),
            [
                'original-images-json',
                'gaoren-images-sse',
                'sub2api-images-sse',
                'sub2api-responses-json',
                'gpt2image-responses-sse',
                'matsca-images-sse'
            ]
        );
        assert.equal(
            report.results.every((item) => item.status === 200),
            true
        );
        assert.equal(
            report.results.every((item) => item.first_b64_length === 92),
            true
        );
    });

    it('prints help without starting the fixture', () => {
        const result = spawnSync(process.execPath, [scriptPath, '--help'], {
            cwd: repoRoot,
            encoding: 'utf8'
        });

        assert.equal(result.status, 0);
        assert.match(result.stdout, /smoke:image-upstream-local/);
        assert.match(result.stdout, /local fixture gate/);
    });

    it('rejects unsafe parent timeout values before starting the fixture', () => {
        const result = spawnSync(process.execPath, [scriptPath, '--timeout-ms', String(Number.MAX_SAFE_INTEGER)], {
            cwd: repoRoot,
            encoding: 'utf8'
        });

        assert.equal(result.status, 1);
        assert.equal(result.stderr.trim(), '');
        const body = JSON.parse(result.stdout);
        assert.equal(body.ok, false);
        assert.match(body.error, /父进程超时会超过安全整数上限/);
    });
});
