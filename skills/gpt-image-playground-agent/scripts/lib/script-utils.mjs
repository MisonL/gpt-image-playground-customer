const MAX_RETRY_AFTER_SECONDS = 60;
const DIGITS_PATTERN = /^\d+$/;
const IMAGE_SIZE_PATTERN = /^(\d+)x(\d+)$/;
const LEGACY_IMAGE_SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536']);

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
  assertNumberWithinCapabilities(body.n, capabilities?.limits?.generate_images, 'n');
  assertNumberWithinCapabilities(
    body.partial_images,
    readPartialImagesLimitForBackend(body.image_backend ?? body.imageBackend, capabilities),
    'partial_images'
  );
}

export function validateAgentEditRequestAgainstCapabilities(input, capabilities) {
  assertNumberWithinCapabilities(input.n, capabilities?.limits?.edit_images, 'n');
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

function assertPositiveIntegerDimensions(width, height, label) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} 的宽度和高度必须是正数。`);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`${label} 的宽度和高度必须是整数。`);
  }
}
