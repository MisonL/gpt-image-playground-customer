#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { isMainModule, parseJsonPayload, pickFailureOutput, printJson, redactBaseUrl, runCommand } from './command-center-utils.mjs';
import {
    loadPrivateAgentEnvFile,
    resolvePlaygroundBaseUrl
} from '../skills/gpt-image-playground-agent/scripts/lib/script-utils.mjs';

const GENERATE_SCRIPT = fileURLToPath(new URL('../skills/gpt-image-playground-agent/scripts/generate-image.mjs', import.meta.url));
const EDIT_SCRIPT = fileURLToPath(new URL('../skills/gpt-image-playground-agent/scripts/edit-image.mjs', import.meta.url));
const AGENT_DOCTOR_TIMEOUT_MS = 75_000;

export function buildAgentDoctorArgs() {
    return [GENERATE_SCRIPT, '--contract-check', '--timeout-ms', '60000', 'contract check'];
}

export function buildAgentDoctorContractArgs(baseUrl) {
    const args = [GENERATE_SCRIPT, '--contract-check', '--timeout-ms', '60000'];
    if (baseUrl) args.push('--base-url', baseUrl);
    args.push('contract check');
    return args;
}

function parseArgs(argv) {
    const parsed = {
        help: false,
        allowBillable: false,
        timeoutMs: 60_000,
        baseUrl: undefined,
        editImage: undefined
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') parsed.help = true;
        else if (arg === '--allow-billable') parsed.allowBillable = true;
        else if (arg === '--timeout-ms') parsed.timeoutMs = readPositiveInteger(readOptionValue(argv, (index += 1), arg), '--timeout-ms');
        else if (arg === '--base-url') parsed.baseUrl = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--edit-image') parsed.editImage = readOptionValue(argv, (index += 1), arg);
        else throw new Error(`未知参数：${arg}`);
    }
    return parsed;
}

function printHelp() {
    console.log(`用法：
  npm run agent:doctor
  npm run agent:doctor -- --base-url https://your-space.hf.space --allow-billable --edit-image /path/to/reference.png

环境变量：
  GPT_IMAGE_PLAYGROUND_URL       服务基础地址，默认 http://localhost:4783。
  GPT_IMAGE_AGENT_TOKEN          capabilities 需要 bearer 鉴权时使用。
  GPT_IMAGE_APP_PASSWORD_HASH    capabilities 需要页面密码鉴权时使用。

选项：
  --base-url      显式服务地址，优先于 GPT_IMAGE_PLAYGROUND_URL 和本地探测。
  --timeout-ms    HTTP 探测和 smoke 超时，默认 60000。
  --edit-image    真实 edit smoke 使用的参考图。
  --allow-billable 显式允许真实 1K/2K smoke 请求。

agent:doctor 默认只读、非计费。真实 generate/edit smoke 必须显式添加 --allow-billable。`);
}

async function main() {
    loadPrivateAgentEnvFile();
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const baseUrlInfo = resolvePlaygroundBaseUrl(options.baseUrl, process.env);
    const baseUrl = baseUrlInfo.baseUrl;
    const contract = runContractCheck(baseUrl);
    const capabilities = await readJsonLayer('capabilities', `${baseUrl}/api/agent/capabilities`, options.timeoutMs);
    const runtime = await readJsonLayer('runtime', `${baseUrl}/api/runtime-capabilities`, options.timeoutMs);
    const smoke = options.allowBillable ? runBillableSmoke(options, baseUrl) : buildSkippedSmoke(options);
    const layers = buildLayers({ capabilities, runtime, contract, smoke });

    printJson({
        ok: layers.every((layer) => layer.ok || layer.skipped),
        command: 'agent:doctor',
        billable: options.allowBillable,
        base_url: redactBaseUrl(baseUrl),
        service_base_url: redactBaseUrl(baseUrl),
        service_base_url_source: baseUrlInfo.source,
        interactive_confirmation_required: baseUrlInfo.interactive_confirmation_required,
        layers,
        summary: buildSummary({ capabilities, runtime, contract, smoke })
    });
    if (layers.some((layer) => !layer.ok && !layer.skipped)) process.exit(1);
}

function runContractCheck(baseUrl) {
    const result = runCommand(process.execPath, buildAgentDoctorContractArgs(baseUrl), {
        env: { ...process.env, GPT_IMAGE_AGENT_CONTRACT_CHECK: '1' },
        timeoutMs: AGENT_DOCTOR_TIMEOUT_MS
    });
    if (!result.ok) {
        return { ok: false, output: pickFailureOutput(result), elapsed_ms: result.elapsed_ms };
    }
    return {
        ok: true,
        elapsed_ms: result.elapsed_ms,
        body: result.stdout ? parseJsonPayload(result.stdout, 'agent contract check') : {}
    };
}

