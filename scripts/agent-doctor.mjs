#!/usr/bin/env node
import {
    loadPrivateAgentEnvFile,
    resolvePlaygroundBaseUrl
} from '../skills/visual-journal-agent/scripts/lib/script-utils.mjs';
import { CHANNEL_REQUEST_MODES, CHANNEL_REQUEST_MODE_SMOKE_CASES } from '../src/lib/channel-request-mode-values.mjs';
import {
    isMainModule,
    parseJsonPayload,
    pickFailureOutput,
    printJson,
    redactBaseUrl,
    runCommand
} from './command-center-utils.mjs';
import { fileURLToPath } from 'node:url';

const GENERATE_SCRIPT = fileURLToPath(
    new URL('../skills/visual-journal-agent/scripts/generate-image.mjs', import.meta.url)
);
const EDIT_SCRIPT = fileURLToPath(
    new URL('../skills/visual-journal-agent/scripts/edit-image.mjs', import.meta.url)
);
const AGENT_DOCTOR_TIMEOUT_MS = 75_000;
const ORCHESTRATION_GENERATE_SMOKE_NAME = 'orchestration_generate_1k';
const AGENT_GENERATE_SMOKE_NAME = 'agent_generate_1k';
const PAGE_SSE_GENERATE_SMOKE_NAME = 'responses_page_sse_generate_1k';
const RESPONSES_AGENT_GENERATE_SMOKE_NAME = 'responses_agent_generate_1k';

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
        else if (arg === '--timeout-ms')
            parsed.timeoutMs = readPositiveInteger(readOptionValue(argv, (index += 1), arg), '--timeout-ms');
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
        if (!response.ok)
            throw new Error(`${safePathname(url)} failed with HTTP ${response.status}${formatBodySnippet(text)}`);
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
            { name: ORCHESTRATION_GENERATE_SMOKE_NAME, skipped: true, reason: 'requires --allow-billable' },
            { name: AGENT_GENERATE_SMOKE_NAME, skipped: true, reason: 'requires --allow-billable' },
            { name: PAGE_SSE_GENERATE_SMOKE_NAME, skipped: true, reason: 'requires --allow-billable' },
            { name: RESPONSES_AGENT_GENERATE_SMOKE_NAME, skipped: true, reason: 'requires --allow-billable' },
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
        runSmokeCommand(ORCHESTRATION_GENERATE_SMOKE_NAME, [
            GENERATE_SCRIPT,
            '--base-url',
            baseUrl,
            '--allow-billable',
            '--timeout-ms',
            String(options.timeoutMs),
            '--size',
            '1024x1024',
            '--quality',
            'low',
            '--image-backend',
            'images-api',
            '--stream-mode',
            'non_stream',
            '--idempotency-key',
            `agent-doctor-orchestration-generate-${Date.now()}`,
            'agent doctor orchestration 1k generate smoke'
        ]),
        runSmokeCommand(AGENT_GENERATE_SMOKE_NAME, [
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
            '--image-backend',
            'images-api',
            '--stream-mode',
            'non_stream',
            '--idempotency-key',
            `agent-doctor-agent-generate-${Date.now()}`,
            'agent doctor agent JSON 1k generate smoke'
        ]),
        runSmokeCommand(PAGE_SSE_GENERATE_SMOKE_NAME, [
            GENERATE_SCRIPT,
            '--base-url',
            baseUrl,
            '--allow-billable',
            '--page-sse',
            '--timeout-ms',
            String(options.timeoutMs),
            '--size',
            '1024x1024',
            '--quality',
            'low',
            '--image-backend',
            'responses-image-generation',
            '--stream-mode',
            'stream',
            '--streaming-strategy',
            'responses-sse',
            '--idempotency-key',
            `agent-doctor-responses-page-sse-generate-${Date.now()}`,
            'agent doctor responses page SSE generate smoke'
        ]),
        runSmokeCommand(RESPONSES_AGENT_GENERATE_SMOKE_NAME, [
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
            '--image-backend',
            'responses-image-generation',
            '--stream-mode',
            'non_stream',
            '--idempotency-key',
            `agent-doctor-responses-agent-generate-${Date.now()}`,
            'agent doctor responses non-stream generate smoke'
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
        page_sse_declared_supported: body?.agent_streaming?.page_sse?.supported === true,
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
        executable_routing_rules: Boolean(body?.routing_rules?.high_resolution_edit?.conditions),
        request_modes_supported: readRequestModeList(body?.supported?.request_modes),
        request_modes_by_channel: readCapabilitiesRequestModesByChannel(body)
    };
}

