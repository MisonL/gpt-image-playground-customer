import {
    MAX_IMAGE_COUNT,
    MAX_PROMPT_LENGTH,
    MAX_UPLOAD_BYTES,
    RequestValidationError,
    validateApiBaseUrl,
    type GptImageModel,
    type ValidOutputFormat
} from './image-request-utils';
import { validateGptImage2Size } from './size-utils';

export const AGENT_API_VERSION = '1.0.0';
export const AGENT_SCHEMA_VERSION = '2026-05-12';
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

export type AgentStateBackend = 'sqlite' | 'postgres';
export type AgentResponseMode = (typeof AGENT_RESPONSE_MODES)[number];
export type AgentQuality = (typeof AGENT_QUALITIES)[number];
export type AgentBackground = (typeof AGENT_BACKGROUNDS)[number];
export type AgentModeration = (typeof AGENT_MODERATIONS)[number];

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

export type AgentCapabilities = {
    api_version: string;
    schema_version: string;
    auth: {
        required: boolean;
        schemes: string[];
    };
    endpoints: Record<string, string>;
    defaults: {
        model: GptImageModel;
        response_mode: AgentResponseMode;
        state_backend: AgentStateBackend;
    };
    limits: {
        max_prompt_length: number;
        max_images: number;
        max_upload_mb: number;
        partial_images: { min: number; max: number };
    };
    supported: {
        models: readonly string[];
        output_formats: readonly string[];
        response_modes: readonly string[];
        qualities: readonly string[];
        backgrounds: readonly string[];
        moderations: readonly string[];
        legacy_sizes: readonly string[];
    };
    storage: {
        image_storage_mode: string;
        sqlite_path?: string;
        postgres_configured: boolean;
    };
    idempotency: {
        required: boolean;
        header: string;
        ttl_seconds: number;
    };
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
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        fields[field] = `must be an integer between ${min} and ${max}`;
        return fallback;
    }
    return parsed;
}

function validatePrompt(value: unknown, fields: FieldErrors): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        fields.prompt = 'is required';
        return '';
    }
    if (value.length > MAX_PROMPT_LENGTH) {
        fields.prompt = `must be ${MAX_PROMPT_LENGTH} characters or fewer`;
    }
    return value;
}

function readModel(body: Record<string, unknown>, fields: FieldErrors): GptImageModel {
    const value = readStringField(body, 'model', 'gpt-image-2');
    if (!value || !isOneOf(value, AGENT_MODELS)) {
        fields.model = `must be one of ${AGENT_MODELS.join(', ')}`;
        return 'gpt-image-2';
    }
    return value;
}

function readSize(body: Record<string, unknown>, model: GptImageModel, fields: FieldErrors, fallback: string): string {
    const value = readStringField(body, 'size', fallback);
    if (!value) {
        fields.size = 'must be a string';
        return fallback;
    }
    if (model !== 'gpt-image-2' && !isOneOf(value, AGENT_LEGACY_SIZES)) {
        fields.size = `must be one of ${AGENT_LEGACY_SIZES.join(', ')} for ${model}`;
        return fallback;
    }
    if (model === 'gpt-image-2' && value !== 'auto') {
        const match = /^(\d+)x(\d+)$/.exec(value);
        if (!match) {
            fields.size = 'must be auto or a WxH value';
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
        fields.output_format = `must be one of ${AGENT_OUTPUT_FORMATS.join(', ')}`;
        return 'png';
    }
    return normalized;
}

function readResponseMode(body: Record<string, unknown>, fields: FieldErrors): AgentResponseMode {
    const value = readStringField(body, 'response_mode', 'path');
    if (!value || !isOneOf(value, AGENT_RESPONSE_MODES)) {
        fields.response_mode = `must be one of ${AGENT_RESPONSE_MODES.join(', ')}`;
        return 'path';
    }
    return value;
}

function readQuality(body: Record<string, unknown>, fields: FieldErrors): AgentQuality {
    const value = readStringField(body, 'quality', 'auto');
    if (!value || !isOneOf(value, AGENT_QUALITIES)) {
        fields.quality = `must be one of ${AGENT_QUALITIES.join(', ')}`;
        return 'auto';
    }
    return value;
}

function readBackground(body: Record<string, unknown>, model: GptImageModel, fields: FieldErrors): AgentBackground {
    const value = readStringField(body, 'background', 'auto');
    if (!value || !isOneOf(value, AGENT_BACKGROUNDS)) {
        fields.background = `must be one of ${AGENT_BACKGROUNDS.join(', ')}`;
        return 'auto';
    }
    if (model === 'gpt-image-2' && value === 'transparent') {
        fields.background = 'transparent is not supported for gpt-image-2';
    }
    return value;
}

function readModeration(body: Record<string, unknown>, fields: FieldErrors): AgentModeration {
    const value = readStringField(body, 'moderation', 'auto');
    if (!value || !isOneOf(value, AGENT_MODERATIONS)) {
        fields.moderation = `must be one of ${AGENT_MODERATIONS.join(', ')}`;
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
        fields.output_compression = 'is only valid for jpeg or webp output';
        return undefined;
    }
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
        fields.output_compression = 'must be an integer between 0 and 100';
        return undefined;
    }
    return parsed;
}

