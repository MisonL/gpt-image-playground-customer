import { AGENT_ENDPOINTS, AGENT_JOB_ENDPOINTS } from './agent-api-paths.mjs';
import type { AgentErrorDiagnostics } from './api-error-response';
import {
    MAX_IMAGE_COUNT,
    MAX_PROMPT_LENGTH,
    MAX_UPLOAD_BYTES,
    RequestValidationError,
    validateApiBaseUrl,
    type GptImageModel,
    type ValidOutputFormat
} from './image-request-utils';
import {
    parseImageGenerationBackendValue,
    parseImageStreamingStrategyValue,
    resolveImageStreamEnabled,
    type ImageGenerationBackend,
    type ImageStreamingStrategy
} from './image-upstream-strategy';
import { CHINESE_POSITIVE_INTEGER_MESSAGES, readPositiveIntegerFromEnv } from './positive-integer-config.mjs';
import { readBooleanEnv } from './server-runtime';
import {
    GPT_IMAGE_2_EDGE_MULTIPLE,
    GPT_IMAGE_2_MAX_ASPECT,
    GPT_IMAGE_2_MAX_EDGE,
    GPT_IMAGE_2_MAX_PIXELS,
    GPT_IMAGE_2_MIN_PIXELS,
    validateGptImage2Size
} from './size-utils';

export const AGENT_API_VERSION = '1.0.0';
export const AGENT_SCHEMA_VERSION = '2026-05-24';
export const AGENT_DEFAULT_SQLITE_PATH = 'generated-images/.agent-state/agent.sqlite';
export const AGENT_DEFAULT_LEASE_MS = 10 * 60 * 1000;
export const AGENT_DEFAULT_REQUEST_TTL_SECONDS = 24 * 60 * 60;
export const AGENT_DEFAULT_RECOVERY_INTERVAL_MS = 30 * 1000;

export const AGENT_MODELS = ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2'] as const;
export const AGENT_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;
export const AGENT_RESPONSE_MODES = ['path', 'base64', 'both'] as const;
export const AGENT_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;
export const AGENT_BACKGROUNDS = ['transparent', 'opaque', 'auto'] as const;
export const AGENT_MODERATIONS = ['low', 'auto'] as const;
export const AGENT_LEGACY_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
export const AGENT_JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'expired'] as const;
export const AGENT_IMAGE_BACKENDS = ['images-api', 'responses-image-generation'] as const;
export const PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH = 128;
export const AGENT_STREAMING_STRATEGIES = [
    'off',
    'auto',
    'openai-sse',
    'newapi-keepalive-sse',
    'responses-sse',
    'force-sse'
] as const;
export const AGENT_UPSTREAM_SSE_ACTIVATION_STRATEGIES = [
    'openai-sse',
    'newapi-keepalive-sse',
    'responses-sse',
    'force-sse'
] as const;

export type AgentStateBackend = 'memory' | 'sqlite' | 'postgres';
export type AgentAuthScheme = 'bearer' | 'x-app-password-hash';
export type PageSseAuthScheme = 'form-password-hash';
export type AgentResponseMode = (typeof AGENT_RESPONSE_MODES)[number];
export type AgentQuality = (typeof AGENT_QUALITIES)[number];
export type AgentBackground = (typeof AGENT_BACKGROUNDS)[number];
export type AgentModeration = (typeof AGENT_MODERATIONS)[number];
export type AgentJobState = (typeof AGENT_JOB_STATES)[number];
export type AgentRoutingTransport = 'agent_json' | 'agent_job_polling' | 'page_sse';
export type AgentRoutingStrength = 'default' | 'recommended' | 'must_use';
export type ImageBackendRuntimeRequirement = {
    supported: true;
    enabled: boolean;
    required_env: string[];
    missing_env: string[];
};

export type AgentGenerateRequest = {
    model: GptImageModel;
    prompt: string;
    n: number;
    size: string;
    quality: AgentQuality;
    output_format: ValidOutputFormat;
    output_compression?: number;
    background: AgentBackground;
    moderation: AgentModeration;
    response_mode: AgentResponseMode;
    image_backend: ImageGenerationBackend;
    streaming_strategy: ImageStreamingStrategy;
    partial_images: 1 | 2 | 3;
};

