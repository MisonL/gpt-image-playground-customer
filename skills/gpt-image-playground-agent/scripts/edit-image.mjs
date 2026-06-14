#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  errorMessage,
  assertValidImageSizeForModel,
  normalizeBaseUrl,
  normalizeOutputFormat,
  parseRetryAfterValue,
  readCapabilitiesImageTransportTimeoutMs,
  readConfiguredPositiveInteger,
  readMaxImageEdge,
  readOptionValue,
  readPartialImages,
  sleep,
  validateAgentEditRequestAgainstCapabilities
} from './lib/script-utils.mjs';
import {
  attachSummary,
  buildFailureSummary,
  buildSuccessSummary,
  completeScriptTiming,
  startScriptTiming
} from './lib/script-summary.mjs';
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
const IMAGE_BACKENDS = new Set(['images-api', 'images', 'responses', 'responses-image-generation']);
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const MODERATIONS = new Set(['low', 'auto']);
const THINKING_VALUES = new Set(['minimal', 'none', 'low', 'medium', 'high', 'xhigh']);
const DEFAULT_PAGE_OUTPUT_FORMAT = 'webp';
const DEFAULT_PAGE_OUTPUT_COMPRESSION = 100;

const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const passwordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH || '';
const contractCheck = process.env.GPT_IMAGE_AGENT_CONTRACT_CHECK === '1' || process.argv.includes('--contract-check');
const scriptTiming = startScriptTiming();
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
          ...(options.partialImages !== undefined
            ? { partial_images: readPartialImages(options.partialImages, '--partial-images') }
            : {}),
          ...(usesPageOutputOptions(options, routingGuidance) ? { output_format: readOutputFormat(options) } : {}),
          ...(usesPageOutputOptions(options, routingGuidance) && readOutputCompression(options) !== undefined
            ? { output_compression: readOutputCompression(options) }
            : {}),
          ...(options.moderation ? { moderation: options.moderation } : {}),
          ...(options.imageBackend ? { image_backend: normalizeImageBackendForPage(options.imageBackend) } : {}),
          ...(options.responsesModel ? { responsesModel: readNonEmptyString(options.responsesModel, '--responses-model') } : {}),
          ...(options.thinking ? { thinking: options.thinking } : {}),
          ...(options.promptOptimization !== undefined
            ? { promptOptimization: readBooleanOption(options.promptOptimization, '--prompt-optimization') }
            : {}),
          ...(options.forceWeb !== undefined ? { force_web: true } : {}),
          ...(readEditNormalizations(options) ? { normalizations: readEditNormalizations(options) } : {})
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
    format: DEFAULT_PAGE_OUTPUT_FORMAT,
    formatSpecified: false,
    outputCompression: undefined,
    moderation: undefined,
    imageBackend: undefined,
    responsesModel: undefined,
    thinking: undefined,
    promptOptimization: undefined,
    forceWeb: undefined,
    sseLogPath: undefined,
    timeoutMs: undefined,
    idempotencyKey: undefined,
    imagePath: undefined,
    imagePathSource: undefined,
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
    else if (arg === '--format' || arg === '--output-format') {
      parsed.format = readOptionValue(argv, (index += 1), arg);
      parsed.formatSpecified = true;
    }
    else if (arg === '--output-compression') parsed.outputCompression = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--moderation') parsed.moderation = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--image-backend') parsed.imageBackend = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--responses-model' || arg === '--gpt-model') parsed.responsesModel = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--thinking') parsed.thinking = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--prompt-optimization') parsed.promptOptimization = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--force-web') parsed.forceWeb = true;
    else if (arg === '--sse-log') parsed.sseLogPath = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--idempotency-key') parsed.idempotencyKey = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--image') {
      if (parsed.imagePathSource === 'option') throw new Error('--image 只能设置一次。');
      if (parsed.imagePath) throw new Error('--image 与位置参数 <image-path> 不能同时设置。');
      parsed.imagePath = readOptionValue(argv, (index += 1), arg);
      parsed.imagePathSource = 'option';
    }
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else if (!parsed.imagePath) {
      parsed.imagePath = arg;
      parsed.imagePathSource = 'positional';
    }
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
    assertNoPageOnlyEditOptions(parsed, 'Agent edit');
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
  if (hasPageOnlyEditOptions(parsed) && isPageSseAllowed(parsed)) {
    return {
      recommended_endpoint: '/api/images',
      transport: 'page_sse',
      strength: 'default',
      reason: 'GPT2Image-compatible edit options require the page form-data SSE endpoint; Agent JSON edit does not accept those fields.'
    };
  }
  if (usesDefaultPageOutput(parsed) && isPageSseAllowed(parsed)) {
    return {
      recommended_endpoint: '/api/images',
      transport: 'page_sse',
      strength: 'default',
      reason: 'Default WebP edit output uses the page form-data SSE endpoint; Agent JSON edit has a fixed output contract.'
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
    reason: 'Agent edit uses a fixed output contract and should be selected explicitly with --agent.'
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
  if (hasPageOnlyEditOptions(parsed) && !isPageSseAllowed(parsed)) {
    throw new Error('图生图高级参数需要页面 SSE，不能同时设置 stream_mode=non_stream 或 streaming_strategy=off。');
  }
  if (parsed.routeMode !== 'agent' && usesDefaultPageOutput(parsed) && !isPageSseAllowed(parsed)) {
    throw new Error('默认 WebP 图生图输出需要页面 SSE；若要使用 Agent JSON 固定输出，请添加 --agent。');
  }
  if (parsed.routeMode === 'agent') {
    assertNoPageOnlyEditOptions(parsed, 'Agent edit');
  }
  if (parsed.formatSpecified && !OUTPUT_FORMATS.has(readOutputFormat(parsed))) {
    throw new Error('--format 必须是 png、jpeg 或 webp。');
  }
  if (parsed.outputCompression !== undefined) readOutputCompression(parsed);
  if (parsed.moderation && !MODERATIONS.has(parsed.moderation)) {
    throw new Error('--moderation 必须是 low 或 auto。');
  }
  if (parsed.imageBackend && !IMAGE_BACKENDS.has(parsed.imageBackend)) {
    throw new Error('--image-backend 必须是 images-api、images、responses 或 responses-image-generation。');
  }
  if (parsed.responsesModel !== undefined) readNonEmptyString(parsed.responsesModel, '--responses-model');
  if (parsed.thinking && !THINKING_VALUES.has(parsed.thinking)) {
    throw new Error('--thinking 必须是 minimal、none、low、medium、high 或 xhigh。');
  }
  if (parsed.promptOptimization !== undefined) readBooleanOption(parsed.promptOptimization, '--prompt-optimization');
  if (parsed.partialImages !== undefined) readPartialImages(parsed.partialImages, '--partial-images');
}

function hasPageOnlyEditOptions(parsed) {
  return Boolean(
    parsed.formatSpecified ||
      parsed.outputCompression !== undefined ||
      parsed.moderation ||
      parsed.imageBackend ||
      parsed.responsesModel ||
      parsed.thinking ||
      parsed.promptOptimization !== undefined ||
      parsed.forceWeb !== undefined
  );
}

function assertNoPageOnlyEditOptions(parsed, context) {
  if (!hasPageOnlyEditOptions(parsed)) return;
  throw new Error(`${context} 不接受图生图高级页面字段；请去掉这些字段或使用 --page-sse。`);
}

function readOutputFormat(parsed) {
  return parsed.format ? normalizeOutputFormat(parsed.format) : DEFAULT_PAGE_OUTPUT_FORMAT;
}

function usesPageOutputOptions(parsed, routingGuidance) {
  return routingGuidance.transport === 'page_sse' || parsed.formatSpecified || parsed.outputCompression !== undefined;
}

function usesDefaultPageOutput(parsed) {
  return !parsed.formatSpecified && parsed.outputCompression === undefined && readOutputFormat(parsed) === DEFAULT_PAGE_OUTPUT_FORMAT;
}

function readOutputCompression(parsed) {
  const outputFormat = readOutputFormat(parsed);
  if (outputFormat === 'png') return undefined;
  const value = parsed.outputCompression === undefined ? String(DEFAULT_PAGE_OUTPUT_COMPRESSION) : String(parsed.outputCompression);
  if (!/^\d+$/.test(value)) throw new Error('--output-compression 必须是 0 到 100 之间的整数。');
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 100) {
    throw new Error('--output-compression 必须是 0 到 100 之间的整数。');
  }
  return parsedValue;
}

