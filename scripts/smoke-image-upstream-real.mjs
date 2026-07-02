#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

const originalEnv = { ...process.env };
const CASES = [
    { id: 'original-images-json', prefix: 'IMAGE_REAL_SMOKE_ORIGINAL', stream: false },
    { id: 'gaoren-images-sse', prefix: 'IMAGE_REAL_SMOKE_GAOREN', stream: true, strategy: 'newapi-keepalive-sse' },
    { id: 'sub2api-images-sse', prefix: 'IMAGE_REAL_SMOKE_SUB2API', stream: true, strategy: 'newapi-keepalive-sse' },
    {
        id: 'sub2api-responses-json',
        prefix: 'IMAGE_REAL_SMOKE_SUB2API_RESPONSES',
        fallbackPrefix: 'IMAGE_REAL_SMOKE_SUB2API',
        stream: false,
        backend: 'responses-image-generation'
    },
    {
        id: 'gpt2image-responses-sse',
        prefix: 'IMAGE_REAL_SMOKE_GPT2IMAGE',
        stream: true,
        strategy: 'responses-sse',
        backend: 'responses-image-generation'
    },
    {
        id: 'matsca-images-sse',
        prefix: 'IMAGE_REAL_SMOKE_MATSCA',
        stream: true,
        strategy: 'newapi-keepalive-sse'
    }
];
const SERVER_CHANNEL_CASES = [
    { id: 'server-channel-images-json', prefix: 'IMAGE_REAL_SMOKE_SERVER', stream: false, serverChannel: true },
    {
        id: 'server-channel-images-sse',
        prefix: 'IMAGE_REAL_SMOKE_SERVER',
        stream: true,
        strategy: 'newapi-keepalive-sse',
        serverChannel: true
    },
    {
        id: 'server-channel-responses-sse',
        prefix: 'IMAGE_REAL_SMOKE_SERVER',
        stream: true,
        strategy: 'responses-sse',
        backend: 'responses-image-generation',
        serverChannel: true
    },
    {
        id: 'server-channel-responses-json',
        prefix: 'IMAGE_REAL_SMOKE_SERVER',
        stream: false,
        backend: 'responses-image-generation',
        serverChannel: true
    },
    {
        id: 'server-channel-agent-images-sse',
        prefix: 'IMAGE_REAL_SMOKE_SERVER',
        stream: true,
        strategy: 'newapi-keepalive-sse',
        serverChannel: true,
        endpoint: 'agent-generate'
    },
    {
        id: 'server-channel-agent-responses-sse',
        prefix: 'IMAGE_REAL_SMOKE_SERVER',
        stream: true,
        strategy: 'responses-sse',
        backend: 'responses-image-generation',
        serverChannel: true,
        endpoint: 'agent-generate'
    },
    {
        id: 'server-channel-agent-responses-json',
        prefix: 'IMAGE_REAL_SMOKE_SERVER',
        stream: false,
        backend: 'responses-image-generation',
        serverChannel: true,
        endpoint: 'agent-generate'
    }
];

