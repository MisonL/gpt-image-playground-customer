#!/usr/bin/env node
import { AGENT_ENDPOINTS } from './lib/agent-api-paths.mjs';
import {
  errorMessage,
  assertValidImageSizeForModel,
  normalizeBaseUrl,
  normalizeOutputFormat,
  parseImageSizeValue,
  readConfiguredPositiveInteger,
  readMaxImageEdge,
  readOptionValue,
  resolveSameOriginUrl
} from './lib/script-utils.mjs';
import {
  PAGE_SSE_ENDPOINT,
  assertPageSseReady,
  buildPageSseFailureOutput,
  formatPageSseOutput,
  normalizeImageBackendForPage,
  postPageSse
} from './lib/page-sse-client.mjs';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_BACKENDS = new Set(['images-api', 'images', 'responses', 'responses-image-generation']);
const MODELS = new Set(['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2']);
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const QUALITIES = new Set(['low', 'medium', 'high', 'auto']);
const BACKGROUNDS = new Set(['transparent', 'opaque', 'auto']);
const MODERATIONS = new Set(['low', 'auto']);
const RESPONSE_MODES = new Set(['path', 'base64', 'both']);
const STREAM_MODES = new Set(['auto', 'stream', 'non_stream']);
const STREAMING_STRATEGIES = new Set([
  'off',
  'auto',
  'openai-sse',
  'newapi-keepalive-sse',
  'responses-sse',
  'force-sse'
]);
const MAX_EDIT_IMAGES = 10;
const MIN_PARTIAL_IMAGES = 1;
const MAX_PARTIAL_IMAGES = 3;
const GENERATE_ONLY_FIELDS = [
  'output_format',
  'format',
  'output_compression',
  'background',
  'moderation',
  'image_backend',
  'responsesModel'
];
const EDIT_ONLY_FIELDS = ['image_path', 'image_paths', 'mask_path'];
const BOOLEAN_ROUTING_FIELDS = ['page_sse', 'complex_ui', 'long_image', 'resume_or_recover'];
const TASK_FIELDS = new Set([
  'id',
  'mode',
  'prompt',
  'idempotency_key',
  'model',
  'n',
  'size',
  'quality',
  'response_mode',
  'stream_mode',
  'streaming_strategy',
  'partial_images',
  'page_sse',
  'transport',
  'complex_ui',
  'long_image',
  'resume_or_recover',
  ...GENERATE_ONLY_FIELDS,
  ...EDIT_ONLY_FIELDS
]);

const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const passwordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH || '';

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

let baseUrl;
let tasks;
let timeoutMs;
let capabilities;
try {
  if (!options.input) throw new Error('--input 需要 JSONL 文件路径。');
  baseUrl = normalizeBaseUrl(process.env.GPT_IMAGE_PLAYGROUND_URL || 'http://localhost:4783');
  timeoutMs = readConfiguredPositiveInteger(options.timeoutMs, '--timeout-ms', 420000);
  tasks = readJsonlTasks(options.input);
} catch (error) {
  console.error(errorMessage(error));
  process.exit(2);
}

const manifestPath = options.manifest || `${options.input}.manifest.jsonl`;
let planned;
try {
  planned = tasks.map((task, index) => normalizeTask(task, index, options));
} catch (error) {
  console.error(errorMessage(error));
  process.exit(2);
}

if (!options.allowBillable || options.dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        billable: false,
        dry_run: true,
        input: options.input,
        manifest: manifestPath,
        total: planned.length,
        tasks: planned.map((task) => {
          const routing = buildTaskRouting(task);
          return {
            index: task.index,
            id: task.id,
            mode: task.mode,
            idempotency_key: task.idempotencyKey,
            endpoint: routing.endpoint,
            routing,
            request: buildDryRunRequestPreview(task, routing)
          };
        }),
        next_step: '重新执行并添加 --allow-billable 才会发起真实批量请求。'
      },
      null,
      2
    )
  );
  process.exit(0);
}

