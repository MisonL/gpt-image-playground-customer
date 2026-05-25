#!/usr/bin/env node
import { AGENT_ENDPOINTS, buildAgentJobResultPath } from '../../../src/lib/agent-api-paths.mjs';
import {
    errorMessage,
    normalizeBaseUrl,
    normalizeOutputFormat,
    parseRetryAfterValue,
    readConfiguredPositiveInteger,
    readOptionValue,
    resolveSameOriginUrl,
    sleep
} from './lib/script-utils.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';

const IMAGE_BACKENDS = new Set(['images-api', 'images', 'responses', 'responses-image-generation']);
const RESPONSE_MODES = new Set(['path', 'base64', 'both']);
const STREAMING_STRATEGIES = new Set([
    'off',
    'auto',
    'openai-sse',
    'newapi-keepalive-sse',
    'responses-sse',
    'force-sse'
]);
const MIN_PARTIAL_IMAGES = 1;
const MAX_PARTIAL_IMAGES = 3;
const DEFAULT_PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH = 128;
const PAGE_SSE_ENDPOINT = '/api/images';
const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const passwordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH || '';
const contractCheck = process.env.GPT_IMAGE_AGENT_CONTRACT_CHECK === '1' || process.argv.includes('--contract-check');
let pageSseClientRequestIdMaxLength = DEFAULT_PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH;
let options;
try {
    options = parseArgs(process.argv.slice(2));
} catch (error) {
    console.error(errorMessage(error));
    printUsage();
    process.exit(2);
}
if (options.help) {
    printUsage();
    process.exit(0);
}

let prompt;
let maxAttempts;
let timeoutMs;
let idempotencyKey;
let requestBody;
try {
    maxAttempts = readConfiguredPositiveInteger(
        process.env.GPT_IMAGE_AGENT_MAX_ATTEMPTS,
        'GPT_IMAGE_AGENT_MAX_ATTEMPTS',
        3
    );
    timeoutMs = readConfiguredPositiveInteger(options.timeoutMs, '--timeout-ms', 420000);
    idempotencyKey =
        options.idempotencyKey ||
        process.env.GPT_IMAGE_AGENT_IDEMPOTENCY_KEY ||
        `agent-generate-${crypto.randomUUID()}`;
    if (isNonBillableDryRun(options, contractCheck)) {
        if (!hasPromptSource(options)) {
            printUsage();
            process.exit(2);
        }
        requestBody = buildDryRunRequestBody(options);
    } else {
        prompt = readPrompt(options, { readPromptFile: !contractCheck });
        requestBody = buildRequestBody(prompt, options);
    }
} catch (error) {
    console.error(errorMessage(error));
    printUsage();
    process.exit(2);
}

if (!isNonBillableDryRun(options, contractCheck) && !prompt && !contractCheck) {
    printUsage();
    process.exit(2);
}

let baseUrl;
try {
    baseUrl = normalizeBaseUrl(process.env.GPT_IMAGE_PLAYGROUND_URL || 'http://localhost:4783');
} catch (error) {
    console.error(errorMessage(error));
    process.exit(2);
}

if (isNonBillableDryRun(options, contractCheck)) {
    console.log(
        JSON.stringify(
            {
                ok: true,
                billable: false,
                dry_run: true,
                endpoint: dryRunEndpoint(requestBody, options.routeMode),
                route_mode: options.routeMode,
                routing_guidance: buildGenerateRoutingGuidance(requestBody, options.routeMode),
                idempotency_key: idempotencyKey,
                request: requestBody,
                next_step: '重新执行并添加 --allow-billable 才会发起真实生图请求。'
            },
            null,
            2
        )
    );
    process.exit(0);
}

try {
    var capabilities = await readCapabilities();
} catch (error) {
    if (isScriptError(error)) {
        console.error(JSON.stringify(buildPageSseFailureOutput(error), null, 2));
        process.exit(1);
    }
    console.error(errorMessage(error));
    process.exit(1);
}
applyCapabilitiesRuntimeValues(capabilities);

