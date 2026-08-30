import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/smoke-image-upstream-real.mjs');
const realSmokeOutputDir = join(repoRoot, 'generated-images/.real-smoke');
const pngBase64 = createPngWithDimensions(1024, 1024).toString('base64');
const smokeChildTerminationGraceMs = 5_000;
const smokeProcessTestTimeoutMs = 120_000;

function createPngWithDimensions(width, height) {
    const raw = Buffer.alloc((width + 1) * height, 0x40);
    for (let row = 0; row < height; row += 1) raw[row * (width + 1)] = 0;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    return Buffer.concat([
        Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
        createPngChunk('IHDR', ihdr),
        createPngChunk('IDAT', deflateSync(raw)),
        createPngChunk('IEND', Buffer.alloc(0))
    ]);
}

function createPngChunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBytes, data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, checksum]);
}

function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

describe('image upstream real smoke script', () => {
    it('skips every real upstream target without billable calls when no target env is configured', () => {
        const result = runScript();

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.billable, false);
        assert.equal(report.results.length, 6);
        assert.equal(
            report.results.every((item) => item.skipped === true),
            true
        );
        assert.deepEqual(report.request_modes.passed, []);
        assert.deepEqual(report.request_modes.failed, []);
        assert.deepEqual(report.request_modes.skipped, [
            'images-non-stream',
            'images-sse',
            'responses-non-stream',
            'responses-sse'
        ]);
        assert.deepEqual(report.request_modes.not_selected, []);
        assert.equal(report.suggested_channel_config, '');
        assert.equal(
            report.results.every((item) => item.reason === 'missing base url env'),
            true
        );
        assert.deepEqual(report.results[0].missing_env_any, [['IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL']]);
        assert.deepEqual(report.results[3].missing_env_any, [
            ['IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL', 'IMAGE_REAL_SMOKE_SUB2API_BASE_URL']
        ]);
        assert.deepEqual(report.independent_targets, {
            required_count: 6,
            required_cases: independentSmokeCaseIds(),
            selected_cases: independentSmokeCaseIds(),
            unselected_required_count: 0,
            unselected_required_cases: [],
            configuration_complete: false,
            selected_count: 6,
            configured_count: 0,
            missing_count: 6,
            configured_cases: [],
            missing_cases: independentSmokeCaseIds(),
            invalid_count: 0,
            invalid_cases: [],
            invalid_env: {},
            final_gate_command:
                'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable'
        });
    });

    it('does not run configured real upstreams without explicit billable consent or leak API keys', () => {
        const result = runScript(['--case', 'original-images-json'], {
            IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://example.test/v1',
            IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key'
        });

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        assert.doesNotMatch(result.stdout, /secret-real-smoke-key/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.results.length, 1);
        assert.equal(report.results[0].reason, 'requires --allow-billable');
        assert.equal(report.results[0].upstream_host, 'example.test');
        assert.deepEqual(report.request_modes.skipped, ['images-non-stream']);
        assert.equal(report.suggested_channel_config, '');
        assert.equal('missing_env_any' in report.results[0], false);
        assert.deepEqual(report.independent_targets.required_cases, independentSmokeCaseIds());
        assert.deepEqual(report.independent_targets.selected_cases, ['original-images-json']);
        assert.deepEqual(report.independent_targets.unselected_required_cases, [
            'gaoren-images-sse',
            'sub2api-images-sse',
            'sub2api-responses-json',
            'gpt2image-responses-sse',
            'matsca-images-sse'
        ]);
        assert.equal(report.independent_targets.configuration_complete, false);
        assert.deepEqual(report.independent_targets.configured_cases, ['original-images-json']);
        assert.deepEqual(report.independent_targets.missing_cases, []);
    });

    it('accepts request-mode aliases as smoke case selectors', () => {
        const result = runScript(['--case', 'responses-json'], {
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL: 'https://example.test/v1',
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY: 'secret-real-smoke-key'
        });

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        const report = JSON.parse(result.stdout);
        assert.equal(report.results.length, 1);
        assert.deepEqual(
            report.results.map((item) => item.id),
            ['sub2api-responses-json']
        );
        assert.deepEqual(
            report.results.map((item) => item.request_mode),
            ['responses-non-stream']
        );
        assert.deepEqual(report.request_modes.skipped, ['responses-non-stream']);
        assert.deepEqual(report.request_modes.not_selected, ['images-non-stream', 'images-sse', 'responses-sse']);
    });

    it('loads independent real upstream targets from an explicit env file without leaking API keys', () => {
        const envFilePath = uniqueSmokeEnvPath('real-smoke-test');
        try {
            writeEnvFile(
                envFilePath,
                [
                    'IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL=https://env-file.example/v1',
                    'IMAGE_REAL_SMOKE_ORIGINAL_API_KEY=secret-env-file-key'
                ].join('\n')
            );
            const result = runScript(['--env-file', envFilePath, '--case', 'original-images-json']);

            assert.equal(result.status, 0);
            assert.equal(result.stderr.trim(), '');
            assert.doesNotMatch(result.stdout, /secret-env-file-key/);
            const report = JSON.parse(result.stdout);
            assert.equal(report.results[0].reason, 'requires --allow-billable');
            assert.equal(report.results[0].upstream_host, 'env-file.example');
        } finally {
            rmSync(envFilePath, { force: true });
        }
    });

    it('keeps shell environment values ahead of explicit env file values', () => {
        const envFilePath = uniqueSmokeEnvPath('real-smoke-test');
        try {
            writeEnvFile(
                envFilePath,
                [
                    'IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL=https://env-file.example/v1',
                    'IMAGE_REAL_SMOKE_ORIGINAL_API_KEY=secret-env-file-key'
                ].join('\n')
            );
            const result = runScript(['--env-file', envFilePath, '--case', 'original-images-json'], {
                IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://shell.example/v1',
                IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-shell-key'
            });

            assert.equal(result.status, 0);
            assert.doesNotMatch(result.stdout, /secret-env-file-key|secret-shell-key/);
            const report = JSON.parse(result.stdout);
            assert.equal(report.results[0].upstream_host, 'shell.example');
        } finally {
            rmSync(envFilePath, { force: true });
        }
    });

    it('reports the missing API key env when a real upstream base URL is configured alone', () => {
        const result = runScript(['--case', 'gaoren-images-sse'], {
            IMAGE_REAL_SMOKE_GAOREN_BASE_URL: 'https://gaoren.example/v1'
        });

        assert.equal(result.status, 0);
        const report = JSON.parse(result.stdout);
        assert.equal(report.results[0].reason, 'missing api key env');
        assert.deepEqual(report.results[0].missing_env_any, [['IMAGE_REAL_SMOKE_GAOREN_API_KEY']]);
    });

    it('reports unsafe real upstream base URLs in the structured readiness summary', () => {
        const result = runScript(['--case', 'original-images-json'], {
            IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://user:pass@example.test/v1?token=secret#frag',
            IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key'
        });

        assert.equal(result.status, 1);
        assert.equal(result.stderr.trim(), '');
        assert.doesNotMatch(result.stdout, /user:pass|example\.test|secret-real-smoke-key|token=secret/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, false);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.independent_targets.configuration_complete, false);
        assert.equal(report.independent_targets.configured_count, 0);
        assert.equal(report.independent_targets.invalid_count, 1);
        assert.deepEqual(report.independent_targets.invalid_cases, ['original-images-json']);
        assert.deepEqual(report.independent_targets.invalid_env['original-images-json'], [
            {
                key: 'IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL',
                reason: 'must_not_include_credentials'
            }
        ]);
        assert.deepEqual(report.results[0].invalid_env, [
            {
                key: 'IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL',
                reason: 'must_not_include_credentials'
            }
        ]);
    });

    it(
        'does not make billable upstream calls when any selected target has unsafe configuration',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--require-independent-targets'],
                    {
                        ...buildAllIndependentTargetEnv(upstream.baseUrl),
                        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://user:pass@example.test/v1?token=secret#frag'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 1);
                assert.doesNotMatch(result.stdout, /user:pass|example\.test|secret-independent-key|token=secret/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.ok, false);
                assert.deepEqual(report.invalid_required_cases, ['original-images-json']);
                assert.deepEqual(report.blocked_required_cases, [
                    'gaoren-images-sse',
                    'sub2api-images-sse',
                    'sub2api-responses-json',
                    'gpt2image-responses-sse',
                    'matsca-images-sse'
                ]);
                assert.equal(upstream.calls.length, 0);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'reports blocked cases at the top level for non-final-gate billable smoke runs',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable'],
                    {
                        ...buildAllIndependentTargetEnv(upstream.baseUrl),
                        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://user:pass@example.test/v1?token=secret#frag'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 1);
                const report = JSON.parse(result.stdout);
                assert.deepEqual(report.blocked_cases, [
                    'gaoren-images-sse',
                    'sub2api-images-sse',
                    'sub2api-responses-json',
                    'gpt2image-responses-sse',
                    'matsca-images-sse'
                ]);
                assert.equal(upstream.calls.length, 0);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'does not make billable upstream calls when the required independent gate is missing target config',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--require-independent-targets'],
                    {
                        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: upstream.baseUrl,
                        IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 1);
                assert.doesNotMatch(result.stdout, /secret-real-smoke-key/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.ok, false);
                assert.deepEqual(report.blocked_required_cases, ['original-images-json']);
                assert.deepEqual(report.skipped_required_cases, [
                    'gaoren-images-sse',
                    'sub2api-images-sse',
                    'sub2api-responses-json',
                    'gpt2image-responses-sse',
                    'matsca-images-sse'
                ]);
                assert.equal(upstream.calls.length, 0);
            } finally {
                await upstream.close();
            }
        }
    );

    it('fails the run when independent upstream targets are required but skipped', () => {
        const result = runScript(['--require-independent-targets']);

        assert.equal(result.status, 1);
        assert.equal(result.stderr.trim(), '');
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, false);
        assert.equal(report.final_gate_satisfied, false);
        assert.deepEqual(report.skipped_required_cases, [
            'original-images-json',
            'gaoren-images-sse',
            'sub2api-images-sse',
            'sub2api-responses-json',
            'gpt2image-responses-sse',
            'matsca-images-sse'
        ]);
        assert.equal('unselected_required_cases' in report, false);
        assert.equal(report.missing_required_count, 6);
        assert.deepEqual(report.missing_required_cases, independentSmokeCaseIds());
    });

    it('fails the required independent upstream gate when billable consent is missing', () => {
        const result = runScript(['--require-independent-targets', '--case', 'original-images-json'], {
            IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://example.test/v1',
            IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key'
        });

        assert.equal(result.status, 1);
        assert.doesNotMatch(result.stdout, /secret-real-smoke-key/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, false);
        assert.equal(report.final_gate_satisfied, false);
        assert.deepEqual(report.skipped_required_cases, ['original-images-json']);
        assert.deepEqual(report.unselected_required_cases, [
            'gaoren-images-sse',
            'sub2api-images-sse',
            'sub2api-responses-json',
            'gpt2image-responses-sse',
            'matsca-images-sse'
        ]);
        assert.equal(report.missing_required_count, 6);
        assert.deepEqual(report.missing_required_cases, independentSmokeCaseIds());
        assert.equal(report.results[0].reason, 'requires --allow-billable');
    });

    it('can include current server channel smoke cases without explicit billable consent or leaking keys', () => {
        const result = runScript(['--include-server-channel', '--case', 'server-channel-agent-images-sse'], {
            OPENAI_CHANNEL_1_BASE_URL: 'https://server-channel.example/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key'
        });

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        assert.doesNotMatch(result.stdout, /secret-server-channel-key/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.results.length, 1);
        assert.equal(report.results[0].reason, 'requires --allow-billable');
        assert.equal(report.results[0].server_channel, true);
        assert.equal(report.results[0].upstream_host, 'server-channel.example');
        assert.equal('independent_targets' in report, false);
    });

    it('fails the required independent upstream gate when only server channel cases are selected', () => {
        const result = runScript(
            ['--include-server-channel', '--require-independent-targets', '--case', 'server-channel-agent-images-sse'],
            {
                OPENAI_CHANNEL_1_BASE_URL: 'https://server-channel.example/v1',
                OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key'
            }
        );

        assert.equal(result.status, 1);
        assert.equal(result.stderr.trim(), '');
        assert.doesNotMatch(result.stdout, /secret-server-channel-key/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, false);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.independent_targets.required_count, 6);
        assert.deepEqual(report.independent_targets.selected_cases, []);
        assert.equal(report.independent_targets.unselected_required_count, 6);
        assert.deepEqual(report.independent_targets.unselected_required_cases, independentSmokeCaseIds());
        assert.deepEqual(report.unselected_required_cases, independentSmokeCaseIds());
        assert.equal(report.missing_required_count, 6);
        assert.deepEqual(report.missing_required_cases, independentSmokeCaseIds());
        assert.equal('skipped_required_cases' in report, false);
    });

    it('can dry-run the current server channel Agent Responses SSE smoke case without leaking keys', () => {
        const result = runScript(['--include-server-channel', '--case', 'server-channel-agent-responses-sse'], {
            OPENAI_CHANNEL_1_BASE_URL: 'https://server-channel.example/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key',
            IMAGE_REAL_SMOKE_SERVER_RESPONSES_MODEL: 'gpt-4.1'
        });

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        assert.doesNotMatch(result.stdout, /secret-server-channel-key/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.results.length, 1);
        assert.equal(report.results[0].reason, 'requires --allow-billable');
        assert.equal(report.results[0].server_channel, true);
        assert.equal(report.results[0].upstream_host, 'server-channel.example');
    });

    it('can dry-run the current server channel Responses JSON smoke case without leaking keys', () => {
        const result = runScript(['--include-server-channel', '--case', 'server-channel-responses-json'], {
            OPENAI_CHANNEL_1_BASE_URL: 'https://server-channel.example/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key',
            IMAGE_REAL_SMOKE_SERVER_RESPONSES_MODEL: 'gpt-4.1'
        });

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        assert.doesNotMatch(result.stdout, /secret-server-channel-key/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.results.length, 1);
        assert.equal(report.results[0].reason, 'requires --allow-billable');
        assert.equal(report.results[0].server_channel, true);
        assert.equal(report.results[0].upstream_host, 'server-channel.example');
    });

    it('requires an explicit Responses top-level model for Responses smoke readiness', () => {
        const result = runScript(['--case', 'sub2api-responses-json'], {
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL: 'https://responses.example/v1',
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY: 'secret-responses-key'
        });

        assert.equal(result.status, 0);
        assert.doesNotMatch(result.stdout, /secret-responses-key|responses\.example/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.results[0].reason, 'missing responses model env');
        assert.deepEqual(report.results[0].missing_env_any, [
            ['IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL', 'OPENAI_RESPONSES_API_MODEL']
        ]);
        assert.equal(report.independent_targets.configuration_complete, false);
        assert.deepEqual(report.independent_targets.missing_cases, ['sub2api-responses-json']);
    });

    it('does not treat the sub2api Responses image model env as readiness for the Responses top-level model', () => {
        const result = runScript(['--case', 'sub2api-responses-json'], {
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL: 'https://responses.example/v1',
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY: 'secret-responses-key',
            IMAGE_REAL_SMOKE_SUB2API_RESPONSES_MODEL: 'gpt-image-2'
        });

        assert.equal(result.status, 0);
        assert.doesNotMatch(result.stdout, /secret-responses-key|responses\.example/);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.results[0].reason, 'missing responses model env');
        assert.deepEqual(report.results[0].missing_env_any, [
            ['IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL', 'OPENAI_RESPONSES_API_MODEL']
        ]);
        assert.equal(report.independent_targets.configuration_complete, false);
        assert.deepEqual(report.independent_targets.missing_cases, ['sub2api-responses-json']);
    });

    it(
        'passes APP_PASSWORD auth to in-process page route billable smoke runs',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--case', 'original-images-json'],
                    {
                        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: upstream.baseUrl,
                        IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key',
                        APP_PASSWORD: 'page-access-code'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-real-smoke-key|page-access-code/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.results[0].status, 200);
                assert.equal(report.results[0].image_count, 1);
                assert.deepEqual(upstream.calls, ['/v1/images/generations']);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'pins page route smoke backend and strategy against global route defaults',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--case', 'original-images-json'],
                    {
                        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: upstream.baseUrl,
                        IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key',
                        IMAGE_GENERATION_BACKEND: 'responses-image-generation',
                        IMAGE_STREAMING_STRATEGY: 'force-sse',
                        ENABLE_RESPONSES_IMAGE_BACKEND: 'true',
                        OPENAI_RESPONSES_API_MODEL: 'gpt-4.1-env'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-real-smoke-key|gpt-4\.1-env/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.results[0].status, 200);
                assert.equal(report.results[0].content_type, 'application/json');
                assert.equal(report.results[0].image_count, 1);
                assert.deepEqual(upstream.calls, ['/v1/images/generations']);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'trims APP_PASSWORD before hashing page route billable smoke auth',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--case', 'original-images-json'],
                    {
                        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: upstream.baseUrl,
                        IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key',
                        APP_PASSWORD: '  page-access-code  '
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-real-smoke-key|page-access-code/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.results[0].status, 200);
                assert.equal(report.results[0].image_count, 1);
                assert.deepEqual(upstream.calls, ['/v1/images/generations']);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'passes AGENT_API_TOKEN auth to in-process Agent route billable smoke runs',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--include-server-channel', '--allow-billable', '--case', 'server-channel-agent-images-sse'],
                    {
                        OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
                        OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key',
                        OPENAI_CHANNEL_1_REQUEST_MODES: 'images-sse',
                        IMAGE_REAL_SMOKE_SERVER_TRANSPORT: 'in-process',
                        AGENT_API_TOKEN: 'secret-agent-token'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-server-channel-key|secret-agent-token/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.results[0].status, 200);
                assert.equal(report.results[0].image_count, 1);
                assert.equal(report.results[0].selected_channel_id, 'channel-1');
                assert.equal(report.results[0].upstream_host, new URL(upstream.baseUrl).host);
                assert.equal(report.results[0].channel_request_mode, 'images-sse');
                assert.deepEqual(upstream.calls, ['/v1/images/generations']);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'passes APP_PASSWORD auth to in-process Agent route billable smoke runs when no Agent token is configured',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--include-server-channel', '--allow-billable', '--case', 'server-channel-agent-images-sse'],
                    {
                        OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
                        OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key',
                        OPENAI_CHANNEL_1_REQUEST_MODES: 'images-sse',
                        IMAGE_REAL_SMOKE_SERVER_TRANSPORT: 'in-process',
                        APP_PASSWORD: 'page-access-code'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-server-channel-key|page-access-code/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.results[0].status, 200);
                assert.equal(report.results[0].image_count, 1);
                assert.equal(report.results[0].selected_channel_id, 'channel-1');
                assert.equal(report.results[0].upstream_host, new URL(upstream.baseUrl).host);
                assert.equal(report.results[0].channel_request_mode, 'images-sse');
                assert.deepEqual(upstream.calls, ['/v1/images/generations']);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'removes generated .real-smoke artifact files after billable local Agent smoke runs',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImagesSseUpstream();
            const before = listRealSmokeFiles();
            let after = before;
            try {
                const result = await runScriptAsync(
                    ['--include-server-channel', '--allow-billable', '--case', 'server-channel-agent-images-sse'],
                    {
                        OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
                        OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key',
                        OPENAI_CHANNEL_1_REQUEST_MODES: 'images-sse',
                        IMAGE_REAL_SMOKE_SERVER_TRANSPORT: 'in-process'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-server-channel-key/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.ok, true);
                assert.equal(report.final_gate_satisfied, false);
                assert.equal(report.results[0].image_count, 1);
                assert.equal(report.results[0].selected_channel_id, 'channel-1');
                assert.equal(report.results[0].upstream_host, new URL(upstream.baseUrl).host);
                assert.equal(report.results[0].channel_request_mode, 'images-sse');
                after = listRealSmokeFiles();
                assert.deepEqual(diffFiles(before, after), []);
            } finally {
                for (const file of diffFiles(before, after)) {
                    rmSync(join(realSmokeOutputDir, file), { force: true });
                }
                await upstream.close();
            }
        }
    );

    it(
        'runs the current server channel Responses JSON smoke case against a local upstream',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalResponsesJsonUpstream();
            try {
                const result = await runScriptAsync(
                    ['--include-server-channel', '--allow-billable', '--case', 'server-channel-responses-json'],
                    {
                        OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
                        OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key',
                        OPENAI_CHANNEL_1_REQUEST_MODES: 'responses-non-stream',
                        IMAGE_REAL_SMOKE_SERVER_TRANSPORT: 'in-process',
                        IMAGE_REAL_SMOKE_SERVER_RESPONSES_MODEL: 'gpt-5.4'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-server-channel-key/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.ok, true);
                assert.equal(report.final_gate_satisfied, false);
                assert.equal(report.results[0].status, 200);
                assert.equal(report.results[0].image_count, 1);
                assert.equal(report.results[0].first_b64_length, pngBase64.length);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'marks the final gate satisfied only after every independent target runs successfully',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalImageAndResponsesUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--require-independent-targets'],
                    buildAllIndependentTargetEnv(upstream.baseUrl),
                    { signal: t.signal }
                );

                assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-independent-key/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.ok, true);
                assert.equal(report.final_gate_satisfied, true);
                assert.deepEqual(report.request_modes.passed, [
                    'images-non-stream',
                    'images-sse',
                    'responses-non-stream',
                    'responses-sse'
                ]);
                assert.deepEqual(report.request_modes.failed, []);
                assert.equal(
                    report.suggested_channel_config,
                    'images-non-stream,images-sse,responses-non-stream,responses-sse'
                );
                assert.equal(report.independent_targets.configuration_complete, true);
                assert.equal(report.independent_targets.configured_count, 6);
                assert.equal(report.results.length, 6);
                assert.equal(
                    report.results.every((item) => item.ok === true && item.skipped !== true),
                    true
                );
                assert.equal('missing_required_cases' in report, false);
            } finally {
                await upstream.close();
            }
        }
    );

    it(
        'fails the final gate when a page SSE smoke case returns a stream error event',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const successUpstream = await startLocalImageAndResponsesUpstream();
            const failingSseUpstream = await startLocalFailingImagesSseUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--require-independent-targets'],
                    {
                        ...buildAllIndependentTargetEnv(successUpstream.baseUrl),
                        IMAGE_REAL_SMOKE_GAOREN_BASE_URL: failingSseUpstream.baseUrl,
                        IMAGE_REAL_SMOKE_GAOREN_API_KEY: 'secret-independent-key-gaoren'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-independent-key/);
                const report = JSON.parse(result.stdout);
                const failedCase = report.results.find((item) => item.id === 'gaoren-images-sse');

                assert.equal(report.ok, false);
                assert.equal(report.final_gate_satisfied, false);
                assert.deepEqual(report.request_modes.failed, ['images-sse']);
                assert.equal(report.suggested_channel_config, 'images-non-stream,responses-non-stream,responses-sse');
                assert.equal(failedCase?.ok, false);
                assert.equal(failedCase?.status, 200);
                assert.equal(failedCase?.done_image_count, 0);
                assert.match(failedCase?.error || '', /b64_json|最终图片/);
                assert.equal(successUpstream.calls.length, 5);
            } finally {
                await successUpstream.close();
                await failingSseUpstream.close();
            }
        }
    );

    it(
        'exits after its own timeout when a billable upstream never responds',
        { timeout: smokeProcessTestTimeoutMs },
        async (t) => {
            const upstream = await startLocalHangingImageUpstream();
            try {
                const result = await runScriptAsync(
                    ['--allow-billable', '--case', 'original-images-json', '--timeout-ms', '1000'],
                    {
                        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: upstream.baseUrl,
                        IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-real-smoke-key'
                    },
                    { signal: t.signal }
                );

                assert.equal(result.signal, null, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.equal(result.killedByTest, false, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
                assert.doesNotMatch(result.stdout, /secret-real-smoke-key/);
                const report = JSON.parse(result.stdout);
                assert.equal(report.ok, false);
                assert.equal(report.final_gate_satisfied, false);
                assert.equal(report.results[0].timed_out, true);
                assert.equal(report.results[0].ok, false);
                assert.match(report.results[0].error, /timed out after 1000ms/);
            } finally {
                await upstream.close();
            }
        }
    );

    it('rejects invalid timeout values before running smoke cases', () => {
        const result = runScript(['--timeout-ms', '999']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /--timeout-ms 必须是不小于 1000 的整数毫秒/);
    });

    it('rejects missing env file values before running smoke cases', () => {
        const result = runScript(['--env-file']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /--env-file 缺少参数值/);
    });

    it('lets the npm smoke script pass --env-file through to the smoke script', () => {
        const missingEnvFilePath = uniqueSmokeEnvPath('missing-real-smoke');
        rmSync(missingEnvFilePath, { force: true });

        const result = spawnSync('npm', ['run', 'smoke:image-upstream-real', '--', '--env-file', missingEnvFilePath], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: buildScriptEnv()
        });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /--env-file 指定的文件不存在/);
        assert.doesNotMatch(result.stderr, /node: .*not found/);
        assert.doesNotMatch(result.stderr, /ModuleJob\.run|Node\.js v|at loadEnvFile/);
    });

    it('lets the npm final gate report readiness when the optional env file is absent', () => {
        const missingEnvFilePath = uniqueSmokeEnvPath('missing-real-smoke');
        rmSync(missingEnvFilePath, { force: true });

        const result = spawnSync(
            'npm',
            [
                'run',
                'smoke:image-upstream-real',
                '--',
                '--env-file-if-exists',
                missingEnvFilePath,
                '--require-independent-targets',
                '--allow-billable'
            ],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                env: buildScriptEnv()
            }
        );

        assert.equal(result.status, 1);
        assert.doesNotMatch(result.stderr, /--env-file 指定的文件不存在/);
        const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
        assert.equal(report.independent_targets.configuration_complete, false);
        assert.equal(report.missing_required_count, 6);
        assert.deepEqual(report.missing_required_cases, independentSmokeCaseIds());
    });

    it('fails explicitly for unknown real upstream smoke cases', () => {
        const result = runScript(['--case', 'missing-case']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /未知真实 smoke 场景：missing-case/);
    });

    it('lists every independent real upstream smoke target in help output', () => {
        const result = runScript(['--help']);

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        assert.match(result.stdout, /--env-file <path>/);
        assert.match(result.stdout, /--env-file-if-exists <path>/);
        for (const prefix of independentSmokePrefixes()) {
            assert.match(result.stdout, new RegExp(`${prefix}_BASE_URL / ${prefix}_API_KEY`));
        }
    });

    it('documents every independent real upstream smoke target in env templates without secrets', () => {
        const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8');
        const realSmokeEnvExample = readFileSync(join(repoRoot, '.env.real-smoke.example'), 'utf8');
        const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');

        for (const prefix of independentSmokePrefixes()) {
            assert.match(envExample, new RegExp(`# ${prefix}_BASE_URL=`));
            assert.match(envExample, new RegExp(`# ${prefix}_API_KEY=$`, 'm'));
            assert.match(realSmokeEnvExample, new RegExp(`${prefix}_BASE_URL=`));
            assert.match(realSmokeEnvExample, new RegExp(`${prefix}_API_KEY=$`, 'm'));
        }
        assert.match(envExample, /# IMAGE_REAL_SMOKE_TIMEOUT_MS=240000/);
        assert.match(realSmokeEnvExample, /^IMAGE_REAL_SMOKE_TIMEOUT_MS=240000$/m);
        assert.match(gitignore, /^!.env\.real-smoke\.example$/m);
    });
});