try {
  const completed = options.resume ? readCompletedManifestKeys(manifestPath) : new Set();
  const results = [];
  for (const task of planned) {
    if (completed.has(task.idempotencyKey) || completed.has(task.id)) {
      const skipped = { ok: true, status: 'skipped', id: task.id, idempotency_key: task.idempotencyKey };
      appendManifest(manifestPath, { ...baseManifestEntry(task), status: 'skipped', skipped_reason: 'resume' });
      results.push(skipped);
      continue;
    }
    const result = await runTask(task);
    results.push(result);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(JSON.stringify({ ok: failed === 0, total: results.length, failed, manifest: manifestPath, results }, null, 2));
  process.exit(failed === 0 ? 0 : 1);
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    input: undefined,
    manifest: undefined,
    orderedPrefix: 'batch',
    timeoutMs: undefined,
    allowBillable: false,
    dryRun: false,
    resume: false,
    dimensionCheck: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-billable') parsed.allowBillable = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--resume') parsed.resume = true;
    else if (arg === '--dimension-check') parsed.dimensionCheck = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--input') parsed.input = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--manifest') parsed.manifest = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--ordered-prefix') parsed.orderedPrefix = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = readOptionValue(argv, (index += 1), arg);
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else if (!parsed.input) parsed.input = arg;
    else throw new Error(`未知位置参数：${arg}`);
  }
  return parsed;
}

function readJsonlTasks(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((item) => item.line && !item.line.startsWith('#'))
    .map((item) => {
      try {
        return JSON.parse(item.line);
      } catch (error) {
        throw new Error(`${filePath}:${item.index + 1} 不是有效 JSON：${errorMessage(error)}`);
      }
    });
}

function normalizeTask(raw, index, parsedOptions) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`第 ${index + 1} 行必须是 JSON 对象。`);
  }
  const mode = normalizeMode(raw.mode, index);
  const id = normalizeTaskId(raw.id, mode, index);
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) {
    throw new Error(`${id} 缺少 prompt。`);
  }
  validateTaskFields(raw, id, mode);
  validateTaskSize(raw, id, mode, parsedOptions.dimensionCheck);
  validateTaskRoutingFields(raw, id);
  if (mode === 'edit') validateEditImages(raw, id);
  return {
    id,
    index,
    mode,
    raw,
    idempotencyKey: normalizeIdempotencyKey(raw.idempotency_key, parsedOptions.orderedPrefix, index, id)
  };
}

function normalizeTaskId(value, mode, index) {
  if (value === undefined || value === null || value === '') return `${mode}-${index + 1}`;
  return String(value);
}

function normalizeMode(value, index) {
  if (value === undefined || value === null || value === '' || value === 'generate') return 'generate';
  if (value === 'edit') return 'edit';
  throw new Error(`第 ${index + 1} 行 mode 必须是 generate 或 edit。`);
}

function normalizeIdempotencyKey(value, orderedPrefix, index, id) {
  if (value === undefined || value === null || value === '') return buildOrderedKey(orderedPrefix, index, id);
  if (typeof value !== 'string') throw new Error(`${id} idempotency_key 必须是字符串。`);
  return value;
}

function validateTaskSize(raw, id, mode, dimensionCheck) {
  if (raw.size !== undefined) {
    assertValidImageSizeForModel(raw.size, raw.model || 'gpt-image-2', `${id}.size`);
  }
  if (!dimensionCheck) return;
  const size = raw.size || (mode === 'generate' ? '1024x1024' : undefined);
  if (!parseExpectedSize(size)) {
    throw new Error(`${id} --dimension-check 需要 size 为 WIDTHxHEIGHT。`);
  }
}

function validateEditImages(raw, id) {
  const imagePaths = readEditImagePaths(raw, id);
  if (imagePaths.length === 0) throw new Error(`${id} edit 任务必须提供 image_path 或 image_paths。`);
  if (imagePaths.length > MAX_EDIT_IMAGES) throw new Error(`${id} edit 任务最多支持 ${MAX_EDIT_IMAGES} 张源图。`);
  if (hasOwn(raw, 'mask_path')) readNonEmptyString(raw.mask_path, `${id}.mask_path`);
}