export type AgentImageResponseItem = {
    id: string;
    filename: string;
    content_url: string;
    metadata_url: string;
    output_format: string;
    mime_type: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    b64_json?: string;
};

export type AgentImageResponse = {
    request_id: string;
    idempotency_key: string;
    cached: boolean;
    images: AgentImageResponseItem[];
    usage?: unknown;
    created_at: string;
};

export type AgentJobStatusResponse = {
    job: {
        id: string;
        request_id: string;
        idempotency_key: string;
        mode: 'generate' | 'edit';
        state: AgentJobState;
        created_at: string;
        updated_at: string;
        expires_at: string;
        result_url?: string;
        retry_after_seconds?: number;
        error?: {
            code: string;
            message: string;
            retryable: boolean;
            details?: Record<string, unknown>;
            upstream_status?: number;
            diagnostics?: AgentErrorDiagnostics;
        };
    };
};

export type AgentCapabilities = {
    api_version: string;
    schema_version: string;
    auth: {
        required: boolean;
        schemes: AgentAuthScheme[];
    };
    endpoints: Record<string, string>;
    defaults: {
        model: GptImageModel;
        response_mode: AgentResponseMode;
        state_backend: AgentStateBackend;
        image_backend: ImageGenerationBackend;
        streaming_strategy: ImageStreamingStrategy;
        partial_images: 1 | 2 | 3;
    };
    limits: {
        max_prompt_length: number;
        max_images: number;
        max_upload_mb: number;
        partial_images: { min: number; max: number };
    };
    model_limits: {
        'gpt-image-2': {
            max_edge: number;
            max_pixels: number;
            edge_multiple: number;
            max_aspect: number;
            min_pixels: number;
            recommended_presets: Array<{ name: string; size: string; purpose: string }>;
            large_image_risk: {
                applies_to: string[];
                guidance: string;
            };
        };
    };
    agent_streaming: {
        generate: {
            supported: false;
            mode: 'non_streaming_only';
            endpoint: string;
        };
        edit: {
            supported: false;
            mode: 'non_streaming_only';
            endpoint: string;
        };
        upstream_sse: {
            supported: true;
            mode: 'internal_upstream_sse';
            endpoint: string;
            request_fields: ['image_backend', 'streaming_strategy', 'partial_images'];
            image_backends: readonly ImageGenerationBackend[];
            enabled_image_backends: readonly ImageGenerationBackend[];
            streaming_strategies: readonly ImageStreamingStrategy[];
            activation_strategies: readonly ImageStreamingStrategy[];
            final_response_contract: 'AgentImageResponse';
        };
        page_sse: {
            supported: true;
            mode: 'form_data_sse';
            endpoint: string;
            contract: 'page_ui_only';
            transport_contract: 'page_form_data_sse';
            auth: {
                required: boolean;
                schemes: PageSseAuthScheme[];
                form_field: 'passwordHash';
            };
            client_request_id: {
                form_field: 'clientRequestId';
                source_header: 'Idempotency-Key';
                max_length: number;
            };
            agent_usage: 'recommended_for_high_resolution_generate_edit_and_complex_batch';
        };
    };
    routing_rules: {
        high_resolution_edit: AgentRoutingRule;
        complex_ui_batch: AgentRoutingRule;
        long_image_recovery: AgentRoutingRule;
        agent_generate_small_smoke: AgentRoutingRule;
        page_sse_large_generate: AgentRoutingRule;
        retry_recovery: {
            reuse_failed_idempotency_key: false;
            new_attempt_guidance: string;
        };
    };
    agent_jobs: {
        supported: true;
        mode: 'job_polling';
        intended_for: string[];
        endpoints: {
            create_generate_job: string;
            get_job: string;
            get_job_result: string;
        };
        states: readonly string[];
        current_guidance: string;
    };
    supported: {
        models: readonly string[];
        output_formats: readonly string[];
        response_modes: readonly string[];
        qualities: readonly string[];
        backgrounds: readonly string[];
        moderations: readonly string[];
        legacy_sizes: readonly string[];
        image_backends: readonly ImageGenerationBackend[];
        enabled_image_backends: readonly ImageGenerationBackend[];
        image_backend_requirements: Record<ImageGenerationBackend, ImageBackendRuntimeRequirement>;
        streaming_strategies: readonly ImageStreamingStrategy[];
    };
    storage: {
        image_storage_mode: string;
        postgres_configured: boolean;
    };
    idempotency: {
        required: boolean;
        header: string;
        ttl_seconds: number;
    };
};