function summarizeRuntime(body) {
    return {
        default_stream_mode: body?.streaming?.defaultMode,
        streaming_unavailable_scope: body?.streaming?.unavailableMarkScope,
        responses_image_backend: body?.responsesImageBackend?.enabled === true,
        streaming_batch_enabled: body?.streamingBatch?.enabled === true,
        configured_request_modes: readRequestModeList(body?.channelRouting?.configuredRequestModes),
        effective_request_modes: readRequestModeList(body?.channelRouting?.effectiveRequestModes),
        effective_request_modes_by_channel: readRuntimeRequestModesByChannel(body)
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
        declared_supported: requirements?.supported === true,
        backend_supported: requirements?.supported === true,
        backend_enabled: requirements?.enabled === true,
        runtime_enabled: runtime?.responsesImageBackend?.enabled === true,
        missing_env: requirements?.missing_env || [],
        gpt2image_real_smoke_case: 'gpt2image-responses-sse',
        real_smoke_gate:
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case gpt2image-responses-sse --allow-billable',
        real_smoke_gates: [
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case sub2api-responses-json --allow-billable',
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case gpt2image-responses-sse --allow-billable'
        ]
    };
}

function buildSummary({ capabilities, runtime, contract, smoke }) {
    return {
        capabilities: capabilities.ok ? 'ok' : 'failed',
        contract_check: contract.ok ? 'ok' : 'failed',
        runtime: runtime.ok ? 'ok' : 'failed',
        state_backend: capabilities.ok ? capabilities.body?.defaults?.state_backend : 'unknown',
        page_sse_declared_supported: capabilities.ok
            ? capabilities.body?.agent_streaming?.page_sse?.supported === true
            : false,
        page_sse_auth_ready:
            capabilities.ok && capabilities.body?.agent_streaming?.page_sse?.auth?.required === true
                ? Boolean(process.env.GPT_IMAGE_APP_PASSWORD_HASH)
                : capabilities.ok,
        page_sse_real_smoke: summarizePageSseSmoke(smoke),
        orchestration_generate_smoke: summarizeSmokeCheck(smoke, ORCHESTRATION_GENERATE_SMOKE_NAME),
        agent_generate_smoke: summarizeSmokeCheck(smoke, AGENT_GENERATE_SMOKE_NAME),
        responses_page_sse_generate_smoke: summarizeSmokeCheck(smoke, PAGE_SSE_GENERATE_SMOKE_NAME),
        responses_agent_generate_smoke: summarizeSmokeCheck(smoke, RESPONSES_AGENT_GENERATE_SMOKE_NAME),
        real_smoke_checks: summarizeSmokeChecks(smoke),
        request_modes: buildRequestModeSummary({
            capabilities: capabilities.ok ? capabilities.body : undefined,
            runtime: runtime.ok ? runtime.body : undefined,
            smoke
        }),
        runtime_environment: buildRuntimeEnvironmentSummary({
            capabilities: capabilities.ok ? capabilities.body : undefined,
            runtime: runtime.ok ? runtime.body : undefined
        }),
        responses_gpt2image_ready:
            capabilities.ok && runtime.ok
                ? capabilities.body?.supported?.image_backend_requirements?.['responses-image-generation']?.enabled ===
                      true && runtime.body?.responsesImageBackend?.enabled === true
                : false,
        responses_image_backend_declared_supported: capabilities.ok
            ? capabilities.body?.supported?.image_backend_requirements?.['responses-image-generation']?.supported ===
              true
            : false,
        billable_smoke: smoke.skipped ? 'skipped' : smoke.ok ? 'ok' : 'failed'
    };
}