function validateTaskFields(raw, id, mode) {
  validateKnownTaskFields(raw, id);
  validateModeSpecificFields(raw, id, mode);
  validateRoutingControlFields(raw, id);
  validateAmbiguousAliasFields(raw, id);
  if (hasOwn(raw, 'model')) normalizeEnumValue(raw.model, MODELS, `${id}.model`);
  if (raw.n !== undefined) readConfiguredPositiveInteger(raw.n, `${id}.n`, 1);
  if (hasOwn(raw, 'quality')) normalizeEnumValue(raw.quality, QUALITIES, `${id}.quality`);
  if (hasOwn(raw, 'response_mode')) normalizeEnumValue(raw.response_mode, RESPONSE_MODES, `${id}.response_mode`);
  if (hasOwn(raw, 'image_backend')) normalizeEnumValue(raw.image_backend, IMAGE_BACKENDS, `${id}.image_backend`);
  if (hasOwn(raw, 'background')) normalizeEnumValue(raw.background, BACKGROUNDS, `${id}.background`);
  if (hasOwn(raw, 'moderation')) normalizeEnumValue(raw.moderation, MODERATIONS, `${id}.moderation`);
  validateResponsesModelField(raw, id);
  if (hasOwn(raw, 'stream_mode')) normalizeEnumValue(raw.stream_mode, STREAM_MODES, `${id}.stream_mode`);
  if (hasOwn(raw, 'streaming_strategy')) {
    normalizeEnumValue(raw.streaming_strategy, STREAMING_STRATEGIES, `${id}.streaming_strategy`);
  }
  if (hasOwn(raw, 'partial_images')) readPartialImages(raw.partial_images, `${id}.partial_images`);
  if (hasOwn(raw, 'output_format') || hasOwn(raw, 'format')) {
    normalizeEnumValue(readOutputFormatField(raw, id), OUTPUT_FORMATS, `${id}.output_format`);
  }
  validateBackgroundForModel(raw, id);
  validateOutputCompression(raw, id);
}

function validateAmbiguousAliasFields(raw, id) {
  if (hasOwn(raw, 'output_format') && hasOwn(raw, 'format')) {
    throw new Error(`${id}.output_format 与 format 不能同时设置。`);
  }
  if (hasOwn(raw, 'image_path') && hasOwn(raw, 'image_paths')) {
    throw new Error(`${id}.image_path 与 image_paths 不能同时设置。`);
  }
}

function validateKnownTaskFields(raw, id) {
  for (const field of Object.keys(raw)) {
    if (!TASK_FIELDS.has(field)) {
      throw new Error(`${id}.${field} 不是支持的 batch JSONL 字段。`);
    }
  }
}

function validateModeSpecificFields(raw, id, mode) {
  const fields = mode === 'edit' ? GENERATE_ONLY_FIELDS : EDIT_ONLY_FIELDS;
  const expectedMode = mode === 'edit' ? 'generate' : 'edit';
  for (const field of fields) {
    if (hasOwn(raw, field)) {
      throw new Error(`${id}.${modeSpecificFieldLabel(field)} 仅适用于 ${expectedMode} 任务。`);
    }
  }
}

function modeSpecificFieldLabel(field) {
  return field === 'format' ? 'output_format' : field;
}

function validateRoutingControlFields(raw, id) {
  for (const field of BOOLEAN_ROUTING_FIELDS) {
    if (hasOwn(raw, field) && typeof raw[field] !== 'boolean') {
      throw new Error(`${id}.${field} 必须是布尔值。`);
    }
  }
  if (hasOwn(raw, 'transport') && raw.transport !== 'page_sse') {
    throw new Error(`${id}.transport 必须是 page_sse。`);
  }
}

function validateBackgroundForModel(raw, id) {
  if (!hasOwn(raw, 'background')) return;
  const model = hasOwn(raw, 'model') ? String(raw.model) : 'gpt-image-2';
  if (model === 'gpt-image-2' && String(raw.background) === 'transparent') {
    throw new Error(`${id}.background 对 gpt-image-2 无效：gpt-image-2 不支持 transparent 背景。`);
  }
}

function validateOutputCompression(raw, id) {
  readOutputCompression(raw, id);
}

function validateResponsesModelField(raw, id) {
  if (!hasOwn(raw, 'responsesModel')) return;
  readNonEmptyString(raw.responsesModel, `${id}.responsesModel`);
  if (!hasOwn(raw, 'image_backend')) {
    throw new Error(`${id}.responsesModel 必须同时设置 image_backend=responses-image-generation。`);
  }
  const imageBackend = normalizeEnumValue(raw.image_backend, IMAGE_BACKENDS, `${id}.image_backend`);
  if (imageBackend !== 'responses-image-generation' && imageBackend !== 'responses') {
    throw new Error(`${id}.responsesModel 仅适用于 image_backend=responses-image-generation。`);
  }
}

