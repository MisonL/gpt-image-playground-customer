import type OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

type ImageTransportEnv = Record<string, string | undefined>;

type UpstreamProxyProtocol = 'http' | 'https';

export type UpstreamProxySummary = {
    configured: boolean;
    protocol?: UpstreamProxyProtocol;
};

const DEFAULT_IMAGE_UPSTREAM_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_UPSTREAM_MAX_RETRIES = 0;
const UPSTREAM_PROXY_URL_ENV = 'OPENAI_UPSTREAM_PROXY_URL';
const proxyDispatcherByUrl = new Map<string, ProxyAgent>();

export function readImageUpstreamTimeoutMs(env: ImageTransportEnv = process.env): number {
    return readPositiveIntegerEnv(env, 'IMAGE_UPSTREAM_TIMEOUT_MS', DEFAULT_IMAGE_UPSTREAM_TIMEOUT_MS);
}

export function readImageUpstreamMaxRetries(env: ImageTransportEnv = process.env): number {
    return readNonNegativeIntegerEnv(env, 'IMAGE_UPSTREAM_MAX_RETRIES', DEFAULT_IMAGE_UPSTREAM_MAX_RETRIES);
}

export function readImageStreamDataIntervalTimeoutMs(env: ImageTransportEnv = process.env): number {
    return readNonNegativeIntegerEnv(
        env,
        'IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS',
        DEFAULT_IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS
    );
}

export function createOpenAIImageClientOptions(input: {
    apiKey: string;
    baseURL?: string;
    defaultHeaders?: ClientOptions['defaultHeaders'];
    upstreamProxyUrl?: string;
    env?: ImageTransportEnv;
}): ClientOptions {
    const upstreamProxyUrl = input.upstreamProxyUrl
        ? normalizeUpstreamProxyUrl(input.upstreamProxyUrl, UPSTREAM_PROXY_URL_ENV)
        : undefined;
    return {
        apiKey: input.apiKey,
        baseURL: input.baseURL,
        defaultHeaders: input.defaultHeaders,
        ...(upstreamProxyUrl ? { fetch: createOpenAIUpstreamFetch(upstreamProxyUrl) } : {}),
        timeout: readImageUpstreamTimeoutMs(input.env),
        maxRetries: readImageUpstreamMaxRetries(input.env)
    };
}

export function readOpenAIUpstreamProxyUrl(
    env: ImageTransportEnv = process.env,
    fieldName = UPSTREAM_PROXY_URL_ENV
): string | undefined {
    const rawValue = env[fieldName]?.trim();
    return rawValue ? normalizeUpstreamProxyUrl(rawValue, fieldName) : undefined;
}

export function summarizeOpenAIUpstreamProxy(upstreamProxyUrl: string | undefined): UpstreamProxySummary {
    if (!upstreamProxyUrl) return { configured: false };
    const parsed = new URL(normalizeUpstreamProxyUrl(upstreamProxyUrl, UPSTREAM_PROXY_URL_ENV));
    return {
        configured: true,
        protocol: parsed.protocol.slice(0, -1) as UpstreamProxyProtocol
    };
}

export function fetchOpenAIUpstream(
    input: Parameters<NonNullable<ClientOptions['fetch']>>[0],
    init: Parameters<NonNullable<ClientOptions['fetch']>>[1] | undefined,
    upstreamProxyUrl?: string
): Promise<Response> {
    if (!upstreamProxyUrl) {
        return fetch(input, init);
    }
    const normalizedProxyUrl = normalizeUpstreamProxyUrl(upstreamProxyUrl, UPSTREAM_PROXY_URL_ENV);
    const dispatcher = getUpstreamProxyDispatcher(normalizedProxyUrl);
    return undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...(init || {}), dispatcher } as Parameters<typeof undiciFetch>[1]
    ) as unknown as Promise<Response>;
}