function independentSmokePrefixes() {
    return [
        'IMAGE_REAL_SMOKE_ORIGINAL',
        'IMAGE_REAL_SMOKE_GAOREN',
        'IMAGE_REAL_SMOKE_SUB2API',
        'IMAGE_REAL_SMOKE_SUB2API_RESPONSES',
        'IMAGE_REAL_SMOKE_GPT2IMAGE',
        'IMAGE_REAL_SMOKE_MATSCA'
    ];
}

function independentSmokeCaseIds() {
    return [
        'original-images-json',
        'gaoren-images-sse',
        'sub2api-images-sse',
        'sub2api-responses-json',
        'gpt2image-responses-sse',
        'matsca-images-sse'
    ];
}

function buildAllIndependentTargetEnv(baseUrl) {
    return {
        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-independent-key-original',
        IMAGE_REAL_SMOKE_GAOREN_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_GAOREN_API_KEY: 'secret-independent-key-gaoren',
        IMAGE_REAL_SMOKE_SUB2API_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_SUB2API_API_KEY: 'secret-independent-key-sub2api',
        IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY: 'secret-independent-key-sub2api-responses',
        IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL: 'gpt-4.1',
        IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY: 'secret-independent-key-gpt2image',
        IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL: 'gpt-5.4',
        IMAGE_REAL_SMOKE_MATSCA_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_MATSCA_API_KEY: 'secret-independent-key-matsca'
    };
}