function readOutputCompression(raw, id) {
  if (!hasOwn(raw, 'output_compression')) return undefined;
  const outputFormat = hasOwn(raw, 'output_format') || hasOwn(raw, 'format')
    ? readOutputFormatField(raw, id)
    : 'png';
  if (outputFormat === 'png') {
    throw new Error(`${id}.output_compression 仅适用于 jpeg 或 webp 输出。`);
  }
  const value = raw.output_compression;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${id}.output_compression 必须是 0 到 100 之间的整数。`);
  }
  return parsed;
}

function readOutputFormatField(raw, id) {
  const value = raw.output_format ?? raw.format;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${id}.output_format 必须是字符串。`);
  }
  return normalizeOutputFormat(value);
}

function validateTaskRoutingFields(raw, id) {
  if ((raw.page_sse === true || raw.transport === 'page_sse') && (raw.stream_mode === 'non_stream' || raw.streaming_strategy === 'off')) {
    throw new Error(`${id} stream_mode=non_stream 或 streaming_strategy=off 时不能强制使用页面 SSE。`);
  }
  if (hasOwn(raw, 'responsesModel') && (raw.stream_mode === 'non_stream' || raw.streaming_strategy === 'off')) {
    throw new Error(`${id}.responsesModel 需要页面 SSE 路径，不能同时设置 stream_mode=non_stream 或 streaming_strategy=off。`);
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readEditImagePaths(raw, id = 'edit') {
  if (Array.isArray(raw.image_paths)) {
    if (raw.image_paths.length === 0) throw new Error(`${id}.image_paths 必须是非空字符串数组。`);
    return raw.image_paths.map((value, index) => readNonEmptyString(value, `${id}.image_paths[${index}]`));
  }
  if (hasOwn(raw, 'image_paths')) throw new Error(`${id}.image_paths 必须是非空字符串数组。`);
  if (hasOwn(raw, 'image_path')) return [readNonEmptyString(raw.image_path, `${id}.image_path`)];
  return [];
}

function readNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} 必须是非空字符串。`);
  }
  return value;
}

function buildOrderedKey(prefix, index, id) {
  const safePrefix = sanitizeKeyPart(prefix || 'batch');
  const safeId = sanitizeKeyPart(id || `item-${index + 1}`);
  return `${safePrefix}-${String(index + 1).padStart(4, '0')}-${safeId}`.slice(0, 200);
}

function sanitizeKeyPart(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function authHeaders() {
  if (token) return { Authorization: `Bearer ${token}` };
  if (passwordHash) return { 'X-App-Password-Hash': passwordHash };
  return {};
}

async function readCapabilities() {
  const { response, result, text } = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.capabilities}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`capabilities 请求失败，状态码 ${response.status}：${text}`);
  return result;
}

async function ensureCapabilities() {
  capabilities ??= await readCapabilities();
  return capabilities;
}

async function runTask(task) {
  const routing = buildTaskRouting(task);
  try {
    const response =
      routing.transport === 'page_sse'
        ? await postPageSseTask(task, routing)
        : task.mode === 'edit'
          ? await postEditTask(task)
          : await postGenerateTask(task);
    if (options.dimensionCheck) await assertDimensions(task, response);
    const output = { ok: true, status: 'succeeded', id: task.id, idempotency_key: task.idempotencyKey, routing, response };
    appendManifest(manifestPath, { ...baseManifestEntry(task), status: 'succeeded', routing, response: sanitizeResponse(response) });
    return output;
  } catch (error) {
    const failure = buildTaskFailureOutput(error, routing);
    const output = { ok: false, status: 'failed', id: task.id, idempotency_key: task.idempotencyKey, ...failure };
    appendManifest(manifestPath, { ...baseManifestEntry(task), status: 'failed', ...failure });
    return output;
  }
}

function buildTaskFailureOutput(error, routing) {
  if (error?.pageSseFailure && typeof error.pageSseFailure === 'object') {
    return {
      billable: error.pageSseFailure.billable,
      error: error.pageSseFailure.error,
      routing: error.pageSseFailure.routing || routing,
      next_step: error.pageSseFailure.next_step
    };
  }
  return { error: errorMessage(error), routing };
}

function buildTaskRouting(task) {
  if (shouldUsePageSseForTask(task)) {
    return {
      endpoint: PAGE_SSE_ENDPOINT,
      transport: 'page_sse',
      strength: task.mode === 'edit' && readTaskMaxEdge(task) > 2048 ? 'default' : 'recommended',
      fallback_endpoint: task.mode === 'edit' ? AGENT_ENDPOINTS.edit : AGENT_ENDPOINTS.generate,
      fallback_mode: 'manual_after_diagnosis',
      reason:
        task.mode === 'edit' && readTaskMaxEdge(task) > 2048
          ? 'High-resolution edit defaults to page form-data SSE; fall back explicitly after diagnosis if streaming has issues.'
          : 'Large or complex batch image tasks should use page form-data SSE for observability and recovery.'
    };
  }
  return {
    endpoint: task.mode === 'edit' ? AGENT_ENDPOINTS.edit : AGENT_ENDPOINTS.generate,
    transport: 'agent_json',
    strength: 'default',
    reason: 'Normal batch tasks use the Agent JSON response contract.'
  };
}

function buildDryRunRequestPreview(task, routing) {
  if (routing.transport === 'page_sse') return buildPageSseRequestPreview(task);
  if (task.mode === 'edit') return buildAgentEditRequestPreview(task.raw);
  return buildGenerateBody(task.raw);
}

function buildAgentEditRequestPreview(raw) {
  validateEditStrategyFields(raw);
  const preview = {};
  const fields = ['prompt', 'model', 'n', 'size', 'quality', 'response_mode', 'stream_mode', 'streaming_strategy', 'partial_images'];
  for (const field of fields) {
    if (raw[field] !== undefined) preview[field] = raw[field];
  }
  if (!raw.model) preview.model = 'gpt-image-2';
  if (!raw.response_mode) preview.response_mode = 'path';
  preview.image_fields = readEditImagePaths(raw, String(raw.id || 'edit')).map((_, index) => `image_${index}`);
  if (raw.mask_path) preview.mask = 'provided';
  return preview;
}

function buildPageSseRequestPreview(task) {
  const raw = task.raw;
  const preview = {
    mode: task.mode,
    prompt: raw.prompt,
    model: raw.model || 'gpt-image-2',
    size: raw.size || (task.mode === 'generate' ? '1024x1024' : 'auto'),
    quality: raw.quality || (task.mode === 'generate' ? 'high' : 'auto'),
    response_mode: readResponseMode(raw),
    clientRequestId: task.idempotencyKey,
    stream: 'true'
  };
  if (raw.n !== undefined) preview.n = readConfiguredPositiveInteger(raw.n, `${task.id}.n`, 1);
  if (raw.stream_mode) preview.stream_mode = String(raw.stream_mode);
  if (raw.streaming_strategy) preview.image_streaming_strategy = String(raw.streaming_strategy);
  if (raw.partial_images !== undefined) preview.partial_images = readPartialImages(raw.partial_images, `${task.id}.partial_images`);
  if (raw.image_backend) preview.image_backend = normalizeImageBackendForPage(String(raw.image_backend));
  if (raw.responsesModel) preview.responsesModel = readNonEmptyString(raw.responsesModel, `${task.id}.responsesModel`);
  if (raw.background) preview.background = String(raw.background);
  if (raw.moderation) preview.moderation = String(raw.moderation);
  if (raw.output_compression !== undefined) preview.output_compression = readOutputCompression(raw, task.id);
  if (task.mode === 'edit') {
    preview.image_fields = readEditImagePaths(raw, task.id).map((_, index) => `image_${index}`);
    if (raw.mask_path) preview.mask = 'provided';
  } else {
    preview.output_format = readOutputFormat(raw);
  }
  return preview;
}

function shouldUsePageSseForTask(task) {
  const pageSseAllowed = isPageSseAllowedForTask(task);
  if (task.raw.page_sse === true || task.raw.transport === 'page_sse') {
    if (!pageSseAllowed) {
      throw new Error(`${task.id} stream_mode=non_stream 或 streaming_strategy=off 时不能强制使用页面 SSE。`);
    }
    return true;
  }
  if (!pageSseAllowed) return false;
  if (task.raw.complex_ui === true || task.raw.long_image === true || task.raw.resume_or_recover === true) return true;
  if (hasOwn(task.raw, 'responsesModel')) return true;
  if (task.mode === 'edit' && readTaskMaxEdge(task) > 2048) return true;
  if (task.mode === 'generate' && readTaskMaxEdge(task) > 2048) {
    return true;
  }
  return false;
}

function isPageSseAllowedForTask(task) {
  return task.raw.streaming_strategy !== 'off' && task.raw.stream_mode !== 'non_stream';
}

async function postGenerateTask(task) {
  const body = buildGenerateBody(task.raw);
  const { response, result, text } = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.generate}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': task.idempotencyKey, ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(readErrorMessage(result) || `generate 请求失败，状态码 ${response.status}：${text}`);
  return enrichImageUrls(result);
}

async function postEditTask(task) {
  const formData = new FormData();
  appendEditFields(formData, task.raw);
  const { response, result, text } = await fetchJson(`${baseUrl}${AGENT_ENDPOINTS.edit}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': task.idempotencyKey, ...authHeaders() },
    body: formData
  });
  if (!response.ok) throw new Error(readErrorMessage(result) || `edit 请求失败，状态码 ${response.status}：${text}`);
  return enrichImageUrls(result);
}

