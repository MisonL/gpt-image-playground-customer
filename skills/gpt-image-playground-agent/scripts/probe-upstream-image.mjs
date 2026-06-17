#!/usr/bin/env node
import dns from 'node:dns/promises';
import tls from 'node:tls';
import {
  errorMessage,
  assertValidImageSizeForModel,
  loadPrivateAgentEnvFile,
  normalizeBaseUrl,
  normalizeOutputFormat,
  readConfiguredPositiveInteger,
  readOptionValue
} from './lib/script-utils.mjs';
import { completeScriptTiming, startScriptTiming } from './lib/script-summary.mjs';

const HEADER_ALLOWLIST = new Set(['content-type', 'date', 'server', 'cf-ray', 'x-request-id', 'retry-after']);
const DEFAULT_USER_AGENT = 'gpt-image-playground/probe';
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const DEFAULT_OUTPUT_FORMAT = 'webp';
const DEFAULT_OUTPUT_COMPRESSION = 100;
loadPrivateAgentEnvFile();
const scriptTiming = startScriptTiming();
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
try {
  baseUrl = normalizeBaseUrl(
    options.baseUrl || process.env.GPT_IMAGE_UPSTREAM_BASE_URL || process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'
  );
} catch (error) {
  console.error(errorMessage(error));
  process.exit(2);
}
const apiKey = process.env.GPT_IMAGE_UPSTREAM_API_KEY || process.env.OPENAI_API_KEY || '';
const userAgent = process.env.OPENAI_UPSTREAM_USER_AGENT || process.env.UPSTREAM_USER_AGENT || DEFAULT_USER_AGENT;
let timeoutMs;
try {
  timeoutMs = readConfiguredPositiveInteger(options.timeoutMs, '--timeout-ms', 30000);
  options.size = assertValidImageSizeForModel(options.size, options.model, '--size');
  if (!OUTPUT_FORMATS.has(normalizeOutputFormat(options.format))) {
    throw new Error('--format 必须是 png、jpeg 或 webp。');
  }
  if (options.outputCompression !== undefined) readOutputCompression(options);
} catch (error) {
  console.error(errorMessage(error));
  printUsage();
  process.exit(2);
}
let upstream;
try {
  upstream = new URL(baseUrl);
} catch {
  console.error(`无效的上游 base URL：${baseUrl}`);
  process.exit(2);
}

const report = {
  ok: false,
  billable: false,
  base_url: baseUrl,
  upstream_host: upstream.host,
  api_key_configured: Boolean(apiKey),
  dns: await probeDns(upstream.hostname),
  tls: await probeTls(upstream),
  models: await probeModels()
};

if (options.allowBillable) {
  report.generation = await probeGeneration();
  report.billable = true;
}

report.ok = Boolean(report.models.ok && (!report.generation || report.generation.ok));
report.summary = buildProbeSummary(report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    baseUrl: undefined,
    model: 'gpt-image-2',
    prompt: 'contract probe',
    size: '1024x1024',
    quality: 'low',
    format: DEFAULT_OUTPUT_FORMAT,
    outputCompression: undefined,
    timeoutMs: undefined,
    allowBillable: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') parsed.baseUrl = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--model') parsed.model = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--prompt') parsed.prompt = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--size') parsed.size = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--quality') parsed.quality = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--format' || arg === '--output-format') parsed.format = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--output-compression') parsed.outputCompression = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--allow-billable') parsed.allowBillable = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return parsed;
}

async function probeDns(hostname) {
  const startedAt = Date.now();
  try {
    const result = await dns.lookup(hostname);
    return { ok: true, elapsed_ms: Date.now() - startedAt, address_family: result.family };
  } catch (error) {
    return { ok: false, elapsed_ms: Date.now() - startedAt, error: errorMessage(error) };
  }
}

async function probeTls(url) {
  if (url.protocol !== 'https:') {
    return { ok: true, skipped: true, reason: 'non_https_base_url' };
  }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      timeout: timeoutMs
    });
    socket.once('secureConnect', () => {
      const protocol = socket.getProtocol() || undefined;
      socket.end();
      resolve({ ok: true, elapsed_ms: Date.now() - startedAt, authorized: socket.authorized, protocol });
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ ok: false, elapsed_ms: Date.now() - startedAt, error: 'TLS handshake timed out.' });
    });
    socket.once('error', (error) => {
      resolve({ ok: false, elapsed_ms: Date.now() - startedAt, error: errorMessage(error) });
    });
  });
}