export type AgentRoutingRule = {
    when: string[];
    endpoint: string;
    transport: AgentRoutingTransport;
    strength: AgentRoutingStrength;
    reason: string;
};

type FieldErrors = Record<string, string>;

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
    return (allowed as readonly string[]).includes(value);
}

function readStringField(body: Record<string, unknown>, field: string, fallback?: string): string | undefined {
    const value = body[field];
    if (value === undefined || value === null) return fallback;
    return typeof value === 'string' ? value : undefined;
}

function readIntegerField(
    body: Record<string, unknown>,
    field: string,
    fallback: number,
    min: number,
    max: number,
    fields: FieldErrors
): number {
    const value = body[field];
    if (value === undefined || value === null || value === '') return fallback;
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        fields[field] = `必须是 ${min} 到 ${max} 之间的整数`;
        return fallback;
    }
    return parsed;
}

function validatePrompt(value: unknown, fields: FieldErrors): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        fields.prompt = '必填';
        return '';
    }
    if (value.length > MAX_PROMPT_LENGTH) {
        fields.prompt = `长度不能超过 ${MAX_PROMPT_LENGTH} 个字符`;
    }
    return value;
}

function readModel(body: Record<string, unknown>, fields: FieldErrors): GptImageModel {
    const value = readStringField(body, 'model', 'gpt-image-2');
    if (!value || !isOneOf(value, AGENT_MODELS)) {
        fields.model = `必须是以下值之一：${AGENT_MODELS.join(', ')}`;
        return 'gpt-image-2';
    }
    return value;
}

function readSize(body: Record<string, unknown>, model: GptImageModel, fields: FieldErrors, fallback: string): string {
    const value = readStringField(body, 'size', fallback);
    if (!value) {
        fields.size = '必须是字符串';
        return fallback;
    }
    if (model !== 'gpt-image-2' && !isOneOf(value, AGENT_LEGACY_SIZES)) {
        fields.size = `${model} 的 size 必须是以下值之一：${AGENT_LEGACY_SIZES.join(', ')}`;
        return fallback;
    }
    if (model === 'gpt-image-2' && value !== 'auto') {
        const match = /^(\d+)x(\d+)$/.exec(value);
        if (!match) {
            fields.size = '必须是 auto 或 WxH 格式的尺寸值';
            return value;
        }
        const validation = validateGptImage2Size(Number(match[1]), Number(match[2]));
        if (!validation.valid) {
            fields.size = validation.reason;
        }
    }
    return value;
}

function readOutputFormat(body: Record<string, unknown>, fields: FieldErrors): ValidOutputFormat {
    const rawValue = readStringField(body, 'output_format', 'png');
    const normalized = rawValue?.toLowerCase() === 'jpg' ? 'jpeg' : rawValue?.toLowerCase();
    if (!normalized || !isOneOf(normalized, AGENT_OUTPUT_FORMATS)) {
        fields.output_format = `必须是以下值之一：${AGENT_OUTPUT_FORMATS.join(', ')}`;
        return 'png';
    }
    return normalized;
}

function readResponseMode(body: Record<string, unknown>, fields: FieldErrors): AgentResponseMode {
    const value = readStringField(body, 'response_mode', 'path');
    if (!value || !isOneOf(value, AGENT_RESPONSE_MODES)) {
        fields.response_mode = `必须是以下值之一：${AGENT_RESPONSE_MODES.join(', ')}`;
        return 'path';
    }
    return value;
}

function readAgentImageBackend(body: Record<string, unknown>, fields: FieldErrors): ImageGenerationBackend {
    const rawValue = body.image_backend;
    if (rawValue !== undefined && rawValue !== null && typeof rawValue !== 'string') {
        fields.image_backend = '必须是字符串';
        return 'images-api';
    }
    const value = readStringField(body, 'image_backend', 'images-api');
    if (!value) return 'images-api';
    try {
        return parseImageGenerationBackendValue(value);
    } catch (error) {
        fields.image_backend = error instanceof Error ? error.message : 'image_backend 无效';
        return 'images-api';
    }
}