if (contractCheck) {
    await runContractCheck(capabilities);
    process.exit(0);
}

try {
    if (shouldUseJobPolling(capabilities, options.routeMode)) {
        await runGenerateJob();
    } else if (shouldUsePageSse(capabilities, requestBody, options.routeMode)) {
        try {
            const result = await runPageSseRequest();
            console.log(
                JSON.stringify(
                    buildSuccessOutput(formatPageSseOutput(result), {
                        transport: 'page_sse',
                        endpoint: PAGE_SSE_ENDPOINT
                    }),
                    null,
                    2
                )
            );
            process.exit(0);
        } catch (error) {
            console.error(JSON.stringify(buildPageSseFailureOutput(error), null, 2));
            process.exit(1);
        }
    } else {
        await runGenerateRequest({ routing: { transport: 'agent_json', endpoint: AGENT_ENDPOINTS.generate } });
    }
} catch (error) {
    if (isScriptError(error)) {
        console.error(JSON.stringify(buildPageSseFailureOutput(error), null, 2));
        process.exit(1);
    }
    console.error(errorMessage(error));
    process.exit(1);
}

function parseArgs(argv) {
    const parsed = {
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        n: '1',
        format: 'png',
        responseMode: 'path',
        imageBackend: undefined,
        streamingStrategy: undefined,
        partialImages: undefined,
        timeoutMs: undefined,
        promptFile: undefined,
        idempotencyKey: undefined,
        routeMode: 'auto',
        dryRun: false,
        allowBillable: false,
        help: false,
        promptParts: []
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') parsed.dryRun = true;
        else if (arg === '--allow-billable') parsed.allowBillable = true;
        else if (arg === '--job') parsed.routeMode = 'job';
        else if (arg === '--no-job' || arg === '--agent') parsed.routeMode = 'agent';
        else if (arg === '--page-sse') parsed.routeMode = 'page_sse';
        else if (arg === '--help' || arg === '-h') parsed.help = true;
        else if (arg === '--contract-check') continue;
        else if (arg === '--model') parsed.model = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--size') parsed.size = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--quality') parsed.quality = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--n') parsed.n = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--format') parsed.format = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--response-mode') parsed.responseMode = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--image-backend') parsed.imageBackend = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--streaming-strategy') parsed.streamingStrategy = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--partial-images') parsed.partialImages = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--timeout-ms') parsed.timeoutMs = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--prompt-file') parsed.promptFile = readOptionValue(argv, (index += 1), arg);
        else if (arg === '--idempotency-key') parsed.idempotencyKey = readOptionValue(argv, (index += 1), arg);
        else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
        else parsed.promptParts.push(arg);
    }
    return parsed;
}

function readPrompt(parsed, { readPromptFile }) {
    if (parsed.promptFile) {
        if (readPromptFile) {
            return fs.readFileSync(parsed.promptFile, 'utf8');
        }
        return parsed.promptParts.join(' ') || 'contract check';
    }
    return parsed.promptParts.join(' ');
}

function buildRequestBody(promptValue, parsed) {
    return addUpstreamStrategyFields(
        {
            prompt: promptValue || 'contract check',
            model: parsed.model,
            n: readConfiguredPositiveInteger(parsed.n, '--n', 1),
            size: parsed.size,
            quality: parsed.quality,
            output_format: normalizeOutputFormat(parsed.format),
            response_mode: parsed.responseMode
        },
        parsed
    );
}

function buildDryRunRequestBody(parsed) {
    const body = addUpstreamStrategyFields(
        {
            model: parsed.model,
            n: readConfiguredPositiveInteger(parsed.n, '--n', 1),
            size: parsed.size,
            quality: parsed.quality,
            output_format: normalizeOutputFormat(parsed.format),
            response_mode: parsed.responseMode
        },
        parsed
    );
    if (parsed.promptFile) {
        return { ...body, prompt_file: parsed.promptFile };
    }
    return { ...body, prompt: parsed.promptParts.join(' ') };
}

