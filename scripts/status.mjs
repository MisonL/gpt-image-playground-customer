#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';

import { HF_SPACE_ID, HF_SPACE_URL } from './hf-space-doctor-utils.mjs';
import { isMainModule, parseJsonPayload, printJson, runCommand, runCommandStrict } from './command-center-utils.mjs';
import { CHANNEL_REQUEST_MODES, CHANNEL_REQUEST_MODE_ADMIN_CONTROL } from '../src/lib/channel-request-mode-values.mjs';

const REMOTE_STATUS_TIMEOUT_MS = 30_000;
const LOCAL_ENDPOINT_TIMEOUT_MS = 500;
export const FORMAL_PRODUCT_NAME = '图像手记 / Visual Journal';
const IMAGE_UPSTREAM_REAL_SMOKE_CASES = [
    { id: 'original-images-json', prefix: 'IMAGE_REAL_SMOKE_ORIGINAL', requestMode: 'images-non-stream' },
    { id: 'gaoren-images-sse', prefix: 'IMAGE_REAL_SMOKE_GAOREN', requestMode: 'images-sse' },
    { id: 'sub2api-images-sse', prefix: 'IMAGE_REAL_SMOKE_SUB2API', requestMode: 'images-sse' },
    {
        id: 'sub2api-responses-json',
        prefix: 'IMAGE_REAL_SMOKE_SUB2API_RESPONSES',
        fallbackPrefix: 'IMAGE_REAL_SMOKE_SUB2API',
        requiresResponsesModel: true,
        requestMode: 'responses-non-stream'
    },
    {
        id: 'gpt2image-responses-sse',
        prefix: 'IMAGE_REAL_SMOKE_GPT2IMAGE',
        requiresResponsesModel: true,
        requestMode: 'responses-sse'
    },
    { id: 'matsca-images-sse', prefix: 'IMAGE_REAL_SMOKE_MATSCA', requestMode: 'images-sse' }
];
const IMAGE_UPSTREAM_FINAL_GATE_COMMAND =
    CHANNEL_REQUEST_MODE_ADMIN_CONTROL.finalGateCommand;
const STATUS_ENV_FILES = [
    { path: '.env.local', override: false },
    { path: '.env.real-smoke.local', override: true }
];

export function buildAdminCommands() {
    return {
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
        hf_space_local_smoke: 'npm run smoke:hf-space-local',
        hf_space_smoke_legacy_alias: 'npm run smoke:hf-space'
    };
}

export function parseGitStatusEntries(output) {
    const entries = output.split('\0').filter(Boolean);
    const paths = [];
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const status = entry.slice(0, 2);
        paths.push(entry.slice(3));
        if (status.includes('R') || status.includes('C')) index += 1;
    }
    return paths;
}

