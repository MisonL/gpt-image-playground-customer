import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildAgentDoctorArgs } from './agent-doctor.mjs';
import { fetchJsonWithTimeout, parseJsonPayload, pickFailureOutput, runCommand } from './command-center-utils.mjs';
import {
    buildAdminCommands,
    buildImageUpstreamRealSmokeStatus,
    parseGitStatusEntries,
    readStatusEnvFromFiles,
    readRemoteStatusFromResult
} from './status.mjs';
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
            ['version:check', 'test', 'lint', 'lint:scripts', 'build', 'diff-check', 'diff-cached-check']
        );
    });

    it('supports a quick verification loop without hiding the full gate', () => {
        assert.deepEqual(
            buildVerifyPlan({ quick: true }).map((step) => step.name),
            ['version:check', 'test:scripts', 'lint:scripts', 'diff-check', 'diff-cached-check']
        );
        assert.deepEqual(
            buildVerifyPlan({ skipBuild: true }).map((step) => step.name),
            ['version:check', 'test', 'lint', 'lint:scripts', 'diff-check', 'diff-cached-check']
        );
    });

    it('can include the live PostgreSQL gate before the final diff check', () => {
        assert.deepEqual(
            buildVerifyPlan({ postgres: true }).map((step) => step.name),
            [
                'version:check',
                'test',
                'lint',
                'lint:scripts',
                'build',
                'test:postgres',
                'diff-check',
                'diff-cached-check'
            ]
        );
        assert.deepEqual(
            buildVerifyPlan({ quick: true, postgres: true }).map((step) => step.name),
            ['version:check', 'test:scripts', 'lint:scripts', 'test:postgres', 'diff-check', 'diff-cached-check']
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

    it('summarizes independent image upstream smoke readiness without exposing credentials', () => {
        const missing = buildImageUpstreamRealSmokeStatus({});
        assert.equal(missing.configuration_complete, false);
        assert.equal(missing.configured_count, 0);
        assert.deepEqual(missing.missing_cases, [
            'original-images-json',
            'gaoren-images-sse',
            'sub2api-images-sse',
            'sub2api-responses-json',
            'gpt2image-responses-sse'
        ]);
        assert.deepEqual(missing.missing_env_any['sub2api-responses-json'][0], [
            'IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL',
            'IMAGE_REAL_SMOKE_SUB2API_BASE_URL'
        ]);
        assert.equal(
            missing.final_gate_command,
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable'
        );

        const configured = buildImageUpstreamRealSmokeStatus({
            IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://original.example/v1',
            IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'original-secret',
            IMAGE_REAL_SMOKE_GAOREN_BASE_URL: 'https://gaoren.example/v1',
            IMAGE_REAL_SMOKE_GAOREN_API_KEY: 'gaoren-secret',
            IMAGE_REAL_SMOKE_SUB2API_BASE_URL: 'https://sub2api.example/v1',
            IMAGE_REAL_SMOKE_SUB2API_API_KEY: 'sub2api-secret',
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL: 'gpt-4.1',
            IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL: 'https://gpt2image.example/v1',
            IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY: 'gpt2image-secret',
            IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL: 'gpt-5.4'
        });
        assert.equal(configured.configuration_complete, true);
        assert.equal(configured.configured_count, 5);
        assert.equal(configured.missing_count, 0);
        assert.doesNotMatch(JSON.stringify(configured), /secret|example\/v1/);
    });

    it('requires Responses top-level models in image upstream status readiness', () => {
        const status = buildImageUpstreamRealSmokeStatus({
            IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://original.example/v1',
            IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'original-secret',
            IMAGE_REAL_SMOKE_GAOREN_BASE_URL: 'https://gaoren.example/v1',
            IMAGE_REAL_SMOKE_GAOREN_API_KEY: 'gaoren-secret',
            IMAGE_REAL_SMOKE_SUB2API_BASE_URL: 'https://sub2api.example/v1',
            IMAGE_REAL_SMOKE_SUB2API_API_KEY: 'sub2api-secret',
            IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL: 'https://gpt2image.example/v1',
            IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY: 'gpt2image-secret'
        });

        assert.equal(status.configuration_complete, false);
        assert.equal(status.configured_count, 3);
        assert.deepEqual(status.configured_cases, [
            'original-images-json',
            'gaoren-images-sse',
            'sub2api-images-sse'
        ]);
        assert.deepEqual(status.missing_cases, ['sub2api-responses-json', 'gpt2image-responses-sse']);
        assert.deepEqual(status.missing_env_any['sub2api-responses-json'][0], [
            'IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL',
            'OPENAI_RESPONSES_API_MODEL'
        ]);
        assert.deepEqual(status.missing_env_any['gpt2image-responses-sse'][0], [
            'IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL',
            'OPENAI_RESPONSES_API_MODEL'
        ]);
        assert.doesNotMatch(JSON.stringify(status), /secret|example\/v1/);
    });

    it('does not treat the sub2api Responses image model as the Responses top-level model', () => {
        const status = buildImageUpstreamRealSmokeStatus({
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL: 'https://sub2api-responses.example/v1',
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY: 'sub2api-responses-secret',
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_MODEL: 'gpt-image-2'
        });

        assert.equal(status.configuration_complete, false);
        assert.equal(status.configured_count, 0);
        assert.deepEqual(status.missing_cases, [
            'original-images-json',
            'gaoren-images-sse',
            'sub2api-images-sse',
            'sub2api-responses-json',
            'gpt2image-responses-sse'
        ]);
        assert.deepEqual(status.missing_env_any['sub2api-responses-json'][0], [
            'IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL',
            'OPENAI_RESPONSES_API_MODEL'
        ]);
        assert.doesNotMatch(JSON.stringify(status), /sub2api-responses-secret|sub2api-responses\.example/);
    });

    it('reports unsafe independent image upstream base URLs without exposing values', () => {
        const status = buildImageUpstreamRealSmokeStatus({
            IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://user:pass@original.example/v1?token=secret#frag',
            IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'original-secret'
        });

        assert.equal(status.configuration_complete, false);
        assert.equal(status.configured_count, 0);
        assert.equal(status.missing_count, 4);
        assert.equal(status.invalid_count, 1);
        assert.deepEqual(status.invalid_cases, ['original-images-json']);
        assert.deepEqual(status.invalid_env['original-images-json'], [
            {
                key: 'IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL',
                reason: 'must_not_include_credentials'
            }
        ]);
        assert.equal(status.missing_env_any['original-images-json'], undefined);
        assert.doesNotMatch(JSON.stringify(status), /user:pass|original\.example|token=secret|original-secret/);
    });

    it('loads independent image upstream smoke readiness from env files without overriding shell env', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-upstream-status-'));
        const localEnvPath = path.join(tempDir, '.env.local');
        const realSmokeEnvPath = path.join(tempDir, '.env.real-smoke.local');
        await writeFile(
            localEnvPath,
            [
                'IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL=https://local-original.example/v1',
                'IMAGE_REAL_SMOKE_ORIGINAL_API_KEY=local-original-secret',
                'IMAGE_REAL_SMOKE_GAOREN_BASE_URL=https://local-gaoren.example/v1',
                'IMAGE_REAL_SMOKE_GAOREN_API_KEY=local-gaoren-secret'
            ].join('\n')
        );
        await writeFile(
            realSmokeEnvPath,
            [
                'IMAGE_REAL_SMOKE_GAOREN_BASE_URL=https://real-gaoren.example/v1',
                'IMAGE_REAL_SMOKE_GAOREN_API_KEY=real-gaoren-secret',
                'IMAGE_REAL_SMOKE_SUB2API_BASE_URL=https://real-sub2api.example/v1',
                'IMAGE_REAL_SMOKE_SUB2API_API_KEY=real-sub2api-secret',
                'IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL=gpt-4.1',
                'IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL=https://real-gpt2image.example/v1',
                'IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY=real-gpt2image-secret',
                'IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL=gpt-5.4'
            ].join('\n')
        );

        try {
            const statusEnv = readStatusEnvFromFiles(
                {
                    IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'shell-original-secret'
                },
                [
                    { path: localEnvPath, override: false },
                    { path: realSmokeEnvPath, override: true }
                ]
            );
            const status = buildImageUpstreamRealSmokeStatus(statusEnv);

            assert.equal(statusEnv.IMAGE_REAL_SMOKE_ORIGINAL_API_KEY, 'shell-original-secret');
            assert.equal(status.configuration_complete, true);
            assert.deepEqual(status.configured_cases, [
                'original-images-json',
                'gaoren-images-sse',
                'sub2api-images-sse',
                'sub2api-responses-json',
                'gpt2image-responses-sse'
            ]);
            assert.doesNotMatch(JSON.stringify(status), /secret|example\/v1/);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('preserves mismatched env quotes in status env files', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-upstream-status-'));
        const envPath = path.join(tempDir, '.env.local');
        await writeFile(
            envPath,
            [
                'MATCHED_DOUBLE="https://quoted.example/v1"',
                "MATCHED_SINGLE='single-secret'",
                'MATCHED_DOUBLE_SPACES="  kept value  "',
                'MISMATCHED_LEADING="kept-value',
                'MISMATCHED_TRAILING=kept-value"',
                'MISMATCHED_PAIR="kept-value\'',
                'SINGLE_DOUBLE_QUOTE="',
                "SINGLE_SINGLE_QUOTE='"
            ].join('\n')
        );

        try {
            const statusEnv = readStatusEnvFromFiles({}, [{ path: envPath, override: false }]);

            assert.equal(statusEnv.MATCHED_DOUBLE, 'https://quoted.example/v1');
            assert.equal(statusEnv.MATCHED_SINGLE, 'single-secret');
            assert.equal(statusEnv.MATCHED_DOUBLE_SPACES, '  kept value  ');
            assert.equal(statusEnv.MISMATCHED_LEADING, '"kept-value');
            assert.equal(statusEnv.MISMATCHED_TRAILING, 'kept-value"');
            assert.equal(statusEnv.MISMATCHED_PAIR, '"kept-value\'');
            assert.equal(statusEnv.SINGLE_DOUBLE_QUOTE, '"');
            assert.equal(statusEnv.SINGLE_SINGLE_QUOTE, "'");
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
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

    it('reports layered agent:doctor diagnostics without billable smoke by default', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            defaults: { state_backend: 'memory' },
                            storage: { image_storage_mode: 'indexeddb', postgres_configured: false },
                            agent_streaming: {
                                page_sse: { supported: true }
                            },
                            agent_jobs: { supported: true },
                            routing_rules: {
                                high_resolution_edit: {
                                    conditions: { operation: 'edit', max_edge: { operator: 'gt', value: 2048 } }
                                }
                            },
                            supported: {
                                image_backend_requirements: {
                                    'responses-image-generation': {
                                        supported: true,
                                        enabled: true,
                                        missing_env: []
                                    }
                                }
                            }
                        })
                    );
                    return;
                }
                if (request.url === '/api/runtime-capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            streaming: {
                                defaultMode: 'auto',
                                unavailableMarkScope: 'channel+backend+strategy+operation'
                            },
                            streamingBatch: { enabled: true },
                            responsesImageBackend: { enabled: true, mode: 'experimental' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/agent/images/generate') {
                    response.writeHead(400, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            error: {
                                code: 'idempotency_key_required',
                                message: 'missing key',
                                retryable: false
                            }
                        })
                    );
                    return;
                }
                if (request.url === '/api/agent/jobs/images/generate') {
                    response.writeHead(400, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            error: {
                                code: 'idempotency_key_required',
                                message: 'missing key',
                                retryable: false
                            }
                        })
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runNodeCommandAsync(['scripts/agent-doctor.mjs'], {
                    env: { ...process.env, GPT_IMAGE_PLAYGROUND_URL: baseUrl },
                    timeoutMs: 15_000
                });

                assert.equal(result.ok, true);
                const body = parseJsonPayload(result.stdout, 'agent doctor');
                assert.equal(body.ok, true);
                assert.equal(body.billable, false);
                assert.equal(body.summary.capabilities, 'ok');
                assert.equal(body.summary.runtime, 'ok');
                assert.equal(body.summary.state_backend, 'memory');
                assert.equal(body.summary.responses_gpt2image_ready, true);
                assert.equal(body.summary.billable_smoke, 'skipped');
                assert.equal(body.layers.find((layer) => layer.name === 'billable_smoke').skipped, true);
                assert.equal(body.layers.find((layer) => layer.name === 'capabilities').executable_routing_rules, true);
            }
        );
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

async function withServer(handler, run) {
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
        assert.equal(typeof address, 'object');
        assert.ok(address);
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function runNodeCommandAsync(args, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
            cwd: process.cwd(),
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        const startedAt = Date.now();
        const timeout = options.timeoutMs
            ? setTimeout(() => {
                  child.kill('SIGTERM');
              }, options.timeoutMs)
            : undefined;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('close', (status, signal) => {
            if (timeout) clearTimeout(timeout);
            resolve({
                ok: status === 0,
                status,
                signal,
                stdout,
                stderr,
                elapsed_ms: Date.now() - startedAt
            });
        });
    });
}
