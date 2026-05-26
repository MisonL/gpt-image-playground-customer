const MAX_RETRY_AFTER_SECONDS = 60;
const DIGITS_PATTERN = /^\d+$/;

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