async function postPageSseTask(task, routing) {
  const pageSseCapabilities = await ensureCapabilities();
  try {
    assertPageSseReady({
      capabilities: pageSseCapabilities,
      passwordHash,
      idempotencyKey: task.idempotencyKey
    });
    const formData = buildPageSseTaskFormData(task);
    const result = await postPageSse({
      url: `${baseUrl}${PAGE_SSE_ENDPOINT}`,
      formData,
      timeoutMs,
      errorMessage
    });
    return formatPageSseOutput({
      result,
      baseUrl,
      responseMode: readResponseMode(task.raw),
      defaultOutputFormat: readOutputFormat(task.raw)
    });
  } catch (error) {
    const pageSseFailure = buildPageSseFailureOutput({
      error,
      fallbackEndpoint: routing.fallback_endpoint,
      errorMessage
    });
    const taskError = new Error(pageSseFailure.error?.message || errorMessage(error));
    taskError.pageSseFailure = pageSseFailure;
    throw taskError;
  }
}

function buildGenerateBody(raw) {
  const outputFormat = hasOwn(raw, 'output_format') || hasOwn(raw, 'format')
    ? normalizeOutputFormat(raw.output_format ?? raw.format)
    : 'png';
  const outputCompression = readOutputCompression(raw, String(raw.id || 'generate'));
  return {
    prompt: raw.prompt,
    model: raw.model || 'gpt-image-2',
    n: readConfiguredPositiveInteger(raw.n, 'n', 1),
    size: raw.size || '1024x1024',
    quality: raw.quality || 'high',
    output_format: normalizeEnumValue(outputFormat, OUTPUT_FORMATS, 'output_format'),
    response_mode: normalizeEnumValue(hasOwn(raw, 'response_mode') ? raw.response_mode : 'path', RESPONSE_MODES, 'response_mode'),
    ...(outputCompression !== undefined ? { output_compression: outputCompression } : {}),
    ...(raw.background ? { background: raw.background } : {}),
    ...(raw.moderation ? { moderation: raw.moderation } : {}),
    ...(hasOwn(raw, 'image_backend') ? { image_backend: normalizeEnumValue(raw.image_backend, IMAGE_BACKENDS, 'image_backend') } : {}),
    ...(hasOwn(raw, 'stream_mode') ? { stream_mode: normalizeEnumValue(raw.stream_mode, STREAM_MODES, 'stream_mode') } : {}),
    ...(hasOwn(raw, 'streaming_strategy')
      ? { streaming_strategy: normalizeEnumValue(raw.streaming_strategy, STREAMING_STRATEGIES, 'streaming_strategy') }
      : {}),
    ...(hasOwn(raw, 'partial_images') ? { partial_images: readPartialImages(raw.partial_images, 'partial_images') } : {})
  };
}

