import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/smoke-image-upstream-real.mjs');
const realSmokeOutputDir = join(repoRoot, 'generated-images/.real-smoke');
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

describe('image upstream real smoke script', () => {
    it('skips every real upstream target without billable calls when no target env is configured', () => {
        const result = runScript();

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.final_gate_satisfied, false);
        assert.equal(report.billable, false);
        assert.equal(report.results.length, 5);
        assert.equal(report.results.every((item) => item.skipped === true), true);
        assert.equal(report.results.every((item) => item.reason === 'missing base url env'), true);
        assert.deepEqual(report.results[0].missing_env_any, [['IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL']]);
        assert.deepEqual(report.results[3].missing_env_any, [
            ['IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL', 'IMAGE_REAL_SMOKE_SUB2API_BASE_URL']
        ]);
        assert.deepEqual(report.independent_targets, {
            required_count: 5,
            required_cases: independentSmokeCaseIds(),
            selected_cases: independentSmokeCaseIds(),
            unselected_required_count: 0,
            unselected_required_cases: [],
            configuration_complete: false,
            selected_count: 5,
            configured_count: 0,
            missing_count: 5,
            configured_cases: [],
            missing_cases: independentSmokeCaseIds(),
            invalid_count: 0,
            invalid_cases: [],
            invalid_env: {},
            final_gate_command:
                'npm run smoke:image-upstream-real -- --env-file .env.real-smoke.local --require-independent-targets --allow-billable'
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
        assert.equal('missing_env_any' in report.results[0], false);
        assert.deepEqual(report.independent_targets.required_cases, independentSmokeCaseIds());
        assert.deepEqual(report.independent_targets.selected_cases, ['original-images-json']);
        assert.deepEqual(report.independent_targets.unselected_required_cases, [
            'gaoren-images-sse',
            'sub2api-images-sse',
            'sub2api-responses-json',
            'gpt2image-responses-sse'
        ]);
        assert.equal(report.independent_targets.configuration_complete, false);
        assert.deepEqual(report.independent_targets.configured_cases, ['original-images-json']);
        assert.deepEqual(report.independent_targets.missing_cases, []);
    });

    it('loads independent real upstream targets from an explicit env file without leaking API keys', () => {
        const envFilePath = join(repoRoot, 'generated-images/.real-smoke-test.env');
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
        const envFilePath = join(repoRoot, 'generated-images/.real-smoke-test.env');
        try {
            writeEnvFile(
                envFilePath,
                [
                    'IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL=https://env-file.example/v1',
                    'IMAGE_REAL_SMOKE_ORIGINAL_API_KEY=secret-env-file-key'
                ].join('\n')
            );
            const result = runScript(
                ['--env-file', envFilePath, '--case', 'original-images-json'],
                {
                    IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: 'https://shell.example/v1',
                    IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'secret-shell-key'
                }
            );

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
            'gpt2image-responses-sse'
        ]);
        assert.equal('unselected_required_cases' in report, false);
        assert.equal(report.missing_required_count, 5);
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
            'gpt2image-responses-sse'
        ]);
        assert.equal(report.missing_required_count, 5);
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
        assert.equal(report.independent_targets.required_count, 5);
        assert.deepEqual(report.independent_targets.selected_cases, []);
        assert.equal(report.independent_targets.unselected_required_count, 5);
        assert.deepEqual(report.independent_targets.unselected_required_cases, independentSmokeCaseIds());
        assert.deepEqual(report.unselected_required_cases, independentSmokeCaseIds());
        assert.equal(report.missing_required_count, 5);
        assert.deepEqual(report.missing_required_cases, independentSmokeCaseIds());
        assert.equal('skipped_required_cases' in report, false);
    });

    it('can dry-run the current server channel Agent Responses SSE smoke case without leaking keys', () => {
        const result = runScript(['--include-server-channel', '--case', 'server-channel-agent-responses-sse'], {
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
    });

    it('can dry-run the current server channel Responses JSON smoke case without leaking keys', () => {
        const result = runScript(['--include-server-channel', '--case', 'server-channel-responses-json'], {
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
    });

    it('removes generated .real-smoke artifact files after billable local Agent smoke runs', async () => {
        const upstream = await startLocalImagesSseUpstream();
        const before = listRealSmokeFiles();
        let after = before;
        try {
            const result = await runScriptAsync(
                ['--include-server-channel', '--allow-billable', '--case', 'server-channel-agent-images-sse'],
                {
                    OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
                    OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key'
                }
            );

            assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
            assert.doesNotMatch(result.stdout, /secret-server-channel-key/);
            const report = JSON.parse(result.stdout);
            assert.equal(report.ok, true);
            assert.equal(report.final_gate_satisfied, false);
            assert.equal(report.results[0].image_count, 1);
            after = listRealSmokeFiles();
            assert.deepEqual(diffFiles(before, after), []);
        } finally {
            for (const file of diffFiles(before, after)) {
                rmSync(join(realSmokeOutputDir, file), { force: true });
            }
            await upstream.close();
        }
    });

    it('runs the current server channel Responses JSON smoke case against a local upstream', async () => {
        const upstream = await startLocalResponsesJsonUpstream();
        try {
            const result = await runScriptAsync(
                ['--include-server-channel', '--allow-billable', '--case', 'server-channel-responses-json'],
                {
                    OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
                    OPENAI_CHANNEL_1_API_KEYS: 'secret-server-channel-key',
                    IMAGE_REAL_SMOKE_SERVER_RESPONSES_MODEL: 'gpt-5.4'
                }
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
    });

    it('marks the final gate satisfied only after every independent target runs successfully', async () => {
        const upstream = await startLocalImageAndResponsesUpstream();
        try {
            const result = await runScriptAsync(
                ['--allow-billable', '--require-independent-targets'],
                buildAllIndependentTargetEnv(upstream.baseUrl)
            );

            assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
            assert.doesNotMatch(result.stdout, /secret-independent-key/);
            const report = JSON.parse(result.stdout);
            assert.equal(report.ok, true);
            assert.equal(report.final_gate_satisfied, true);
            assert.equal(report.independent_targets.configuration_complete, true);
            assert.equal(report.independent_targets.configured_count, 5);
            assert.equal(report.results.length, 5);
            assert.equal(report.results.every((item) => item.ok === true && item.skipped !== true), true);
            assert.equal('missing_required_cases' in report, false);
        } finally {
            await upstream.close();
        }
    });

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
        'IMAGE_REAL_SMOKE_GPT2IMAGE'
    ];
}

function independentSmokeCaseIds() {
    return [
        'original-images-json',
        'gaoren-images-sse',
        'sub2api-images-sse',
        'sub2api-responses-json',
        'gpt2image-responses-sse'
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
        IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY: 'secret-independent-key-gpt2image',
        IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL: 'gpt-5.4'
    };
}

function runScript(args = [], env = {}) {
    return spawnSync(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: buildScriptEnv(env)
    });
}

function runScriptAsync(args = [], env = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
            cwd: repoRoot,
            env: buildScriptEnv(env),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('close', (status) => {
            resolve({ status, stdout, stderr });
        });
    });
}

function listRealSmokeFiles() {
    try {
        return readdirSync(realSmokeOutputDir).filter((item) => item.endsWith('.png') || item.endsWith('.jpeg')).sort();
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

function buildScriptEnv(env = {}) {
    const scriptEnv = { ...process.env };
    for (const key of Object.keys(scriptEnv)) {
        if (isSmokeEnvKey(key)) delete scriptEnv[key];
    }
    return {
        ...scriptEnv,
        ...env,
        NODE_ENV: 'test',
        IMAGE_REAL_SMOKE_SKIP_DOTENV: '1'
    };
}

function isSmokeEnvKey(key) {
    return (
        key.startsWith('IMAGE_REAL_SMOKE_') ||
        key.startsWith('OPENAI_CHANNEL_') ||
        key === 'OPENAI_API_BASE_URL' ||
        key === 'OPENAI_API_KEY' ||
        key === 'OPENAI_RESPONSES_API_MODEL' ||
        key === 'OPENAI_ROUTING_STRATEGY' ||
        key === 'OPENAI_CHANNELS_JSON' ||
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
        response.write(`event: image_generation.completed\ndata: ${JSON.stringify({ type: 'image_generation.completed', b64_json: pngBase64 })}\n\n`);
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

async function startLocalImageAndResponsesUpstream() {
    const server = createServer(async (request, response) => {
        if (request.method !== 'POST') {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
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
        response.write(`event: image_generation.completed\ndata: ${JSON.stringify({ type: 'image_generation.completed', b64_json: pngBase64 })}\n\n`);
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
    response.end(JSON.stringify({ output: [{ type: 'image_generation_call', status: 'completed', result: pngBase64 }] }));
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
        if (parsed.stream !== false || parsed.tool_choice?.type !== 'image_generation' || parsed.tools?.[0]?.type !== 'image_generation') {
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
