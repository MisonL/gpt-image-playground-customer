import { isLoopbackIpAddress, isPublicIpAddress, isSyntheticDnsIpAddress } from './network-security';
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

export type ImageTransportTunMode = 'disabled' | 'synthetic-dns';

const DEFAULT_IMAGE_UPSTREAM_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_UPSTREAM_MAX_RETRIES = 0;
const MAX_PINNED_DNS_ROTATION_ENTRIES = 256;
const DEFAULT_TRANSPORT_RESOURCE_CLOSE_TIMEOUT_MS = 5000;
const UPSTREAM_PROXY_URL_ENV = 'OPENAI_UPSTREAM_PROXY_URL';
const proxyDispatcherByUrl = new Map<string, ProxyAgent>();
const upstreamDnsDispatcherByPolicy = new Map<string, Agent>();

/**
 * Raised when an upstream API returns a successful HTML page instead of the
 * JSON or SSE response required by the image APIs.  Keeping this distinction
 * at the transport boundary prevents the OpenAI SDK from reducing a
 * deterministic upstream response-format failure to a generic connection
 * error.
 */
export class UpstreamResponseFormatError extends Error {
    readonly code = 'upstream_response_format';
    readonly status = 502;
    readonly upstreamStatus: number;
    readonly contentType?: string;
    readonly headers: Headers;

    constructor(input: { upstreamStatus: number; contentType?: string; headers?: Headers }) {
        super('上游返回 HTML 页面而不是 JSON 或 SSE 响应。请确认 API URL 填写的是兼容接口根地址，而不是网页地址。');
        this.name = 'UpstreamResponseFormatError';
        this.upstreamStatus = input.upstreamStatus;
        this.contentType = input.contentType;
        this.headers = new Headers(
            input.headers ?? (input.contentType ? { 'content-type': input.contentType } : undefined)
        );
    }
}

/**
 * Close cached proxy dispatchers when a short-lived consumer (for example a
 * test worker) is about to exit. The application normally keeps these
 * dispatchers cached for the lifetime of the process.
 */
export async function closeOpenAIImageTransportResources(
    timeoutMs = DEFAULT_TRANSPORT_RESOURCE_CLOSE_TIMEOUT_MS
): Promise<void> {
    const dispatchers = [...proxyDispatcherByUrl.values(), ...upstreamDnsDispatcherByPolicy.values()];
    proxyDispatcherByUrl.clear();
    upstreamDnsDispatcherByPolicy.clear();
    if (dispatchers.length === 0) return;

    const normalizedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.floor(timeoutMs) : 0;
    const closePromise = Promise.allSettled(dispatchers.map((dispatcher) => dispatcher.close()));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
        closePromise.then(() => false),
        new Promise<boolean>((resolve) => {
            timeout = setTimeout(() => resolve(true), normalizedTimeoutMs);
        })
    ]);
    if (timeout) clearTimeout(timeout);
    if (!timedOut) return;

    const destroyError = new Error('上游传输资源优雅关闭超时，已强制终止未完成请求。');
    await Promise.allSettled(
        dispatchers.map((dispatcher) =>
            Promise.race([
                dispatcher.destroy(destroyError),
                new Promise<void>((resolve) => setTimeout(resolve, normalizedTimeoutMs))
            ])
        )
    );
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
            allowedPlainHttpBaseUrls: input.allowedPlainHttpBaseUrls,
            allowSyntheticDns: readSyntheticDnsSetting(input.env)
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
    options: { baseURL?: string; allowedPlainHttpBaseUrls?: string[]; allowSyntheticDns?: boolean } = {}
): Promise<Response> {
    const allowSyntheticDns = options.allowSyntheticDns ?? readSyntheticDnsSetting();
    if (upstreamProxyUrl && dispatcher) {
        throw new Error('不能同时指定 upstreamProxyUrl 和 pinned dispatcher。');
    }
    if (!upstreamProxyUrl) {
        const effectiveDispatcher =
            dispatcher ||
            getUpstreamDnsDispatcher({
                baseURL: options.baseURL || readFetchUrl(input),
                allowedPlainHttpBaseUrls: options.allowedPlainHttpBaseUrls,
                allowSyntheticDns
            });
        return fetch(
            input,
            effectiveDispatcher
                ? ({ ...(init || {}), dispatcher: effectiveDispatcher } as Parameters<typeof fetch>[1])
                : init
        ).then(validateUpstreamResponseFormat);
    }
    const normalizedProxyUrl = normalizeUpstreamProxyUrl(upstreamProxyUrl, UPSTREAM_PROXY_URL_ENV);
    const proxyDispatcher = getUpstreamProxyDispatcher(normalizedProxyUrl);
    // Use Node's native fetch so OpenAI SDK multipart uploads retain native FormData encoding.
    return fetch(input, { ...(init || {}), dispatcher: proxyDispatcher } as Parameters<typeof fetch>[1]).then(
        validateUpstreamResponseFormat
    );
}

