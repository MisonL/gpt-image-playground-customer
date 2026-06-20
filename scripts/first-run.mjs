#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMainModule, printJson, redactBaseUrl } from './command-center-utils.mjs';
import { summarizeEnvFile } from './env-summary.mjs';
import {
    loadPrivateAgentEnvFile,
    resolvePlaygroundBaseUrl
} from '../skills/gpt-image-playground-agent/scripts/lib/script-utils.mjs';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_ENV_FILES = ['.env.local', '.env.agent.local'];

function parseArgs(argv) {
    const parsed = {
        help: false,
        json: false,
        baseUrl: undefined,
        timeoutMs: DEFAULT_TIMEOUT_MS
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') parsed.help = true;
        else if (arg === '--json') parsed.json = true;
        else if (arg === '--base-url') parsed.baseUrl = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--timeout-ms') parsed.timeoutMs = readPositiveInteger(readOptionValue(argv, (index += 1), arg), arg);
        else throw new Error(`未知参数：${arg}`);
    }
    return parsed;
}

function printHelp() {
    console.log(`用法：
  npm run first-run
  npm run first-run -- --json
  npm run first-run -- --base-url https://your-space.hf.space

选项：
  --json         输出机器可读 JSON。
  --base-url     显式服务地址，优先于 GPT_IMAGE_PLAYGROUND_URL 和本地探测。
  --timeout-ms   HTTP 探测超时，默认 3000。

first-run 只读、非计费，不写 env 文件或 secret。`);
}

export async function buildFirstRunReport(options = {}, env = process.env) {
    const cwd = options.cwd || process.cwd();
    const envFiles = options.envFiles || DEFAULT_ENV_FILES;
    loadPrivateAgentEnvFile({ cwd, env });
    const base = resolveFirstRunBaseUrl(options.baseUrl, env);
    const envSummary = envFiles.map((filePath) => summarizeEnvFile(join(cwd, filePath)));
    const validationError = readBaseUrlValidationError(base);
    const service = validationError
        ? { ok: false, skipped: true, error: validationError }
        : await probeService(base.baseUrl, {
              timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
              headers: authHeaders(env)
          });
    const agentAuth = readAgentAuthState(env, envSummary);
    const checks = buildChecks({
        cwd,
        env,
        envSummary,
        service,
        base,
        validationError
    });
    const nextActions = buildNextActions({ checks, base, service, env, envSummary, validationError });
    return {
        ok: checks.every((check) => check.ok || check.skipped),
        command: 'first-run',
        billable: false,
        service_base_url: validationError ? undefined : redactBaseUrl(base.baseUrl),
        service_base_url_source: base.source,
        interactive_confirmation_required: base.interactive_confirmation_required,
        agent_auth_process: agentAuth.process,
        private_agent_env: agentAuth.privateEnv,
        checks,
        env_sources: envSummary.map((source) => summarizeEnvSource(source, cwd)),
        service: summarizeService(service),
        next_actions: nextActions
    };
}

async function probeService(baseUrl, options) {
    const capabilities = await readJsonEndpoint(`${baseUrl}/api/agent/capabilities`, options);
    const runtime = capabilities.ok ? await readJsonEndpoint(`${baseUrl}/api/runtime-capabilities`, options) : undefined;
    return {
        ok: capabilities.ok && (!runtime || runtime.ok),
        capabilities,
        ...(runtime ? { runtime } : {})
    };
}

async function readJsonEndpoint(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
        const response = await fetch(url, { headers: options.headers, signal: controller.signal });
        const text = await response.text();
        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                endpoint: safeEndpoint(url),
                error: `HTTP ${response.status}`
            };
        }
        try {
            return {
                ok: true,
                status: response.status,
                endpoint: safeEndpoint(url),
                body: JSON.parse(text)
            };
        } catch {
            return {
                ok: false,
                status: response.status,
                endpoint: safeEndpoint(url),
                error: 'response_not_json'
            };
        }
    } catch (error) {
        return {
            ok: false,
            endpoint: safeEndpoint(url),
            error: error?.name === 'AbortError' ? `timeout_after_${options.timeoutMs}ms` : 'request_failed'
        };
    } finally {
        clearTimeout(timer);
    }
}