function runScript(args = [], env = {}) {
    return spawnSync(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: buildScriptEnv(env)
    });
}

function runScriptAsync(args = [], env = {}, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
            cwd: repoRoot,
            env: buildScriptEnv(env),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const startedAt = Date.now();
        let stdout = '';
        let stderr = '';
        let killedByTest = false;
        let terminationRequested = false;
        let forceKillTimer;
        const terminateChild = () => {
            if (terminationRequested || child.exitCode !== null || child.signalCode !== null) return;

            terminationRequested = true;
            killedByTest = true;
            if (child.kill('SIGTERM')) {
                forceKillTimer = setTimeout(() => {
                    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                }, smokeChildTerminationGraceMs);
            }
        };
        const abortListener = () => terminateChild();
        const abortSignal = options.signal;
        if (abortSignal) {
            if (abortSignal.aborted) abortListener();
            else abortSignal.addEventListener('abort', abortListener, { once: true });
        }
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('close', (status, signal) => {
            if (abortSignal) abortSignal.removeEventListener('abort', abortListener);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            resolve({ status, signal, stdout, stderr, killedByTest, elapsedMs: Date.now() - startedAt });
        });
    });
}

function listRealSmokeFiles() {
    try {
        return readdirSync(realSmokeOutputDir)
            .filter((item) => item.endsWith('.png') || item.endsWith('.jpeg'))
            .sort();
    } catch {
        return [];
    }
}