async function validateUpstreamResponseFormat(response: Response): Promise<Response> {
    if (!response.ok) return response;
    const contentType = response.headers.get('content-type') || '';
    const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') return response;
    try {
        await response.body?.cancel();
    } catch {
        // The response is being rejected regardless; cancellation is best effort.
    }
    throw new UpstreamResponseFormatError({
        upstreamStatus: response.status,
        contentType: mediaType || contentType || undefined,
        headers: response.headers
    });
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
                const requestedFamily = options.family && options.family !== 0 ? options.family : undefined;
                const candidateAddresses = requestedFamily
                    ? addresses.filter(({ family }) => family === requestedFamily)
                    : addresses;
                if (candidateAddresses.length === 0) {
                    callback(
                        Object.assign(new Error('已验证 DNS 地址没有匹配请求地址族。'), {
                            code: 'ERR_FORBIDDEN_DNS_FAMILY'
                        }),
                        '',
                        0
                    );
                    return;
                }
                if (options.all) {
                    callback(
                        null,
                        candidateAddresses.map(({ address, family }) => ({ address, family }))
                    );
                    return;
                }
                const address = candidateAddresses[nextAddress % candidateAddresses.length];
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
        allowSyntheticDns?: boolean;
        lookup?: typeof dns.lookup;
        allowedPrivateHostnames?: readonly string[];
    } = {}
): Agent {
    const allowPrivate = input.allowPrivate === true;
    const allowSyntheticDns = input.allowSyntheticDns === true;
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
                                (allowSyntheticDns && !literalFamily && isSyntheticDnsIpAddress(address)) ||
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
        allowSyntheticDns?: boolean;
    } = {}
): Agent {
    return createDnsValidatedDispatcher(
        resolveUpstreamDnsPolicy(input.baseURL, input.allowedPlainHttpBaseUrls, input.allowSyntheticDns)
    );
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
    const syntheticDnsEnabled = readSyntheticDnsSetting(env);
    return {
        upstream_timeout_ms: readImageUpstreamTimeoutMs(env),
        stream_data_interval_timeout_ms: readImageStreamDataIntervalTimeoutMs(env),
        upstream_max_retries: readImageUpstreamMaxRetries(env),
        upstream_proxy: summarizeOpenAIUpstreamProxy(readOpenAIUpstreamProxyUrl(env)),
        tun_mode: (syntheticDnsEnabled ? 'synthetic-dns' : 'disabled') as ImageTransportTunMode
    };
}

function createOpenAIUpstreamFetch(
    upstreamProxyUrl: string | undefined,
    options: { baseURL?: string; allowedPlainHttpBaseUrls?: string[]; allowSyntheticDns?: boolean }
): NonNullable<ClientOptions['fetch']> {
    return (input, init) =>
        fetchOpenAIUpstream(input, init, upstreamProxyUrl, undefined, {
            baseURL: options.baseURL,
            allowedPlainHttpBaseUrls: options.allowedPlainHttpBaseUrls,
            allowSyntheticDns: options.allowSyntheticDns
        });
}

function readFetchUrl(input: Parameters<NonNullable<ClientOptions['fetch']>>[0]): string | undefined {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
    return undefined;
}

function getUpstreamDnsDispatcher(options: {
    baseURL?: string;
    allowedPlainHttpBaseUrls?: string[];
    allowSyntheticDns?: boolean;
}): Agent {
    const policy = resolveUpstreamDnsPolicy(
        options.baseURL,
        options.allowedPlainHttpBaseUrls,
        options.allowSyntheticDns
    );
    const hostKey = policy.allowedPrivateHostnames?.join(',') || '';
    const key = `${policy.allowPrivate ? 'private' : 'public'}:${policy.allowSyntheticDns ? 'synthetic' : 'strict'}:${hostKey}`;
    const existing = upstreamDnsDispatcherByPolicy.get(key);
    if (existing) return existing;
    const dispatcher = createDnsValidatedDispatcher(policy);
    upstreamDnsDispatcherByPolicy.set(key, dispatcher);
    return dispatcher;
}

export function resolveUpstreamDnsPolicy(
    baseURL: string | undefined,
    allowedPlainHttpBaseUrls: string[] | undefined,
    allowSyntheticDns = false
): { allowPrivate: boolean; allowSyntheticDns: boolean; allowedPrivateHostnames?: string[] } {
    if (!baseURL) return { allowPrivate: false, allowSyntheticDns };
    let parsed: URL;
    try {
        parsed = new URL(baseURL);
    } catch {
        return { allowPrivate: false, allowSyntheticDns };
    }
    if (parsed.protocol !== 'http:') return { allowPrivate: false, allowSyntheticDns };
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        return { allowPrivate: true, allowSyntheticDns, allowedPrivateHostnames: [hostname] };
    }
    if (net.isIP(hostname) === 4 && hostname.startsWith('127.')) {
        return { allowPrivate: true, allowSyntheticDns, allowedPrivateHostnames: [hostname] };
    }
    if (net.isIP(hostname) === 6 && isLoopbackIpAddress(hostname)) {
        return { allowPrivate: true, allowSyntheticDns, allowedPrivateHostnames: [hostname] };
    }
    const normalized = normalizePlainHttpBaseUrl(parsed);
    const explicitlyAllowed = (allowedPlainHttpBaseUrls ?? []).some((value) => {
        try {
            return normalizePlainHttpBaseUrl(new URL(value)) === normalized;
        } catch {
            return false;
        }
    });
    return explicitlyAllowed
        ? { allowPrivate: true, allowSyntheticDns, allowedPrivateHostnames: [hostname] }
        : { allowPrivate: false, allowSyntheticDns };
}

export function readSyntheticDnsSetting(env: ImageTransportEnv = process.env): boolean {
    const tunMode = env.OPENAI_TUN_MODE?.trim().toLowerCase();
    if (tunMode) {
        if (['disabled', 'off', 'strict'].includes(tunMode)) return false;
        if (['synthetic-dns', 'synthetic_dns', 'fake-ip', 'fake_ip', 'enabled', 'on'].includes(tunMode)) return true;
        throw new Error('OPENAI_TUN_MODE 必须是 disabled 或 synthetic-dns。');
    }
    return ['1', 'true', 'yes', 'on'].includes(env.OPENAI_ALLOW_SYNTHETIC_DNS_IPS?.trim().toLowerCase() || '');
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
