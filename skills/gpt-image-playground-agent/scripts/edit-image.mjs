#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  errorMessage,
  assertValidImageSizeForModel,
  normalizeBaseUrl,
  parseRetryAfterValue,
  readConfiguredPositiveInteger,
  readMaxImageEdge,
  readOptionValue,
  sleep
} from './lib/script-utils.mjs';
import {
  PAGE_SSE_ENDPOINT,
  assertPageSseReady,
  assertPageSseStreamingAllowed,
  buildPageSseFailureOutput,
  formatPageSseOutput,
  normalizeImageBackendForPage,
  postPageSse
} from './lib/page-sse-client.mjs';

const STREAM_MODES = new Set(['auto', 'stream', 'non_stream']);
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

const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const passwordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH || '';
const contractCheck = process.env.GPT_IMAGE_AGENT_CONTRACT_CHECK === '1' || process.argv.includes('--contract-check');
let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(errorMessage(error));
  printUsage();
  process.exit(2);
}
const imagePath = options.imagePath;
const prompt = options.promptParts.join(' ');
if (options.help) {
  printUsage();
  process.exit(0);
}

try {
  validateUpstreamStreamingOptions(options);
  options.size = assertValidImageSizeForModel(options.size, options.model, '--size');
} catch (error) {
  console.error(errorMessage(error));
  printUsage();
  process.exit(2);
}

let maxAttempts;
let timeoutMs;
try {
  maxAttempts = readConfiguredPositiveInteger(process.env.GPT_IMAGE_AGENT_MAX_ATTEMPTS, 'GPT_IMAGE_AGENT_MAX_ATTEMPTS', 3);
  timeoutMs = readConfiguredPositiveInteger(options.timeoutMs, '--timeout-ms', 420000);
} catch (error) {
  console.error(errorMessage(error));
  printUsage();
  process.exit(2);
}
const idempotencyKey = options.idempotencyKey || process.env.GPT_IMAGE_AGENT_IDEMPOTENCY_KEY || `agent-edit-${crypto.randomUUID()}`;

if ((!imagePath || !prompt) && !contractCheck) {
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

if (options.dryRun || (!contractCheck && !options.allowBillable)) {
  const routingGuidance = buildEditRoutingGuidance(options);
  console.log(
    JSON.stringify(
      {
        ok: true,
        billable: false,
        dry_run: true,
        endpoint: `${baseUrl}${routingGuidance.recommended_endpoint}`,
        routing_guidance: routingGuidance,
        idempotency_key: idempotencyKey,
        request: {
          image_path: imagePath,
          prompt,
          model: options.model,
          size: options.size,
          quality: options.quality,
          response_mode: options.responseMode,
          ...(options.streamMode ? { stream_mode: options.streamMode } : {}),
          ...(options.streamingStrategy ? { streaming_strategy: options.streamingStrategy } : {}),
          ...(options.partialImages ? { partial_images: readPartialImages(options.partialImages) } : {})
        },
        next_step: '重新执行并添加 --allow-billable 才会发起真实图片编辑请求。'
      },
      null,
      2
    )
  );
  process.exit(0);
}

const routingGuidance = buildEditRoutingGuidance(options);
if (routingGuidance.transport === 'page_sse') {
  try {
    assertPageSseStreamingAllowed(options);
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(2);
  }
}

function parseArgs(argv) {
  const parsed = {
    model: 'gpt-image-2',
    size: 'auto',
    quality: 'auto',
    responseMode: 'path',
    routeMode: 'auto',
    streamMode: undefined,
    streamingStrategy: undefined,
    partialImages: undefined,
    timeoutMs: undefined,
    idempotencyKey: undefined,
    imagePath: undefined,
    dryRun: false,
    allowBillable: false,
    help: false,
    promptParts: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--allow-billable') parsed.allowBillable = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--contract-check') continue;
    else if (arg === '--model') parsed.model = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--size') parsed.size = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--quality') parsed.quality = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--response-mode') parsed.responseMode = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--agent') parsed.routeMode = 'agent';
    else if (arg === '--page-sse') parsed.routeMode = 'page_sse';
    else if (arg === '--stream-mode') parsed.streamMode = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--streaming-strategy') parsed.streamingStrategy = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--partial-images') parsed.partialImages = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--idempotency-key') parsed.idempotencyKey = readOptionValue(argv, (index += 1), arg);
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else if (!parsed.imagePath) parsed.imagePath = arg;
    else parsed.promptParts.push(arg);
  }
  return parsed;
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