function buildChecks({ cwd, env, envSummary, service, base, validationError }) {
    const node = readNodeCheck();
    const packageJson = readPackageJson(cwd);
    const packageLock = existsSync(join(cwd, 'package-lock.json'));
    const nodeModules = existsSync(join(cwd, 'node_modules'));
    const currentToken = Boolean(env.GPT_IMAGE_AGENT_TOKEN || env.GPT_IMAGE_APP_PASSWORD_HASH);
    const fileToken = envSummary.some((source) =>
        ['GPT_IMAGE_AGENT_TOKEN', 'GPT_IMAGE_APP_PASSWORD_HASH'].some((name) => sourceHasSetVariable(source, name))
    );
    return [
        { name: 'node_version', ok: node.ok, current: node.current, required: '>=20.0.0' },
        { name: 'package_lock', ok: packageLock },
        {
            name: 'dependencies_installed',
            ok: nodeModules,
            skipped: false,
            hint: nodeModules ? undefined : 'run npm install'
        },
        {
            name: 'env_files',
            ok: envSummary.some((source) => source.exists),
            files: envSummary.map((source) => ({ path: source.path.replace(`${cwd}/`, ''), exists: source.exists }))
        },
        {
            name: 'agent_auth_available_to_process',
            ok: currentToken,
            skipped: !requiresAgentAuth(service),
            auth_in_private_env_file: fileToken
        },
        {
            name: 'page_sse_auth_available_to_process',
            ok: Boolean(env.GPT_IMAGE_APP_PASSWORD_HASH),
            skipped: !requiresPageSsePasswordHash(service),
            auth_in_private_env_file: envSummary.some((source) =>
                sourceHasSetVariable(source, 'GPT_IMAGE_APP_PASSWORD_HASH')
            )
        },
        {
            name: 'service_base_url_valid',
            ok: !validationError,
            source: base.source,
            ...(validationError ? { error: validationError } : {})
        },
        {
            name: 'service_reachable',
            ok: service.ok,
            endpoint: '/api/agent/capabilities',
            ...(service.capabilities?.status ? { status: service.capabilities.status } : {}),
            ...(service.capabilities?.error ? { error: service.capabilities.error } : {})
        },
        {
            name: 'agent_capabilities_contract',
            ok: isCapabilitiesBody(service.capabilities?.body),
            skipped: !service.capabilities?.ok
        },
        {
            name: 'runtime_capabilities_contract',
            ok: Boolean(service.runtime?.ok),
            skipped: !service.capabilities?.ok
        },
        {
            name: 'package_metadata',
            ok: Boolean(packageJson.name && packageJson.version),
            package: packageJson.name,
            version: packageJson.version
        }
    ];
}

function readAgentAuthState(env, envSummary) {
    const hasToken = Boolean(env.GPT_IMAGE_AGENT_TOKEN);
    const hasPasswordHash = Boolean(env.GPT_IMAGE_APP_PASSWORD_HASH);
    const privateSource = envSummary.find((source) => source.path.endsWith('.env.agent.local'));
    return {
        process: {
            has_token: hasToken,
            has_password_hash: hasPasswordHash,
            has_any_auth: hasToken || hasPasswordHash
        },
        privateEnv: {
            exists: privateSource?.exists === true,
            has_token: privateSource ? sourceHasSetVariable(privateSource, 'GPT_IMAGE_AGENT_TOKEN') : false,
            has_password_hash: privateSource ? sourceHasSetVariable(privateSource, 'GPT_IMAGE_APP_PASSWORD_HASH') : false
        }
    };
}