function buildPageSseTaskFormData(task) {
  const raw = task.raw;
  const formData = new FormData();
  formData.append('mode', task.mode);
  formData.append('prompt', raw.prompt);
  formData.append('model', raw.model || 'gpt-image-2');
  formData.append('size', raw.size || (task.mode === 'generate' ? '1024x1024' : 'auto'));
  formData.append('quality', raw.quality || (task.mode === 'generate' ? 'high' : 'auto'));
  formData.append('response_mode', readResponseMode(raw));
  formData.append('clientRequestId', task.idempotencyKey);
  formData.append('stream', 'true');
  if (raw.n !== undefined) formData.append('n', String(readConfiguredPositiveInteger(raw.n, `${task.id}.n`, 1)));
  if (raw.stream_mode) formData.append('stream_mode', String(raw.stream_mode));
  if (raw.streaming_strategy) formData.append('image_streaming_strategy', String(raw.streaming_strategy));
  if (raw.partial_images !== undefined) formData.append('partial_images', String(readPartialImages(raw.partial_images, `${task.id}.partial_images`)));
  if (raw.image_backend) formData.append('image_backend', normalizeImageBackendForPage(String(raw.image_backend)));
  if (raw.responsesModel) formData.append('responsesModel', readNonEmptyString(raw.responsesModel, `${task.id}.responsesModel`));
  if (raw.background) formData.append('background', String(raw.background));
  if (raw.moderation) formData.append('moderation', String(raw.moderation));
  if (raw.output_compression !== undefined) formData.append('output_compression', String(readOutputCompression(raw, task.id)));
  if (passwordHash) formData.append('passwordHash', passwordHash);
  if (task.mode === 'edit') {
    readEditImagePaths(raw, task.id).forEach((filePath, index) => appendFile(formData, `image_${index}`, filePath));
    if (raw.mask_path) appendFile(formData, 'mask', raw.mask_path);
  } else {
    formData.append('output_format', readOutputFormat(raw));
  }
  return formData;
}