async function readJsonLayer(name, url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { headers: authHeaders(), signal: controller.signal });
        const text = await response.text();
        if (!response.ok) throw new Error(`${safePathname(url)} failed with HTTP ${response.status}${formatBodySnippet(text)}`);
        return { ok: true, body: text ? JSON.parse(text) : {} };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), name };
    } finally {
        clearTimeout(timer);
    }
}

function buildSkippedSmoke(options) {
    return {
        ok: true,
        skipped: true,
        reason: 'requires --allow-billable',
        checks: [
            { name: 'generate_1k', skipped: true, reason: 'requires --allow-billable' },
            {
                name: 'edit_1k',
                skipped: true,
                reason: options.editImage ? 'requires --allow-billable' : 'requires --allow-billable and --edit-image'
            },
            {
                name: 'page_sse_edit_2k',
                skipped: true,
                reason: options.editImage ? 'requires --allow-billable' : 'requires --allow-billable and --edit-image'
            }
        ]
    };
}

function runBillableSmoke(options, baseUrl) {
    const checks = [
        runSmokeCommand('generate_1k', [
            GENERATE_SCRIPT,
            '--base-url',
            baseUrl,
            '--allow-billable',
            '--agent',
            '--timeout-ms',
            String(options.timeoutMs),
            '--size',
            '1024x1024',
            '--quality',
            'low',
            '--idempotency-key',
            `agent-doctor-generate-${Date.now()}`,
            'agent doctor 1k generate smoke'
        ])
    ];
    if (options.editImage) {
        checks.push(
            runSmokeCommand('edit_1k', [
                EDIT_SCRIPT,
                '--base-url',
                baseUrl,
                '--allow-billable',
                '--agent',
                '--timeout-ms',
                String(options.timeoutMs),
                '--size',
                '1024x1024',
                '--quality',
                'low',
                '--idempotency-key',
                `agent-doctor-edit-${Date.now()}`,
                options.editImage,
                'agent doctor 1k edit smoke'
            ])
        );
        checks.push(
            runSmokeCommand('page_sse_edit_2k', [
                EDIT_SCRIPT,
                '--base-url',
                baseUrl,
                '--allow-billable',
                '--page-sse',
                '--timeout-ms',
                String(options.timeoutMs),
                '--size',
                '2048x2048',
                '--quality',
                'low',
                '--idempotency-key',
                `agent-doctor-page-sse-edit-${Date.now()}`,
                options.editImage,
                'agent doctor 2k page SSE edit smoke'
            ])
        );
    } else {
        checks.push({ name: 'edit_1k', ok: true, skipped: true, reason: 'requires --edit-image' });
        checks.push({ name: 'page_sse_edit_2k', ok: true, skipped: true, reason: 'requires --edit-image' });
    }
    return { ok: checks.every((check) => check.ok || check.skipped), skipped: false, checks };
}

function runSmokeCommand(name, args) {
    const result = runCommand(process.execPath, args, {
        env: process.env,
        timeoutMs: AGENT_DOCTOR_TIMEOUT_MS
    });
    return {
        name,
        ok: result.ok,
        elapsed_ms: result.elapsed_ms,
        ...(result.ok ? {} : { output: pickFailureOutput(result) })
    };
}

function buildLayers({ capabilities, runtime, contract, smoke }) {
    return [
        {
            name: 'capabilities',
            ok: capabilities.ok,
            endpoint: '/api/agent/capabilities',
            ...(capabilities.ok ? summarizeCapabilities(capabilities.body) : { error: capabilities.error })
        },
        {
            name: 'contract_check',
            ok: contract.ok,
            billable: false,
            ...(contract.ok ? { checks: contract.body.checks || [] } : { error: contract.output })
        },
        {
            name: 'runtime_backend',
            ok: runtime.ok,
            endpoint: '/api/runtime-capabilities',
            ...(runtime.ok ? summarizeRuntime(runtime.body) : { error: runtime.error })
        },
        {
            name: 'state_backend',
            ok: capabilities.ok,
            ...(capabilities.ok ? summarizeStateBackend(capabilities.body) : { error: capabilities.error })
        },
        {
            name: 'responses_gpt2image_readiness',
            ok: capabilities.ok && runtime.ok,
            ...(capabilities.ok && runtime.ok
                ? summarizeResponsesReadiness(capabilities.body, runtime.body)
                : { error: 'requires capabilities and runtime layers' })
        },
        {
            name: 'billable_smoke',
            ok: smoke.ok,
            skipped: smoke.skipped,
            checks: smoke.checks,
            ...(smoke.reason ? { reason: smoke.reason } : {})
        }
    ];
}