function readEditNormalizations(parsed) {
  if (parsed.outputCompression === undefined || readOutputFormat(parsed) !== 'png') return undefined;
  return { output_compression_ignored_for_png: true };
}

function readBooleanOption(value, name) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} 必须是 true 或 false。`);
}

function readNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串。`);
  return value.trim();
}

function isPageSseAllowed(parsed) {
  return parsed.streamMode !== 'non_stream' && parsed.streamingStrategy !== 'off';
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
  console.error('用法：edit-image.mjs [options] <image-path> <prompt> 或 edit-image.mjs --image <path> [options] <prompt>');
  console.error('默认只输出 dry-run；添加 --allow-billable 才会真实编辑图片。');
  console.error('常用参数：--image --model --size --quality --response-mode --format --output-compression --moderation --image-backend --responses-model --thinking --prompt-optimization --force-web --stream-mode --streaming-strategy --partial-images --sse-log --timeout-ms --idempotency-key --page-sse --agent --dry-run --allow-billable');
  console.error('契约检查：GPT_IMAGE_AGENT_CONTRACT_CHECK=1 edit-image.mjs 或 edit-image.mjs --contract-check');
}

let capabilities;
try {
  capabilities = await readCapabilities();
  if (options.timeoutMs === undefined) {
    timeoutMs = readCapabilitiesImageTransportTimeoutMs(capabilities, timeoutMs);
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}

try {
  validateAgentEditRequestAgainstCapabilities(
    {
      n: 1,
      partial_images:
        options.partialImages !== undefined
          ? readPartialImages(options.partialImages, '--partial-images')
          : capabilities?.defaults?.partial_images,
      imageCount: 1,
      image_backend: options.imageBackend
    },
    capabilities
  );
} catch (error) {
  console.error(errorMessage(error));
  process.exit(2);
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
  if (options.partialImages !== undefined) {
    formData.append('partial_images', String(readPartialImages(options.partialImages, '--partial-images')));
  } else if (capabilities?.defaults?.partial_images !== undefined) {
    formData.append('partial_images', String(readPartialImages(capabilities.defaults.partial_images, 'capabilities.defaults.partial_images')));
  }
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
  formData.append('output_format', readOutputFormat(options));
  if (readOutputCompression(options) !== undefined) {
    formData.append('output_compression', String(readOutputCompression(options)));
  }
  if (options.moderation) formData.append('moderation', options.moderation);
  if (options.imageBackend) formData.append('image_backend', normalizeImageBackendForPage(options.imageBackend));
  if (options.responsesModel) formData.append('responsesModel', readNonEmptyString(options.responsesModel, '--responses-model'));
  if (options.thinking) formData.append('thinking', options.thinking);
  if (options.promptOptimization !== undefined) {
    formData.append('promptOptimization', String(readBooleanOption(options.promptOptimization, '--prompt-optimization')));
  }
  if (options.forceWeb !== undefined) formData.append('force_web', 'true');
  if (options.streamMode) formData.append('stream_mode', options.streamMode);
  if (options.streamingStrategy) formData.append('image_streaming_strategy', options.streamingStrategy);
  if (options.partialImages !== undefined) {
    formData.append('partial_images', String(readPartialImages(options.partialImages, '--partial-images')));
  } else if (capabilities?.defaults?.partial_images !== undefined) {
    formData.append('partial_images', String(readPartialImages(capabilities.defaults.partial_images, 'capabilities.defaults.partial_images')));
  }
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
    sseLogPath: options.sseLogPath,
    errorMessage
  });
  console.log(
    JSON.stringify(
      attachSummary({
        ...formatPageSseOutput({
          result,
          baseUrl,
          responseMode: options.responseMode,
          defaultOutputFormat: DEFAULT_PAGE_OUTPUT_FORMAT
        }),
        routing: {
          transport: 'page_sse',
          endpoint: PAGE_SSE_ENDPOINT,
          fallback_endpoint: '/api/agent/images/edit',
          fallback_mode: 'manual_after_diagnosis'
        }
      }, buildSuccessSummary({
        result,
        routing: {
          transport: 'page_sse',
          endpoint: PAGE_SSE_ENDPOINT
        },
        timing: completeScriptTiming(scriptTiming),
        idempotencyKey,
        billable: true
      })),
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
    const failureOutput = buildPageSseFailureOutput({
      error,
      fallbackEndpoint: '/api/agent/images/edit',
      errorMessage
    });
    console.error(
      JSON.stringify(
        attachSummary(failureOutput, buildFailureSummary({
          errorBody: failureOutput,
          routing: {
            transport: 'page_sse',
            endpoint: PAGE_SSE_ENDPOINT
          },
          timing: completeScriptTiming(scriptTiming),
          idempotencyKey,
          billable: failureOutput.billable !== false
        })),
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
    console.log(
      JSON.stringify(
        attachSummary(
          enrichImageUrls(result),
          buildSuccessSummary({
            result: enrichImageUrls(result),
            routing: { transport: 'agent_json', endpoint: '/api/agent/images/edit' },
            timing: completeScriptTiming(scriptTiming),
            idempotencyKey,
            billable: true
          })
        ),
        null,
        2
      )
    );
    process.exit(0);
  }

  const retryAfter = parseRetryAfterValue(response.headers.get('retry-after'));
  lastResult = result;
  lastRetryAfter = retryAfter;
  if (!shouldRetry(result) || attempt === maxAttempts) break;
  await sleep(retryAfter);
}

const failureOutput = { ...lastResult, retry_after: lastRetryAfter };
console.error(
  JSON.stringify(
    attachSummary(
      failureOutput,
      buildFailureSummary({
        errorBody: failureOutput,
        routing: { transport: 'agent_json', endpoint: '/api/agent/images/edit' },
        timing: completeScriptTiming(scriptTiming),
        idempotencyKey,
        billable: failureOutput?.billable !== false
      })
    ),
    null,
    2
  )
);
process.exit(1);