function buildNextActions({ checks, base, service, env, envSummary, validationError }) {
    const actions = [];
    const hasCurrentAuth = Boolean(env.GPT_IMAGE_AGENT_TOKEN || env.GPT_IMAGE_APP_PASSWORD_HASH);
    const hasFileAuth = envSummary.some((source) =>
        ['GPT_IMAGE_AGENT_TOKEN', 'GPT_IMAGE_APP_PASSWORD_HASH'].some((name) => sourceHasSetVariable(source, name))
    );
    if (!findCheck(checks, 'node_version').ok) actions.push('安装 Node.js 20 或更新版本。');
    if (!findCheck(checks, 'dependencies_installed').ok) actions.push('运行 npm install。');
    if (!findCheck(checks, 'env_files').ok) {
        actions.push('复制 .env.example 为 .env.local，或在页面设置里配置默认上游。');
    }
    if (validationError) {
        actions.push('把 GPT_IMAGE_PLAYGROUND_URL 或 --base-url 设为不含凭据、查询参数或片段的 http/https 地址。');
        return actions;
    }
    if (!hasCurrentAuth && requiresAgentAuth(service) && !hasFileAuth) {
        actions.push(
            '在仓库外导出 GPT_IMAGE_AGENT_TOKEN 或 GPT_IMAGE_APP_PASSWORD_HASH，再运行受保护的 Agent 脚本。'
        );
    }
    if (requiresPageSsePasswordHash(service) && !env.GPT_IMAGE_APP_PASSWORD_HASH) {
        actions.push(
            '如果要使用页面 SSE、Responses backend edit 或 --page-sse，请在本机私有 .env.agent.local 中设置 GPT_IMAGE_APP_PASSWORD_HASH；Agent 脚本会自动读取该文件，GPT_IMAGE_AGENT_TOKEN 只覆盖 Agent JSON 鉴权。'
        );
    }
    if (!service.ok && !requiresAgentAuth(service)) {
        actions.push('先用 npm run dev 或 docker compose up -d --build --remove-orphans 启动服务，再重新运行 npm run first-run。');
    }
    if (base.interactive_confirmation_required) {
        actions.push('在交互式 Agent 任务里，先和用户确认探测到的服务地址，再发真实请求。');
    }
    if (!hasCurrentAuth && hasFileAuth) {
        actions.push('Agent 脚本会自动读取 .env.agent.local；如果仍提示缺少鉴权，请确认文件位于当前仓库根目录且变量名正确。');
    }
    if (service.ok && hasCurrentAuth) {
        actions.push('运行 npm run agent:doctor 做完整的非计费 Agent 合同检查。');
    }
    return actions;
}

function requiresAgentAuth(service) {
    if (service.capabilities?.status === 401 || service.capabilities?.status === 403) return true;
    const schemes = service.capabilities?.body?.auth?.schemes;
    return Array.isArray(schemes) && schemes.length > 0;
}

function requiresPageSsePasswordHash(service) {
    return service.capabilities?.body?.agent_streaming?.page_sse?.auth?.required === true;
}

function sourceHasSetVariable(source, name) {
    return source.exists && source.variables.some((item) => item.name === name && item.set === true);
}

function summarizeEnvSource(source, cwd) {
    return {
        path: source.path.startsWith(`${cwd}/`) ? source.path.slice(cwd.length + 1) : source.path,
        exists: source.exists,
        variable_count: source.variable_count || 0,
        configured: source.variables
            .filter((item) => item.set)
            .map((item) => ({
                name: item.name,
                sensitive: item.sensitive,
                value_kind: item.value_kind
            }))
    };
}

function summarizeService(service) {
    const capabilities = service.capabilities || {};
    const runtime = service.runtime;
    return {
        ok: service.ok,
        capabilities: {
            ok: capabilities.ok === true,
            endpoint: capabilities.endpoint,
            ...(capabilities.status ? { status: capabilities.status } : {}),
            ...(capabilities.error ? { error: capabilities.error } : {}),
            ...(capabilities.ok ? summarizeCapabilitiesBody(capabilities.body) : {})
        },
        ...(runtime
            ? {
                  runtime: {
                      ok: runtime.ok === true,
                      endpoint: runtime.endpoint,
                      ...(runtime.status ? { status: runtime.status } : {}),
                      ...(runtime.error ? { error: runtime.error } : {}),
                      ...(runtime.ok ? summarizeRuntimeBody(runtime.body) : {})
                  }
              }
            : {})
    };
}