function readAgentStreamingStrategy(body: Record<string, unknown>, fields: FieldErrors): ImageStreamingStrategy {
    const rawValue = body.streaming_strategy;
    if (rawValue !== undefined && rawValue !== null && typeof rawValue !== 'string') {
        fields.streaming_strategy = '必须是字符串';
        return 'off';
    }
    const value = readStringField(body, 'streaming_strategy', 'off');
    if (!value) return 'off';
    try {
        return parseImageStreamingStrategyValue(value);
    } catch (error) {
        fields.streaming_strategy = error instanceof Error ? error.message : 'streaming_strategy 无效';
        return 'off';
    }
}

function shouldAgentRequestUpstreamStream(streamingStrategy: ImageStreamingStrategy): boolean {
    return streamingStrategy !== 'off' && streamingStrategy !== 'auto';
}

function validateAgentImageUpstreamStrategy(input: {
    imageBackend: ImageGenerationBackend;
    streamingStrategy: ImageStreamingStrategy;
    fields: FieldErrors;
}) {
    try {
        resolveImageStreamEnabled({
            imageBackend: input.imageBackend,
            requestedStream: shouldAgentRequestUpstreamStream(input.streamingStrategy),
            streamingStrategy: input.streamingStrategy
        });
    } catch (error) {
        input.fields.streaming_strategy =
            error instanceof Error ? error.message : 'streaming_strategy 与 image_backend 不兼容';
    }
}

function readQuality(body: Record<string, unknown>, fields: FieldErrors): AgentQuality {
    const value = readStringField(body, 'quality', 'high');
    if (!value || !isOneOf(value, AGENT_QUALITIES)) {
        fields.quality = `必须是以下值之一：${AGENT_QUALITIES.join(', ')}`;
        return 'high';
    }
    return value;
}

function readBackground(body: Record<string, unknown>, model: GptImageModel, fields: FieldErrors): AgentBackground {
    const value = readStringField(body, 'background', 'auto');
    if (!value || !isOneOf(value, AGENT_BACKGROUNDS)) {
        fields.background = `必须是以下值之一：${AGENT_BACKGROUNDS.join(', ')}`;
        return 'auto';
    }
    if (model === 'gpt-image-2' && value === 'transparent') {
        fields.background = 'gpt-image-2 不支持 transparent 背景';
    }
    return value;
}

function readModeration(body: Record<string, unknown>, fields: FieldErrors): AgentModeration {
    const value = readStringField(body, 'moderation', 'auto');
    if (!value || !isOneOf(value, AGENT_MODERATIONS)) {
        fields.moderation = `必须是以下值之一：${AGENT_MODERATIONS.join(', ')}`;
        return 'auto';
    }
    return value;
}

function readOutputCompression(
    body: Record<string, unknown>,
    outputFormat: ValidOutputFormat,
    fields: FieldErrors
): number | undefined {
    const value = body.output_compression;
    if (value === undefined || value === null || value === '') return undefined;
    if (outputFormat === 'png') {
        fields.output_compression = '仅适用于 jpeg 或 webp 输出';
        return undefined;
    }
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
        fields.output_compression = '必须是 0 到 100 之间的整数';
        return undefined;
    }
    return parsed;
}

export function validateAgentGenerateRequest(body: unknown): AgentGenerateRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new RequestValidationError('请求正文必须是 JSON 对象。');
    }
    const objectBody = body as Record<string, unknown>;
    const fields: FieldErrors = {};
    const model = readModel(objectBody, fields);
    const prompt = validatePrompt(objectBody.prompt, fields);
    const n = readIntegerField(objectBody, 'n', 1, 1, MAX_IMAGE_COUNT, fields);
    const size = readSize(objectBody, model, fields, '1024x1024');
    const quality = readQuality(objectBody, fields);
    const outputFormat = readOutputFormat(objectBody, fields);
    const outputCompression = readOutputCompression(objectBody, outputFormat, fields);
    const background = readBackground(objectBody, model, fields);
    const moderation = readModeration(objectBody, fields);
    const responseMode = readResponseMode(objectBody, fields);
    const imageBackend = readAgentImageBackend(objectBody, fields);
    const streamingStrategy = readAgentStreamingStrategy(objectBody, fields);
    const partialImages = readIntegerField(objectBody, 'partial_images', 2, 1, 3, fields) as 1 | 2 | 3;
    validateAgentImageUpstreamStrategy({ imageBackend, streamingStrategy, fields });

    if (Object.keys(fields).length > 0) {
        throw new RequestValidationError(JSON.stringify({ fields }), 422);
    }

    return {
        model,
        prompt,
        n,
        size,
        quality,
        output_format: outputFormat,
        ...(outputCompression !== undefined ? { output_compression: outputCompression } : {}),
        background,
        moderation,
        response_mode: responseMode,
        image_backend: imageBackend,
        streaming_strategy: streamingStrategy,
        partial_images: partialImages
    };
}

