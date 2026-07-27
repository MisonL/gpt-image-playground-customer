import packageJson from '../../package.json';

export type UpstreamRequestHeaders = Record<string, string>;

export type UpstreamRequestHeaderSummary = {
    user_agent_effective: string;
    has_extra_headers: boolean;
    allowed_header_names: string[];
    configured_header_names: string[];
};

const DEFAULT_PRODUCT_USER_AGENT = `visual-journal/${packageJson.version}`;
const CONFIGURABLE_HEADER_BLOCKLIST = new Set([
    'authorization',
    'accept',
    'content-type',
    'content-length',
    'host',
    'idempotency-key',
    'proxy-authorization'
]);
// Defense-in-depth: protocol and proxy-auth headers must never leak from extra upstream headers.
const ALWAYS_FILTERED_EXTRA_HEADER_NAMES = new Set(['idempotency-key', 'proxy-authorization']);
const CANONICAL_HEADER_NAMES: Record<string, string> = {
    accept: 'Accept',
    authorization: 'Authorization',
    'content-length': 'Content-Length',
    'content-type': 'Content-Type',
    'idempotency-key': 'Idempotency-Key',
    'user-agent': 'User-Agent',
    'x-app-id': 'X-App-ID',
    'x-app-secret': 'X-App-Secret'
};
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

export function readDefaultUpstreamUserAgent(env: Record<string, string | undefined> = process.env): string {
    return normalizeHeaderValue(
        env.OPENAI_UPSTREAM_USER_AGENT || env.UPSTREAM_USER_AGENT || DEFAULT_PRODUCT_USER_AGENT
    );
}

export function buildDefaultUpstreamHeaders(
    env: Record<string, string | undefined> = process.env
): UpstreamRequestHeaders {
    return { 'User-Agent': readDefaultUpstreamUserAgent(env) };
}

export function buildMatscaAppHeaders(input: {
    appId?: string;
    appSecret?: string;
}): UpstreamRequestHeaders | undefined {
    const appId = input.appId?.trim();
    const appSecret = input.appSecret?.trim();
    if (!appId && !appSecret) return undefined;
    if (!appId || !appSecret) {
        throw new Error('Matsca appId 和 appSecret 必须同时配置。');
    }
    return {
        'X-App-ID': appId,
        'X-App-Secret': appSecret
    };
}

export function normalizeConfiguredUpstreamHeaders(
    headers: UpstreamRequestHeaders | undefined,
    sourceName = 'upstream headers'
): UpstreamRequestHeaders | undefined {
    const normalized = normalizeHeaderMap(headers, { rejectBlocked: true, sourceName });
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function mergeUpstreamHeadersWithFixed(
    upstreamHeaders: UpstreamRequestHeaders | undefined,
    fixedHeaders: UpstreamRequestHeaders,
    env: Record<string, string | undefined> = process.env
): UpstreamRequestHeaders {
    const baseHeaders = normalizeHeaderMap(buildDefaultUpstreamHeaders(env), { rejectBlocked: false });
    const extraHeaders = normalizeHeaderMap(upstreamHeaders, { rejectBlocked: false });
    const fixedNames = new Set(Object.keys(fixedHeaders).map((name) => name.toLowerCase()));
    const filteredExtraHeaders = Object.fromEntries(
        Object.entries({ ...baseHeaders, ...extraHeaders }).filter(([name]) => {
            const lowerName = name.toLowerCase();
            return !fixedNames.has(lowerName) && !ALWAYS_FILTERED_EXTRA_HEADER_NAMES.has(lowerName);
        })
    );
    return {
        ...filteredExtraHeaders,
        ...normalizeHeaderMap(fixedHeaders, { rejectBlocked: false })
    };
}

export function mergeUpstreamHeaders(
    left: UpstreamRequestHeaders | undefined,
    right: UpstreamRequestHeaders | undefined
): UpstreamRequestHeaders | undefined {
    const merged = normalizeHeaderMap({ ...(left || {}), ...(right || {}) }, { rejectBlocked: false });
    return Object.keys(merged).length > 0 ? merged : undefined;
}

export function summarizeUpstreamRequestHeaders(
    upstreamHeaders: UpstreamRequestHeaders | undefined,
    env: Record<string, string | undefined> = process.env
): UpstreamRequestHeaderSummary {
    const headers = mergeUpstreamHeadersWithFixed(upstreamHeaders, {}, env);
    const configuredHeaders = normalizeHeaderMap(upstreamHeaders, { rejectBlocked: false });
    return {
        user_agent_effective: headers['User-Agent'],
        has_extra_headers: Object.keys(configuredHeaders).some((name) => name.toLowerCase() !== 'user-agent'),
        allowed_header_names: ['user-agent', 'x-app-id', 'x-app-secret'],
        configured_header_names: Object.keys(configuredHeaders)
            .map((name) => name.toLowerCase())
            .sort()
    };
}

function normalizeHeaderMap(
    headers: UpstreamRequestHeaders | undefined,
    options: { rejectBlocked: boolean; sourceName?: string }
): UpstreamRequestHeaders {
    const result: UpstreamRequestHeaders = {};
    for (const [rawName, rawValue] of Object.entries(headers || {})) {
        const name = normalizeHeaderName(rawName, options.sourceName);
        const lowerName = name.toLowerCase();
        if (options.rejectBlocked && CONFIGURABLE_HEADER_BLOCKLIST.has(lowerName)) {
            throw new Error(`${options.sourceName || 'upstream headers'} 不能配置 ${name}。`);
        }
        result[toCanonicalHeaderName(name)] = normalizeHeaderValue(rawValue);
    }
    return result;
}

function normalizeHeaderName(name: string, sourceName = 'upstream headers'): string {
    const normalized = name.trim();
    if (!normalized || !HEADER_NAME_PATTERN.test(normalized)) {
        throw new Error(`${sourceName} 包含无效请求头名称。`);
    }
    return normalized;
}

function normalizeHeaderValue(value: string): string {
    const normalized = value.trim();
    if (!normalized || CONTROL_CHAR_PATTERN.test(normalized)) {
        throw new Error('请求头值不能为空，也不能包含控制字符。');
    }
    return normalized;
}

function toCanonicalHeaderName(name: string): string {
    const lowerName = name.toLowerCase();
    const knownName = CANONICAL_HEADER_NAMES[lowerName];
    if (knownName) return knownName;
    return lowerName
        .split('-')
        .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
        .join('-');
}