export function validateAgentGenerateRequest(body: unknown): AgentGenerateRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new RequestValidationError('Request body must be a JSON object.');
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
        response_mode: responseMode
    };
}

export function readAgentStateBackend(env: Record<string, string | undefined>): AgentStateBackend {
    const backend = env.AGENT_STATE_BACKEND?.trim().toLowerCase();
    if (!backend) return 'sqlite';
    if (backend === 'sqlite' || backend === 'postgres') return backend;
    throw new RequestValidationError('AGENT_STATE_BACKEND must be sqlite or postgres.', 500);
}

export function readAgentRequestTtlSeconds(env: Record<string, string | undefined>): number {
    const value = env.AGENT_REQUEST_TTL_SECONDS;
    if (!value || !/^\d+$/.test(value)) return AGENT_DEFAULT_REQUEST_TTL_SECONDS;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : AGENT_DEFAULT_REQUEST_TTL_SECONDS;
}

export function readAgentLeaseMs(env: Record<string, string | undefined>): number {
    const value = env.AGENT_REQUEST_LEASE_MS;
    if (!value || !/^\d+$/.test(value)) return AGENT_DEFAULT_LEASE_MS;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : AGENT_DEFAULT_LEASE_MS;
}

export function readAgentRecoveryIntervalMs(env: Record<string, string | undefined>): number {
    const value = env.AGENT_RECOVERY_INTERVAL_MS;
    if (!value || !/^\d+$/.test(value)) return AGENT_DEFAULT_RECOVERY_INTERVAL_MS;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : AGENT_DEFAULT_RECOVERY_INTERVAL_MS;
}

export function readAgentSqlitePath(env: Record<string, string | undefined>): string {
    return env.AGENT_SQLITE_PATH?.trim() || AGENT_DEFAULT_SQLITE_PATH;
}

export function readAgentPublicBaseUrl(env: Record<string, string | undefined>): string {
    return env.AGENT_PUBLIC_BASE_URL?.trim() || '/';
}

export function validateOptionalAgentApiBaseUrl(baseUrl: string | undefined): void {
    if (baseUrl) validateApiBaseUrl(baseUrl);
}

export function buildAgentCapabilities(env: Record<string, string | undefined>): AgentCapabilities {
    return {
        api_version: AGENT_API_VERSION,
        schema_version: AGENT_SCHEMA_VERSION,
        auth: {
            required: Boolean(env.AGENT_API_TOKEN || env.APP_PASSWORD),
            schemes: ['bearer', 'x-app-password-hash']
        },
        endpoints: {
            capabilities: '/api/agent/capabilities',
            openapi: '/api/agent/openapi.json',
            generate: '/api/agent/images/generate',
            edit: '/api/agent/images/edit',
            artifact_metadata: '/api/agent/artifacts/{id}',
            artifact_content: '/api/agent/artifacts/{id}/content',
            artifact_delete: '/api/agent/artifacts/{id}'
        },
        defaults: {
            model: 'gpt-image-2',
            response_mode: 'path',
            state_backend: readAgentStateBackend(env)
        },
        limits: {
            max_prompt_length: MAX_PROMPT_LENGTH,
            max_images: MAX_IMAGE_COUNT,
            max_upload_mb: MAX_UPLOAD_BYTES / 1024 / 1024,
            partial_images: { min: 1, max: 3 }
        },
        supported: {
            models: AGENT_MODELS,
            output_formats: AGENT_OUTPUT_FORMATS,
            response_modes: AGENT_RESPONSE_MODES,
            qualities: AGENT_QUALITIES,
            backgrounds: AGENT_BACKGROUNDS,
            moderations: AGENT_MODERATIONS,
            legacy_sizes: AGENT_LEGACY_SIZES
        },
        storage: {
            image_storage_mode: env.NEXT_PUBLIC_IMAGE_STORAGE_MODE || (env.VERCEL === '1' ? 'indexeddb' : 'fs'),
            sqlite_path: readAgentSqlitePath(env),
            postgres_configured: Boolean(env.AGENT_DATABASE_URL)
        },
        idempotency: {
            required: true,
            header: 'Idempotency-Key',
            ttl_seconds: readAgentRequestTtlSeconds(env)
        }
    };
}

