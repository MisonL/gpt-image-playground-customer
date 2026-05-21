#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
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
  maxAttempts = readConfiguredPositiveInteger(process.env.GPT_IMAGE_AGENT_MAX_ATTEMPTS, 'GPT_IMAGE_AGENT_MAX_ATTEMPTS', 3);
  timeoutMs = readConfiguredPositiveInteger(options.timeoutMs, '--timeout-ms', 420000);
  idempotencyKey = options.idempotencyKey || process.env.GPT_IMAGE_AGENT_IDEMPOTENCY_KEY || `agent-generate-${crypto.randomUUID()}`;
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
        endpoint: dryRunEndpoint(options.jobMode),
        job_mode: options.jobMode,
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
  console.error(errorMessage(error));
  process.exit(1);
}

if (contractCheck) {
  await runContractCheck(capabilities);
  process.exit(0);
}

try {
  if (shouldUseJobPolling(capabilities, requestBody, options.jobMode)) {
    await runGenerateJob();
  } else {
    await runGenerateRequest();
  }
} catch (error) {
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
    jobMode: 'auto',
    dryRun: false,
    allowBillable: false,
    help: false,
    promptParts: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--allow-billable') parsed.allowBillable = true;
    else if (arg === '--job') parsed.jobMode = 'always';
    else if (arg === '--no-job') parsed.jobMode = 'never';
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
  return {
    ...body,
    ...(parsed.imageBackend ? { image_backend: parsed.imageBackend } : {}),
    ...(parsed.streamingStrategy ? { streaming_strategy: parsed.streamingStrategy } : {}),
    ...(parsed.partialImages
      ? { partial_images: readConfiguredPositiveInteger(parsed.partialImages, '--partial-images', 2) }
      : {})
  };
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

function dryRunEndpoint(jobMode) {
  if (jobMode === 'always') return `${baseUrl}${AGENT_ENDPOINTS.create_generate_job}`;
  if (jobMode === 'never') return `${baseUrl}${AGENT_ENDPOINTS.generate}`;
  return `${baseUrl}${AGENT_ENDPOINTS.generate} 或 ${baseUrl}${AGENT_ENDPOINTS.create_generate_job}`;
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

async function runGenerateRequest() {
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
  const resultUrl = resolveSameOriginUrl(baseUrl, job.result_url || buildAgentJobResultPath(job.id), 'job.result_url');
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
        JSON.stringify({ ok: false, billable: false, status: jobCheck.response.status, result: jobCheck.result }, null, 2)
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const fetchInit = { ...init };
    delete fetchInit.timeoutMs;
    const response = await fetch(url, { ...fetchInit, signal: controller.signal });
    const text = await response.text();
    const result = parseJsonResponse(text, response.ok, url);
    return { response, result, text };
  } catch (error) {
    const message = errorMessage(error);
    throw new Error(`请求失败：${url}。${message}`);
  } finally {
    clearTimeout(timeout);
  }
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
  return Boolean(capabilitiesValue?.agent_jobs?.supported === true && capabilitiesValue.agent_jobs.mode === 'job_polling');
}

function shouldUseJobPolling(capabilitiesValue, request, jobMode) {
  if (jobMode === 'never') return false;
  if (!supportsJobPolling(capabilitiesValue)) {
    if (jobMode === 'always') {
      throw new Error('服务 capabilities 未声明 agent_jobs.supported=true，不能调用 job endpoint。');
    }
    return false;
  }
  if (jobMode === 'always') return true;
  return request.quality === 'high' && readMaxImageEdge(request.size) >= 3072;
}

function readMaxImageEdge(size) {
  if (typeof size !== 'string') return 0;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return 0;
  return Math.max(Number(match[1]), Number(match[2]));
}

function printUsage() {
  console.error('用法：generate-image.mjs [options] <prompt>');
  console.error('默认只输出 dry-run；添加 --allow-billable 才会真实生图。');
  console.error(
    '常用参数：--model --size --quality --n --format --response-mode --image-backend --streaming-strategy --partial-images --timeout-ms --prompt-file --idempotency-key --job --no-job'
  );
  console.error('契约检查：GPT_IMAGE_AGENT_CONTRACT_CHECK=1 generate-image.mjs 或 generate-image.mjs --contract-check');
}