export function readAgentStateBackend(env: Record<string, string | undefined>): AgentStateBackend {
    const backend = env.AGENT_STATE_BACKEND?.trim().toLowerCase();
    if (!backend) return 'sqlite';
    if (backend === 'memory' || backend === 'sqlite' || backend === 'postgres') return backend;
    throw new RequestValidationError('AGENT_STATE_BACKEND 必须是 memory、sqlite 或 postgres。', 500);
}

export function readAgentRequestTtlSeconds(env: Record<string, string | undefined>): number {
    return readPositiveIntegerEnv(env, 'AGENT_REQUEST_TTL_SECONDS', AGENT_DEFAULT_REQUEST_TTL_SECONDS);
}

export function readAgentLeaseMs(env: Record<string, string | undefined>): number {
    return readPositiveIntegerEnv(env, 'AGENT_REQUEST_LEASE_MS', AGENT_DEFAULT_LEASE_MS);
}

export function readAgentRecoveryIntervalMs(env: Record<string, string | undefined>): number {
    return readPositiveIntegerEnv(env, 'AGENT_RECOVERY_INTERVAL_MS', AGENT_DEFAULT_RECOVERY_INTERVAL_MS);
}

export function readAgentSqlitePath(env: Record<string, string | undefined>): string {
    return env.AGENT_SQLITE_PATH?.trim() || AGENT_DEFAULT_SQLITE_PATH;
}

export function readAgentPublicBaseUrl(env: Record<string, string | undefined>): string {
    const value = env.AGENT_PUBLIC_BASE_URL?.trim();
    if (!value) return '/';
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new RequestValidationError('AGENT_PUBLIC_BASE_URL 格式无效。', 500);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new RequestValidationError('AGENT_PUBLIC_BASE_URL 必须是 http 或 https URL。', 500);
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new RequestValidationError('AGENT_PUBLIC_BASE_URL 不能包含凭据、查询参数或片段。', 500);
    }
    return parsed.toString().replace(/\/$/, '');
}

export function validateOptionalAgentApiBaseUrl(baseUrl: string | undefined): void {
    if (baseUrl) validateApiBaseUrl(baseUrl);
}

export function buildAgentAuthCapabilities(env: Record<string, string | undefined>): AgentCapabilities['auth'] {
    if (env.AGENT_API_TOKEN?.trim()) {
        return { required: true, schemes: ['bearer'] };
    }
    if (env.APP_PASSWORD?.trim()) {
        return { required: true, schemes: ['x-app-password-hash'] };
    }
    return { required: false, schemes: [] };
}

export function buildPageSseAuthCapabilities(
    env: Record<string, string | undefined>
): AgentCapabilities['agent_streaming']['page_sse']['auth'] {
    return {
        required: Boolean(env.APP_PASSWORD?.trim()),
        schemes: env.APP_PASSWORD?.trim() ? ['form-password-hash'] : [],
        form_field: 'passwordHash'
    };
}

function readEnabledImageBackends(
    requirements: Record<ImageGenerationBackend, ImageBackendRuntimeRequirement>
): ImageGenerationBackend[] {
    return requirements['responses-image-generation'].enabled
        ? ['images-api', 'responses-image-generation']
        : ['images-api'];
}