function summarizeCapabilities(body) {
    return {
        page_sse: body?.agent_streaming?.page_sse?.supported === true,
        page_sse_auth_required: body?.agent_streaming?.page_sse?.auth?.required === true,
        page_sse_auth_ready:
            body?.agent_streaming?.page_sse?.auth?.required === true
                ? Boolean(process.env.GPT_IMAGE_APP_PASSWORD_HASH)
                : true,
        page_sse_auth_next_action:
            body?.agent_streaming?.page_sse?.auth?.required === true && !process.env.GPT_IMAGE_APP_PASSWORD_HASH
                ? 'Set GPT_IMAGE_APP_PASSWORD_HASH in private local env before using --page-sse.'
                : undefined,
        agent_jobs: body?.agent_jobs?.supported === true,
        routing_rules: Boolean(body?.routing_rules),
        executable_routing_rules: Boolean(body?.routing_rules?.high_resolution_edit?.conditions)
    };
}

function summarizeRuntime(body) {
    return {
        default_stream_mode: body?.streaming?.defaultMode,
        streaming_unavailable_scope: body?.streaming?.unavailableMarkScope,
        responses_image_backend: body?.responsesImageBackend?.enabled === true,
        streaming_batch_enabled: body?.streamingBatch?.enabled === true
    };
}

function summarizeStateBackend(body) {
    return {
        backend: body?.defaults?.state_backend,
        image_storage_mode: body?.storage?.image_storage_mode,
        postgres_configured: body?.storage?.postgres_configured === true
    };
}

function summarizeResponsesReadiness(capabilities, runtime) {
    const requirements = capabilities?.supported?.image_backend_requirements?.['responses-image-generation'];
    return {
        backend_supported: requirements?.supported === true,
        backend_enabled: requirements?.enabled === true,
        runtime_enabled: runtime?.responsesImageBackend?.enabled === true,
        missing_env: requirements?.missing_env || [],
        gpt2image_real_smoke_case: 'gpt2image-responses-sse',
        real_smoke_gate:
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case gpt2image-responses-sse --allow-billable'
    };
}

function buildSummary({ capabilities, runtime, contract, smoke }) {
    return {
        capabilities: capabilities.ok ? 'ok' : 'failed',
        contract_check: contract.ok ? 'ok' : 'failed',
        runtime: runtime.ok ? 'ok' : 'failed',
        state_backend: capabilities.ok ? capabilities.body?.defaults?.state_backend : 'unknown',
        page_sse_auth_ready:
            capabilities.ok && capabilities.body?.agent_streaming?.page_sse?.auth?.required === true
                ? Boolean(process.env.GPT_IMAGE_APP_PASSWORD_HASH)
                : capabilities.ok,
        responses_gpt2image_ready:
            capabilities.ok && runtime.ok
                ? capabilities.body?.supported?.image_backend_requirements?.['responses-image-generation']?.enabled === true &&
                  runtime.body?.responsesImageBackend?.enabled === true
                : false,
        billable_smoke: smoke.skipped ? 'skipped' : smoke.ok ? 'ok' : 'failed'
    };
}

function authHeaders() {
    if (process.env.GPT_IMAGE_AGENT_TOKEN) return { Authorization: `Bearer ${process.env.GPT_IMAGE_AGENT_TOKEN}` };
    if (process.env.GPT_IMAGE_APP_PASSWORD_HASH) return { 'X-App-Password-Hash': process.env.GPT_IMAGE_APP_PASSWORD_HASH };
    return {};
}

function readOptionValue(argv, index, name) {
    const value = argv[index];
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要参数值。`);
    return value;
}

function readPositiveInteger(value, name) {
    if (!/^\d+$/.test(String(value))) throw new Error(`${name} 必须是正整数。`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} 必须是正整数。`);
    return parsed;
}

function normalizeBaseUrl(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('base URL must use http or https.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('base URL must not include credentials, query parameters, or fragments.');
    }
    return normalized;
}

function safePathname(url) {
    try {
        return new URL(url).pathname;
    } catch {
        return String(url);
    }
}

function formatBodySnippet(text) {
    return text ? `: ${text.slice(0, 100)}` : '';
}

try {
    if (isMainModule(import.meta.url, process.argv[1])) await main();
} catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}
