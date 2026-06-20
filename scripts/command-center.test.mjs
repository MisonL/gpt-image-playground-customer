import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildAgentDoctorArgs, buildAgentDoctorContractArgs } from './agent-doctor.mjs';
import { fetchJsonWithTimeout, parseJsonPayload, pickFailureOutput, runCommand } from './command-center-utils.mjs';
import {
    buildAbsentReport,
    buildSkippedReport,
    hasLegacyFixtureRepoMount,
    parseDockerInspectContainer,
    summarizeDockerMounts
} from './cleanup-docker-fixtures.mjs';
import { buildFirstRunReport, formatFirstRunText } from './first-run.mjs';
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
            first_run: 'npm run first-run',
            doctor: 'npm run doctor',
            status: 'npm run status',
            env_summary: 'npm run env:summary',
            verify: 'npm run verify',
            deploy_local: 'npm run deploy:local',
            deploy_space: 'npm run deploy:space',
            docker_cleanup_fixtures: 'npm run docker:cleanup-fixtures',
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
            'gpt2image-responses-sse',
            'matsca-images-sse'
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
            IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL: 'gpt-5.4',
            IMAGE_REAL_SMOKE_MATSCA_BASE_URL: 'https://matsca.example/v1',
            IMAGE_REAL_SMOKE_MATSCA_API_KEY: 'matsca-secret'
        });
        assert.equal(configured.configuration_complete, true);
        assert.equal(configured.configured_count, 6);
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
            IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY: 'gpt2image-secret',
            IMAGE_REAL_SMOKE_MATSCA_BASE_URL: 'https://matsca.example/v1',
            IMAGE_REAL_SMOKE_MATSCA_API_KEY: 'matsca-secret'
        });

        assert.equal(status.configuration_complete, false);
        assert.equal(status.configured_count, 4);
        assert.deepEqual(status.configured_cases, [
            'original-images-json',
            'gaoren-images-sse',
            'sub2api-images-sse',
            'matsca-images-sse'
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
            'gpt2image-responses-sse',
            'matsca-images-sse'
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
        assert.equal(status.missing_count, 5);
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
                'IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL=gpt-5.4',
                'IMAGE_REAL_SMOKE_MATSCA_BASE_URL=https://real-matsca.example/v1',
                'IMAGE_REAL_SMOKE_MATSCA_API_KEY=real-matsca-secret'
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
                'gpt2image-responses-sse',
                'matsca-images-sse'
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

    it('detects only the legacy fixture whole-repository Docker mount', () => {
        const repoRoot = '/Volumes/Work/code/gpt-image-playground-customer';
        assert.equal(
            hasLegacyFixtureRepoMount(
                [
                    {
                        Type: 'bind',
                        Source: repoRoot,
                        Destination: '/workspace',
                        Mode: 'ro',
                        RW: false
                    }
                ],
                repoRoot
            ),
            true
        );
        assert.equal(
            hasLegacyFixtureRepoMount(
                [
                    {
                        Type: 'bind',
                        Source: `${repoRoot}/generated-images`,
                        Destination: '/app/generated-images',
                        Mode: '',
                        RW: true
                    }
                ],
                repoRoot
            ),
            false
        );
    });

    it('parses and summarizes Docker fixture cleanup inspection data', () => {
        const container = parseDockerInspectContainer(
            JSON.stringify([
                {
                    Mounts: [
                        {
                            Type: 'bind',
                            Source: '/repo',
                            Destination: '/workspace',
                            Mode: 'ro',
                            RW: false
                        }
                    ]
                }
            ])
        );

        assert.deepEqual(summarizeDockerMounts(container.Mounts), [
            {
                type: 'bind',
                source: '/repo',
                destination: '/workspace',
                mode: 'ro',
                writable: false
            }
        ]);
        assert.deepEqual(buildAbsentReport('gipc-local-image-fixture'), {
            ok: true,
            command: 'docker:cleanup-fixtures',
            container: 'gipc-local-image-fixture',
            present: false,
            unsafe_repo_mount: false,
            removed: false
        });
        assert.equal(buildSkippedReport('custom', container.Mounts).removed, false);
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

    it('routes agent:doctor contract check through an explicit base URL', () => {
        const args = buildAgentDoctorContractArgs('https://space.example.test/');
        assert.match(args[0], /generate-image\.mjs$/);
        assert.deepEqual(args.slice(1), [
            '--contract-check',
            '--timeout-ms',
            '60000',
            '--base-url',
            'https://space.example.test/',
            'contract check'
        ]);
    });

    it('reports first-run readiness without exposing secrets', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'first-run-'));
        await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
        await writeFile(path.join(tempDir, 'package-lock.json'), '{}');
        await writeFile(path.join(tempDir, '.env.agent.local'), 'GPT_IMAGE_AGENT_TOKEN=file-secret\n');
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    assert.equal(request.headers.authorization, 'Bearer shell-secret');
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            auth: { schemes: ['bearer'] },
                            defaults: { state_backend: 'memory' },
                            agent_streaming: {
                                page_sse: {
                                    supported: true,
                                    auth: {
                                        required: true,
                                        form_field: 'passwordHash'
                                    }
                                }
                            },
                            supported: { image_backend_requirements: {} }
                        })
                    );
                    return;
                }
                if (request.url === '/api/runtime-capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ streaming: { defaultMode: 'auto' } }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                try {
                    const report = await buildFirstRunReport(
                        {
                            cwd: tempDir,
                            baseUrl,
                            envFiles: ['.env.agent.local'],
                            timeoutMs: 1000
                        },
                        { GPT_IMAGE_AGENT_TOKEN: 'shell-secret' }
                    );

                    assert.equal(report.command, 'first-run');
                    assert.equal(report.billable, false);
                    assert.equal(report.service_base_url, baseUrl);
                    assert.equal(report.service_base_url_source, 'user_provided');
                    assert.equal(report.interactive_confirmation_required, false);
                    assert.deepEqual(report.agent_auth_process, {
                        has_token: true,
                        has_password_hash: false,
                        has_any_auth: true
                    });
                    assert.deepEqual(report.private_agent_env, {
                        exists: true,
                        has_token: true,
                        has_password_hash: false
                    });
                    assert.equal(report.service.ok, true);
                    assert.equal(report.checks.find((check) => check.name === 'agent_auth_available_to_process').ok, true);
                    assert.equal(report.checks.find((check) => check.name === 'page_sse_auth_available_to_process').ok, false);
                    assert.equal(report.checks.find((check) => check.name === 'page_sse_auth_available_to_process').skipped, false);
                    assert.equal(
                        report.checks.find((check) => check.name === 'page_sse_auth_available_to_process')
                            .auth_in_private_env_file,
                        false
                    );
                    assert.equal(report.service.capabilities.page_sse_auth_required, true);
                    assert.equal(report.service.capabilities.page_sse_auth_form_field, 'passwordHash');
                    assert.equal(report.service.capabilities.page_sse_declared_supported, true);
                    assert.equal(report.service.capabilities.page_sse_real_smoke, 'not_run_by_first_run');
                    assert.equal(report.service.capabilities.responses_image_backend_real_smoke, 'not_run_by_first_run');
                    assert.deepEqual(report.service.capabilities.page_sse_real_smoke_status, {
                        state: 'not_run',
                        billable: false,
                        reason: 'first-run is non-billable and does not call /api/images'
                    });
                    assert.deepEqual(report.service.capabilities.responses_image_backend_real_smoke_status, {
                        state: 'not_run',
                        billable: false,
                        reason: 'first-run is non-billable and does not call Responses image generation'
                    });
                    assert.match(formatFirstRunText(report), /页面 SSE：声明支持，实测=未执行真实 smoke/);
                    assert.match(formatFirstRunText(report), /Responses 后端：声明未支持，启用=否，实测=未执行真实 smoke/);
                    assert.equal(
                        report.checks.find((check) => check.name === 'agent_auth_available_to_process')
                            .auth_in_private_env_file,
                        true
                    );
                    assert.doesNotMatch(JSON.stringify(report), /shell-secret|file-secret/);
                    assert.match(JSON.stringify(report.next_actions), /agent:doctor/);
                    assert.match(JSON.stringify(report.next_actions), /GPT_IMAGE_APP_PASSWORD_HASH/);
                    assert.match(JSON.stringify(report.next_actions), /GPT_IMAGE_AGENT_TOKEN/);
                } finally {
                    await rm(tempDir, { recursive: true, force: true });
                }
            }
        );
    });

    it('formats first-run as human-readable text by default', async () => {
        const report = await buildFirstRunReport(
            { cwd: process.cwd(), baseUrl: 'not a url', envFiles: [] },
            { GPT_IMAGE_AGENT_LOAD_ENV_FILE: '0' }
        );
        const text = formatFirstRunText(report);

        assert.match(text, /^首次配置检查：需要处理/m);
        assert.match(text, /服务地址：无效/);
        assert.match(text, /当前进程鉴权：未加载/);
        assert.match(text, /私有 Agent env：不存在/);
        assert.match(text, /下一步：/);
        assert.doesNotMatch(text, /实测=passed/);
        assert.doesNotMatch(text, /^\{/);
    });

    it('preserves path-prefixed service URLs in first-run reports', async () => {
        // This test only checks local URL normalization in the report; .test is reserved and should not resolve.
        const report = await buildFirstRunReport(
            {
                cwd: process.cwd(),
                baseUrl: 'https://space.example.test/proxy/',
                envFiles: [],
                timeoutMs: 5
            },
            {}
        );

        assert.equal(report.service_base_url, 'https://space.example.test/proxy');
    });

    it('prints localized first-run help and option errors', async () => {
        const help = await runNodeCommandAsync(['scripts/first-run.mjs', '--help'], {
            env: process.env,
            timeoutMs: 5_000
        });
        assert.equal(help.ok, true);
        assert.match(help.stdout, /用法：/);
        assert.match(help.stdout, /输出机器可读 JSON/);
        assert.doesNotMatch(help.stdout, /Usage:/);

        const invalid = await runNodeCommandAsync(['scripts/first-run.mjs', '--missing-option'], {
            env: process.env,
            timeoutMs: 5_000
        });
        assert.equal(invalid.ok, false);
        assert.match(invalid.stdout, /"ok": false/);
        assert.match(invalid.stdout, /未知参数：--missing-option/);
    });

    it('keeps first-run local discovery explicit when no URL is provided', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'first-run-default-'));
        try {
            await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));

            const report = await buildFirstRunReport({ cwd: tempDir, envFiles: [], timeoutMs: 20 }, {});

            assert.equal(report.service_base_url_source, 'default_local_probe');
            assert.equal(report.interactive_confirmation_required, true);
            assert.equal(report.ok, false);
            assert.match(JSON.stringify(report.next_actions), /确认探测到的服务地址/);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('points first-run at auth setup when the service rejects capabilities with 401', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'first-run-auth-'));
        await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
        await withServer(
            (_request, response) => {
                response.writeHead(401, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'unauthorized' }));
            },
            async (baseUrl) => {
                try {
                    const report = await buildFirstRunReport(
                        {
                            cwd: tempDir,
                            baseUrl: `${baseUrl}/`,
                            envFiles: [],
                            timeoutMs: 1000
                        },
                        {}
                    );

                    assert.equal(report.service_base_url, baseUrl);
                    assert.equal(report.checks.find((check) => check.name === 'agent_auth_available_to_process').skipped, false);
                    assert.equal(report.checks.find((check) => check.name === 'service_reachable').status, 401);
                    assert.equal('runtime' in report.service, false);
                    assert.match(JSON.stringify(report.next_actions), /GPT_IMAGE_AGENT_TOKEN/);
                    assert.doesNotMatch(JSON.stringify(report.next_actions), /Start the service/);
                } finally {
                    await rm(tempDir, { recursive: true, force: true });
                }
            }
        );
    });

    it('reports layered agent:doctor diagnostics without billable smoke by default', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/proxy/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            defaults: { state_backend: 'memory' },
                            storage: { image_storage_mode: 'indexeddb', postgres_configured: false },
                            agent_streaming: {
                                page_sse: {
                                    supported: true,
                                    auth: { required: true, form_field: 'passwordHash' }
                                }
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
                if (request.url === '/proxy/api/runtime-capabilities') {
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
                if (request.url === '/proxy/api/agent/images/generate') {
                    if (request.headers['idempotency-key']) {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'doctor-generate', filename: 'doctor.png' }] }));
                        return;
                    }
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
                if (request.url === '/proxy/api/agent/jobs/images/generate') {
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
                const prefixedBaseUrl = `${baseUrl}/proxy`;
                const result = await runNodeCommandAsync(['scripts/agent-doctor.mjs'], {
                    env: { ...process.env, GPT_IMAGE_PLAYGROUND_URL: `${prefixedBaseUrl}/` },
                    timeoutMs: 15_000
                });

                assert.equal(result.ok, true);
                const body = parseJsonPayload(result.stdout, 'agent doctor');
                assert.equal(body.ok, true);
                assert.equal(body.billable, false);
                assert.equal(body.summary.capabilities, 'ok');
                assert.equal(body.summary.runtime, 'ok');
                assert.equal(body.summary.state_backend, 'memory');
                assert.equal(body.summary.page_sse_auth_ready, false);
                assert.equal(body.summary.page_sse_declared_supported, true);
                assert.equal(body.summary.page_sse_real_smoke, 'skipped');
                assert.equal(body.summary.responses_page_sse_generate_smoke, 'skipped');
                assert.deepEqual(body.summary.real_smoke_checks, {
                    agent_generate_1k: 'skipped',
                    responses_page_sse_generate_1k: 'skipped',
                    agent_edit_1k: 'skipped',
                    page_sse_edit_2k: 'skipped'
                });
                assert.equal(body.summary.responses_gpt2image_ready, true);
                assert.equal(body.summary.responses_image_backend_declared_supported, true);
                assert.equal(body.summary.billable_smoke, 'skipped');
                assert.equal(body.layers.find((layer) => layer.name === 'billable_smoke').skipped, true);
                assert.ok(
                    body.layers
                        .find((layer) => layer.name === 'billable_smoke')
                        .checks.some((check) => check.name === 'responses_page_sse_generate_1k' && check.skipped === true)
                );
                assert.equal(body.layers.find((layer) => layer.name === 'capabilities').executable_routing_rules, true);
                assert.equal(body.layers.find((layer) => layer.name === 'capabilities').page_sse_declared_supported, true);
                assert.equal(body.layers.find((layer) => layer.name === 'capabilities').page_sse_auth_required, true);
                assert.equal(body.layers.find((layer) => layer.name === 'capabilities').page_sse_auth_ready, false);
                assert.equal(body.layers.find((layer) => layer.name === 'responses_gpt2image_readiness').declared_supported, true);
                assert.match(
                    body.layers.find((layer) => layer.name === 'capabilities').page_sse_auth_next_action,
                    /GPT_IMAGE_APP_PASSWORD_HASH/
                );
                assert.equal(body.service_base_url, prefixedBaseUrl);
                assert.equal(body.service_base_url_source, 'GPT_IMAGE_PLAYGROUND_URL');
                assert.equal(body.interactive_confirmation_required, true);
            }
        );
    });

    it('uses an explicit base URL for agent:doctor billable smoke checks', async () => {
        const hits = [];
        await withServer(
            (request, response) => {
                hits.push(request.url);
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            defaults: { state_backend: 'memory' },
                            storage: { image_storage_mode: 'indexeddb', postgres_configured: false },
                            agent_streaming: { page_sse: { supported: true } },
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
                    if (request.headers['idempotency-key']) {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'doctor-generate', filename: 'doctor.png' }] }));
                    } else {
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
                    }
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"doctor-page-sse.png","path":"/api/image/doctor-page-sse.png","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"doctor-page-sse-request","images":[{"filename":"doctor-page-sse.png"}]}',
                            '',
                            ''
                        ].join('\n')
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
                const result = await runNodeCommandAsync(
                    ['scripts/agent-doctor.mjs', '--base-url', baseUrl, '--allow-billable'],
                    { timeoutMs: 15_000 }
                );

                assert.equal(result.ok, true);
                const body = parseJsonPayload(result.stdout, 'agent doctor');
                assert.equal(body.service_base_url_source, 'user_provided');
                assert.equal(body.interactive_confirmation_required, false);
                assert.equal(body.summary.page_sse_real_smoke, 'passed');
                assert.equal(body.summary.responses_page_sse_generate_smoke, 'passed');
                assert.equal(body.summary.real_smoke_checks.agent_generate_1k, 'passed');
                assert.equal(body.summary.real_smoke_checks.responses_page_sse_generate_1k, 'passed');
                assert.equal(body.summary.real_smoke_checks.agent_edit_1k, 'skipped');
                assert.equal(body.summary.real_smoke_checks.page_sse_edit_2k, 'skipped');
                assert.ok(hits.includes('/api/agent/images/generate'));
                assert.ok(hits.includes('/api/images'));
            }
        );
    });

    it('reports failed agent:doctor page SSE smoke checks without hiding the failure', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            defaults: { state_backend: 'memory' },
                            storage: { image_storage_mode: 'indexeddb', postgres_configured: false },
                            agent_streaming: { page_sse: { supported: true } },
                            agent_jobs: { supported: true },
                            routing_rules: {},
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
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ images: [{ id: 'doctor-generate', filename: 'doctor.png' }] }));
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(503, { 'content-type': 'text/plain' });
                    response.end('503 Service temporarily unavailable');
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
                const result = await runNodeCommandAsync(
                    ['scripts/agent-doctor.mjs', '--base-url', baseUrl, '--allow-billable'],
                    { timeoutMs: 15_000 }
                );

                assert.equal(result.ok, false);
                const body = parseJsonPayload(result.stdout, 'agent doctor');
                assert.equal(body.ok, false);
                assert.equal(body.summary.billable_smoke, 'failed');
                assert.equal(body.summary.page_sse_real_smoke, 'failed');
                assert.equal(body.summary.responses_page_sse_generate_smoke, 'failed');
                assert.equal(body.summary.real_smoke_checks.agent_generate_1k, 'passed');
                assert.equal(body.summary.real_smoke_checks.responses_page_sse_generate_1k, 'failed');
                assert.equal(body.summary.real_smoke_checks.page_sse_edit_2k, 'skipped');
                assert.match(
                    body.layers
                        .find((layer) => layer.name === 'billable_smoke')
                        .checks.find((check) => check.name === 'responses_page_sse_generate_1k').output,
                    /503 Service temporarily unavailable/
                );
            }
        );
    });

    it('prints localized agent:doctor help and option errors', async () => {
        const help = await runNodeCommandAsync(['scripts/agent-doctor.mjs', '--help'], {
            env: process.env,
            timeoutMs: 5_000
        });
        assert.equal(help.ok, true);
        assert.match(help.stdout, /用法：/);
        assert.match(help.stdout, /真实 generate\/edit smoke/);
        assert.doesNotMatch(help.stdout, /Usage:/);

        const invalid = await runNodeCommandAsync(['scripts/agent-doctor.mjs', '--bad-option'], {
            env: process.env,
            timeoutMs: 5_000
        });
        assert.equal(invalid.ok, false);
        assert.match(invalid.stdout, /"ok": false/);
        assert.match(invalid.stdout, /未知参数：--bad-option/);
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
            env: { GPT_IMAGE_AGENT_LOAD_ENV_FILE: '0', ...options.env },
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