function diffFiles(before, after) {
    const beforeSet = new Set(before);
    return after.filter((file) => !beforeSet.has(file));
}

function writeEnvFile(filepath, content) {
    rmSync(filepath, { force: true });
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, `${content}\n`, 'utf8');
}

function uniqueSmokeEnvPath(prefix) {
    return join(repoRoot, 'generated-images', `.${prefix}-${process.pid}-${crypto.randomUUID()}.env`);
}

function buildScriptEnv(env = {}) {
    const scriptEnv = { ...process.env };
    for (const key of Object.keys(scriptEnv)) {
        if (isSmokeEnvKey(key) || key.startsWith('NODE_TEST_') || key === 'NODE_OPTIONS') delete scriptEnv[key];
    }
    return {
        ...scriptEnv,
        ...env,
        NODE_ENV: env.NODE_ENV || 'development',
        IMAGE_REAL_SMOKE_SKIP_DOTENV: '1'
    };
}

function isSmokeEnvKey(key) {
    return (
        key.startsWith('IMAGE_REAL_SMOKE_') ||
        key.startsWith('OPENAI_CHANNEL_') ||
        key === 'OPENAI_API_BASE_URL' ||
        key === 'OPENAI_API_KEY' ||
        key === 'OPENAI_UPSTREAM_PROXY_URL' ||
        key === 'OPENAI_RESPONSES_API_MODEL' ||
        key === 'OPENAI_ROUTING_STRATEGY' ||
        key === 'OPENAI_CHANNELS_JSON' ||
        key === 'IMAGE_GENERATION_BACKEND' ||
        key === 'IMAGE_STREAMING_STRATEGY' ||
        key === 'ENABLE_RESPONSES_IMAGE_BACKEND' ||
        key === 'IMAGE_OUTPUT_DIR' ||
        key === 'APP_PASSWORD' ||
        key === 'AGENT_API_TOKEN'
    );
}