function readResponseMode(raw) {
  return normalizeEnumValue(hasOwn(raw, 'response_mode') ? raw.response_mode : 'path', RESPONSE_MODES, 'response_mode');
}

function readOutputFormat(raw) {
  const outputFormat = hasOwn(raw, 'output_format') || hasOwn(raw, 'format')
    ? normalizeOutputFormat(raw.output_format ?? raw.format)
    : 'png';
  return normalizeEnumValue(outputFormat, OUTPUT_FORMATS, 'output_format');
}

function appendEditFields(formData, raw) {
  validateEditStrategyFields(raw);
  const fields = ['prompt', 'model', 'n', 'size', 'quality', 'response_mode', 'stream_mode', 'streaming_strategy', 'partial_images'];
  for (const field of fields) {
    if (raw[field] !== undefined) formData.append(field, String(raw[field]));
  }
  if (!raw.model) formData.append('model', 'gpt-image-2');
  if (!raw.response_mode) formData.append('response_mode', 'path');
  readEditImagePaths(raw, String(raw.id || 'edit')).forEach((filePath, index) => appendFile(formData, `image_${index}`, filePath));
  if (raw.mask_path) appendFile(formData, 'mask', raw.mask_path);
}

function readTaskMaxEdge(task) {
  return readMaxImageEdge(task.raw.size || (task.mode === 'generate' ? '1024x1024' : undefined));
}

function validateEditStrategyFields(raw) {
  if (hasOwn(raw, 'response_mode')) normalizeEnumValue(raw.response_mode, RESPONSE_MODES, 'response_mode');
  if (hasOwn(raw, 'stream_mode')) normalizeEnumValue(raw.stream_mode, STREAM_MODES, 'stream_mode');
  if (hasOwn(raw, 'streaming_strategy')) {
    normalizeEnumValue(raw.streaming_strategy, STREAMING_STRATEGIES, 'streaming_strategy');
  }
  if (hasOwn(raw, 'partial_images')) readPartialImages(raw.partial_images, 'partial_images');
}

function normalizeEnumValue(value, allowed, name) {
  const normalized = String(value);
  if (allowed.has(normalized)) return normalized;
  throw new Error(`${name} 的值无效：${normalized}`);
}