async function probeModels() {
  const { response, json, text, elapsedMs } = await fetchJson(`${baseUrl}/models`, { method: 'GET' });
  return {
    ok: response.ok,
    status: response.status,
    elapsed_ms: elapsedMs,
    content_type: response.headers.get('content-type') || undefined,
    response_headers: readAllowedHeaders(response.headers),
    ...summarizeJson(json, text)
  };
}

async function probeGeneration() {
  const { response, json, text, elapsedMs } = await fetchJson(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      prompt: options.prompt,
      n: 1,
      size: options.size,
      quality: options.quality,
      output_format: normalizeOutputFormat(options.format),
      ...(readOutputCompression(options) !== undefined ? { output_compression: readOutputCompression(options) } : {})
    })
  });
  return {
    ok: response.ok,
    billable: true,
    status: response.status,
    elapsed_ms: elapsedMs,
    content_type: response.headers.get('content-type') || undefined,
    response_headers: readAllowedHeaders(response.headers),
    ...summarizeGenerationJson(json, text)
  };
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'User-Agent': userAgent,
        ...(init.headers || {})
      },
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text, json: parseJson(text), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return {
      response: new Response(JSON.stringify({ error: errorMessage(error) }), { status: 599 }),
      text: '',
      json: { error: errorMessage(error) },
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildProbeSummary(value) {
  const timing = completeScriptTiming(scriptTiming);
  const configuredHeaderNames = readProbeConfiguredHeaderNames();
  return {
    ok: value.ok,
    billable: Boolean(value.generation),
    started_at: timing.started_at,
    completed_at: timing.completed_at,
    elapsed_ms: timing.elapsed_ms,
    transport: 'upstream_probe',
    endpoint: `${baseUrl}/models`,
    upstream_host: upstream.host,
    request_headers: {
      user_agent_effective: userAgent,
      has_extra_headers: configuredHeaderNames.some((name) => name !== 'user-agent'),
      allowed_header_names: ['authorization', 'user-agent'],
      configured_header_names: configuredHeaderNames
    },
    retryable: value.ok ? false : undefined,
    next_action: value.ok ? 'done' : 'inspect_dns_tls_models'
  };
}

function readProbeConfiguredHeaderNames() {
  const names = [];
  if (apiKey) names.push('authorization');
  if (userAgent !== DEFAULT_USER_AGENT) names.push('user-agent');
  return names.sort();
}

function summarizeJson(json, text) {
  if (Array.isArray(json?.data)) {
    return { model_count: json.data.length };
  }
  return { error: summarizeError(json, text) };
}

function summarizeGenerationJson(json, text) {
  if (!Array.isArray(json?.data)) {
    return { error: summarizeError(json, text) };
  }
  const firstImage = json.data[0] || {};
  const firstB64 = typeof firstImage.b64_json === 'string' ? firstImage.b64_json : '';
  return {
    image_count: json.data.length,
    first_b64_length: firstB64.length,
    usage: json.usage || undefined
  };
}

function summarizeError(json, text) {
  const error = json?.error;
  if (typeof error === 'object' && error) {
    return {
      code: typeof error.code === 'string' ? error.code : undefined,
      type: typeof error.type === 'string' ? error.type : undefined,
      message: typeof error.message === 'string' ? error.message : undefined
    };
  }
  return text ? { message: text.slice(0, 500) } : undefined;
}

function readAllowedHeaders(headers) {
  const result = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers.get(name);
    if (value) result[name] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readOutputCompression(parsed) {
  const outputFormat = normalizeOutputFormat(parsed.format);
  if (outputFormat === 'png') return undefined;
  const value = parsed.outputCompression === undefined ? String(DEFAULT_OUTPUT_COMPRESSION) : String(parsed.outputCompression);
  if (!/^\d+$/.test(value)) throw new Error('--output-compression 必须是 0 到 100 之间的整数。');
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 100) {
    throw new Error('--output-compression 必须是 0 到 100 之间的整数。');
  }
  return parsedValue;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function printUsage() {
  console.error('用法：probe-upstream-image.mjs [options]');
  console.error('默认只请求 /models；添加 --allow-billable 才会调用 /images/generations。');
  console.error('常用参数：--base-url --model --prompt --size --quality --format --output-compression --timeout-ms --allow-billable');
}