function readEnv(env, key) {
    const value = env[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function shouldSetStatusEnv(key, baseEnv, statusEnv, options) {
    if (baseEnv[key] !== undefined) return false;
    return options.override || statusEnv[key] === undefined;
}

function loadStatusEnvFile(statusEnv, baseEnv, options) {
    if (!existsSync(options.path)) return;
    for (const line of readFileSync(options.path, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || !shouldSetStatusEnv(match[1], baseEnv, statusEnv, options)) continue;
        const value = match[2].trim();
        const quoted =
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
        statusEnv[match[1]] = quoted ? value.slice(1, -1) : value;
    }
}

export function readStatusEnvFromFiles(baseEnv = process.env, envFiles = STATUS_ENV_FILES) {
    const statusEnv = { ...baseEnv };
    for (const envFile of envFiles) {
        loadStatusEnvFile(statusEnv, baseEnv, envFile);
    }
    return statusEnv;
}

function readSmokeEnvAlternatives(testCase, suffix) {
    const keys = [`${testCase.prefix}_${suffix}`];
    if (testCase.fallbackPrefix && testCase.fallbackPrefix !== testCase.prefix) {
        keys.push(`${testCase.fallbackPrefix}_${suffix}`);
    }
    return keys;
}

function readResponsesModelEnvAlternatives(testCase) {
    return [`${testCase.prefix}_RESPONSES_MODEL`, 'OPENAI_RESPONSES_API_MODEL'];
}

function readFirstStatusEnv(env, keys) {
    for (const key of keys) {
        const value = readEnv(env, key);
        if (value) return { key, value };
    }
    return undefined;
}

function readBaseUrlValidationError(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return 'must_be_http_or_https_absolute_url';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must_use_http_or_https';
    if (url.username || url.password) return 'must_not_include_credentials';
    if (url.search || url.hash) return 'must_not_include_query_or_fragment';
    return undefined;
}

function readTargetConfigured(testCase, env) {
    const baseUrl = readFirstStatusEnv(env, readSmokeEnvAlternatives(testCase, 'BASE_URL'));
    const apiKey = readFirstStatusEnv(env, readSmokeEnvAlternatives(testCase, 'API_KEY'));
    const responsesModel = testCase.requiresResponsesModel
        ? readFirstStatusEnv(env, readResponsesModelEnvAlternatives(testCase))
        : undefined;
    const baseUrlError = baseUrl ? readBaseUrlValidationError(baseUrl.value) : undefined;
    return {
        baseUrl: Boolean(baseUrl),
        baseUrlValue: baseUrl?.value,
        apiKey: Boolean(apiKey),
        responsesModel: Boolean(responsesModel),
        invalidEnv: baseUrlError ? [{ key: baseUrl.key, reason: baseUrlError }] : []
    };
}

function readMissingEnvAny(testCase, target) {
    const groups = [];
    if (!target.baseUrl) groups.push(readSmokeEnvAlternatives(testCase, 'BASE_URL'));
    if (target.baseUrl && !target.apiKey) groups.push(readSmokeEnvAlternatives(testCase, 'API_KEY'));
    if (target.baseUrl && testCase.requiresResponsesModel && !target.responsesModel) {
        groups.push(readResponsesModelEnvAlternatives(testCase));
    }
    return groups;
}

export function buildImageUpstreamRealSmokeStatus(env = process.env) {
    const caseSummaries = IMAGE_UPSTREAM_REAL_SMOKE_CASES.map((testCase) => {
        const target = readTargetConfigured(testCase, env);
        const missingEnvAny = readMissingEnvAny(testCase, target);
        return {
            id: testCase.id,
            request_mode: testCase.requestMode,
            configured: missingEnvAny.length === 0 && target.invalidEnv.length === 0,
            ...(missingEnvAny.length > 0 ? { missing_env_any: missingEnvAny } : {}),
            ...(target.invalidEnv.length > 0 ? { invalid_env: target.invalidEnv } : {})
        };
    });
    const configuredCases = caseSummaries.filter((item) => item.configured).map((item) => item.id);
    const missingCases = caseSummaries.filter(
        (item) => Array.isArray(item.missing_env_any) && item.missing_env_any.length > 0
    );
    const invalidCases = caseSummaries.filter((item) => Array.isArray(item.invalid_env) && item.invalid_env.length > 0);
    return {
        required_count: IMAGE_UPSTREAM_REAL_SMOKE_CASES.length,
        required_cases: IMAGE_UPSTREAM_REAL_SMOKE_CASES.map((testCase) => testCase.id),
        configuration_complete: missingCases.length === 0 && invalidCases.length === 0,
        configured_count: configuredCases.length,
        configured_cases: configuredCases,
        missing_count: missingCases.length,
        missing_cases: missingCases.map((item) => item.id),
        missing_env_any: Object.fromEntries(missingCases.map((item) => [item.id, item.missing_env_any])),
        invalid_count: invalidCases.length,
        invalid_cases: invalidCases.map((item) => item.id),
        invalid_env: Object.fromEntries(invalidCases.map((item) => [item.id, item.invalid_env])),
        request_modes: summarizeRealSmokeRequestModes(caseSummaries),
        final_gate_command: IMAGE_UPSTREAM_FINAL_GATE_COMMAND
    };
}

function summarizeRealSmokeRequestModes(caseSummaries) {
    return Object.fromEntries(
        CHANNEL_REQUEST_MODES.map((mode) => {
            const items = caseSummaries.filter((item) => item.request_mode === mode);
            const configured = items.filter((item) => item.configured);
            const missing = items.filter((item) => Array.isArray(item.missing_env_any) && item.missing_env_any.length > 0);
            const invalid = items.filter((item) => Array.isArray(item.invalid_env) && item.invalid_env.length > 0);
            return [
                mode,
                {
                    required_count: items.length,
                    required_cases: items.map((item) => item.id),
                    configuration_complete: missing.length === 0 && invalid.length === 0,
                    configured_count: configured.length,
                    configured_cases: configured.map((item) => item.id),
                    missing_count: missing.length,
                    missing_cases: missing.map((item) => item.id),
                    invalid_count: invalid.length,
                    invalid_cases: invalid.map((item) => item.id),
                    smoke_state: 'not_run_by_status'
                }
            ];
        })
    );
}

function normalizeLocalHostname(hostname) {
    return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isLocalHostname(hostname) {
    const normalized = normalizeLocalHostname(hostname);
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function readUrlPort(url) {
    if (url.port) return Number(url.port);
    if (url.protocol === 'http:') return 80;
    if (url.protocol === 'https:') return 443;
    return undefined;
}

function readLocalEndpoint(testCase, env) {
    const target = readTargetConfigured(testCase, env);
    if (!target.baseUrlValue || target.invalidEnv.length > 0) return undefined;
    const url = new URL(target.baseUrlValue);
    if (!isLocalHostname(url.hostname)) return undefined;
    const port = readUrlPort(url);
    if (!port) return undefined;
    return {
        id: testCase.id,
        host: normalizeLocalHostname(url.hostname),
        port
    };
}

function readLocalEndpointTargets(env) {
    return IMAGE_UPSTREAM_REAL_SMOKE_CASES.map((testCase) => readLocalEndpoint(testCase, env)).filter(Boolean);
}

function formatEndpoint(endpoint) {
    const host = endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host;
    return `${host}:${endpoint.port}`;
}

function readSocketFailureReason(error) {
    if (error?.code === 'ECONNREFUSED') return 'connection_refused';
    if (error?.code === 'ETIMEDOUT') return 'timeout';
    if (error?.code === 'EHOSTUNREACH') return 'host_unreachable';
    if (error?.code === 'ENETUNREACH') return 'network_unreachable';
    return 'connection_failed';
}

function probeTcpEndpoint(endpoint, options = {}) {
    const timeoutMs = options.timeoutMs || LOCAL_ENDPOINT_TIMEOUT_MS;
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(timeoutMs, () => finish({ ok: false, reason: 'timeout' }));
        socket.once('connect', () => finish({ ok: true }));
        socket.once('error', (error) => finish({ ok: false, reason: readSocketFailureReason(error) }));
    });
}

export async function buildImageUpstreamLocalEndpointStatus(env = process.env, options = {}) {
    const probe = options.probe || probeTcpEndpoint;
    const results = [];
    for (const endpoint of readLocalEndpointTargets(env)) {
        const result = await probe(endpoint, options);
        results.push({
            id: endpoint.id,
            endpoint: formatEndpoint(endpoint),
            ok: result.ok === true,
            ...(result.ok === true ? {} : { reason: result.reason || 'connection_failed' })
        });
    }
    const unavailable = results.filter((item) => !item.ok);
    return {
        checked_count: results.length,
        unavailable_count: unavailable.length,
        unavailable_cases: unavailable.map((item) => item.id),
        results
    };
}

function parseArgs(argv) {
    const unknown = argv.find((arg) => !['--help', '-h', '--remote'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        remote: argv.includes('--remote')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run status
  npm run status -- --remote

Options:
  --remote       Include read-only Hugging Face Space runtime info.
  --help         Show this help.`);
}

async function buildLocalStatus() {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const branch = runCommandStrict('git', ['branch', '--show-current']).trim();
    const head = runCommandStrict('git', ['rev-parse', '--short', 'HEAD']).trim();
    const changed = parseGitStatusEntries(runCommandStrict('git', ['status', '--porcelain=v1', '-z']));
    const statusEnv = readStatusEnvFromFiles(process.env);
    const imageUpstreamRealSmoke = buildImageUpstreamRealSmokeStatus(statusEnv);
    return {
        product: FORMAL_PRODUCT_NAME,
        package_name: packageJson.name,
        version: packageJson.version,
        branch,
        head,
        dirty: changed.length > 0,
        changed_files: changed,
        node: process.version,
        commands: buildAdminCommands(),
        space: {
            id: HF_SPACE_ID,
            url: HF_SPACE_URL
        },
        agent: {
            capabilities: '/api/agent/capabilities',
            skill: 'skills/visual-journal-agent/SKILL.md'
        },
        image_upstream_real_smoke: {
            ...imageUpstreamRealSmoke,
            local_endpoint_checks: await buildImageUpstreamLocalEndpointStatus(statusEnv)
        }
    };
}

export function readRemoteStatusFromResult(result) {
    if (!result.ok) {
        return { ok: false, error: result.error || result.stderr || result.stdout || 'Cannot read Hugging Face Space info.' };
    }
    let info;
    try {
        info = parseJsonPayload(result.stdout, 'hf spaces info');
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return {
        ok: true,
        stage: info.runtime?.stage || 'unknown',
        sha: info.sha || info.runtime?.raw?.sha || 'unknown',
        hardware: info.runtime?.hardware || info.hardware || 'unknown'
    };
}

function readRemoteStatus() {
    return readRemoteStatusFromResult(
        runCommand('hf', ['spaces', 'info', HF_SPACE_ID, '--format', 'json'], { timeoutMs: REMOTE_STATUS_TIMEOUT_MS })
    );
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const status = await buildLocalStatus();
    printJson({
        ok: true,
        ...status,
        ...(options.remote ? { remote: readRemoteStatus() } : {})
    });
}

if (isMainModule(import.meta.url, process.argv[1])) {
    main().catch((error) => {
        printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
        process.exit(1);
    });
}