function buildImageBackendRequirements(
    env: Record<string, string | undefined>
): Record<ImageGenerationBackend, ImageBackendRuntimeRequirement> {
    const responsesMissingEnv = readResponsesImageBackendMissingEnv(env);
    return {
        'images-api': {
            supported: true,
            enabled: true,
            required_env: [],
            missing_env: []
        },
        'responses-image-generation': {
            supported: true,
            enabled: responsesMissingEnv.length === 0,
            required_env: ['ENABLE_RESPONSES_IMAGE_BACKEND', 'OPENAI_RESPONSES_API_MODEL'],
            missing_env: responsesMissingEnv
        }
    };
}

function readResponsesImageBackendMissingEnv(env: Record<string, string | undefined>): string[] {
    const missing: string[] = [];
    if (!readBooleanEnv(env, 'ENABLE_RESPONSES_IMAGE_BACKEND')) {
        missing.push('ENABLE_RESPONSES_IMAGE_BACKEND');
    }
    if (!env.OPENAI_RESPONSES_API_MODEL?.trim()) {
        missing.push('OPENAI_RESPONSES_API_MODEL');
    }
    return missing;
}

function readPositiveIntegerEnv(env: Record<string, string | undefined>, fieldName: string, fallback: number): number {
    try {
        return readPositiveIntegerFromEnv(env, fieldName, fallback, {
            messages: CHINESE_POSITIVE_INTEGER_MESSAGES
        });
    } catch (error) {
        throw new RequestValidationError(error instanceof Error ? error.message : `${fieldName} 必须是正整数。`, 500);
    }
}