async function startLocalImagesSseUpstream() {
    const server = createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/images/generations')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        request.resume();
        await new Promise((resolve) => request.on('end', resolve));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
            `event: image_generation.completed\ndata: ${JSON.stringify({ type: 'image_generation.completed', b64_json: pngBase64 })}\n\n`
        );
        response.write('data: [DONE]\n\n');
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

async function startLocalFailingImagesSseUpstream() {
    const server = createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/images/generations')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        request.resume();
        await new Promise((resolve) => request.on('end', resolve));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
            `event: image_generation.completed\ndata: ${JSON.stringify({ type: 'image_generation.completed' })}\n\n`
        );
        response.write('data: [DONE]\n\n');
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

async function startLocalHangingImageUpstream() {
    const sockets = new Set();
    const server = createServer(async (request) => {
        if (request.method === 'POST' && request.url?.endsWith('/images/generations')) {
            request.resume();
            return;
        }
        request.resume();
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () =>
            new Promise((resolve, reject) => {
                for (const socket of sockets) socket.destroy();
                server.close((error) => (error ? reject(error) : resolve()));
            })
    };
}

async function startLocalImageAndResponsesUpstream() {
    const calls = [];
    const server = createServer(async (request, response) => {
        if (request.method !== 'POST') {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        calls.push(request.url);
        const body = await readRequestBody(request);
        if (request.url?.endsWith('/images/generations')) {
            respondToImageGenerationRequest(response, body);
            return;
        }
        if (request.url?.endsWith('/responses')) {
            respondToResponsesImageRequest(response, body);
            return;
        }
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'not found' } }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        calls,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

async function readRequestBody(request) {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
        body += chunk;
    });
    await new Promise((resolve) => request.on('end', resolve));
    return body ? JSON.parse(body) : {};
}

function respondToImageGenerationRequest(response, body) {
    if (body.stream === true) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
            `event: image_generation.completed\ndata: ${JSON.stringify({ type: 'image_generation.completed', b64_json: pngBase64 })}\n\n`
        );
        response.write('data: [DONE]\n\n');
        response.end();
        return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ b64_json: pngBase64 }] }));
}

function respondToResponsesImageRequest(response, body) {
    if (body.tool_choice?.type !== 'image_generation' || body.tools?.[0]?.type !== 'image_generation') {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'invalid responses image request' } }));
        return;
    }
    if (body.stream === true) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
            `event: response.output_item.done\ndata: ${JSON.stringify({
                type: 'response.output_item.done',
                item: { type: 'image_generation_call', status: 'completed', result: pngBase64 }
            })}\n\n`
        );
        response.write('data: [DONE]\n\n');
        response.end();
        return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
        JSON.stringify({ output: [{ type: 'image_generation_call', status: 'completed', result: pngBase64 }] })
    );
}

async function startLocalResponsesJsonUpstream() {
    const server = createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
        });
        await new Promise((resolve) => request.on('end', resolve));
        const parsed = JSON.parse(body);
        if (
            parsed.stream !== false ||
            parsed.tool_choice?.type !== 'image_generation' ||
            parsed.tools?.[0]?.type !== 'image_generation'
        ) {
            response.writeHead(400, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'invalid responses image request' } }));
            return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
            JSON.stringify({
                output: [{ type: 'image_generation_call', status: 'completed', result: pngBase64 }]
            })
        );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}