function addUpstreamStrategyFields(body, parsed) {
    validateUpstreamStrategyOptions(parsed);
    return {
        ...body,
        ...(parsed.imageBackend ? { image_backend: parsed.imageBackend } : {}),
        ...(parsed.streamingStrategy ? { streaming_strategy: parsed.streamingStrategy } : {}),
        ...(parsed.partialImages ? { partial_images: readPartialImages(parsed.partialImages) } : {})
    };
}

function validateUpstreamStrategyOptions(parsed) {
    if (!RESPONSE_MODES.has(parsed.responseMode)) {
        throw new Error('--response-mode 必须是 path、base64 或 both。');
    }
    if (parsed.imageBackend && !IMAGE_BACKENDS.has(parsed.imageBackend)) {
        throw new Error('--image-backend 必须是 images-api、images、responses 或 responses-image-generation。');
    }
    if (parsed.streamingStrategy && !STREAMING_STRATEGIES.has(parsed.streamingStrategy)) {
        throw new Error(
            '--streaming-strategy 必须是 off、auto、openai-sse、newapi-keepalive-sse、responses-sse 或 force-sse。'
        );
    }
    if (parsed.routeMode === 'page_sse' && parsed.streamingStrategy === 'off') {
        throw new Error('streaming_strategy=off 时不能强制使用页面 SSE。');
    }
}

function readPartialImages(value) {
    const parsed = readConfiguredPositiveInteger(value, '--partial-images', 2);
    if (parsed < MIN_PARTIAL_IMAGES || parsed > MAX_PARTIAL_IMAGES) {
        throw new Error('--partial-images 必须是 1 到 3 的整数。');
    }
    return parsed;
}

function hasPromptSource(parsed) {
    return Boolean(parsed.promptFile || parsed.promptParts.length > 0);
}

function isNonBillableDryRun(parsed, isContractCheck) {
    return parsed.dryRun || (!isContractCheck && !parsed.allowBillable);
}

function authHeaders() {
    if (token) return { Authorization: `Bearer ${token}` };
    if (passwordHash) return { 'X-App-Password-Hash': passwordHash };
    return {};
}

function absoluteUrl(value) {
    if (typeof value !== 'string' || !value) return undefined;
    return new URL(value, `${baseUrl}/`).toString();
}

function enrichImageUrls(result) {
    if (!result || !Array.isArray(result.images)) return result;
    return {
        ...result,
        images: result.images.map((image) => ({
            ...image,
            ...(image.content_url ? { absolute_content_url: absoluteUrl(image.content_url) } : {}),
            ...(image.metadata_url ? { absolute_metadata_url: absoluteUrl(image.metadata_url) } : {})
        }))
    };
}

function dryRunEndpoint(body, routeMode) {
    if (routeMode === 'job') return `${baseUrl}${AGENT_ENDPOINTS.create_generate_job}`;
    if (routeMode === 'agent') return `${baseUrl}${AGENT_ENDPOINTS.generate}`;
    if (routeMode === 'page_sse') return `${baseUrl}${PAGE_SSE_ENDPOINT}`;
    return isLargeGenerate(body) && isPageSseAllowed(body)
        ? `${baseUrl}${PAGE_SSE_ENDPOINT}`
        : `${baseUrl}${AGENT_ENDPOINTS.generate}`;
}

