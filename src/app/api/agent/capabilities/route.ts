import { buildAgentCapabilities } from '@/lib/agent-api-contracts';
import { RequestValidationError } from '@/lib/image-request-utils';
import { normalizeConfiguredUpstreamHeaders, type UpstreamRequestHeaders } from '@/lib/image-upstream-profile';
import { parseImageProviderManifest } from '@/lib/image-upstream-provider-manifest';
import { NextResponse } from 'next/server';

const CONFIGURED_MARKER = 'configured';
const REDACTED_CHANNEL_FIELDS = new Set(['API_KEYS', 'MATSCA_APP_ID', 'MATSCA_APP_SECRET', 'USER_AGENT']);

export async function GET() {
    // 保持未鉴权，便于 Agent 在发起工具调用前发现契约和鉴权要求。
    return NextResponse.json(buildAgentCapabilities(readPublicCapabilitiesEnv()));
}

function readPublicCapabilitiesEnv(): Record<string, string | undefined> {
    return {
        AGENT_STATE_BACKEND: process.env.AGENT_STATE_BACKEND,
        AGENT_API_TOKEN: process.env.AGENT_API_TOKEN?.trim() ? 'configured' : undefined,
        APP_PASSWORD: process.env.APP_PASSWORD?.trim() ? 'configured' : undefined,
        AGENT_DATABASE_URL: process.env.AGENT_DATABASE_URL ? 'configured' : undefined,
        AGENT_DB_PASSWORD: process.env.AGENT_DB_PASSWORD ? 'configured' : undefined,
        AGENT_DB_PASSWORD_FILE: process.env.AGENT_DB_PASSWORD_FILE ? 'configured' : undefined,
        AGENT_REQUEST_TTL_SECONDS: process.env.AGENT_REQUEST_TTL_SECONDS,
        AGENT_PUBLIC_BASE_URL: process.env.AGENT_PUBLIC_BASE_URL,
        ENABLE_RESPONSES_IMAGE_BACKEND: process.env.ENABLE_RESPONSES_IMAGE_BACKEND,
        OPENAI_RESPONSES_API_MODEL: process.env.OPENAI_RESPONSES_API_MODEL?.trim() ? 'configured' : undefined,
        NEXT_PUBLIC_IMAGE_STORAGE_MODE: process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE,
        VERCEL: process.env.VERCEL,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() ? 'configured' : undefined,
        OPENAI_API_BASE_URL: process.env.OPENAI_API_BASE_URL,
        OPENAI_UPSTREAM_PROFILE: process.env.OPENAI_UPSTREAM_PROFILE,
        OPENAI_UPSTREAM_REQUEST_MODES: process.env.OPENAI_UPSTREAM_REQUEST_MODES,
        OPENAI_UPSTREAM_REQUEST_MODE_PRIORITY: process.env.OPENAI_UPSTREAM_REQUEST_MODE_PRIORITY,
        OPENAI_UPSTREAM_USER_AGENT: readConfiguredMarker(process.env.OPENAI_UPSTREAM_USER_AGENT),
        UPSTREAM_USER_AGENT: readConfiguredMarker(process.env.UPSTREAM_USER_AGENT),
        OPENAI_ROUTING_STRATEGY: process.env.OPENAI_ROUTING_STRATEGY,
        OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS: process.env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS,
        IMAGE_UPSTREAM_TIMEOUT_MS: process.env.IMAGE_UPSTREAM_TIMEOUT_MS,
        IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS: process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS,
        IMAGE_UPSTREAM_MAX_RETRIES: process.env.IMAGE_UPSTREAM_MAX_RETRIES,
        ...readPublicChannelEnv(process.env)
    };
}

function readPublicChannelEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
    const publicEnv: Record<string, string | undefined> = {};
    for (const key of Object.keys(env)) {
        const match =
            /^OPENAI_CHANNEL_(\d+)_(ID|BASE_URL|UPSTREAM_PROFILE|PROVIDER_MANIFEST|REQUEST_MODES|REQUEST_MODE_PRIORITY|API_KEYS|MATSCA_APP_ID|MATSCA_APP_SECRET|USER_AGENT|UPSTREAM_HEADERS_JSON)$/.exec(
                key
            );
        if (!match) continue;
        const [, , fieldName] = match;
        publicEnv[key] = readPublicChannelEnvValue(key, fieldName, env[key]);
    }
    return publicEnv;
}

function readPublicChannelEnvValue(key: string, fieldName: string, value: string | undefined): string | undefined {
    if (REDACTED_CHANNEL_FIELDS.has(fieldName)) return readConfiguredMarker(value);
    if (fieldName === 'UPSTREAM_HEADERS_JSON') return sanitizePublicUpstreamHeadersJson(key, value);
    if (fieldName === 'PROVIDER_MANIFEST') return sanitizePublicProviderManifest(value);
    return value;
}

function readConfiguredMarker(value: string | undefined): string | undefined {
    return value?.trim() ? CONFIGURED_MARKER : undefined;
}

function sanitizePublicUpstreamHeadersJson(key: string, value: string | undefined): string | undefined {
    if (!value?.trim()) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new RequestValidationError(`${key} 必须是 JSON 对象。`, 500);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new RequestValidationError(`${key} 必须是 JSON 对象。`, 500);
    }
    const headers: UpstreamRequestHeaders = {};
    for (const [name, headerValue] of Object.entries(parsed)) {
        if (typeof headerValue !== 'string') {
            throw new RequestValidationError(`${key} 的值必须都是字符串。`, 500);
        }
        headers[name] = headerValue;
    }
    const normalized = normalizeConfiguredUpstreamHeaders(headers, key);
    const sanitized = Object.fromEntries(
        Object.keys(normalized || {}).map((name) => [name, CONFIGURED_MARKER])
    ) as UpstreamRequestHeaders;
    return JSON.stringify(sanitized);
}

function sanitizePublicProviderManifest(value: string | undefined): string | undefined {
    if (!value?.trim()) return undefined;
    return JSON.stringify(parseImageProviderManifest(value));
}
