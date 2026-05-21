import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';

import { buildAgentDoctorArgs } from './agent-doctor.mjs';
import { fetchJsonWithTimeout, parseJsonPayload, pickFailureOutput, runCommand } from './command-center-utils.mjs';
import { buildAdminCommands, parseGitStatusEntries, readRemoteStatusFromResult } from './status.mjs';
import { assertLocalProbeMatchesMode, buildDockerComposeArgs, buildDockerComposeEnv } from './deploy-local.mjs';
import { buildVerifyPlan } from './verify.mjs';

describe('Command center scripts', () => {
    it('exposes a small stable administrator command set', () => {
        assert.deepEqual(buildAdminCommands(), {
            doctor: 'npm run doctor',
            status: 'npm run status',
            verify: 'npm run verify',
            deploy_local: 'npm run deploy:local',
            deploy_space: 'npm run deploy:space',
            agent_doctor: 'npm run agent:doctor',
            hf_space_doctor: 'npm run doctor:hf-space',
            hf_space_smoke: 'npm run smoke:hf-space'
        });
    });

    it('keeps the full verification gate aligned with repository policy', () => {
        assert.deepEqual(
            buildVerifyPlan().map((step) => step.name),
            ['test', 'lint', 'lint:scripts', 'build', 'diff-check', 'diff-cached-check']
        );
    });

    it('supports a quick verification loop without hiding the full gate', () => {
        assert.deepEqual(
            buildVerifyPlan({ quick: true }).map((step) => step.name),
            ['test:scripts', 'lint:scripts', 'diff-check', 'diff-cached-check']
        );
        assert.deepEqual(
            buildVerifyPlan({ skipBuild: true }).map((step) => step.name),
            ['test', 'lint', 'lint:scripts', 'diff-check', 'diff-cached-check']
        );
    });

    it('can include the live PostgreSQL gate before the final diff check', () => {
        assert.deepEqual(
            buildVerifyPlan({ postgres: true }).map((step) => step.name),
            ['test', 'lint', 'lint:scripts', 'build', 'test:postgres', 'diff-check', 'diff-cached-check']
        );
        assert.deepEqual(
            buildVerifyPlan({ quick: true, postgres: true }).map((step) => step.name),
            ['test:scripts', 'lint:scripts', 'test:postgres', 'diff-check', 'diff-cached-check']
        );
    });

    it('parses NUL-delimited git porcelain paths without rewriting filenames', () => {
        const output = [
            ' M README.md',
            '?? path with spaces.md',
            'R  new name.md',
            'old name.md',
            ' M path -> not rename.md',
            ' M line\nbreak.md',
            ''
        ].join('\0');

        assert.deepEqual(parseGitStatusEntries(output), [
            'README.md',
            'path with spaces.md',
            'new name.md',
            'path -> not rename.md',
            'line\nbreak.md'
        ]);
    });

    it('builds deterministic local deploy compose arguments', () => {
        assert.deepEqual(buildDockerComposeArgs(), ['compose', '-f', 'docker-compose.yml', 'up', '-d', '--build']);
        assert.deepEqual(buildDockerComposeArgs({ memory: true }), [
            'compose',
            '-f',
            'docker-compose.yml',
            '-f',
            'docker-compose.memory.yml',
            'up',
            '-d',
            '--build'
        ]);
    });

    it('uses plain compose progress for diagnosable local deploy output', () => {
        assert.deepEqual(buildDockerComposeEnv({ PATH: '/bin', COMPOSE_PROGRESS: 'auto' }), {
            PATH: '/bin',
            COMPOSE_PROGRESS: 'plain'
        });
    });

    it('fails local memory deploy probes when the overlay did not take effect', () => {
        assert.doesNotThrow(() => assertLocalProbeMatchesMode({ stateBackend: 'sqlite', imageStorageMode: 'fs' }));
        assert.doesNotThrow(() =>
            assertLocalProbeMatchesMode({ stateBackend: 'memory', imageStorageMode: 'indexeddb' }, { memory: true })
        );
        assert.throws(
            () => assertLocalProbeMatchesMode({ stateBackend: 'sqlite', imageStorageMode: 'fs' }, { memory: true }),
            /Memory overlay did not take effect/
        );
    });

    it('routes agent:doctor through the non-billable contract check', () => {
        const args = buildAgentDoctorArgs();
        assert.match(args[0], /generate-image\.mjs$/);
        assert.deepEqual(args.slice(1), ['--contract-check', '--timeout-ms', '60000', 'contract check']);
    });

    it('preserves raw child output for command consumers', () => {
        const result = runCommand(process.execPath, ['-e', 'process.stdout.write(" M README.md\\n")']);

        assert.equal(result.ok, true);
        assert.equal(result.stdout, ' M README.md\n');
    });

    it('parses JSON output after command preamble lines', () => {
        assert.deepEqual(parseJsonPayload('hint\n{"ok":true}', 'example'), { ok: true });
        assert.deepEqual(parseJsonPayload('hint\n{"ok":true}\ntrailing log', 'example'), { ok: true });
        assert.deepEqual(parseJsonPayload('[WARN] not json\n{"ok":true}', 'example'), { ok: true });
        assert.throws(() => parseJsonPayload('hint only', 'example'), /example did not return JSON output/);
        assert.throws(() => parseJsonPayload('hint\n{"ok":', 'example'), /example returned invalid JSON/);
    });

    it('times out local HTTP probes instead of hanging', async () => {
        const server = createServer(() => {});
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        try {
            assert.equal(typeof address, 'object');
            await assert.rejects(
                fetchJsonWithTimeout(`http://127.0.0.1:${address.port}/api/agent/capabilities`, { timeoutMs: 20 }),
                /timed out after 20ms/
            );
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('preserves invalid URL fetch errors while building timeout diagnostics', async () => {
        await assert.rejects(() => fetchJsonWithTimeout('not a url', { timeoutMs: 20 }), /Failed to parse URL|Invalid URL/i);
    });

    it('includes a response snippet when HTTP probes return non-JSON bodies', async () => {
        const server = createServer((request, response) => {
            response.writeHead(200, { 'content-type': 'text/html' });
            response.end('<html>login page</html>');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        try {
            assert.equal(typeof address, 'object');
            await assert.rejects(
                fetchJsonWithTimeout(`http://127.0.0.1:${address.port}/api/agent/capabilities`, { timeoutMs: 1000 }),
                /did not return JSON: <html>login page<\/html>/
            );
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('redacts response snippets from production HTTP probe errors', async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const server = createServer((request, response) => {
            response.writeHead(502, { 'content-type': 'text/plain' });
            response.end('secret upstream body');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        try {
            assert.equal(typeof address, 'object');
            await assert.rejects(
                fetchJsonWithTimeout(`http://127.0.0.1:${address.port}/api/agent/capabilities`, { timeoutMs: 1000 }),
                (error) => {
                    assert.match(error.message, /failed with HTTP 502/);
                    assert.doesNotMatch(error.message, /secret upstream body/);
                    return true;
                }
            );
        } finally {
            if (originalNodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = originalNodeEnv;
            }
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('supports command timeouts for long-running child processes', () => {
        const result = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 20 });

        assert.equal(result.ok, false);
        assert.equal(result.status, null);
        assert.match(result.error, /timed out|ETIMEDOUT|SIGTERM/i);
        assert.match(pickFailureOutput(result), /error:|signal:/);
    });

    it('includes spawn errors in failure summaries without stdout or stderr', () => {
        const summary = pickFailureOutput({ stdout: '', stderr: '', error: 'spawn missing ENOENT', signal: null });

        assert.equal(summary, 'error: spawn missing ENOENT');
    });

    it('includes non-zero exit status in failure summaries', () => {
        const summary = pickFailureOutput({ stdout: '', stderr: 'bad option', status: 129, signal: null });

        assert.equal(summary, 'bad option\nstatus: 129');
    });

    it('keeps local status usable when remote status JSON is malformed', () => {
        assert.deepEqual(readRemoteStatusFromResult({ ok: true, stdout: 'not json' }), {
            ok: false,
            error: 'hf spaces info did not return JSON output.'
        });
    });
});
