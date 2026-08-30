import { isPublicIpAddress } from './network-security';
import dns from 'node:dns/promises';
import net from 'node:net';
import type OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import { Agent, ProxyAgent } from 'undici';

type ImageTransportEnv = Record<string, string | undefined>;

type UpstreamProxyProtocol = 'http' | 'https';

export type UpstreamProxySummary = {
    configured: boolean;
    protocol?: UpstreamProxyProtocol;
};

const DEFAULT_IMAGE_UPSTREAM_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_UPSTREAM_MAX_RETRIES = 0;
const MAX_PINNED_DNS_ROTATION_ENTRIES = 256;
const UPSTREAM_PROXY_URL_ENV = 'OPENAI_UPSTREAM_PROXY_URL';
const proxyDispatcherByUrl = new Map<string, ProxyAgent>();
const upstreamDnsDispatcherByPolicy = new Map<string, Agent>();

/**
 * Close cached proxy dispatchers when a short-lived consumer (for example a
 * test worker) is about to exit. The application normally keeps these
 * dispatchers cached for the lifetime of the process.
 */
export async function closeOpenAIImageTransportResources(): Promise<void> {
    const dispatchers = [...proxyDispatcherByUrl.values(), ...upstreamDnsDispatcherByPolicy.values()];
    proxyDispatcherByUrl.clear();
    upstreamDnsDispatcherByPolicy.clear();
    await Promise.allSettled(dispatchers.map((dispatcher) => dispatcher.close()));
}

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
    allowedPlainHttpBaseUrls?: string[];
    env?: ImageTransportEnv;
}): ClientOptions {
    const upstreamProxyUrl = input.upstreamProxyUrl
        ? normalizeUpstreamProxyUrl(input.upstreamProxyUrl, UPSTREAM_PROXY_URL_ENV)
        : undefined;
    return {
        apiKey: input.apiKey,
        baseURL: input.baseURL,
        defaultHeaders: input.defaultHeaders,
        fetch: createOpenAIUpstreamFetch(upstreamProxyUrl, {
            baseURL: input.baseURL,
            allowedPlainHttpBaseUrls: input.allowedPlainHttpBaseUrls
        }),
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
    upstreamProxyUrl?: string,
    dispatcher?: Agent,
    options: { baseURL?: string; allowedPlainHttpBaseUrls?: string[] } = {}
): Promise<Response> {
    if (upstreamProxyUrl && dispatcher) {
        throw new Error('不能同时指定 upstreamProxyUrl 和 pinned dispatcher。');
    }
    if (!upstreamProxyUrl) {
        const effectiveDispatcher =
            dispatcher ||
            getUpstreamDnsDispatcher({
                baseURL: options.baseURL || readFetchUrl(input),
                allowedPlainHttpBaseUrls: options.allowedPlainHttpBaseUrls
            });
        return fetch(
            input,
            effectiveDispatcher
                ? ({ ...(init || {}), dispatcher: effectiveDispatcher } as Parameters<typeof fetch>[1])
                : init
        );
    }
    const normalizedProxyUrl = normalizeUpstreamProxyUrl(upstreamProxyUrl, UPSTREAM_PROXY_URL_ENV);
    const proxyDispatcher = getUpstreamProxyDispatcher(normalizedProxyUrl);
    // Use Node's native fetch so OpenAI SDK multipart uploads retain native FormData encoding.
    return fetch(input, { ...(init || {}), dispatcher: proxyDispatcher } as Parameters<typeof fetch>[1]);
}

export function createPinnedDnsDispatcher(addresses: Array<{ address: string; family: number }>): Agent {
    if (addresses.length === 0) throw new Error('至少需要一个已验证的 DNS 地址。');
    const addressSetKey = addresses.map(({ address, family }) => `${family}:${address}`).join('|');
    const startAddress = pinnedDnsNextAddressBySet.get(addressSetKey) ?? 0;
    pinnedDnsNextAddressBySet.set(addressSetKey, (startAddress + 1) % addresses.length);
    if (pinnedDnsNextAddressBySet.size > MAX_PINNED_DNS_ROTATION_ENTRIES) {
        const oldestKey = pinnedDnsNextAddressBySet.keys().next().value;
        if (typeof oldestKey === 'string') pinnedDnsNextAddressBySet.delete(oldestKey);
    }
    let nextAddress = startAddress;
    return new Agent({
        connect: {
            lookup: (_hostname, options, callback) => {
                if (options.all) {
                    callback(
                        null,
                        addresses.map(({ address, family }) => ({ address, family }))
                    );
                    return;
                }
                const address = addresses[nextAddress % addresses.length];
                nextAddress += 1;
                callback(null, address.address, address.family);
            }
        }
    });
}

/**
 * Resolve and validate the destination at connection time. The dispatcher
 * returns only the addresses from that lookup to undici, so a later DNS
 * rebinding cannot make the same request connect to a different target.
 */
export function createDnsValidatedDispatcher(
    input: {
        allowPrivate?: boolean;
        lookup?: typeof dns.lookup;
        allowedPrivateHostnames?: readonly string[];
    } = {}
): Agent {
    const allowPrivate = input.allowPrivate === true;
    const lookup = input.lookup ?? dns.lookup;
    const allowedPrivateHostnames = new Set(
        (input.allowedPrivateHostnames ?? []).map((hostname) => hostname.replace(/^\[|\]$/g, '').toLowerCase())
    );
    return new Agent({
        connect: {
            lookup: (hostname, options, callback) => {
                const normalizedHostname = hostname.replace(/^\[|\]$/g, '');
                const literalFamily = net.isIP(normalizedHostname);
                const resolve = literalFamily
                    ? Promise.resolve([{ address: normalizedHostname, family: literalFamily }])
                    : lookup(normalizedHostname, { all: true, verbatim: true });
                resolve.then(
                    (addresses) => {
                        const safeAddresses = addresses.filter(
                            ({ address }) =>
                                isPublicIpAddress(address) ||
                                (allowPrivate &&
                                    (allowedPrivateHostnames.size === 0 ||
                                        allowedPrivateHostnames.has(normalizedHostname.toLowerCase())))
                        );
                        if (safeAddresses.length === 0) {
                            callback(
                                Object.assign(new Error('上游 API 主机解析到了被禁止的本地或内网地址。'), {
                                    code: 'ERR_FORBIDDEN_DNS_ADDRESS'
                                }),
                                '',
                                0
                            );
                            return;
                        }
                        const preferred =
                            options.family && options.family !== 0
                                ? safeAddresses.find(({ family }) => family === options.family)
                                : safeAddresses[0];
                        if (!preferred) {
                            callback(
                                Object.assign(new Error('上游 API 主机没有匹配请求地址族的安全 DNS 地址。'), {
                                    code: 'ERR_FORBIDDEN_DNS_FAMILY'
                                }),
                                '',
                                0
                            );
                            return;
                        }
                        if (options.all) {
                            callback(null, safeAddresses);
                            return;
                        }
                        callback(null, preferred.address, preferred.family);
                    },
                    (error) => {
                        const normalizedError = error instanceof Error ? error : new Error(String(error));
                        callback(normalizedError as NodeJS.ErrnoException, '', 0);
                    }
                );
            }
        }
    });
}

export function createUpstreamDnsDispatcher(
    input: {
        baseURL?: string;
        allowedPlainHttpBaseUrls?: string[];
    } = {}
): Agent {
    return createDnsValidatedDispatcher(resolveUpstreamDnsPolicy(input.baseURL, input.allowedPlainHttpBaseUrls));
}

const pinnedDnsNextAddressBySet = new Map<string, number>();

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

function createOpenAIUpstreamFetch(
    upstreamProxyUrl: string | undefined,
    options: { baseURL?: string; allowedPlainHttpBaseUrls?: string[] }
): NonNullable<ClientOptions['fetch']> {
    return (input, init) =>
        fetchOpenAIUpstream(input, init, upstreamProxyUrl, undefined, {
            baseURL: options.baseURL,
            allowedPlainHttpBaseUrls: options.allowedPlainHttpBaseUrls
        });
}

function readFetchUrl(input: Parameters<NonNullable<ClientOptions['fetch']>>[0]): string | undefined {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
    return undefined;
}

function getUpstreamDnsDispatcher(options: { baseURL?: string; allowedPlainHttpBaseUrls?: string[] }): Agent {
    const policy = resolveUpstreamDnsPolicy(options.baseURL, options.allowedPlainHttpBaseUrls);
    const hostKey = policy.allowedPrivateHostnames?.join(',') || '';
    const key = `${policy.allowPrivate ? 'private' : 'public'}:${hostKey}`;
    const existing = upstreamDnsDispatcherByPolicy.get(key);
    if (existing) return existing;
    const dispatcher = createDnsValidatedDispatcher(policy);
    upstreamDnsDispatcherByPolicy.set(key, dispatcher);
    return dispatcher;
}

function resolveUpstreamDnsPolicy(
    baseURL: string | undefined,
    allowedPlainHttpBaseUrls: string[] | undefined
): { allowPrivate: boolean; allowedPrivateHostnames?: string[] } {
    if (!baseURL) return { allowPrivate: false };
    let parsed: URL;
    try {
        parsed = new URL(baseURL);
    } catch {
        return { allowPrivate: false };
    }
    if (parsed.protocol !== 'http:') return { allowPrivate: false };
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        return { allowPrivate: true, allowedPrivateHostnames: [hostname] };
    }
    if (net.isIP(hostname) === 4 && hostname.startsWith('127.')) {
        return { allowPrivate: true, allowedPrivateHostnames: [hostname] };
    }
    if (net.isIP(hostname) === 6 && isLoopbackIpv6(hostname)) {
        return { allowPrivate: true, allowedPrivateHostnames: [hostname] };
    }
    const normalized = normalizePlainHttpBaseUrl(parsed);
    const explicitlyAllowed = (allowedPlainHttpBaseUrls ?? []).some((value) => {
        try {
            return normalizePlainHttpBaseUrl(new URL(value)) === normalized;
        } catch {
            return false;
        }
    });
    return explicitlyAllowed ? { allowPrivate: true, allowedPrivateHostnames: [hostname] } : { allowPrivate: false };
}

function isLoopbackIpv6(hostname: string): boolean {
    return hostname === '::1' || hostname === '0:0:0:0:0:0:0:1' || /^::ffff:127(?:\.\d{1,3}){3}$/.test(hostname);
}

function normalizePlainHttpBaseUrl(value: URL): string {
    const pathname = value.pathname.replace(/\/+$/, '') || '/';
    return `${value.protocol}//${value.host}${pathname}`;
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