function buildGenerateRoutingGuidance(body, routeMode) {
    if (routeMode === 'job') {
        return {
            recommended_endpoint: AGENT_ENDPOINTS.create_generate_job,
            transport: 'agent_job_polling',
            strength: 'recommended',
            reason: 'Explicit --job requests use Agent job polling.'
        };
    }
    if (routeMode === 'page_sse' && !isPageSseAllowed(body)) {
        throw new Error('streaming_strategy=off 时不能强制使用页面 SSE。');
    }
    if ((routeMode === 'page_sse' || (routeMode !== 'agent' && isLargeGenerate(body))) && isPageSseAllowed(body)) {
        return {
            recommended_endpoint: PAGE_SSE_ENDPOINT,
            transport: 'page_sse',
            strength: 'recommended',
            fallback_endpoint: AGENT_ENDPOINTS.generate,
            fallback_mode: 'manual_after_diagnosis',
            reason: 'Generate requests with max_edge>2048 should use page form-data SSE first; if the stream fails, diagnose first and rerun manually with Agent JSON.'
        };
    }
    return {
        recommended_endpoint: AGENT_ENDPOINTS.generate,
        transport: 'agent_json',
        strength: 'default',
        reason: 'Normal single-image generate requests use the Agent JSON response contract.'
    };
}