export function buildAgentCapabilities(env: Record<string, string | undefined>): AgentCapabilities {
    const imageBackendRequirements = buildImageBackendRequirements(env);
    const enabledImageBackends = readEnabledImageBackends(imageBackendRequirements);
    return {
        api_version: AGENT_API_VERSION,
        schema_version: AGENT_SCHEMA_VERSION,
        auth: buildAgentAuthCapabilities(env),
        endpoints: { ...AGENT_ENDPOINTS },
        defaults: {
            model: 'gpt-image-2',
            response_mode: 'path',
            state_backend: readAgentStateBackend(env),
            image_backend: 'images-api',
            streaming_strategy: 'off',
            partial_images: 2
        },
        limits: {
            max_prompt_length: MAX_PROMPT_LENGTH,
            max_images: MAX_IMAGE_COUNT,
            max_upload_mb: MAX_UPLOAD_BYTES / 1024 / 1024,
            partial_images: { min: 1, max: 3 }
        },
        model_limits: {
            'gpt-image-2': {
                max_edge: GPT_IMAGE_2_MAX_EDGE,
                max_pixels: GPT_IMAGE_2_MAX_PIXELS,
                edge_multiple: GPT_IMAGE_2_EDGE_MULTIPLE,
                max_aspect: GPT_IMAGE_2_MAX_ASPECT,
                min_pixels: GPT_IMAGE_2_MIN_PIXELS,
                recommended_presets: [
                    { name: 'square', size: '2048x2048', purpose: '通用正方形构图' },
                    { name: 'landscape', size: '3072x2048', purpose: '横向宽幅构图' },
                    { name: 'portrait', size: '2048x3072', purpose: '纵向主体构图' }
                ],
                large_image_risk: {
                    applies_to: ['max_edge>2048', 'long_running_upstream'],
                    guidance: '大尺寸请求可能耗时数分钟；失败应归类为上游长耗时风险，不代表低负载路径不可用。'
                }
            }
        },
        agent_streaming: {
            generate: {
                supported: false,
                mode: 'non_streaming_only',
                endpoint: AGENT_ENDPOINTS.generate
            },
            edit: {
                supported: false,
                mode: 'non_streaming_only',
                endpoint: AGENT_ENDPOINTS.edit
            },
            upstream_sse: {
                supported: true,
                mode: 'internal_upstream_sse',
                endpoint: AGENT_ENDPOINTS.generate,
                request_fields: ['image_backend', 'streaming_strategy', 'partial_images'],
                image_backends: AGENT_IMAGE_BACKENDS,
                enabled_image_backends: enabledImageBackends,
                streaming_strategies: AGENT_STREAMING_STRATEGIES,
                activation_strategies: AGENT_UPSTREAM_SSE_ACTIVATION_STRATEGIES,
                final_response_contract: 'AgentImageResponse'
            },
            page_sse: {
                supported: true,
                mode: 'form_data_sse',
                endpoint: '/api/images',
                contract: 'page_ui_only',
                transport_contract: 'page_form_data_sse',
                auth: buildPageSseAuthCapabilities(env),
                client_request_id: {
                    form_field: 'clientRequestId',
                    source_header: 'Idempotency-Key',
                    max_length: PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH
                },
                agent_usage: 'recommended_for_high_resolution_generate_edit_and_complex_batch'
            }
        },
        routing_rules: {
            high_resolution_edit: {
                when: ['operation=edit', 'max_edge>2048'],
                endpoint: '/api/images',
                transport: 'page_sse',
                strength: 'must_use',
                reason: 'Agent edit is non-streaming and rejects high-resolution edit requests; use the page form-data SSE endpoint instead.'
            },
            complex_ui_batch: {
                when: ['operation=generate_or_edit', 'complex_ui=true', 'batch=true'],
                endpoint: '/api/images',
                transport: 'page_sse',
                strength: 'recommended',
                reason: 'Page form-data SSE keeps long-running image production observable and recoverable for complex UI batches.'
            },
            long_image_recovery: {
                when: ['operation=generate_or_edit', 'long_image=true', 'resume_or_recover=true'],
                endpoint: '/api/images',
                transport: 'page_sse',
                strength: 'recommended',
                reason: 'Page form-data SSE exposes partial progress and final-image diagnostics needed for long-image recovery runs.'
            },
            agent_generate_small_smoke: {
                when: ['operation=generate', 'max_edge<=2048', 'single_request=true'],
                endpoint: AGENT_ENDPOINTS.generate,
                transport: 'agent_json',
                strength: 'default',
                reason: 'Agent JSON generate remains the stable contract and smoke path for normal single-image requests.'
            },
            page_sse_large_generate: {
                when: ['operation=generate', 'max_edge>2048', 'single_request=true'],
                endpoint: '/api/images',
                transport: 'page_sse',
                strength: 'recommended',
                reason: 'Page form-data SSE keeps large generate requests observable; if the stream fails, diagnose first and choose any Agent JSON retry explicitly.'
            },
            retry_recovery: {
                reuse_failed_idempotency_key: false,
                new_attempt_guidance:
                    'A failed terminal Agent request only replays the stored failure. Diagnose the failure, then create a new business operation with a new Idempotency-Key.'
            }
        },
        agent_jobs: {
            supported: true,
            mode: 'job_polling',
            intended_for: [
                'explicit_job_route',
                'manual_after_diagnosis',
                'long_running_upstream_when_page_sse_not_selected'
            ],
            endpoints: { ...AGENT_JOB_ENDPOINTS },
            states: AGENT_JOB_STATES,
            current_guidance:
                '对 max_edge>2048 的单次文生图请求优先使用页面端 /api/images SSE；如果页面流式失败，先诊断再显式选择 Agent JSON 或 job 路径，不自动回退。job polling 仅用于显式 job 路径。当前执行模型为同实例后台任务，不是跨实例持久队列。'
        },
        supported: {
            models: AGENT_MODELS,
            output_formats: AGENT_OUTPUT_FORMATS,
            response_modes: AGENT_RESPONSE_MODES,
            qualities: AGENT_QUALITIES,
            backgrounds: AGENT_BACKGROUNDS,
            moderations: AGENT_MODERATIONS,
            legacy_sizes: AGENT_LEGACY_SIZES,
            image_backends: AGENT_IMAGE_BACKENDS,
            enabled_image_backends: enabledImageBackends,
            image_backend_requirements: imageBackendRequirements,
            streaming_strategies: AGENT_STREAMING_STRATEGIES
        },
        storage: {
            image_storage_mode: env.NEXT_PUBLIC_IMAGE_STORAGE_MODE || (env.VERCEL === '1' ? 'indexeddb' : 'fs'),
            postgres_configured: Boolean(env.AGENT_DATABASE_URL || env.AGENT_DB_PASSWORD || env.AGENT_DB_PASSWORD_FILE)
        },
        idempotency: {
            required: true,
            header: 'Idempotency-Key',
            ttl_seconds: readAgentRequestTtlSeconds(env)
        }
    };
}
