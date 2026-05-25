#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { commandFailureMessage, parseJsonPayload, printJson } from './command-center-utils.mjs';
import { createFixtureServer } from './local-image-upstream-fixture.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_SMOKE_SCRIPT = fileURLToPath(new URL('./smoke-image-upstream-real.mjs', import.meta.url));
const DEFAULT_TIMEOUT_MS = 30_000;
const LOCAL_FINAL_GATE_CASE_COUNT = 5;
const LOCAL_FINAL_GATE_PARENT_TIMEOUT_BUFFER_MS = 15_000;

function parseArgs(argv) {
    const parsed = { help: false, timeoutMs: DEFAULT_TIMEOUT_MS };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') parsed.help = true;
        else if (arg === '--timeout-ms') parsed.timeoutMs = readTimeoutMs(readArgValue(argv, (index += 1), arg), arg);
        else throw new Error(`未知参数：${arg}`);
    }
    return parsed;
}

function printHelp() {
    console.log(`Usage:
  npm run smoke:image-upstream-local
  npm run smoke:image-upstream-local -- --timeout-ms 30000

Starts the local image upstream fixture and runs all five independent image upstream smoke cases through the real-smoke final gate. This is a local fixture gate, not proof that third-party upstream deployments are reachable.`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    const fixture = await startFixture();
    try {
        const result = await runLocalFinalGate(fixture.baseUrl, options.timeoutMs);
        const report = parseJsonPayload(result.stdout, 'local image upstream final gate');
        if (!result.ok) {
            printJson({
                ok: false,
                local_fixture: true,
                upstream_host: readHost(fixture.baseUrl),
                report,
                output: commandFailureMessage(result)
            });
            process.exit(1);
        }
        assertFinalGateReport(report);
        printJson({
            ok: true,
            local_fixture: true,
            upstream_host: readHost(fixture.baseUrl),
            final_gate_satisfied: report.final_gate_satisfied,
            independent_targets: report.independent_targets,
            results: report.results.map(summarizeResult)
        });
    } finally {
        await fixture.close();
    }
}

function runLocalFinalGate(baseUrl, timeoutMs) {
    return runCommandAsync(
        process.execPath,
        ['--import', 'tsx', REAL_SMOKE_SCRIPT, '--allow-billable', '--require-independent-targets', '--timeout-ms', String(timeoutMs)],
        {
            cwd: REPO_ROOT,
            env: buildLocalFinalGateEnv(baseUrl, timeoutMs),
            timeoutMs: timeoutMs * LOCAL_FINAL_GATE_CASE_COUNT + LOCAL_FINAL_GATE_PARENT_TIMEOUT_BUFFER_MS
        }
    );
}

function runCommandAsync(command, args, options = {}) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, options.timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => {
            clearTimeout(timeout);
            resolve({
                ok: false,
                command,
                args,
                stdout,
                stderr,
                elapsed_ms: Date.now() - startedAt,
                error: error.message
            });
        });
        child.on('close', (status, signal) => {
            clearTimeout(timeout);
            resolve({
                ok: status === 0,
                command,
                args,
                status,
                stdout,
                stderr,
                elapsed_ms: Date.now() - startedAt,
                ...(signal ? { signal } : {}),
                ...(timedOut ? { error: `timed out after ${options.timeoutMs}ms` } : {})
            });
        });
    });
}

function buildLocalFinalGateEnv(baseUrl, timeoutMs) {
    const env = stripSmokeEnv(process.env);
    return {
        ...env,
        IMAGE_REAL_SMOKE_SKIP_DOTENV: '1',
        IMAGE_REAL_SMOKE_TIMEOUT_MS: String(timeoutMs),
        IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_ORIGINAL_API_KEY: 'local-fixture-key-original',
        IMAGE_REAL_SMOKE_GAOREN_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_GAOREN_API_KEY: 'local-fixture-key-gaoren',
        IMAGE_REAL_SMOKE_SUB2API_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_SUB2API_API_KEY: 'local-fixture-key-sub2api',
        IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY: 'local-fixture-key-sub2api-responses',
        IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL: 'gpt-5.4',
        IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL: baseUrl,
        IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY: 'local-fixture-key-gpt2image',
        IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL: 'gpt-5.4'
    };
}

function stripSmokeEnv(source) {
    const env = { ...source };
    for (const key of Object.keys(env)) {
        if (isSmokeEnvKey(key)) delete env[key];
    }
    return env;
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

async function startFixture() {
    const server = createFixtureServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address !== 'object') throw new Error('local fixture did not expose a TCP address');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => closeServer(server)
    };
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function assertFinalGateReport(report) {
    if (report?.final_gate_satisfied !== true) throw new Error('local final gate did not satisfy final_gate_satisfied=true');
    if (!Array.isArray(report.results) || report.results.length !== 5) {
        throw new Error('local final gate did not run all five independent upstream cases');
    }
    const failed = report.results.find((item) => item.ok !== true || item.skipped === true);
    if (failed) throw new Error(`local final gate case failed: ${failed.id || 'unknown'}`);
}

function summarizeResult(result) {
    return {
        id: result.id,
        status: result.status,
        content_type: result.content_type,
        event_types: result.event_types,
        image_count: result.image_count,
        done_image_count: result.done_image_count,
        first_b64_length: result.first_b64_length,
        elapsed_ms: result.elapsed_ms
    };
}

function readArgValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数值。`);
    return value;
}

function readTimeoutMs(value, source) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1000) throw new Error(`${source} 必须是不小于 1000 的整数毫秒。`);
    return parsed;
}

function readHost(value) {
    try {
        return new URL(value).host;
    } catch {
        return 'invalid-url';
    }
}

main().catch((error) => {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
});