async function readCapabilities() {
    const { response, result, text } = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.capabilities}`, {
        headers: authHeaders(),
        timeoutMs
    });
    if (!response.ok) {
        throw new Error(`capabilities 请求失败，状态码 ${response.status}：${text}`);
    }
    return result;
}

function applyCapabilitiesRuntimeValues(capabilitiesValue) {
    const maxLength = capabilitiesValue?.agent_streaming?.page_sse?.client_request_id?.max_length;
    if (Number.isSafeInteger(maxLength) && maxLength > 0) {
        pageSseClientRequestIdMaxLength = maxLength;
    }
}

async function runGenerateRequest(options = {}) {
    let lastResult;
    let lastRetryAfter = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const { response, result } = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.generate}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
                ...authHeaders()
            },
            body: JSON.stringify(requestBody),
            timeoutMs
        });

        if (response.ok) {
            console.log(JSON.stringify(buildSuccessOutput(enrichImageUrls(result), options.routing), null, 2));
            process.exit(0);
        }

        const retryAfter = parseRetryAfterValue(response.headers.get('retry-after'));
        lastResult = result;
        lastRetryAfter = retryAfter;
        if (!shouldRetry(result) || attempt === maxAttempts) break;
        await sleep(retryAfter);
    }

    console.error(JSON.stringify({ ...lastResult, retry_after: lastRetryAfter }, null, 2));
    process.exit(1);
}

async function runPageSseRequest() {
    const url = `${baseUrl}${PAGE_SSE_ENDPOINT}`;
    const formData = buildPageSseFormData();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
        } catch (error) {
            throw new Error(`请求失败：${url}。${errorMessage(error)}`);
        }
        try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/event-stream')) {
                return await collectPageSseResult(response, controller.signal);
            }
            const text = await response.text();
            if (!response.ok) {
                throw createPageSseHttpError(response.status, readErrorFromJsonText(text) || text);
            }
            return parseJsonResponse(text, true, url);
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(`请求失败：${url}。${errorMessage(error)}`);
            }
            throw error;
        }
    } finally {
        clearTimeout(timeout);
    }
}

function assertPageSseReady(capabilitiesValue) {
    const pageSse = capabilitiesValue?.agent_streaming?.page_sse;
    if (!supportsPageSse(capabilitiesValue)) {
        throw createScriptError(
            'page_sse_unavailable',
            '大图默认路由需要 agent_streaming.page_sse.supported=true；capabilities 未声明时不能静默降级到 Agent JSON。'
        );
    }
    if (pageSse?.auth?.required === true && !passwordHash) {
        throw createScriptError(
            'page_sse_auth_required',
            '页面 SSE 路径需要表单字段 passwordHash；请设置 GPT_IMAGE_APP_PASSWORD_HASH 后重试。'
        );
    }
}

function buildPageSseFormData() {
    const formData = new FormData();
    assertPageSseClientRequestIdLength(idempotencyKey);
    formData.append('mode', 'generate');
    formData.append('prompt', requestBody.prompt);
    formData.append('model', requestBody.model);
    formData.append('n', String(requestBody.n));
    formData.append('size', requestBody.size);
    formData.append('quality', requestBody.quality);
    formData.append('output_format', requestBody.output_format);
    formData.append('response_mode', requestBody.response_mode);
    formData.append('clientRequestId', idempotencyKey);
    formData.append('stream', 'true');
    formData.append('partial_images', String(requestBody.partial_images || 2));
    if (requestBody.image_backend)
        formData.append('image_backend', normalizeImageBackendForPage(requestBody.image_backend));
    if (requestBody.streaming_strategy) {
        formData.append('image_streaming_strategy', requestBody.streaming_strategy);
    }
    if (requestBody.background) formData.append('background', requestBody.background);
    if (requestBody.moderation) formData.append('moderation', requestBody.moderation);
    if (requestBody.output_compression !== undefined) {
        formData.append('output_compression', String(requestBody.output_compression));
    }
    if (passwordHash) formData.append('passwordHash', passwordHash);
    return formData;
}

function assertPageSseClientRequestIdLength(clientRequestId) {
    if (clientRequestId.length > pageSseClientRequestIdMaxLength) {
        throw createScriptError(
            'page_sse_client_request_id_too_long',
            `页面 SSE 的 clientRequestId 不能超过 ${pageSseClientRequestIdMaxLength} 个字符；请缩短 Idempotency-Key。`
        );
    }
}

function formatPageSseOutput(result) {
    if (!result || !Array.isArray(result.images)) return result;
    return {
        ...result,
        images: result.images.map((image) => formatPageSseImage(image))
    };
}

function formatPageSseImage(image) {
    const output = { ...image };
    if (output.path) {
        output.absolute_path = absoluteUrl(output.path);
        if (requestBody.response_mode === 'path') {
            delete output.b64_json;
        }
    }
    return output;
}

function normalizeImageBackendForPage(value) {
    if (value === 'images') return 'images-api';
    if (value === 'responses') return 'responses-image-generation';
    return value;
}

function readPageSseClientRequestId(event) {
    if (typeof event.clientRequestId === 'string') return event.clientRequestId;
    if (typeof event.client_request_id === 'string') return event.client_request_id;
    return undefined;
}

function normalizePageSseImage(image, fallbackClientRequestId) {
    const clientRequestId = image.clientRequestId || image.client_request_id || fallbackClientRequestId;
    return {
        ...image,
        output_format: image.outputFormat || image.output_format || requestBody.output_format,
        ...(clientRequestId ? { clientRequestId } : {})
    };
}

function mergePageSseDoneImages(doneImages, completedImages, fallbackClientRequestId) {
    if (!Array.isArray(doneImages) || doneImages.length === 0) {
        return completedImages.map((image) => normalizePageSseImage(image, fallbackClientRequestId));
    }
    const imageCount = Math.max(doneImages.length, completedImages.length);
    return Array.from({ length: imageCount }, (_, index) =>
        normalizePageSseImage(
            { ...(completedImages[index] || {}), ...(doneImages[index] || {}) },
            fallbackClientRequestId
        )
    );
}

async function collectPageSseResult(response, signal) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('页面 SSE 响应缺少 body。');
    const decoder = new TextDecoder();
    const state = { completedImages: [], usage: undefined, actualCost: undefined, doneReceived: false };
    let buffer = '';
    while (true) {
        const { done, value } = await readPageSseChunk(reader, signal);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const rawEvent of events) {
            applyPageSseEvent(state, rawEvent);
        }
    }
    buffer += decoder.decode();
    if (buffer.trim()) applyPageSseEvent(state, buffer);
    if (state.completedImages.length === 0) {
        throw new Error('页面 SSE 未返回最终图片。');
    }
    if (!state.doneReceived) {
        throw new Error('页面 SSE 缺少最终 done 事件，流式响应可能已提前中断。');
    }
    return { images: state.completedImages, usage: state.usage, actualCost: state.actualCost };
}

function readPageSseChunk(reader, signal) {
    if (!signal) return reader.read();
    if (signal.aborted) {
        return Promise.reject(new Error('请求超时。'));
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('请求超时。'));
        signal.addEventListener('abort', onAbort, { once: true });
        reader
            .read()
            .then(resolve, reject)
            .finally(() => {
                signal.removeEventListener('abort', onAbort);
            });
    });
}

function applyPageSseEvent(state, rawEvent) {
    const event = parsePageSseEvent(rawEvent);
    if (!event) return;
    if (event.type === 'error') {
        throw createPageSseStreamError(event);
    }
    if (event.type === 'completed' && event.filename) {
        state.completedImages.push(
            normalizePageSseImage(
                {
                    filename: event.filename,
                    b64_json: event.b64_json,
                    path: event.path,
                    output_format: event.outputFormat || event.output_format || requestBody.output_format
                },
                readPageSseClientRequestId(event)
            )
        );
        return;
    }
    if (event.type === 'done') {
        state.doneReceived = true;
        const clientRequestId = readPageSseClientRequestId(event);
        state.completedImages = mergePageSseDoneImages(event.images, state.completedImages, clientRequestId);
        state.usage = event.usage;
        state.actualCost = event.actualCost !== undefined ? event.actualCost : event.actual_cost;
    }
}

function formatPageSseError(value) {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
        if (typeof value.message === 'string' && value.message.trim()) return value.message;
        if (typeof value.code === 'string' && value.code.trim()) return value.code;
        try {
            return JSON.stringify(value);
        } catch {
            return '页面 SSE 返回错误事件。';
        }
    }
    return '页面 SSE 返回错误事件。';
}

function createPageSseStreamError(event) {
    const error = new Error(formatPageSseError(event.error));
    const status = readPageSseStreamStatus(event);
    if (Number.isInteger(status)) {
        error.streamStatus = status;
    }
    return error;
}

function readPageSseStreamStatus(event) {
    if (Number.isInteger(event.status)) return event.status;
    if (event.error && typeof event.error === 'object' && Number.isInteger(event.error.status)) {
        return event.error.status;
    }
    return undefined;
}

function parsePageSseEvent(rawEvent) {
    const lines = rawEvent.split(/\r?\n/);
    const data = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n')
        .trim();
    if (!data || data === '[DONE]') return undefined;
    try {
        return JSON.parse(data);
    } catch (error) {
        throw new Error(`页面 SSE 事件不是有效 JSON：${errorMessage(error)}`);
    }
}

function buildSuccessOutput(result, routing) {
    return routing ? { ...result, routing } : result;
}

function buildPageSseFailureOutput(error) {
    if (isScriptError(error)) {
        return buildPageSseScriptFailure(error);
    }
    if (isPageSseRequestRejected(error)) {
        return buildPageSseRequestRejectedFailure(error);
    }
    return buildBillablePageSseFailure(error);
}

function buildPageSseRouting(fallbackMode) {
    return {
        transport: 'page_sse',
        endpoint: PAGE_SSE_ENDPOINT,
        fallback_endpoint: AGENT_ENDPOINTS.generate,
        fallback_mode: fallbackMode
    };
}

function buildPageSseScriptFailure(error) {
    return {
        ok: false,
        billable: false,
        error: {
            code: error.scriptCode,
            message: errorMessage(error)
        },
        routing: buildPageSseRouting('manual_after_diagnosis'),
        next_step: '先补齐页面流式 capability 或访问码哈希，再重新执行；不要静默切换到 Agent JSON。'
    };
}

function buildPageSseRequestRejectedFailure(error) {
    return {
        ok: false,
        billable: false,
        error: {
            code: 'page_sse_request_rejected',
            status: error.status,
            message: errorMessage(error)
        },
        routing: buildPageSseRouting('fix_request_before_retry'),
        next_step: '先修正页面端拒绝的请求参数或鉴权，再重新执行；这类本地 4xx 不应按上游计费失败处理。'
    };
}

function buildBillablePageSseFailure(error) {
    return {
        ok: false,
        billable: true,
        error: {
            code: 'page_sse_failed',
            ...buildPageSseFailureStatus(error),
            message: errorMessage(error)
        },
        routing: buildPageSseRouting('manual_after_diagnosis'),
        next_step: '先诊断页面流式失败原因，再决定是否用 --agent 重新执行同一业务请求；不要自动重试同一个请求。'
    };
}

function buildPageSseFailureStatus(error) {
    if (error && typeof error === 'object') {
        if (Number.isInteger(error.streamStatus)) return { status: error.streamStatus };
        if (Number.isInteger(error.status)) return { status: error.status };
    }
    return {};
}

async function runGenerateJob() {
    let lastResult;
    let lastRetryAfter = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const { response, result } = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.create_generate_job}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
                ...authHeaders()
            },
            body: JSON.stringify(requestBody),
            timeoutMs
        });

        if (response.ok) {
            const jobResult = await pollJobResult(result?.job);
            console.log(JSON.stringify(enrichImageUrls(jobResult), null, 2));
            process.exit(0);
        }

        const retryAfter = parseRetryAfterValue(response.headers.get('retry-after'));
        lastResult = result;
        lastRetryAfter = retryAfter;
        if (!shouldRetry(result) || attempt === maxAttempts) break;
        await sleep(retryAfter);
    }

    console.error(JSON.stringify({ ...lastResult, retry_after: lastRetryAfter }, null, 2));
    process.exit(1);
}

async function pollJobResult(job) {
    if (!job || typeof job.id !== 'string') {
        throw new Error('创建 job 的响应缺少 job.id。');
    }
    const resultUrl = resolveSameOriginUrl(
        baseUrl,
        job.result_url || buildAgentJobResultPath(job.id),
        'job.result_url'
    );
    const deadlineMs = Date.now() + timeoutMs;
    let lastResult;
    let lastRetryAfter = job.retry_after_seconds || 1;

    while (Date.now() < deadlineMs) {
        const { response, result } = await fetchJson(resultUrl, {
            headers: authHeaders(),
            timeoutMs
        });
        if (response.ok) return result;

        const retryAfter = parseRetryAfterValue(response.headers.get('retry-after')) || lastRetryAfter;
        lastResult = result;
        lastRetryAfter = retryAfter;
        if (result?.error?.code !== 'request_in_progress' || !result?.error?.retryable) break;
        await sleep(retryAfter);
    }

    console.error(JSON.stringify({ ...lastResult, retry_after: lastRetryAfter }, null, 2));
    process.exit(1);
}

async function runContractCheck(capabilitiesValue) {
    const checks = [];
    const { response, result } = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.generate}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify(requestBody),
        timeoutMs
    });
    if (response.status === 400 && result?.error?.code === 'idempotency_key_required') {
        checks.push({ endpoint: AGENT_ENDPOINTS.generate, status: response.status, error_code: result.error.code });
    } else {
        console.error(JSON.stringify({ ok: false, billable: false, status: response.status, result }, null, 2));
        process.exit(1);
    }

    if (supportsJobPolling(capabilitiesValue)) {
        const jobCheck = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.create_generate_job}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders()
            },
            body: JSON.stringify(requestBody),
            timeoutMs
        });
        if (jobCheck.response.status !== 400 || jobCheck.result?.error?.code !== 'idempotency_key_required') {
            console.error(
                JSON.stringify(
                    { ok: false, billable: false, status: jobCheck.response.status, result: jobCheck.result },
                    null,
                    2
                )
            );
            process.exit(1);
        }
        checks.push({
            endpoint: AGENT_ENDPOINTS.create_generate_job,
            status: jobCheck.response.status,
            error_code: jobCheck.result.error.code
        });
    }

    console.log(JSON.stringify({ ok: true, billable: false, checks }, null, 2));
}

async function fetchJson(url, init) {
    try {
        const response = await fetchWithTimeout(url, init);
        const text = await response.text();
        const result = parseJsonResponse(text, response.ok, url);
        return { response, result, text };
    } catch (error) {
        const message = errorMessage(error);
        if (message.startsWith(`请求失败：${url}。`)) {
            throw error;
        }
        throw new Error(`请求失败：${url}。${message}`);
    }
}

async function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? timeoutMs);
    try {
        const fetchInit = { ...init };
        delete fetchInit.timeoutMs;
        return await fetch(url, { ...fetchInit, signal: controller.signal });
    } catch (error) {
        const message = errorMessage(error);
        throw new Error(`请求失败：${url}。${message}`);
    } finally {
        clearTimeout(timeout);
    }
}

function readErrorFromJsonText(text) {
    let result;
    try {
        result = parseJsonResponse(text, false, '');
    } catch {
        return undefined;
    }
    if (typeof result?.error === 'string') return result.error;
    if (typeof result?.error?.message === 'string') return result.error.message;
    return undefined;
}

function parseJsonResponse(text, isOk, url) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (error) {
        if (!isOk) return null;
        const message = errorMessage(error);
        throw new Error(`响应不是有效 JSON：${url}。${message}`);
    }
}

function shouldRetry(result) {
    return Boolean(result?.error?.retryable);
}

function supportsJobPolling(capabilitiesValue) {
    return Boolean(
        capabilitiesValue?.agent_jobs?.supported === true && capabilitiesValue.agent_jobs.mode === 'job_polling'
    );
}

function supportsPageSse(capabilitiesValue) {
    return Boolean(capabilitiesValue?.agent_streaming?.page_sse?.supported === true);
}

function shouldUseJobPolling(capabilitiesValue, routeMode) {
    if (routeMode !== 'job') return false;
    if (!supportsJobPolling(capabilitiesValue)) {
        throw new Error('服务 capabilities 未声明 agent_jobs.supported=true，不能调用 job endpoint。');
    }
    return true;
}

function shouldUsePageSse(capabilitiesValue, request, routeMode) {
    if (routeMode === 'agent' || routeMode === 'job') return false;
    if (!isPageSseAllowed(request)) {
        if (routeMode === 'page_sse') {
            throw new Error('streaming_strategy=off 时不能强制使用页面 SSE。');
        }
        return false;
    }
    if (routeMode === 'page_sse' || isLargeGenerate(request)) {
        assertPageSseReady(capabilitiesValue);
        return true;
    }
    return false;
}

function isLargeGenerate(request) {
    return readMaxImageEdge(request.size) > 2048;
}

function isPageSseAllowed(request) {
    return request.streaming_strategy !== 'off';
}

function readMaxImageEdge(size) {
    if (typeof size !== 'string') return 0;
    const match = size.match(/^(\d+)x(\d+)$/);
    if (!match) return 0;
    return Math.max(Number(match[1]), Number(match[2]));
}

function createScriptError(code, message) {
    const error = new Error(message);
    error.scriptCode = code;
    return error;
}

function isScriptError(error) {
    return Boolean(error && typeof error === 'object' && typeof error.scriptCode === 'string');
}

function createPageSseHttpError(status, detail) {
    const message = detail ? `页面 SSE 请求失败，状态码 ${status}：${detail}` : `页面 SSE 请求失败，状态码 ${status}。`;
    const error = new Error(message);
    error.status = status;
    return error;
}

function isPageSseRequestRejected(error) {
    return Boolean(
        error &&
            typeof error === 'object' &&
            Number.isInteger(error.status) &&
            error.status >= 400 &&
            error.status < 500
    );
}

function printUsage() {
    console.error('用法：generate-image.mjs [options] <prompt>');
    console.error('默认只输出 dry-run；添加 --allow-billable 才会真实生图。');
    console.error(
        '常用参数：--model --size --quality --n --format --response-mode --image-backend --streaming-strategy --partial-images --timeout-ms --prompt-file --idempotency-key --page-sse --agent --job --no-job(兼容别名)'
    );
    console.error(
        '契约检查：GPT_IMAGE_AGENT_CONTRACT_CHECK=1 generate-image.mjs 或 generate-image.mjs --contract-check'
    );
}
