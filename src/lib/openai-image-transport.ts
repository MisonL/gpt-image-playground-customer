import type OpenAI from 'openai';
import type { ClientOptions } from 'openai';

type ImageTransportEnv = Record<string, string | undefined>;

const DEFAULT_IMAGE_UPSTREAM_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = 900_000;
const DEFAULT_IMAGE_UPSTREAM_MAX_RETRIES = 0;

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
    env?: ImageTransportEnv;
}): ClientOptions {
    return {
        apiKey: input.apiKey,
        baseURL: input.baseURL,
        defaultHeaders: input.defaultHeaders,
        timeout: readImageUpstreamTimeoutMs(input.env),
        maxRetries: readImageUpstreamMaxRetries(input.env)
    };
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
        upstream_max_retries: readImageUpstreamMaxRetries(env)
    };
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