export function buildOpenAIImageRequestOptions(
    input: {
        abortSignal?: AbortSignal;
        headers?: OpenAI.RequestOptions['headers'];
        idempotencyKey?: string;
        env?: ImageTransportEnv;
    } = {}
): OpenAI.RequestOptions {
    const headers = mergeRequestHeaders(input.headers, readIdempotencyHeader(input.idempotencyKey));
    return {
        ...(input.abortSignal ? { signal: input.abortSignal } : {}),
        ...(headers ? { headers } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        timeout: readImageUpstreamTimeoutMs(input.env),
        maxRetries: readImageUpstreamMaxRetries(input.env)
    };
}

export function summarizeOpenAIImageTransport(env: ImageTransportEnv = process.env) {
    return {
        upstream_timeout_ms: readImageUpstreamTimeoutMs(env),
        stream_data_interval_timeout_ms: readImageStreamDataIntervalTimeoutMs(env),
        upstream_max_retries: readImageUpstreamMaxRetries(env),
        upstream_proxy: summarizeOpenAIUpstreamProxy(readOpenAIUpstreamProxyUrl(env))
    };
}

function createOpenAIUpstreamFetch(upstreamProxyUrl: string): NonNullable<ClientOptions['fetch']> {
    return (input, init) => fetchOpenAIUpstream(input, init, upstreamProxyUrl);
}

function getUpstreamProxyDispatcher(upstreamProxyUrl: string): ProxyAgent {
    const existing = proxyDispatcherByUrl.get(upstreamProxyUrl);
    if (existing) return existing;
    const dispatcher = new ProxyAgent(upstreamProxyUrl);
    proxyDispatcherByUrl.set(upstreamProxyUrl, dispatcher);
    return dispatcher;
}

function normalizeUpstreamProxyUrl(rawValue: string, fieldName: string): string {
    // URL normalizes empty query strings, fragments, and dot paths away, so inspect the source before parsing.
    if (rawValue.includes('?') || rawValue.includes('#')) {
        throw new Error(`${fieldName} 不能包含查询参数或片段。`);
    }
    const protocolMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rawValue);
    if (!protocolMatch) {
        throw new Error(`${fieldName} 必须是有效的 HTTP 或 HTTPS 代理 URL。`);
    }
    if (protocolMatch[1].toLowerCase() !== 'http' && protocolMatch[1].toLowerCase() !== 'https') {
        throw new Error(`${fieldName} 仅支持 http 或 https 代理，不支持 SOCKS 或其他协议。`);
    }
    const authorityAndPath = rawValue.slice(protocolMatch[0].length);
    const pathStartIndex = authorityAndPath.search(/[\\/]/);
    if (pathStartIndex >= 0 && authorityAndPath.slice(pathStartIndex) !== '/') {
        throw new Error(`${fieldName} 不能包含路径。`);
    }
    let parsed: URL;
    try {
        parsed = new URL(rawValue);
    } catch {
        throw new Error(`${fieldName} 必须是有效的 HTTP 或 HTTPS 代理 URL。`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${fieldName} 仅支持 http 或 https 代理，不支持 SOCKS。`);
    }
    if (!parsed.hostname) {
        throw new Error(`${fieldName} 必须包含代理服务器主机名。`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`${fieldName} 不能包含代理用户名或密码。`);
    }
    return parsed.toString();
}

function readNonNegativeIntegerEnv(env: ImageTransportEnv, fieldName: string, fallback: number): number {
    const rawValue = env[fieldName];
    if (rawValue === undefined || rawValue.trim() === '') return fallback;
    if (!/^\d+$/.test(rawValue.trim())) {
        throw new Error(`${fieldName} 必须是非负整数。`);
    }
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) {
        throw new Error(`${fieldName} 超出安全整数范围。`);
    }
    return value;
}

function readPositiveIntegerEnv(env: ImageTransportEnv, fieldName: string, fallback: number): number {
    const value = readNonNegativeIntegerEnv(env, fieldName, fallback);
    if (value === 0) {
        throw new Error(`${fieldName} 必须是正整数。`);
    }
    return value;
}

function readIdempotencyHeader(idempotencyKey: string | undefined): Record<string, string> | undefined {
    const value = idempotencyKey?.trim();
    return value ? { 'Idempotency-Key': value } : undefined;
}

function mergeRequestHeaders(
    headers: OpenAI.RequestOptions['headers'] | undefined,
    fixedHeaders: Record<string, string> | undefined
): OpenAI.RequestOptions['headers'] | undefined {
    if (!fixedHeaders) return headers;
    const normalizedHeaders = new Headers(headers as HeadersInit | undefined);
    for (const [name, value] of Object.entries(fixedHeaders)) {
        normalizedHeaders.set(name, value);
    }
    return normalizedHeaders;
}