function buildEditRoutingGuidance(parsed) {
  if (parsed.routeMode === 'agent') {
    return {
      recommended_endpoint: '/api/agent/images/edit',
      transport: 'agent_json',
      strength: 'default',
      reason: 'Explicit --agent requests use the Agent JSON edit response contract.'
    };
  }
  if (parsed.routeMode === 'page_sse') {
    return {
      recommended_endpoint: '/api/images',
      transport: 'page_sse',
      strength: 'default',
      reason: 'Explicit --page-sse requests use the page form-data SSE endpoint.'
    };
  }
  if (readMaxImageEdge(parsed.size) > 2048 && isPageSseAllowed(parsed)) {
    return {
      recommended_endpoint: '/api/images',
      transport: 'page_sse',
      strength: 'default',
      reason: 'High-resolution edit defaults to the page form-data SSE endpoint; if streaming has issues, diagnose first and explicitly fall back to Agent edit.'
    };
  }
  return {
    recommended_endpoint: '/api/agent/images/edit',
    transport: 'agent_json',
    strength: 'default',
    reason: 'Normal edit requests can use the Agent JSON response contract.'
  };
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

async function readCapabilities() {
  let response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/api/agent/capabilities`, {
      headers: authHeaders()
    });
  } catch (error) {
    const message = errorMessage(error);
    throw new Error(`无法连接 GPT Image Playground：${baseUrl}。${message}`);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`capabilities 请求失败，状态码 ${response.status}：${body}`);
  }
  return response.json();
}

function assertPageSseReadyForEdit(capabilities) {
  assertPageSseReady({
    capabilities,
    passwordHash,
    idempotencyKey
  });
}

function shouldRetry(result) {
  return Boolean(result?.error?.retryable);
}

function validateUpstreamStreamingOptions(parsed) {
  if (parsed.streamMode && !STREAM_MODES.has(parsed.streamMode)) {
    throw new Error('--stream-mode 必须是 auto、stream 或 non_stream。');
  }
  if (parsed.streamingStrategy && !STREAMING_STRATEGIES.has(parsed.streamingStrategy)) {
    throw new Error(
      '--streaming-strategy 必须是 off、auto、openai-sse、newapi-keepalive-sse、responses-sse 或 force-sse。'
    );
  }
  if (parsed.routeMode === 'page_sse') {
    assertPageSseStreamingAllowed(parsed);
  }
  if (parsed.partialImages) readPartialImages(parsed.partialImages);
}

function isPageSseAllowed(parsed) {
  return parsed.streamMode !== 'non_stream' && parsed.streamingStrategy !== 'off';
}

function readPartialImages(value) {
  const parsed = readConfiguredPositiveInteger(value, '--partial-images', 2);
  if (parsed < MIN_PARTIAL_IMAGES || parsed > MAX_PARTIAL_IMAGES) {
    throw new Error('--partial-images 必须是 1 到 3 的整数。');
  }
  return parsed;
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function printUsage() {
  console.error('用法：edit-image.mjs [options] <image-path> <prompt>');
  console.error('默认只输出 dry-run；添加 --allow-billable 才会真实编辑图片。');
  console.error('常用参数：--model --size --quality --response-mode --stream-mode --streaming-strategy --partial-images --timeout-ms --idempotency-key --page-sse --agent --dry-run --allow-billable');
  console.error('契约检查：GPT_IMAGE_AGENT_CONTRACT_CHECK=1 edit-image.mjs 或 edit-image.mjs --contract-check');
}

let capabilities;
try {
  capabilities = await readCapabilities();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}

if (contractCheck) {
  const response = await fetchWithTimeout(`${baseUrl}/api/agent/images/edit`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
      ...authHeaders()
    },
    body: JSON.stringify({ prompt: 'contract check' })
  });
  const result = await response.json();
  if (response.status === 415 && result?.error?.code === 'validation_error') {
    console.log(JSON.stringify({ ok: true, billable: false, status: response.status, error_code: result.error.code }, null, 2));
    process.exit(0);
  }
  console.error(JSON.stringify({ ok: false, billable: false, status: response.status, result }, null, 2));
  process.exit(1);
}

try {
  const stats = fs.statSync(imagePath);
  if (!stats.isFile()) {
    console.error(`图片路径不是文件：${imagePath}`);
    process.exit(2);
  }
} catch (error) {
  const message = errorMessage(error);
  console.error(`无法读取图片文件：${imagePath}。${message}`);
  process.exit(2);
}

const imageBuffer = fs.readFileSync(imagePath);
const imageType = mimeTypeForPath(imagePath);

function buildFormData() {
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('model', options.model);
  formData.append('size', options.size);
  formData.append('quality', options.quality);
  formData.append('response_mode', options.responseMode);
  if (options.streamMode) formData.append('stream_mode', options.streamMode);
  if (options.streamingStrategy) formData.append('streaming_strategy', options.streamingStrategy);
  if (options.partialImages) formData.append('partial_images', String(readPartialImages(options.partialImages)));
  formData.append('image_0', new Blob([imageBuffer], { type: imageType }), path.basename(imagePath));
  return formData;
}

function buildPageSseFormData() {
  const formData = new FormData();
  formData.append('mode', 'edit');
  formData.append('prompt', prompt);
  formData.append('model', options.model);
  formData.append('size', options.size);
  formData.append('quality', options.quality);
  formData.append('response_mode', options.responseMode);
  formData.append('clientRequestId', idempotencyKey);
  formData.append('stream', 'true');
  if (options.streamMode) formData.append('stream_mode', options.streamMode);
  if (options.streamingStrategy) formData.append('image_streaming_strategy', options.streamingStrategy);
  if (options.partialImages) formData.append('partial_images', String(readPartialImages(options.partialImages)));
  if (passwordHash) formData.append('passwordHash', passwordHash);
  formData.append('image_0', new Blob([imageBuffer], { type: imageType }), path.basename(imagePath));
  return formData;
}

async function runPageSseEdit() {
  assertPageSseReadyForEdit(capabilities);
  const result = await postPageSse({
    url: `${baseUrl}${PAGE_SSE_ENDPOINT}`,
    formData: buildPageSseFormData(),
    timeoutMs,
    errorMessage
  });
  console.log(
    JSON.stringify(
      {
        ...formatPageSseOutput({
          result,
          baseUrl,
          responseMode: options.responseMode,
          defaultOutputFormat: 'png'
        }),
        routing: {
          transport: 'page_sse',
          endpoint: PAGE_SSE_ENDPOINT,
          fallback_endpoint: '/api/agent/images/edit',
          fallback_mode: 'manual_after_diagnosis'
        }
      },
      null,
      2
    )
  );
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

let lastResult;
let lastRetryAfter = null;

if (routingGuidance.transport === 'page_sse') {
  try {
    await runPageSseEdit();
    process.exit(0);
  } catch (error) {
    console.error(
      JSON.stringify(
        buildPageSseFailureOutput({
          error,
          fallbackEndpoint: '/api/agent/images/edit',
          errorMessage
        }),
        null,
        2
      )
    );
    process.exit(1);
  }
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  let response;
  let result;
  try {
    response = await fetchWithTimeout(`${baseUrl}/api/agent/images/edit`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        ...authHeaders()
      },
      body: buildFormData()
    });
    result = await response.json();
  } catch (error) {
    const message = errorMessage(error);
    result = { error: { code: 'network_error', message, retryable: true } };
    lastResult = result;
    lastRetryAfter = 1;
    if (attempt === maxAttempts) break;
    await sleep(lastRetryAfter);
    continue;
  }
  if (response.ok) {
    console.log(JSON.stringify(enrichImageUrls(result), null, 2));
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