function readPartialImages(value, name) {
  const parsed = readConfiguredPositiveInteger(value, name, 2);
  if (parsed < MIN_PARTIAL_IMAGES || parsed > MAX_PARTIAL_IMAGES) {
    throw new Error(`${name} 必须是 1 到 3 的整数。`);
  }
  return parsed;
}

function appendFile(formData, field, filePath) {
  const buffer = fs.readFileSync(filePath);
  formData.append(field, new Blob([buffer], { type: mimeTypeForPath(filePath) }), path.basename(filePath));
}

async function fetchJson(url, init) {
  const { response, text } = await fetchText(url, init);
  let result = null;
  try {
    result = text ? JSON.parse(text) : null;
  } catch (error) {
    if (response.ok) throw new Error(`响应不是有效 JSON：${errorMessage(error)}`);
  }
  return { response, result, text };
}

async function fetchText(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function readErrorMessage(result) {
  if (typeof result?.error === 'string') return result.error;
  if (typeof result?.error?.message === 'string') return result.error.message;
  return undefined;
}

function enrichImageUrls(result) {
  if (!result || !Array.isArray(result.images)) return result;
  return {
    ...result,
    images: result.images.map((image) => ({
      ...image,
      ...(image.content_url ? { absolute_content_url: new URL(image.content_url, `${baseUrl}/`).toString() } : {}),
      ...(image.metadata_url ? { absolute_metadata_url: new URL(image.metadata_url, `${baseUrl}/`).toString() } : {})
    }))
  };
}

async function assertDimensions(task, response) {
  const expected = parseExpectedSize(task.raw.size || (task.mode === 'generate' ? '1024x1024' : undefined));
  if (!expected) throw new Error(`${task.id} --dimension-check 需要 size 为 WIDTHxHEIGHT。`);
  if (!Array.isArray(response.images)) return;
  for (const image of response.images) {
    const bytes = await readImageBytes(image);
    const actual = readImageDimensions(bytes);
    if (actual.width !== expected.width || actual.height !== expected.height) {
      throw new Error(`${task.id} 尺寸校验失败：期望 ${expected.width}x${expected.height}，实际 ${actual.width}x${actual.height}。`);
    }
  }
}

async function readImageBytes(image) {
  if (image.b64_json) return Buffer.from(image.b64_json, 'base64');
  const url = image.absolute_content_url || image.content_url;
  if (!url) throw new Error('dimension-check 需要 b64_json 或 content_url。');
  const resolved = resolveSameOriginUrl(baseUrl, url, 'content_url');
  const { response, bytes } = await fetchBytes(resolved, { headers: authHeaders() });
  if (!response.ok) throw new Error(`下载产物失败，状态码 ${response.status}。`);
  return bytes;
}

function parseExpectedSize(size) {
  return parseImageSizeValue(size);
}

function readImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return readWebpDimensions(buffer);
  }
  return readJpegDimensions(buffer);
}

async function fetchBytes(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  } finally {
    clearTimeout(timer);
  }
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('无法读取图片尺寸。');
}

function readWebpDimensions(buffer) {
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  throw new Error('无法读取 WebP 图片尺寸。');
}

function readCompletedManifestKeys(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const keys = new Set();
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.status === 'succeeded') {
      if (entry.id) keys.add(entry.id);
      if (entry.idempotency_key) keys.add(entry.idempotency_key);
    }
  }
  return keys;
}

function appendManifest(filePath, entry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

function baseManifestEntry(task) {
  return { at: new Date().toISOString(), index: task.index, id: task.id, mode: task.mode, idempotency_key: task.idempotencyKey };
}

function sanitizeResponse(response) {
  if (!response || !Array.isArray(response.images)) return response;
  return {
    ...response,
    images: response.images.map((image) => ({
      ...image,
      ...(image.b64_json ? { b64_json_length: image.b64_json.length, b64_json: undefined } : {})
    }))
  };
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function printUsage() {
  console.error('用法：batch-images.mjs --input tasks.jsonl [options]');
  console.error('默认只输出 dry-run；添加 --allow-billable 才会按 routing rules 逐行真实请求 Agent API 或页面 SSE。');
  console.error('常用参数：--manifest --resume --ordered-prefix --dimension-check --timeout-ms --dry-run --allow-billable');
}