function buildRuntimeEnvironmentSummary({ capabilities, runtime }) {
    return {
        state_backend: capabilities?.defaults?.state_backend || 'unknown',
        image_storage_mode: capabilities?.storage?.image_storage_mode || 'unknown',
        postgres_configured: capabilities?.storage?.postgres_configured === true,
        page_sse_auth_required: capabilities?.agent_streaming?.page_sse?.auth?.required === true,
        agent_auth_schemes: Array.isArray(capabilities?.auth?.schemes) ? capabilities.auth.schemes : [],
        orchestration_endpoint: capabilities?.orchestration?.endpoint || null,
        orchestration_transport_selection: capabilities?.orchestration?.transport_selection || null,
        request_mode_control_policy: capabilities?.request_mode_controls?.agent_client_policy || null,
        request_mode_controls:
            runtime?.channelRouting?.requestModeControls || capabilities?.request_mode_controls || null,
        runtime_strategy: runtime?.channelRouting?.strategy || null,
        effective_request_modes: readRequestModeList(runtime?.channelRouting?.effectiveRequestModes),
        streaming_batch_enabled: runtime?.streamingBatch?.enabled === true,
        recommended_concurrency: runtime?.streamingBatch?.recommendedConcurrency ?? null,
        channel_queue_enabled: runtime?.channelQueue?.enabled === true,
        channel_queue_capacity_per_credential: runtime?.channelQueue?.capacityPerCredential ?? null
    };
}

function summarizeSmokeCheck(smoke, name) {
    const check = smoke.checks?.find((item) => item.name === name);
    if (!check || check.skipped) return 'skipped';
    return check.ok ? 'passed' : 'failed';
}

function summarizePageSseSmoke(smoke) {
    const states = [PAGE_SSE_GENERATE_SMOKE_NAME, 'page_sse_edit_2k'].map((name) => summarizeSmokeCheck(smoke, name));
    if (states.includes('failed')) return 'failed';
    if (states.includes('passed')) return 'passed';
    return 'skipped';
}

function summarizeSmokeChecks(smoke) {
    return {
        orchestration_generate_1k: summarizeSmokeCheck(smoke, ORCHESTRATION_GENERATE_SMOKE_NAME),
        agent_generate_1k: summarizeSmokeCheck(smoke, AGENT_GENERATE_SMOKE_NAME),
        responses_page_sse_generate_1k: summarizeSmokeCheck(smoke, PAGE_SSE_GENERATE_SMOKE_NAME),
        responses_agent_generate_1k: summarizeSmokeCheck(smoke, RESPONSES_AGENT_GENERATE_SMOKE_NAME),
        agent_edit_1k: summarizeSmokeCheck(smoke, 'edit_1k'),
        page_sse_edit_2k: summarizeSmokeCheck(smoke, 'page_sse_edit_2k')
    };
}

function buildRequestModeSummary({ capabilities, runtime, smoke }) {
    const supported = readRequestModeList(capabilities?.supported?.request_modes);
    const configured = readRequestModeList(runtime?.channelRouting?.configuredRequestModes);
    const effective = readRequestModeList(runtime?.channelRouting?.effectiveRequestModes);
    const adminWhitelistByChannel = readCapabilitiesRequestModesByChannel(capabilities);
    const effectiveByChannel = readRuntimeRequestModesByChannel(runtime);
    const smokeSummary = Object.fromEntries(
        CHANNEL_REQUEST_MODES.map((mode) => [mode, summarizeRequestModeSmoke(smoke, mode)])
    );
    const gaps = buildRequestModeGaps({
        supported,
        configured,
        effective,
        adminWhitelistByChannel,
        effectiveByChannel,
        smoke: smokeSummary
    });
    return {
        supported,
        configured,
        effective,
        admin_whitelist_by_channel: adminWhitelistByChannel,
        effective_by_channel: effectiveByChannel,
        smoke: smokeSummary,
        gaps,
        suggested_channel_env_key: 'OPENAI_CHANNEL_N_REQUEST_MODES',
        suggested_effective_value: buildSuggestedEffectiveRequestModes({ effective, smoke: smokeSummary }).join(','),
        next_action: buildRequestModeNextAction({ effective, gaps, smoke: smokeSummary })
    };
}