export function buildAgentOpenApiDocument(env: Record<string, string | undefined>) {
    const capabilities = buildAgentCapabilities(env);
    const jsonContent = (schemaRef: string) => ({
        content: {
            'application/json': {
                schema: { $ref: schemaRef }
            }
        }
    });
    const agentSecurity = [{ BearerAuth: [] }, { AppPasswordHash: [] }];
    const commonAgentErrors = {
        '401': jsonContent('#/components/schemas/AgentError'),
        '415': jsonContent('#/components/schemas/AgentError'),
        '502': jsonContent('#/components/schemas/AgentError')
    };
    return {
        openapi: '3.1.0',
        info: {
            title: 'GPT Image Playground Agent API',
            version: capabilities.api_version
        },
        servers: [{ url: readAgentPublicBaseUrl(env) }],
        paths: {
            '/api/agent/capabilities': {
                get: {
                    summary: 'Get machine-readable Agent API capabilities',
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentCapabilities')
                    }
                }
            },
            '/api/agent/openapi.json': {
                get: {
                    summary: 'Get the Agent API OpenAPI document',
                    responses: {
                        '200': { description: 'OpenAPI document' }
                    }
                }
            },
            '/api/agent/images/generate': {
                post: {
                    summary: 'Generate images for agents',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
                    requestBody: {
                        required: true,
                        ...jsonContent('#/components/schemas/GenerateRequest')
                    },
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentImageResponse'),
                        '400': jsonContent('#/components/schemas/AgentError'),
                        '409': {
                            ...jsonContent('#/components/schemas/AgentError'),
                            headers: {
                                'Retry-After': { schema: { type: 'integer', minimum: 1 } }
                            }
                        },
                        ...commonAgentErrors,
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            '/api/agent/images/edit': {
                post: {
                    summary: 'Edit images for agents',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
                    requestBody: {
                        required: true,
                        content: {
                            'multipart/form-data': {
                                schema: { $ref: '#/components/schemas/EditRequest' }
                            }
                        }
                    },
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentImageResponse'),
                        '400': jsonContent('#/components/schemas/AgentError'),
                        '409': jsonContent('#/components/schemas/AgentError'),
                        ...commonAgentErrors,
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            '/api/agent/artifacts/{id}': {
                get: {
                    summary: 'Get artifact metadata',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/ArtifactId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/ArtifactMetadataResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentError')
                    }
                },
                delete: {
                    summary: 'Delete an artifact',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/ArtifactId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/DeleteArtifactResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            '/api/agent/artifacts/{id}/content': {
                get: {
                    summary: 'Download artifact content',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/ArtifactId' }],
                    responses: {
                        '200': {
                            description: 'Image binary content',
                            content: {
                                'image/png': { schema: { type: 'string', format: 'binary' } },
                                'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                                'image/webp': { schema: { type: 'string', format: 'binary' } }
                            }
                        },
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentError')
                    }
                }
            }
        },
        components: {
            securitySchemes: {
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer'
                },
                AppPasswordHash: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-App-Password-Hash'
                }
            },
            parameters: {
                IdempotencyKey: {
                    name: 'Idempotency-Key',
                    in: 'header',
                    required: true,
                    schema: { type: 'string', minLength: 1, maxLength: 200 }
                },
                ArtifactId: {
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', minLength: 1 }
                }
            },
            schemas: {
                AgentCapabilities: {
                    type: 'object',
                    required: ['api_version', 'schema_version', 'auth', 'endpoints', 'defaults', 'limits', 'supported', 'storage', 'idempotency'],
                    properties: {
                        api_version: { type: 'string' },
                        schema_version: { type: 'string' },
                        auth: { type: 'object' },
                        endpoints: { type: 'object', additionalProperties: { type: 'string' } },
                        defaults: { type: 'object' },
                        limits: { type: 'object' },
                        supported: { type: 'object' },
                        storage: { type: 'object' },
                        idempotency: { type: 'object' }
                    }
                },
                GenerateRequest: {
                    type: 'object',
                    required: ['prompt'],
                    properties: {
                        prompt: { type: 'string', maxLength: MAX_PROMPT_LENGTH },
                        model: { type: 'string', enum: AGENT_MODELS },
                        n: { type: 'integer', minimum: 1, maximum: MAX_IMAGE_COUNT },
                        size: { type: 'string' },
                        quality: { type: 'string', enum: AGENT_QUALITIES },
                        output_format: { type: 'string', enum: AGENT_OUTPUT_FORMATS },
                        output_compression: { type: 'integer', minimum: 0, maximum: 100 },
                        background: { type: 'string', enum: AGENT_BACKGROUNDS },
                        moderation: { type: 'string', enum: AGENT_MODERATIONS },
                        response_mode: { type: 'string', enum: AGENT_RESPONSE_MODES, default: 'path' }
                    }
                },
                EditRequest: {
                    type: 'object',
                    required: ['prompt', 'image_0'],
                    properties: {
                        prompt: { type: 'string', maxLength: MAX_PROMPT_LENGTH },
                        model: { type: 'string', enum: AGENT_MODELS, default: 'gpt-image-2' },
                        n: { type: 'integer', minimum: 1, maximum: MAX_IMAGE_COUNT },
                        size: { type: 'string', default: 'auto' },
                        quality: { type: 'string', enum: AGENT_QUALITIES, default: 'auto' },
                        response_mode: { type: 'string', enum: AGENT_RESPONSE_MODES, default: 'path' },
                        image_0: { type: 'string', format: 'binary' },
                        mask: { type: 'string', format: 'binary' }
                    }
                },
                AgentArtifact: {
                    type: 'object',
                    required: ['id', 'filename', 'content_url', 'metadata_url', 'output_format', 'mime_type', 'size_bytes', 'width', 'height'],
                    properties: {
                        id: { type: 'string' },
                        filename: { type: 'string' },
                        content_url: { type: 'string' },
                        metadata_url: { type: 'string' },
                        output_format: { type: 'string', enum: AGENT_OUTPUT_FORMATS },
                        mime_type: { type: 'string' },
                        size_bytes: { type: 'integer', minimum: 0 },
                        width: { type: ['integer', 'null'] },
                        height: { type: ['integer', 'null'] },
                        b64_json: { type: 'string' }
                    }
                },
                AgentImageResponse: {
                    type: 'object',
                    required: ['request_id', 'idempotency_key', 'cached', 'images', 'created_at'],
                    properties: {
                        request_id: { type: 'string' },
                        idempotency_key: { type: 'string' },
                        cached: { type: 'boolean' },
                        images: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/AgentArtifact' }
                        },
                        usage: { type: 'object' },
                        created_at: { type: 'string', format: 'date-time' }
                    }
                },
                ArtifactMetadataResponse: {
                    type: 'object',
                    required: ['artifact'],
                    properties: {
                        artifact: { $ref: '#/components/schemas/AgentArtifact' }
                    }
                },
                AgentArtifactRecord: {
                    type: 'object',
                    required: [
                        'id',
                        'requestId',
                        'filename',
                        'filepath',
                        'contentUrl',
                        'metadataUrl',
                        'outputFormat',
                        'mimeType',
                        'sizeBytes',
                        'width',
                        'height',
                        'model',
                        'promptHash',
                        'createdAt'
                    ],
                    properties: {
                        id: { type: 'string' },
                        requestId: { type: 'string' },
                        filename: { type: 'string' },
                        filepath: { type: 'string' },
                        contentUrl: { type: 'string' },
                        metadataUrl: { type: 'string' },
                        outputFormat: { type: 'string', enum: AGENT_OUTPUT_FORMATS },
                        mimeType: { type: 'string' },
                        sizeBytes: { type: 'integer', minimum: 0 },
                        width: { type: ['integer', 'null'] },
                        height: { type: ['integer', 'null'] },
                        model: { type: 'string' },
                        promptHash: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                DeleteArtifactResponse: {
                    type: 'object',
                    required: ['deleted', 'id'],
                    properties: {
                        deleted: { type: 'boolean' },
                        id: { type: 'string' }
                    }
                },
                AgentError: {
                    type: 'object',
                    required: ['error'],
                    properties: {
                        error: {
                            type: 'object',
                            required: ['code', 'message', 'retryable', 'request_id'],
                            properties: {
                                code: { type: 'string' },
                                message: { type: 'string' },
                                retryable: { type: 'boolean' },
                                details: { type: 'object' },
                                upstream_status: { type: 'integer' },
                                request_id: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    };
}