function summarizeCapabilitiesBody(body) {
    const responsesRequirement = body?.supported?.image_backend_requirements?.['responses-image-generation'];
    return {
        auth_required: body?.auth?.required === true,
        auth_schemes: Array.isArray(body?.auth?.schemes) ? body.auth.schemes : [],
        page_sse_auth_required: body?.agent_streaming?.page_sse?.auth?.required === true,
        page_sse_auth_form_field: body?.agent_streaming?.page_sse?.auth?.form_field,
        state_backend: body?.defaults?.state_backend,
        image_storage_mode: body?.storage?.image_storage_mode,
        agent_jobs_supported: body?.agent_jobs?.supported === true,
        page_sse_supported: body?.agent_streaming?.page_sse?.supported === true,
        page_sse_declared_supported: body?.agent_streaming?.page_sse?.supported === true,
        page_sse_real_smoke: 'not_run_by_first_run',
        upstream_sse_declared_supported: body?.agent_streaming?.upstream_sse?.supported === true,
        responses_image_backend_declared_supported: responsesRequirement?.supported === true,
        responses_image_backend_enabled: responsesRequirement?.enabled === true,
        responses_image_backend_real_smoke: 'not_run_by_first_run'
    };
}

function summarizeRuntimeBody(body) {
    return {
        default_streaming_strategy: body?.streaming?.defaultStrategy,
        streaming_batch_enabled: body?.streamingBatch?.enabled === true,
        recommended_concurrency: body?.streamingBatch?.recommendedConcurrency,
        channel_capacity_per_credential: body?.channelQueue?.capacityPerCredential,
        responses_image_backend_enabled: body?.responsesImageBackend?.enabled === true
    };
}

function findCheck(checks, name) {
    return checks.find((check) => check.name === name) || { ok: false };
}

function readNodeCheck() {
    const match = process.version.match(/^v(\d+)\./);
    const major = match ? Number(match[1]) : 0;
    return { ok: major >= 20, current: process.version };
}

function readPackageJson(cwd) {
    try {
        return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    } catch {
        return {};
    }
}

function isCapabilitiesBody(body) {
    return Boolean(body && typeof body === 'object' && body.supported && body.defaults);
}

function authHeaders(env) {
    if (env.GPT_IMAGE_AGENT_TOKEN) return { Authorization: `Bearer ${env.GPT_IMAGE_AGENT_TOKEN}` };
    if (env.GPT_IMAGE_APP_PASSWORD_HASH) return { 'X-App-Password-Hash': env.GPT_IMAGE_APP_PASSWORD_HASH };
    return {};
}

function readBaseUrlValidationError(base) {
    return base.error;
}