function buildSuggestedEffectiveRequestModes({ effective, smoke }) {
    if (Object.values(smoke).every((value) => value.state === 'skipped')) return effective;
    return effective.filter((mode) => smoke[mode]?.state === 'passed');
}

function buildRequestModeGaps({
    supported,
    configured,
    effective,
    adminWhitelistByChannel,
    effectiveByChannel,
    smoke
}) {
    const supportedModes = Array.isArray(supported) ? supported : [];
    const configuredModes = Array.isArray(configured) ? configured : [];
    const effectiveModes = Array.isArray(effective) ? effective : [];
    const adminChannels = normalizeRequestModeChannelEntries(adminWhitelistByChannel);
    const effectiveChannels = normalizeRequestModeChannelEntries(effectiveByChannel);
    const gaps = [];
    if (effectiveModes.length === 0) {
        gaps.push({
            code: 'no_effective_request_modes',
            severity: 'critical',
            message: '当前服务没有可用上游请求方式；检查 OPENAI_CHANNEL_N_REQUEST_MODES、渠道健康和 API key。'
        });
    }
    const unrecognizedModes = collectUnrecognizedRequestModes(
        supportedModes,
        configuredModes,
        effectiveModes,
        adminChannels.flatMap((channel) => channel.request_modes),
        effectiveChannels.flatMap((channel) => channel.request_modes)
    );
    if (unrecognizedModes.length > 0) {
        gaps.push({
            code: 'unrecognized_request_modes',
            severity: 'warning',
            request_modes: unrecognizedModes,
            message: '服务返回了当前 Agent 未识别的 request mode；升级 skill 或确认服务端模式名称。'
        });
    }
    const unsupportedConfigured = configuredModes.filter((mode) => !supportedModes.includes(mode));
    if (unsupportedConfigured.length > 0) {
        gaps.push({
            code: 'configured_unsupported_request_modes',
            severity: 'warning',
            request_modes: unsupportedConfigured,
            message: '配置中包含服务不支持的 request mode。'
        });
    }
    const configuredButIneffective = configuredModes.filter(
        (mode) => supportedModes.includes(mode) && !effectiveModes.includes(mode)
    );
    if (configuredButIneffective.length > 0) {
        gaps.push({
            code: 'configured_request_modes_not_effective',
            severity: 'warning',
            request_modes: configuredButIneffective,
            message: '部分已配置 request mode 没有在 runtime 生效；检查对应渠道 key、健康状态和白名单。'
        });
    }
    const effectiveByChannelMap = new Map(
        effectiveChannels.map((channel) => [channel.channel_id, channel.request_modes])
    );
    const channelsWithoutModes = [
        ...adminChannels
            .filter((channel) => channel.request_modes.length > 0)
            .filter((channel) => (effectiveByChannelMap.get(channel.channel_id) || []).length === 0),
        ...effectiveChannels.filter((channel) => channel.request_modes.length === 0)
    ];
    const uniqueChannelsWithoutModes = [
        ...new Map(channelsWithoutModes.map((channel) => [channel.channel_id, channel])).values()
    ];
    if (uniqueChannelsWithoutModes.length > 0) {
        gaps.push({
            code: 'channels_without_effective_request_modes',
            severity: 'warning',
            channel_ids: uniqueChannelsWithoutModes.map((channel) => channel.channel_id),
            message: '部分渠道没有生效 request mode。'
        });
    }
    const failedSmokeModes = Object.entries(smoke)
        .filter(([, value]) => value.state === 'failed')
        .map(([mode]) => mode);
    if (failedSmokeModes.length > 0) {
        gaps.push({
            code: 'request_mode_smoke_failed',
            severity: 'critical',
            request_modes: failedSmokeModes,
            message: '真实 smoke 显示部分 request mode 不可用；不要写入渠道白名单。'
        });
    }
    return gaps;
}

