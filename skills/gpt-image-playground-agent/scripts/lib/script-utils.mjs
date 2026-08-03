import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const MAX_RETRY_AFTER_SECONDS = 60;
const DIGITS_PATTERN = /^\d+$/;
const IMAGE_SIZE_PATTERN = /^(\d+)x(\d+)$/;
const LEGACY_IMAGE_SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536']);
export const DEFAULT_PLAYGROUND_BASE_URL = 'http://localhost:4783';
const DEFAULT_PRIVATE_AGENT_ENV_FILE = '.env.agent.local';
const PRIVATE_AGENT_ENV_PREFIX = 'GPT_IMAGE_';
const DISABLE_PRIVATE_AGENT_ENV_VALUES = new Set(['0', 'false', 'no']);

export function loadPrivateAgentEnvFile(options = {}) {
  const env = options.env || process.env;
  if (isPrivateAgentEnvLoadingDisabled(env)) {
    return { loaded: false, skipped: true, reason: 'disabled_by_env' };
  }
  const cwd = options.cwd || process.cwd();
  const filePath = options.filePath || findPrivateAgentEnvFile(cwd);
  if (!existsSync(filePath)) {
    return { loaded: false, skipped: true, reason: 'file_not_found', path: filePath };
  }
  const entries = parsePrivateAgentEnvContent(readFileSync(filePath, 'utf8'));
  const appliedNames = [];
  for (const { name, value } of entries) {
    if (!name.startsWith(PRIVATE_AGENT_ENV_PREFIX)) continue;
    if (env[name] !== undefined) continue;
    env[name] = value;
    appliedNames.push(name);
  }
  return {
    loaded: true,
    path: filePath,
    applied_names: appliedNames
  };
}

export function readOptionValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 需要参数值。`);
  }
  return value;
}

export function readConfiguredPositiveInteger(value, name, fallback) {
  const rawValue = value === undefined || value === null ? '' : String(value).trim();
  if (!rawValue) return fallback;
  if (!DIGITS_PATTERN.test(rawValue)) {
    throw new Error(`${name} 必须是正整数。`);
  }
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} 必须是正整数。`);
  }
  return parsed;
}

export function readConfiguredNonNegativeInteger(value, name, fallback) {
  const rawValue = value === undefined || value === null ? '' : String(value).trim();
  if (!rawValue) return fallback;
  if (!DIGITS_PATTERN.test(rawValue)) {
    throw new Error(`${name} 必须是非负整数。`);
  }
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} 必须是非负整数。`);
  }
  return parsed;
}

export function readCapabilitiesImageTransportTimeoutMs(capabilities, fallback) {
  const value = capabilities?.image_transport?.upstream_timeout_ms;
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.max(fallback, value);
}

export function readPartialImages(value, name = 'partial_images') {
  const parsed = readConfiguredNonNegativeInteger(value, name, 2);
  if (parsed < 0 || parsed > 4) {
    throw new Error(`${name} 必须是 0 到 4 的整数。`);
  }
  return parsed;
}

export function validateAgentGenerateRequestAgainstCapabilities(body, capabilities) {
  assertNumberWithinCapabilities(
    body.n,
    readImageCountLimitForBackend(body.image_backend ?? body.imageBackend, capabilities, 'generate_images'),
    'n'
  );
  assertNumberWithinCapabilities(
    body.partial_images,
    readPartialImagesLimitForBackend(body.image_backend ?? body.imageBackend, capabilities),
    'partial_images'
  );
}

export function validateAgentEditRequestAgainstCapabilities(input, capabilities) {
  assertNumberWithinCapabilities(
    input.n,
    readImageCountLimitForBackend(input.image_backend ?? input.imageBackend, capabilities, 'edit_images'),
    'n'
  );
  assertNumberWithinCapabilities(
    input.partial_images,
    readPartialImagesLimitForBackend(input.image_backend ?? input.imageBackend, capabilities),
    'partial_images'
  );
  assertMaxCountWithinCapabilities(input.imageCount, capabilities?.limits?.upload_images?.max, 'image');
}

function readPartialImagesLimitForBackend(backend, capabilities) {
  const normalizedBackend =
    backend === 'responses' || backend === 'responses-image-generation' ? 'responses-image-generation' : 'images-api';
  return capabilities?.limits?.partial_images_by_backend?.[normalizedBackend] || capabilities?.limits?.partial_images;
}

function readImageCountLimitForBackend(backend, capabilities, legacyField) {
  const normalizedBackend =
    backend === 'responses' || backend === 'responses-image-generation' ? 'responses-image-generation' : 'images-api';
  return capabilities?.limits?.[`${legacyField}_by_backend`]?.[normalizedBackend] || capabilities?.limits?.[legacyField];
}

function assertNumberWithinCapabilities(value, limits, fieldName) {
  if (value === undefined || value === null || !limits) return;
  const min = limits.min;
  const max = limits.max;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return;
  if (value < min || value > max) {
    throw new Error(`${fieldName} 必须在当前 capabilities 允许的 ${min} 到 ${max} 之间。`);
  }
}

function assertMaxCountWithinCapabilities(value, max, fieldName) {
  if (value === undefined || value === null || !Number.isSafeInteger(max)) return;
  if (value > max) {
    throw new Error(`${fieldName} 数量不能超过当前 capabilities 允许的 ${max}。`);
  }
}

export function normalizeBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('base URL 必须是有效的 http/https 绝对 URL。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('base URL 必须使用 http 或 https。');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('base URL 不能包含凭据、查询参数或片段。');
  }
  return normalized;
}

export function resolvePlaygroundBaseUrl(explicitBaseUrl, env = process.env) {
  if (explicitBaseUrl) {
    return {
      baseUrl: normalizeBaseUrl(explicitBaseUrl),
      source: 'user_provided',
      interactive_confirmation_required: false
    };
  }
  if (env.GPT_IMAGE_PLAYGROUND_URL) {
    return {
      baseUrl: normalizeBaseUrl(env.GPT_IMAGE_PLAYGROUND_URL),
      source: 'GPT_IMAGE_PLAYGROUND_URL',
      interactive_confirmation_required: true
    };
  }
  return {
    baseUrl: DEFAULT_PLAYGROUND_BASE_URL,
    source: 'default_local_probe',
    interactive_confirmation_required: true
  };
}

export function normalizeOutputFormat(value) {
  return value.toLowerCase() === 'jpg' ? 'jpeg' : value.toLowerCase();
}

export function assertValidImageSizeForModel(value, model, label = 'size') {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} 必须是字符串。`);
  }
  if (model !== 'gpt-image-2') {
    if (!LEGACY_IMAGE_SIZES.has(value)) {
      throw new Error(`${label} 对 ${model} 无效；非 gpt-image-2 只支持 auto、1024x1024、1536x1024、1024x1536。`);
    }
    return value;
  }
  if (value === 'auto') return value;
  const size = parseImageSizeValue(value);
  if (!size) throw new Error(`${label} 必须是 auto 或 WIDTHxHEIGHT。`);
  assertPositiveIntegerDimensions(size.width, size.height, label);
  return value;
}