function resolveFirstRunBaseUrl(explicitBaseUrl, env) {
    try {
        return resolvePlaygroundBaseUrl(explicitBaseUrl, env);
    } catch (error) {
        return {
            baseUrl: '',
            source: explicitBaseUrl ? 'user_provided' : env.GPT_IMAGE_PLAYGROUND_URL ? 'GPT_IMAGE_PLAYGROUND_URL' : 'default_local_probe',
            interactive_confirmation_required: explicitBaseUrl ? false : true,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export function formatFirstRunText(report) {
    const lines = [];
    lines.push(`首次配置检查：${report.ok ? '通过' : '需要处理'}`);
    if (report.service_base_url) {
        lines.push(`服务地址：${report.service_base_url}（${formatServiceSource(report.service_base_url_source)}）`);
    } else {
        lines.push(`服务地址：无效（${readCheckError(report, 'service_base_url_valid') || 'unknown'}）`);
    }
    lines.push(`交互式确认：${report.interactive_confirmation_required ? '需要' : '不需要'}`);
    lines.push(`当前进程鉴权：${formatAuthState(report.agent_auth_process)}`);
    lines.push(`私有 Agent env：${formatPrivateEnvState(report.private_agent_env)}`);
    lines.push('');
    lines.push('检查项：');
    for (const check of report.checks) {
        lines.push(`- ${formatCheckLabel(check.name)}：${formatCheckStatus(check)}`);
    }
    lines.push('');
    lines.push('服务摘要：');
    lines.push(`- 能力：${formatEndpoint(report.service?.capabilities)}`);
    lines.push(`- 运行时：${formatEndpoint(report.service?.runtime)}`);
    const capability = report.service?.capabilities || {};
    if (capability.ok) {
        lines.push(`- 鉴权：${capability.auth_required ? capability.auth_schemes.join(',') || '需要' : '不需要'}`);
        lines.push(
            `- 页面 SSE 鉴权：${capability.page_sse_auth_required ? `需要 ${capability.page_sse_auth_form_field || 'passwordHash'}` : '不需要'}`
        );
        lines.push(
            `- 页面 SSE：声明${capability.page_sse_declared_supported ? '支持' : '未支持'}，实测=${formatSmokeState(capability.page_sse_real_smoke)}`
        );
        lines.push(
            `- Responses 后端：声明${capability.responses_image_backend_declared_supported ? '支持' : '未支持'}，启用=${capability.responses_image_backend_enabled ? '是' : '否'}，实测=${formatSmokeState(capability.responses_image_backend_real_smoke)}`
        );
        lines.push(`- 状态后端：${capability.state_backend || '未知'}，图片存储：${capability.image_storage_mode || '未知'}`);
    }
    const runtime = report.service?.runtime || {};
    if (runtime.ok) {
        lines.push(
            `- 并发建议：推荐=${runtime.recommended_concurrency ?? '未知'}，每凭证容量=${runtime.channel_capacity_per_credential ?? '未知'}`
        );
    }
    lines.push('');
    lines.push('下一步：');
    if (report.next_actions.length === 0) {
        lines.push('- 无');
    } else {
        for (const action of report.next_actions) lines.push(`- ${action}`);
    }
    return `${lines.join('\n')}\n`;
}

function formatCheckStatus(check) {
    if (check.skipped) return '已跳过';
    if (check.ok) return '通过';
    if (check.status) return `失败（${check.status}）`;
    if (check.error) return `失败（${check.error}）`;
    return '失败';
}

function formatEndpoint(endpoint) {
    if (!endpoint) return '已跳过';
    if (endpoint.ok) return `通过 ${endpoint.status || ''}`.trim();
    return `失败${endpoint.status ? ` ${endpoint.status}` : ''}${endpoint.error ? ` ${endpoint.error}` : ''}`;
}

function formatSmokeState(value) {
    const states = {
        not_run_by_first_run: '未执行真实 smoke',
        skipped: '已跳过',
        passed: '通过',
        failed: '失败'
    };
    return states[value] || value || '未知';
}

function formatAuthState(auth) {
    if (!auth) return '未知';
    if (auth.has_token) return '已加载 token';
    if (auth.has_password_hash) return '已加载访问码哈希';
    return '未加载';
}

function formatPrivateEnvState(privateEnv) {
    if (!privateEnv?.exists) return '不存在';
    if (privateEnv.has_token) return '存在，含 token';
    if (privateEnv.has_password_hash) return '存在，含访问码哈希';
    return '存在，未发现 Agent 鉴权变量';
}

function readCheckError(report, name) {
    const check = report.checks.find((item) => item.name === name);
    return check?.error;
}

function formatServiceSource(source) {
    if (source === 'user_provided') return '用户提供';
    if (source === 'GPT_IMAGE_PLAYGROUND_URL') return '环境变量 GPT_IMAGE_PLAYGROUND_URL';
    if (source === 'default_local_probe') return '默认本地探测';
    return source || '未知来源';
}

function formatCheckLabel(name) {
    const labels = {
        node_version: 'Node.js 版本',
        package_lock: 'package-lock.json',
        dependencies_installed: '依赖是否已安装',
        env_files: '环境文件',
        agent_auth_available_to_process: 'Agent 鉴权可用',
        page_sse_auth_available_to_process: '页面 SSE 鉴权可用',
        service_base_url_valid: '服务地址合法',
        service_reachable: '服务可达',
        agent_capabilities_contract: 'Agent capabilities 合同',
        runtime_capabilities_contract: 'runtime capabilities 合同',
        package_metadata: '包信息'
    };
    return labels[name] || name;
}

function safeEndpoint(url) {
    try {
        return new URL(url).pathname;
    } catch {
        return String(url);
    }
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

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    const report = await buildFirstRunReport(options);
    if (options.json) {
        printJson(report);
    } else {
        process.stdout.write(formatFirstRunText(report));
    }
    if (!report.ok) process.exit(1);
}

try {
    if (isMainModule(import.meta.url, process.argv[1])) await main();
} catch (error) {
    printJson({ ok: false, command: 'first-run', billable: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}