function normalizeRequestModeChannelEntries(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((channel) => ({
            channel_id: String(channel?.channel_id || ''),
            request_modes: readRequestModeList(channel?.request_modes)
        }))
        .filter((channel) => channel.channel_id);
}

function collectUnrecognizedRequestModes(...modeLists) {
    const unrecognized = [];
    const seen = new Set();
    for (const modes of modeLists) {
        if (!Array.isArray(modes)) continue;
        for (const mode of modes) {
            if (CHANNEL_REQUEST_MODES.includes(mode) || seen.has(mode)) continue;
            seen.add(mode);
            unrecognized.push(mode);
        }
    }
    return unrecognized;
}

function buildRequestModeNextAction({ effective, gaps, smoke }) {
    if (effective.length === 0) {
        return '先用 probe-upstream-image.mjs 或 npm run smoke:image-upstream-real -- --allow-billable 探测上游，再配置 OPENAI_CHANNEL_N_REQUEST_MODES。';
    }
    if (gaps.some((gap) => gap.code === 'request_mode_smoke_failed')) {
        return '从 OPENAI_CHANNEL_N_REQUEST_MODES 移除 smoke 失败的 request mode，只保留通过的模式。';
    }
    if (
        gaps.some((gap) =>
            ['configured_request_modes_not_effective', 'channels_without_effective_request_modes'].includes(gap.code)
        )
    ) {
        return '先修正未生效的渠道 request mode、API key 或健康状态，再用 --allow-billable smoke 验证真实可用性。';
    }
    if (Object.values(smoke).every((value) => value.state === 'skipped')) {
        return '当前只验证了配置可见性；真实渠道可用性需要显式 --allow-billable smoke。';
    }
    return '当前 request mode 配置可见；以 effective 和 smoke passed 的交集作为管理员白名单候选。';
}

function summarizeRequestModeSmoke(smoke, mode) {
    const checks = CHANNEL_REQUEST_MODE_SMOKE_CASES[mode] || [];
    if (checks.length === 0) {
        return {
            state: 'skipped',
            checks: [],
            billable: false
        };
    }
    const states = checks.map((name) => summarizeSmokeCheck(smoke, name));
    return {
        state: states.includes('failed') ? 'failed' : states.includes('passed') ? 'passed' : 'skipped',
        checks,
        billable: smoke.skipped !== true
    };
}

function readCapabilitiesRequestModesByChannel(body) {
    const channels = Array.isArray(body?.upstream_request_headers?.channels)
        ? body.upstream_request_headers.channels
        : [];
    return channels
        .map((channel) => ({
            channel_id: String(channel?.id || ''),
            request_modes: readRequestModeList(channel?.request_modes)
        }))
        .filter((channel) => channel.channel_id);
}

function readRuntimeRequestModesByChannel(body) {
    const channels = Array.isArray(body?.channelRouting?.effectiveRequestModesByChannel)
        ? body.channelRouting.effectiveRequestModesByChannel
        : [];
    return channels
        .map((channel) => ({
            channel_id: String(channel?.channelId || ''),
            request_modes: readRequestModeList(channel?.requestModes)
        }))
        .filter((channel) => channel.channel_id);
}

function readRequestModeList(value) {
    if (!Array.isArray(value)) return [];
    const modes = [];
    const seen = new Set();
    for (const item of value) {
        const mode = typeof item === 'string' ? item.trim() : '';
        if (!mode || seen.has(mode)) continue;
        seen.add(mode);
        modes.push(mode);
    }
    return modes;
}

function authHeaders() {
    if (process.env.GPT_IMAGE_AGENT_TOKEN) return { Authorization: `Bearer ${process.env.GPT_IMAGE_AGENT_TOKEN}` };
    if (process.env.GPT_IMAGE_APP_PASSWORD_HASH)
        return { 'X-App-Password-Hash': process.env.GPT_IMAGE_APP_PASSWORD_HASH };
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
    const normalized = String(value || '')
        .trim()
        .replace(/\/+$/, '');
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