const argv = process.argv.slice(2);
let options;
let exitCode = 0;
let forceExitAfterReport = false;
try {
    if (!isHelpRequested(argv)) loadDotEnvFiles(argv);
    options = parseArgs(argv);
    if (options.help) {
        printUsage();
    } else {
        configureRouteEnv();
        const availableCases = options.includeServerChannel ? [...CASES, ...SERVER_CHANNEL_CASES] : CASES;
        const selectedCases = availableCases.filter(
            (testCase) => options.caseId === 'all' || testCase.id === options.caseId
        );
        if (selectedCases.length === 0) throw new Error(`未知真实 smoke 场景：${options.caseId}`);
        const billablePreflight = buildBillablePreflight(selectedCases);
        const results = [];
        const routeHandlersByEndpoint = {};
        for (const testCase of selectedCases) {
            const loadHandlers = async (caseConfig) => {
                const endpoint = readRouteHandlerEndpoint(caseConfig);
                routeHandlersByEndpoint[endpoint] ||= await loadRouteHandlers(endpoint);
                return routeHandlersByEndpoint[endpoint];
            };
            const result = await runCase(loadHandlers, testCase, billablePreflight);
            results.push(result);
            if (result.timed_out) break;
        }
        const independentTargetSummary = buildIndependentTargetSummary(results, options.requireIndependentTargets);
        const unselectedRequiredCases = options.requireIndependentTargets
            ? independentTargetSummary?.unselected_required_cases || []
            : [];
        const invalidRequiredCases = options.requireIndependentTargets
            ? independentTargetSummary?.invalid_cases || []
            : [];
        const blockedCases = results.filter((item) => item.blocked).map((item) => item.id);
        const blockedRequiredCases = options.requireIndependentTargets
            ? blockedCases.filter((id) => CASES.some((testCase) => testCase.id === id))
            : [];
        const skippedRequiredCases = options.requireIndependentTargets
            ? results.filter((item) => item.skipped && !item.blocked && !item.server_channel).map((item) => item.id)
            : [];
        const missingRequiredCaseSet = new Set([...unselectedRequiredCases, ...skippedRequiredCases]);
        const missingRequiredCases = CASES.map((testCase) => testCase.id).filter((id) =>
            missingRequiredCaseSet.has(id)
        );
        const finalGateSatisfied = isFinalGateSatisfied(results, missingRequiredCases);
        const report = {
            ok:
                results.every((item) => item.ok || item.skipped) &&
                missingRequiredCases.length === 0 &&
                invalidRequiredCases.length === 0,
            billable: options.allowBillable,
            final_gate_satisfied: finalGateSatisfied,
            ...(independentTargetSummary ? { independent_targets: independentTargetSummary } : {}),
            ...(unselectedRequiredCases.length > 0 ? { unselected_required_cases: unselectedRequiredCases } : {}),
            ...(invalidRequiredCases.length > 0 ? { invalid_required_count: invalidRequiredCases.length } : {}),
            ...(invalidRequiredCases.length > 0 ? { invalid_required_cases: invalidRequiredCases } : {}),
            ...(blockedCases.length > 0 ? { blocked_count: blockedCases.length } : {}),
            ...(blockedCases.length > 0 ? { blocked_cases: blockedCases } : {}),
            ...(blockedRequiredCases.length > 0 ? { blocked_required_count: blockedRequiredCases.length } : {}),
            ...(blockedRequiredCases.length > 0 ? { blocked_required_cases: blockedRequiredCases } : {}),
            ...(skippedRequiredCases.length > 0 ? { skipped_required_cases: skippedRequiredCases } : {}),
            ...(missingRequiredCases.length > 0 ? { missing_required_count: missingRequiredCases.length } : {}),
            ...(missingRequiredCases.length > 0 ? { missing_required_cases: missingRequiredCases } : {}),
            results
        };
        forceExitAfterReport = results.some((item) => item.timed_out);
        await writeStdout(`${JSON.stringify(report, null, 2)}\n`);
        exitCode = report.ok ? 0 : 1;
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exitCode = 1;
} finally {
    restoreProcessEnv();
}
if (forceExitAfterReport) {
    process.exit(exitCode);
}
process.exitCode = exitCode;

function writeStdout(text) {
    return new Promise((resolve, reject) => {
        process.stdout.write(text, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function isFinalGateSatisfied(results, missingRequiredCases) {
    if (!options.requireIndependentTargets || !options.allowBillable || missingRequiredCases.length > 0) return false;
    const passedIndependentCases = new Set(
        results.filter((item) => !item.server_channel && !item.skipped && item.ok).map((item) => item.id)
    );
    return CASES.every((testCase) => passedIndependentCases.has(testCase.id));
}

function buildBillablePreflight(selectedCases) {
    if (!options.allowBillable) return {};
    if (selectedCases.some((testCase) => readInvalidEnv(readTarget(testCase)).length > 0)) {
        return { blockBillable: true, blockReason: 'blocked by invalid base url env' };
    }
    if (options.requireIndependentTargets && !isRequiredIndependentGateConfigured(selectedCases)) {
        return { blockBillable: true, blockReason: 'blocked by incomplete independent target configuration' };
    }
    return {};
}

function isRequiredIndependentGateConfigured(selectedCases) {
    const selectedIndependentCaseIds = new Set(
        selectedCases.filter((testCase) => !testCase.serverChannel).map((testCase) => testCase.id)
    );
    return CASES.every((testCase) => {
        if (!selectedIndependentCaseIds.has(testCase.id)) return false;
        const target = readTarget(testCase);
        return readInvalidEnv(target).length === 0 && isRunnableTarget(target);
    });
}

function parseArgs(argv) {
    const parsed = {
        allowBillable: false,
        caseId: 'all',
        envFilePath: undefined,
        help: false,
        includeServerChannel: false,
        requireIndependentTargets: false,
        timeoutMs: readTimeoutMs(env('IMAGE_REAL_SMOKE_TIMEOUT_MS') || '240000', 'IMAGE_REAL_SMOKE_TIMEOUT_MS')
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--allow-billable') parsed.allowBillable = true;
        else if (arg === '--env-file') parsed.envFilePath = readArgValue(argv, (index += 1), arg);
        else if (arg === '--env-file-if-exists') parsed.envFileIfExistsPath = readArgValue(argv, (index += 1), arg);
        else if (arg === '--include-server-channel') parsed.includeServerChannel = true;
        else if (arg === '--require-independent-targets') parsed.requireIndependentTargets = true;
        else if (arg === '--timeout-ms') parsed.timeoutMs = readTimeoutMs(readArgValue(argv, (index += 1), arg), arg);
        else if (arg === '--case') parsed.caseId = readArgValue(argv, (index += 1), arg);
        else if (arg === '--help' || arg === '-h') parsed.help = true;
        else throw new Error(`未知参数：${arg}`);
    }
    return parsed;
}

function isHelpRequested(argv) {
    return argv.includes('--help') || argv.includes('-h');
}

function readTimeoutMs(value, source) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1000) {
        throw new Error(`${source} 必须是不小于 1000 的整数毫秒。`);
    }
    return parsed;
}

function readArgValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数值。`);
    return value;
}

function loadDotEnvFiles(argv) {
    if (env('IMAGE_REAL_SMOKE_SKIP_DOTENV') !== '1') {
        loadEnvFileIfPresent('.env.local', { overrideLoadedValues: false });
    }
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] !== '--env-file') continue;
        loadEnvFile(readArgValue(argv, (index += 1), '--env-file'), { overrideLoadedValues: true });
    }
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] !== '--env-file-if-exists') continue;
        loadEnvFileIfPresent(readArgValue(argv, (index += 1), '--env-file-if-exists'), { overrideLoadedValues: true });
    }
}

function loadEnvFileIfPresent(filepath, options) {
    if (!fs.existsSync(filepath)) return;
    loadEnvFile(filepath, options);
}

function loadEnvFile(filepath, options) {
    if (!fs.existsSync(filepath)) throw new Error(`--env-file 指定的文件不存在：${filepath}`);
    for (const line of fs.readFileSync(filepath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || !shouldSetLoadedEnv(match[1], options)) continue;
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
    }
}

function shouldSetLoadedEnv(key, options) {
    if (originalEnv[key] !== undefined) return false;
    return options.overrideLoadedValues || process.env[key] === undefined;
}

function restoreProcessEnv() {
    for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
}

function configureRouteEnv() {
    if (process.env.NODE_ENV === 'test') process.env.NODE_ENV = 'development';
    process.env.APP_LOG_LEVEL = 'warn';
    process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE = 'indexeddb';
    process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
    process.env.AGENT_STATE_BACKEND = 'memory';
    process.env.IMAGE_OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || 'generated-images/.real-smoke';
}

function readRouteHandlerEndpoint(testCase) {
    return testCase.endpoint === 'agent-generate' ? 'agentGenerate' : 'images';
}

async function loadRouteHandlers(endpoint) {
    if (endpoint === 'agentGenerate') {
        const agentGenerateRoute = await import('../src/app/api/agent/images/generate/route.ts');
        return { agentGenerate: readPostHandler(agentGenerateRoute, '/api/agent/images/generate') };
    }
    const imageRoute = await import('../src/app/api/images/route.ts');
    return { images: readPostHandler(imageRoute, '/api/images') };
}

function readPostHandler(routeModule, label) {
    const handler = routeModule.POST || routeModule.default?.POST || routeModule['module.exports']?.POST;
    if (typeof handler !== 'function') {
        throw new Error(`${label} route 缺少 POST handler。`);
    }
    return handler;
}

async function runCase(loadRouteHandlersForBillable, testCase, preflight = {}) {
    const target = readTarget(testCase);
    const invalidEnv = readInvalidEnv(target);
    if (invalidEnv.length > 0) return invalid(testCase, target, invalidEnv);
    if (!isRunnableTarget(target)) return skipped(testCase, target);
    if (preflight.blockBillable && options.allowBillable) return blocked(testCase, target, preflight.blockReason);
    if (!options.allowBillable) {
        return {
            id: testCase.id,
            skipped: true,
            ok: true,
            reason: 'requires --allow-billable',
            upstream_host: readHost(target.baseUrl),
            ...(target.serverChannel ? { server_channel: true } : {})
        };
    }
    const startedAt = Date.now();
    const abortController = new AbortController();
    return withCaseTimeout(
        () => runBillableCaseAfterLoadingHandlers(loadRouteHandlersForBillable, testCase, target, startedAt, abortController.signal),
        testCase,
        target,
        startedAt,
        abortController
    );
}

async function runBillableCaseAfterLoadingHandlers(loadRouteHandlersForBillable, testCase, target, startedAt, signal) {
    const routeHandlers = await loadRouteHandlersForBillable(testCase);
    return runBillableCase(routeHandlers, testCase, target, startedAt, signal);
}

async function runBillableCase(routeHandlers, testCase, target, startedAt, signal) {
    const outputFilesBefore = snapshotRealSmokeOutputFiles();
    if (testCase.endpoint === 'agent-generate' && testCase.backend === 'responses-image-generation') {
        process.env.OPENAI_RESPONSES_API_MODEL = target.responsesModel;
    }
    try {
        const response =
            testCase.endpoint === 'agent-generate'
                ? await routeHandlers.agentGenerate(agentGenerateRequest(testCase, target, signal))
                : await routeHandlers.images(imageRequest(testCase, target, signal));
        const summary =
            testCase.endpoint === 'agent-generate'
                ? await summarizeAgentResponse(response)
                : await summarizeResponse(response);
        return {
            id: testCase.id,
            ok: isSuccessfulBillableSmokeResponse(response, summary),
            status: response.status,
            elapsed_ms: Date.now() - startedAt,
            upstream_host: readHost(target.baseUrl),
            ...(target.serverChannel ? { server_channel: true } : {}),
            ...summary
        };
    } finally {
        removeNewRealSmokeOutputFiles(outputFilesBefore);
    }
}

function withCaseTimeout(run, testCase, target, startedAt, abortController) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            settled = true;
            abortController.abort();
            resolve({
                id: testCase.id,
                ok: false,
                timed_out: true,
                elapsed_ms: Date.now() - startedAt,
                upstream_host: readHost(target.baseUrl),
                ...(target.serverChannel ? { server_channel: true } : {}),
                error: `real upstream smoke timed out after ${options.timeoutMs}ms`
            });
        }, options.timeoutMs);
        run().then(
            (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                reject(error);
            }
        );
    });
}

function readTarget(testCase) {
    const basePrefix = testCase.prefix;
    const fallbackPrefix = testCase.fallbackPrefix || basePrefix;
    const requiresResponsesModel = testCase.backend === 'responses-image-generation';
    if (testCase.serverChannel) {
        const serverBaseUrl = readEnvEntry(`${basePrefix}_BASE_URL`) || readFirstConfiguredServerBaseUrl();
        return {
            serverChannel: true,
            requiresResponsesModel,
            baseUrl: serverBaseUrl?.value,
            baseUrlKey: serverBaseUrl?.key,
            hasServerCredential: Boolean(env('OPENAI_API_KEY') || readFirstConfiguredServerApiKeys()),
            model: env(`${basePrefix}_MODEL`) || 'gpt-image-2',
            responsesModel: env(`${basePrefix}_RESPONSES_MODEL`) || env('OPENAI_RESPONSES_API_MODEL'),
            size: env(`${basePrefix}_SIZE`) || '1024x1024',
            quality: env(`${basePrefix}_QUALITY`) || 'low'
        };
    }
    const baseUrl = readFirstEnvEntry(readSmokeEnvAlternatives(testCase, 'BASE_URL'));
    const apiKey = readFirstEnvEntry(readSmokeEnvAlternatives(testCase, 'API_KEY'));
    return {
        requiresResponsesModel,
        baseUrl: baseUrl?.value,
        baseUrlKey: baseUrl?.key,
        apiKey: apiKey?.value,
        model: env(`${basePrefix}_MODEL`) || env(`${fallbackPrefix}_MODEL`) || 'gpt-image-2',
        responsesModel: env(`${basePrefix}_RESPONSES_MODEL`) || env('OPENAI_RESPONSES_API_MODEL'),
        size: env(`${basePrefix}_SIZE`) || env(`${fallbackPrefix}_SIZE`) || '1024x1024',
        quality: env(`${basePrefix}_QUALITY`) || env(`${fallbackPrefix}_QUALITY`) || 'low'
    };
}

function isRunnableTarget(target) {
    if (!target.baseUrl) return false;
    if (target.requiresResponsesModel && !target.responsesModel) return false;
    if (target.serverChannel) return target.hasServerCredential;
    if (!target.apiKey) return false;
    return true;
}

function readInvalidEnv(target) {
    if (!target.baseUrl || !target.baseUrlKey) return [];
    const reason = readBaseUrlValidationReason(target.baseUrl);
    return reason ? [{ key: target.baseUrlKey, reason }] : [];
}

function readBaseUrlValidationReason(value) {
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

function skipped(testCase, target) {
    const missingEnvAny = readMissingEnvAny(testCase, target);
    return {
        id: testCase.id,
        skipped: true,
        ok: true,
        reason: readSkippedReason(target),
        ...(missingEnvAny.length > 0 ? { missing_env_any: missingEnvAny } : {}),
        ...(target.serverChannel ? { server_channel: true } : {})
    };
}

function invalid(testCase, target, invalidEnv) {
    return {
        id: testCase.id,
        ok: false,
        invalid: true,
        reason: 'invalid base url env',
        invalid_env: invalidEnv,
        ...(target.serverChannel ? { server_channel: true } : {})
    };
}

function blocked(testCase, target, reason = 'blocked by invalid base url env') {
    return {
        id: testCase.id,
        skipped: true,
        blocked: true,
        ok: true,
        reason,
        upstream_host: readHost(target.baseUrl),
        ...(target.serverChannel ? { server_channel: true } : {})
    };
}

function buildIndependentTargetSummary(results, requireIndependentTargets = false) {
    const independentResults = results.filter((item) => !item.server_channel);
    const requiredCases = CASES.map((testCase) => testCase.id);
    if (independentResults.length === 0 && !requireIndependentTargets) return undefined;
    const selectedCases = independentResults.map((item) => item.id);
    const unselectedRequiredCases = requiredCases.filter((id) => !selectedCases.includes(id));
    const configuredCases = independentResults
        .filter(
            (item) =>
                (!Array.isArray(item.missing_env_any) || item.missing_env_any.length === 0) &&
                (!Array.isArray(item.invalid_env) || item.invalid_env.length === 0)
        )
        .map((item) => item.id);
    const missingCases = independentResults
        .filter((item) => Array.isArray(item.missing_env_any) && item.missing_env_any.length > 0)
        .map((item) => item.id);
    const invalidCases = independentResults
        .filter((item) => Array.isArray(item.invalid_env) && item.invalid_env.length > 0)
        .map((item) => item.id);
    return {
        required_count: requiredCases.length,
        required_cases: requiredCases,
        selected_cases: selectedCases,
        unselected_required_count: unselectedRequiredCases.length,
        unselected_required_cases: unselectedRequiredCases,
        configuration_complete:
            unselectedRequiredCases.length === 0 && missingCases.length === 0 && invalidCases.length === 0,
        selected_count: independentResults.length,
        configured_count: configuredCases.length,
        missing_count: missingCases.length,
        configured_cases: configuredCases,
        missing_cases: missingCases,
        invalid_count: invalidCases.length,
        invalid_cases: invalidCases,
        invalid_env: Object.fromEntries(
            independentResults
                .filter((item) => Array.isArray(item.invalid_env) && item.invalid_env.length > 0)
                .map((item) => [item.id, item.invalid_env])
        ),
        final_gate_command:
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable'
    };
}

function readSkippedReason(target) {
    if (!target.baseUrl) return target.serverChannel ? 'missing server channel base url env' : 'missing base url env';
    if (target.serverChannel && !target.hasServerCredential) return 'missing server channel api key env';
    if (!target.serverChannel && !target.apiKey) return 'missing api key env';
    if (target.requiresResponsesModel && !target.responsesModel) return 'missing responses model env';
    return target.serverChannel ? 'missing server channel api key env' : 'missing api key env';
}

function readMissingEnvAny(testCase, target) {
    const groups = [];
    if (!target.baseUrl) {
        groups.push(readSmokeEnvAlternatives(testCase, 'BASE_URL'));
    }
    if (target.serverChannel && target.baseUrl && !target.hasServerCredential) {
        groups.push(['OPENAI_API_KEY', 'OPENAI_CHANNEL_1_API_KEYS']);
    }
    if (!target.serverChannel && target.baseUrl && !target.apiKey) {
        groups.push(readSmokeEnvAlternatives(testCase, 'API_KEY'));
    }
    if (target.requiresResponsesModel && target.baseUrl && !target.responsesModel) {
        groups.push(readResponsesModelEnvAlternatives(testCase));
    }
    return groups;
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

function env(key) {
    const value = process.env[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readEnvEntry(key) {
    const value = env(key);
    return value ? { key, value } : undefined;
}

function readFirstEnvEntry(keys) {
    for (const key of keys) {
        const value = readEnvEntry(key);
        if (value) return value;
    }
    return undefined;
}

function readFirstConfiguredServerBaseUrl() {
    return readEnvEntry('OPENAI_API_BASE_URL') || readFirstNumberedEnvEntry('OPENAI_CHANNEL_', '_BASE_URL');
}

function readFirstConfiguredServerApiKeys() {
    return env('OPENAI_API_KEY') || readFirstNumberedEnv('OPENAI_CHANNEL_', '_API_KEYS');
}

function readFirstNumberedEnv(prefix, suffix) {
    for (let index = 1; index <= 20; index += 1) {
        const value = env(`${prefix}${index}${suffix}`);
        if (value) return value;
    }
    return undefined;
}

function readFirstNumberedEnvEntry(prefix, suffix) {
    for (let index = 1; index <= 20; index += 1) {
        const value = readEnvEntry(`${prefix}${index}${suffix}`);
        if (value) return value;
    }
    return undefined;
}

function imageRequest(testCase, target, signal) {
    const formData = new FormData();
    const fields = {
        mode: 'generate',
        prompt: 'real upstream compatibility smoke',
        model: target.model,
        n: '1',
        size: target.size,
        quality: target.quality,
        output_format: 'png',
        clientRequestId: `real-smoke-${testCase.id}`
    };
    for (const [key, value] of Object.entries(fields)) formData.append(key, value);
    if (!target.serverChannel) {
        formData.append('apiBaseUrl', target.baseUrl);
        formData.append('apiKey', target.apiKey);
    }
    const pagePasswordHash = readAppPasswordHash();
    if (pagePasswordHash) formData.append('passwordHash', pagePasswordHash);
    formData.append('imageBackend', testCase.backend || 'images-api');
    formData.append('imageStreamingStrategy', testCase.strategy || 'off');
    if (testCase.backend === 'responses-image-generation') formData.append('responsesModel', target.responsesModel);
    if (testCase.stream) {
        formData.append('stream', 'true');
        formData.append('partial_images', '2');
    }
    return new Request('http://localhost/api/images', { method: 'POST', body: formData, signal });
}

function agentGenerateRequest(testCase, target, signal) {
    return new Request('http://localhost/api/agent/images/generate', {
        method: 'POST',
        headers: buildAgentRequestHeaders(testCase),
        body: JSON.stringify({
            prompt: 'real agent upstream sse compatibility smoke',
            model: target.model,
            n: 1,
            size: target.size,
            quality: target.quality,
            output_format: 'png',
            response_mode: 'path',
            image_backend: testCase.backend || 'images-api',
            streaming_strategy: testCase.strategy || 'off',
            partial_images: 2
        }),
        signal
    });
}

function buildAgentRequestHeaders(testCase) {
    return {
        'Content-Type': 'application/json',
        'Idempotency-Key': `real-smoke-${testCase.id}-${Date.now()}`,
        ...readAgentAuthHeaders()
    };
}

function readAgentAuthHeaders() {
    const token = env('AGENT_API_TOKEN');
    if (token) return { Authorization: `Bearer ${token}` };
    const passwordHash = readAppPasswordHash();
    return passwordHash ? { 'X-App-Password-Hash': passwordHash } : {};
}

function readAppPasswordHash() {
    const password = env('APP_PASSWORD');
    if (!password) return undefined;
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function summarizeResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) return summarizeSse(await response.text());
    return summarizeJson(await response.text(), contentType);
}

function summarizeSse(text) {
    const events = text
        .split('\n\n')
        .map((part) => part.trim())
        .filter((part) => part.startsWith('data: ') && part !== 'data: [DONE]')
        .map((part) => safeJson(part.slice('data: '.length)))
        .filter(Boolean);
    const done = events.findLast((event) => event.type === 'done');
    const error = events.findLast((event) => event.type === 'error');
    return {
        content_type: 'text/event-stream',
        event_types: events.map((event) => event.type || 'unknown'),
        done_image_count: Array.isArray(done?.images) ? done.images.length : 0,
        first_b64_length: readFirstB64Length(done?.images),
        ...(error ? { error: String(error.error || 'stream error') } : {})
    };
}

function isSuccessfulBillableSmokeResponse(response, summary) {
    if (!response.ok || summary?.error) return false;
    if (summary?.content_type === 'text/event-stream') {
        return summary.done_image_count > 0;
    }
    if (typeof summary?.image_count === 'number') {
        return summary.image_count > 0;
    }
    return false;
}

function summarizeJson(text, contentType) {
    const body = safeJson(text);
    return {
        content_type: contentType || undefined,
        image_count: Array.isArray(body?.images) ? body.images.length : 0,
        first_b64_length: readFirstB64Length(body?.images),
        ...(body?.error ? { error: String(body.error) } : {})
    };
}

async function summarizeAgentResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    const body = safeJson(await response.text());
    return {
        content_type: contentType || undefined,
        image_count: Array.isArray(body?.images) ? body.images.length : 0,
        first_content_url: typeof body?.images?.[0]?.content_url === 'string' ? body.images[0].content_url : undefined,
        has_inline_base64: Boolean(body?.images?.[0]?.b64_json),
        ...(body?.error ? { error: String(body.error.message || body.error) } : {})
    };
}

function readFirstB64Length(images) {
    if (!Array.isArray(images) || typeof images[0]?.b64_json !== 'string') return 0;
    return images[0].b64_json.length;
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function readHost(value) {
    try {
        return new URL(value).host;
    } catch {
        return 'invalid-url';
    }
}

function snapshotRealSmokeOutputFiles() {
    const outputDir = readRealSmokeOutputDir();
    if (!outputDir || !fs.existsSync(outputDir)) return new Set();
    return new Set(fs.readdirSync(outputDir).filter(isGeneratedImageFile));
}

function removeNewRealSmokeOutputFiles(filesBefore) {
    const outputDir = readRealSmokeOutputDir();
    if (!outputDir || !fs.existsSync(outputDir)) return;
    for (const filename of fs.readdirSync(outputDir).filter(isGeneratedImageFile)) {
        if (filesBefore.has(filename)) continue;
        fs.rmSync(`${outputDir}/${filename}`, { force: true });
    }
}

function readRealSmokeOutputDir() {
    return process.env.IMAGE_OUTPUT_DIR === 'generated-images/.real-smoke' ? process.env.IMAGE_OUTPUT_DIR : undefined;
}

function isGeneratedImageFile(filename) {
    return /\.(png|jpe?g|webp)$/i.test(filename);
}

function printUsage() {
    console.log(`用法：npm run smoke:image-upstream-real -- [--env-file <path>] [--env-file-if-exists <path>] [--allow-billable] [--include-server-channel] [--require-independent-targets] [--timeout-ms <ms>] [--case <id>]

环境变量前缀：
  IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL / IMAGE_REAL_SMOKE_ORIGINAL_API_KEY
  IMAGE_REAL_SMOKE_GAOREN_BASE_URL / IMAGE_REAL_SMOKE_GAOREN_API_KEY
  IMAGE_REAL_SMOKE_SUB2API_BASE_URL / IMAGE_REAL_SMOKE_SUB2API_API_KEY
  IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL / IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY
  IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL / IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY
  IMAGE_REAL_SMOKE_MATSCA_BASE_URL / IMAGE_REAL_SMOKE_MATSCA_API_KEY
  IMAGE_REAL_SMOKE_SERVER_* 可覆盖当前服务端渠道的 MODEL / SIZE / QUALITY / RESPONSES_MODEL

可选 --case：all、original-images-json、gaoren-images-sse、sub2api-images-sse、sub2api-responses-json、gpt2image-responses-sse、matsca-images-sse。
添加 --include-server-channel 后还可运行：server-channel-images-json、server-channel-images-sse、server-channel-responses-sse、server-channel-responses-json、server-channel-agent-images-sse、server-channel-agent-responses-sse。
默认只检查配置并跳过真实生图；必须加 --allow-billable 才会调用 /api/images 或 /api/agent/images/generate。
可用 --env-file 指向独立真实上游凭据文件；shell 环境变量优先级高于 --env-file，--env-file 优先级高于 .env.local。
可用 --env-file-if-exists 在凭据文件存在时加载，不存在时继续输出结构化 readiness 报告。
添加 --require-independent-targets 后，任何独立真实上游场景未被选中或被跳过都会使脚本退出非零。默认单场景超时为 240000ms。`);
}