export function parseImageSizeValue(value) {
  if (typeof value !== 'string') return undefined;
  const match = IMAGE_SIZE_PATTERN.exec(value);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
}

export function readMaxImageEdge(value) {
  const size = parseImageSizeValue(value);
  return size ? Math.max(size.width, size.height) : 0;
}

export function parseRetryAfterValue(value, fallback = 1) {
  if (!value || !/^\d+$/.test(value)) return clampRetryAfterSeconds(fallback);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return MAX_RETRY_AFTER_SECONDS;
  return clampRetryAfterSeconds(parsed);
}

export function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function clampRetryAfterSeconds(value) {
  if (!Number.isFinite(value)) return MAX_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.round(value)));
}

export function resolveSameOriginUrl(baseUrl, value, label) {
  const base = new URL(baseUrl);
  const resolved = new URL(value, `${baseUrl}/`);
  if (resolved.origin !== base.origin) {
    throw new Error(`${label} 指向不同 origin，拒绝携带鉴权头访问。`);
  }
  return resolved.toString();
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isPrivateAgentEnvLoadingDisabled(env) {
  return DISABLE_PRIVATE_AGENT_ENV_VALUES.has(String(env.GPT_IMAGE_AGENT_LOAD_ENV_FILE || '').trim().toLowerCase());
}

function findPrivateAgentEnvFile(cwd) {
  const start = resolve(cwd);
  let current = start;
  while (true) {
    const candidate = join(current, DEFAULT_PRIVATE_AGENT_ENV_FILE);
    if (existsSync(candidate)) return candidate;
    if (isPrivateAgentEnvSearchBoundary(current) || dirname(current) === current) {
      return join(start, DEFAULT_PRIVATE_AGENT_ENV_FILE);
    }
    current = dirname(current);
  }
}

function isPrivateAgentEnvSearchBoundary(directory) {
  return existsSync(join(directory, '.git')) || isPlaygroundProjectRoot(directory) || isStandaloneSkillRoot(directory);
}

function isPlaygroundProjectRoot(directory) {
  return existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'skills/gpt-image-playground-agent/SKILL.md'));
}

function isStandaloneSkillRoot(directory) {
  return (
    existsSync(join(directory, 'SKILL.md')) &&
    existsSync(join(directory, 'scripts')) &&
    !isPlaygroundProjectRoot(dirname(dirname(directory)))
  );
}

function parsePrivateAgentEnvContent(content) {
  const entries = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parsePrivateAgentEnvLine(line);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function parsePrivateAgentEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return undefined;
  return { name: match[1], value: parsePrivateAgentEnvValue(match[2].trim()) };
}

function parsePrivateAgentEnvValue(value) {
  if (value.length < 2) return value;
  if (value.startsWith('"') || value.startsWith("'")) return parseQuotedPrivateAgentEnvValue(value);
  return stripPrivateAgentEnvComment(value).trim();
}

function parseQuotedPrivateAgentEnvValue(value) {
  const quote = value[0];
  const closeIndex = value.indexOf(quote, 1);
  if (closeIndex < 0) return value.slice(1);
  return value.slice(1, closeIndex);
}

function stripPrivateAgentEnvComment(value) {
  const index = value.search(/\s#/);
  if (index < 0) return value;
  return value.slice(0, index);
}

function assertPositiveIntegerDimensions(width, height, label) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} 的宽度和高度必须是正数。`);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`${label} 的宽度和高度必须是整数。`);
  }
}
