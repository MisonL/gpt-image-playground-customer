import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = fileURLToPath(new URL('./smoke-image-upstream-local-final-gate.mjs', import.meta.url));

describe('local image upstream final gate smoke launcher', () => {
    it('runs all independent upstream cases against the local fixture', () => {
        const result = spawnSync(process.execPath, [scriptPath, '--timeout-ms', '30000'], {
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
        assert.equal(report.results.length, 5);
        assert.deepEqual(
            report.results.map((item) => item.id),
            [
                'original-images-json',
                'gaoren-images-sse',
                'sub2api-images-sse',
                'sub2api-responses-json',
                'gpt2image-responses-sse'
            ]
        );
        assert.equal(report.results.every((item) => item.status === 200), true);
        assert.equal(report.results.every((item) => item.first_b64_length === 92), true);
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
});
