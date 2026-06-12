import {
    AGENT_BACKGROUNDS,
    AGENT_IMAGE_BACKENDS,
    AGENT_JOB_STATES,
    AGENT_MODERATIONS,
    AGENT_MODELS,
    AGENT_OUTPUT_FORMATS,
    AGENT_QUALITIES,
    AGENT_RESPONSE_MODES,
    AGENT_STREAM_MODES,
    AGENT_STREAMING_STRATEGIES,
    AGENT_UPSTREAM_SSE_EDIT_REQUEST_FIELDS,
    AGENT_UPSTREAM_SSE_GENERATE_REQUEST_FIELDS,
    AGENT_UPSTREAM_SSE_ACTIVATION_STRATEGIES,
    type AgentAuthScheme,
    type AgentRoutingStrength,
    type AgentRoutingTransport,
    buildAgentCapabilities,
    readAgentPublicBaseUrl
} from './agent-api-contracts';
import { AGENT_ENDPOINTS } from './agent-api-paths.mjs';
import { MAX_PROMPT_LENGTH } from './image-request-utils';

type AgentOpenApiSecurityRequirement = { BearerAuth: [] } | { AppPasswordHash: [] };

function buildAgentOpenApiSecurity(schemes: readonly AgentAuthScheme[]): AgentOpenApiSecurityRequirement[] {
    return schemes.map((scheme) => (scheme === 'bearer' ? { BearerAuth: [] } : { AppPasswordHash: [] }));
}

function buildAgentOpenApiSecuritySchemes(schemes: readonly AgentAuthScheme[]) {
    const securitySchemes: Record<string, { type: string; scheme?: string; in?: string; name?: string }> = {};
    if (schemes.includes('bearer')) {
        securitySchemes.BearerAuth = {
            type: 'http',
            scheme: 'bearer'
        };
    }
    if (schemes.includes('x-app-password-hash')) {
        securitySchemes.AppPasswordHash = {
            type: 'apiKey',
            in: 'header',
            name: 'X-App-Password-Hash'
        };
    }
    return securitySchemes;
}

export function buildAgentOpenApiDocument(env: Record<string, string | undefined>) {
    const capabilities = buildAgentCapabilities(env);
    const maxGenerateImageCount = capabilities.limits.generate_images.max;
    const maxEditImageCount = capabilities.limits.edit_images.max;
    const maxSourceImageCount = capabilities.limits.upload_images.max;
    const supportedBackgrounds = capabilities.upstream_profile.activeConstraints.gptImage2.allowTransparentBackground
        ? AGENT_BACKGROUNDS
        : AGENT_BACKGROUNDS.filter((value) => value !== 'transparent');
    const jsonContent = (schemaRef: string) => ({
        content: {
            'application/json': {
                schema: { $ref: schemaRef }
            }
        }
    });
    const agentSecurity = buildAgentOpenApiSecurity(capabilities.auth.schemes);
    const securitySchemes = buildAgentOpenApiSecuritySchemes(capabilities.auth.schemes);
    const commonAgentErrors = {
        '401': jsonContent('#/components/schemas/AgentError'),
        '403': jsonContent('#/components/schemas/AgentError'),
        '415': jsonContent('#/components/schemas/AgentError'),
        '429': jsonContent('#/components/schemas/AgentError'),
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
            [AGENT_ENDPOINTS.capabilities]: {
                get: {
                    summary: '获取机器可读的 Agent API 能力信息',
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentCapabilities')
                    }
                }
            },
            [AGENT_ENDPOINTS.openapi]: {
                get: {
                    summary: '获取 Agent API 的 OpenAPI 文档',
                    responses: {
                        '200': { description: 'OpenAPI 文档' }
                    }
                }
            },
            [AGENT_ENDPOINTS.generate]: {
                post: {
                    summary: '为 Agent 生成图片',
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
            [AGENT_ENDPOINTS.edit]: {
                post: {
                    summary: '为 Agent 编辑图片',
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
            [AGENT_ENDPOINTS.create_generate_job]: {
                post: {
                    summary: '创建 Agent 图片生成 job',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
                    requestBody: {
                        required: true,
                        ...jsonContent('#/components/schemas/GenerateRequest')
                    },
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentJobStatusResponse'),
                        '202': {
                            ...jsonContent('#/components/schemas/AgentJobStatusResponse'),
                            headers: {
                                'Retry-After': { schema: { type: 'integer', minimum: 1 } }
                            }
                        },
                        '400': jsonContent('#/components/schemas/AgentError'),
                        '409': jsonContent('#/components/schemas/AgentError'),
                        ...commonAgentErrors,
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.job]: {
                get: {
                    summary: '获取 Agent job 状态',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/JobId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentJobStatusResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentError'),
                        '410': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.job_result]: {
                get: {
                    summary: '获取 Agent job 结果',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/JobId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentImageResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '403': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentError'),
                        '409': {
                            ...jsonContent('#/components/schemas/AgentError'),
                            headers: {
                                'Retry-After': { schema: { type: 'integer', minimum: 1 } }
                            }
                        },
                        '410': jsonContent('#/components/schemas/AgentError'),
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '429': jsonContent('#/components/schemas/AgentError'),
                        '502': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.artifact_metadata]: {
                get: {
                    summary: '获取产物元数据',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/ArtifactId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/ArtifactMetadataResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentError')
                    }
                },
                delete: {
                    summary: '删除产物',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/ArtifactId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/DeleteArtifactResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.artifact_content]: {
                get: {
                    summary: '下载产物内容',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/ArtifactId' }],
                    responses: {
                        '200': {
                            description: '图片二进制内容',
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
            },
            [AGENT_ENDPOINTS.page_request_feedback_batch]: {
                post: {
                    summary: '批量读取页面请求的结果反馈',
                    security: agentSecurity,
                    requestBody: {
                        required: true,
                        ...jsonContent('#/components/schemas/PageRequestFeedbackBatchRequest')
                    },
                    responses: {
                        '200': jsonContent('#/components/schemas/PageRequestFeedbackBatchResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.page_request_feedback]: {
                get: {
                    summary: '读取页面请求的结果反馈',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/PageRequestId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/PageRequestFeedbackResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.agent_request_diagnostics_lookup]: {
                get: {
                    summary: '按 request_id 或 idempotency_key 读取 Agent state 请求诊断',
                    security: agentSecurity,
                    parameters: [
                        {
                            name: 'request_id',
                            in: 'query',
                            required: false,
                            schema: { type: 'string', minLength: 1, maxLength: 200 }
                        },
                        {
                            name: 'idempotency_key',
                            in: 'query',
                            required: false,
                            schema: { type: 'string', minLength: 1, maxLength: 200 }
                        }
                    ],
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentRequestDiagnosticsLookupResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentRequestDiagnosticsLookupResponse'),
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.agent_request_diagnostics]: {
                get: {
                    summary: '按 request_id 读取 Agent state 请求诊断',
                    security: agentSecurity,
                    parameters: [{ $ref: '#/components/parameters/AgentRequestId' }],
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentRequestDiagnosticsLookupResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '404': jsonContent('#/components/schemas/AgentRequestDiagnosticsLookupResponse'),
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.page_request_diagnostics_batch]: {
                post: {
                    summary: '批量读取页面请求的日志诊断摘要',
                    security: agentSecurity,
                    requestBody: {
                        required: true,
                        ...jsonContent('#/components/schemas/PageRequestDiagnosticsBatchRequest')
                    },
                    responses: {
                        '200': jsonContent('#/components/schemas/PageRequestDiagnosticsBatchResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            },
            [AGENT_ENDPOINTS.page_request_diagnostics]: {
                get: {
                    summary: '读取页面请求的日志诊断摘要',
                    security: agentSecurity,
                    parameters: [
                        { $ref: '#/components/parameters/PageRequestId' },
                        {
                            name: 'filename',
                            in: 'query',
                            required: false,
                            schema: { type: 'array', items: { type: 'string' } },
                            style: 'form',
                            explode: true
                        }
                    ],
                    responses: {
                        '200': jsonContent('#/components/schemas/PageRequestDiagnosticsResponse'),
                        '401': jsonContent('#/components/schemas/AgentError'),
                        '422': jsonContent('#/components/schemas/AgentError'),
                        '500': jsonContent('#/components/schemas/AgentError')
                    }
                }
            }
        },
        components: {
            securitySchemes,
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
                },
                JobId: {
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', minLength: 1 }
                },
                AgentRequestId: {
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', minLength: 1, maxLength: 200 }
                },
                PageRequestId: {
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', minLength: 1, maxLength: 200 }
                }
            },
            schemas: {
                AgentCapabilities: {
                    type: 'object',
                    required: [
                        'api_version',
                        'schema_version',
                        'auth',
                        'endpoints',
                        'image_transport',
                        'upstream_profile',
                        'upstream_request_headers',
                        'defaults',
                        'limits',
                        'model_limits',
                        'agent_streaming',
                        'routing_rules',
                        'agent_jobs',
                        'supported',
                        'storage',
                        'page_request_diagnostics',
                        'agent_request_diagnostics',
                        'idempotency'
                    ],
                    properties: {
                        api_version: { type: 'string' },
                        schema_version: { type: 'string' },
                        auth: {
                            type: 'object',
                            required: ['required', 'schemes'],
                            properties: {
                                required: { type: 'boolean', const: capabilities.auth.required },
                                schemes: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    const: capabilities.auth.schemes
                                }
                            }
                        },
                        endpoints: { type: 'object', additionalProperties: { type: 'string' } },
                        image_transport: { $ref: '#/components/schemas/ImageTransportCapabilities' },
                        upstream_request_headers: {
                            type: 'object',
                            required: ['default', 'channels'],
                            properties: {
                                default: { $ref: '#/components/schemas/UpstreamRequestHeaderSummary' },
                                channels: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        required: ['id', 'request_headers'],
                                        properties: {
                                            id: { type: 'string' },
                                            request_headers: { $ref: '#/components/schemas/UpstreamRequestHeaderSummary' }
                                        },
                                        additionalProperties: false
                                    }
                                }
                            },
                            additionalProperties: false
                        },
                        upstream_profile: {
                            type: 'object',
                            required: [
                                'activeProfile',
                                'serverProfile',
                                'serverProfileMixed',
                                'requestProfile',
                                'activeConstraints',
                                'serverConstraints',
                                'requestConstraints'
                            ],
                            properties: {
                                activeProfile: {
                                    type: 'string',
                                    enum: ['openai-compatible', 'matsca'],
                                    const: capabilities.upstream_profile.activeProfile
                                },
                                serverProfile: {
                                    type: 'string',
                                    enum: ['openai-compatible', 'matsca'],
                                    const: capabilities.upstream_profile.serverProfile
                                },
                                serverProfileMixed: {
                                    type: 'boolean',
                                    const: capabilities.upstream_profile.serverProfileMixed
                                },
                                requestProfile: {
                                    type: 'string',
                                    enum: ['openai-compatible', 'matsca'],
                                    const: capabilities.upstream_profile.requestProfile
                                },
                                activeConstraints: { $ref: '#/components/schemas/ImageUpstreamProfile' },
                                serverConstraints: { $ref: '#/components/schemas/ImageUpstreamProfile' },
                                requestConstraints: { $ref: '#/components/schemas/ImageUpstreamProfile' }
                            },
                            additionalProperties: false
                        },
                        defaults: {
                            type: 'object',
                            required: [
                                'model',
                                'response_mode',
                                'state_backend',
                                'image_backend',
                                'stream_mode',
                                'streaming_strategy',
                                'partial_images'
                            ],
                            properties: {
                                model: { type: 'string', enum: AGENT_MODELS },
                                response_mode: { type: 'string', enum: AGENT_RESPONSE_MODES },
                                state_backend: { type: 'string', enum: ['memory', 'sqlite', 'postgres'] },
                                image_backend: { type: 'string', enum: AGENT_IMAGE_BACKENDS },
                                stream_mode: { type: 'string', enum: AGENT_STREAM_MODES },
                                streaming_strategy: { type: 'string', enum: AGENT_STREAMING_STRATEGIES },
                                partial_images: {
                                    type: 'integer',
                                    minimum: capabilities.limits.partial_images.min,
                                    maximum: capabilities.limits.partial_images.max
                                }
                            }
                        },
                        limits: {
                            type: 'object',
                            required: [
                                'max_prompt_length',
                                'max_images',
                                'generate_images',
                                'edit_images',
                                'upload_images',
                                'max_upload_mb',
                                'partial_images',
                                'partial_images_by_backend',
                                'upstream_profile',
                                'upstream_profile_mixed'
                            ],
                            properties: {
                                max_prompt_length: { type: 'integer', const: capabilities.limits.max_prompt_length },
                                max_images: { type: 'integer', const: capabilities.limits.max_images },
                                generate_images: {
                                    type: 'object',
                                    required: ['min', 'max'],
                                    properties: {
                                        min: { type: 'integer', const: capabilities.limits.generate_images.min },
                                        max: { type: 'integer', const: capabilities.limits.generate_images.max }
                                    },
                                    additionalProperties: false
                                },
                                edit_images: {
                                    type: 'object',
                                    required: ['min', 'max'],
                                    properties: {
                                        min: { type: 'integer', const: capabilities.limits.edit_images.min },
                                        max: { type: 'integer', const: capabilities.limits.edit_images.max }
                                    },
                                    additionalProperties: false
                                },
                                upload_images: {
                                    type: 'object',
                                    required: ['max'],
                                    properties: {
                                        max: { type: 'integer', const: capabilities.limits.upload_images.max }
                                    },
                                    additionalProperties: false
                                },
                                max_upload_mb: { type: 'number', const: capabilities.limits.max_upload_mb },
                                max_total_upload_mb: { type: 'number', const: capabilities.limits.max_total_upload_mb },
                                partial_images: {
                                    type: 'object',
                                    required: ['min', 'max'],
                                    properties: {
                                        min: { type: 'integer', const: capabilities.limits.partial_images.min },
                                        max: { type: 'integer', const: capabilities.limits.partial_images.max }
                                    },
                                    additionalProperties: false
                                },
                                partial_images_by_backend: {
                                    type: 'object',
                                    required: ['images-api', 'responses-image-generation'],
                                    properties: {
                                        'images-api': {
                                            type: 'object',
                                            required: ['min', 'max'],
                                            properties: {
                                                min: {
                                                    type: 'integer',
                                                    const: capabilities.limits.partial_images_by_backend['images-api'].min
                                                },
                                                max: {
                                                    type: 'integer',
                                                    const: capabilities.limits.partial_images_by_backend['images-api'].max
                                                }
                                            },
                                            additionalProperties: false
                                        },
                                        'responses-image-generation': {
                                            type: 'object',
                                            required: ['min', 'max'],
                                            properties: {
                                                min: {
                                                    type: 'integer',
                                                    const: capabilities.limits.partial_images_by_backend[
                                                        'responses-image-generation'
                                                    ].min
                                                },
                                                max: {
                                                    type: 'integer',
                                                    const: capabilities.limits.partial_images_by_backend[
                                                        'responses-image-generation'
                                                    ].max
                                                }
                                            },
                                            additionalProperties: false
                                        }
                                    },
                                    additionalProperties: false
                                },
                                upstream_profile: {
                                    type: 'string',
                                    enum: ['openai-compatible', 'matsca'],
                                    const: capabilities.limits.upstream_profile
                                },
                                upstream_profile_mixed: {
                                    type: 'boolean',
                                    const: capabilities.limits.upstream_profile_mixed
                                }
                            },
                            additionalProperties: false
                        },
                        model_limits: { $ref: '#/components/schemas/AgentModelLimits' },
                        agent_streaming: { $ref: '#/components/schemas/AgentStreamingCapabilities' },
                        routing_rules: { $ref: '#/components/schemas/AgentRoutingRules' },
                        agent_jobs: { $ref: '#/components/schemas/AgentJobCapabilities' },
                        supported: {
                            type: 'object',
                            required: [
                                'models',
                                'output_formats',
                                'response_modes',
                                'qualities',
                                'backgrounds',
                                'moderations',
                                'legacy_sizes',
                                'image_backends',
                                'enabled_image_backends',
                                'image_backend_requirements',
                                'streaming_strategies',
                                'stream_modes'
                            ],
                            properties: {
                                models: { type: 'array', items: { type: 'string', enum: AGENT_MODELS } },
                                output_formats: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_OUTPUT_FORMATS }
                                },
                                response_modes: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_RESPONSE_MODES }
                                },
                                qualities: { type: 'array', items: { type: 'string', enum: AGENT_QUALITIES } },
                                backgrounds: { type: 'array', items: { type: 'string', enum: AGENT_BACKGROUNDS } },
                                moderations: { type: 'array', items: { type: 'string', enum: AGENT_MODERATIONS } },
                                legacy_sizes: { type: 'array', items: { type: 'string' } },
                                image_backends: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_IMAGE_BACKENDS }
                                },
                                enabled_image_backends: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_IMAGE_BACKENDS }
                                },
                                image_backend_requirements: {
                                    type: 'object',
                                    additionalProperties: { $ref: '#/components/schemas/ImageBackendRequirement' }
                                },
                                streaming_strategies: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_STREAMING_STRATEGIES }
                                },
                                stream_modes: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_STREAM_MODES }
                                }
                            }
                        },
                        storage: {
                            type: 'object',
                            required: ['image_storage_mode', 'postgres_configured'],
                            properties: {
                                image_storage_mode: { type: 'string' },
                                postgres_configured: { type: 'boolean' }
                            }
                        },
                        page_request_diagnostics: {
                            $ref: '#/components/schemas/AgentPageRequestDiagnosticsCapabilities'
                        },
                        agent_request_diagnostics: {
                            $ref: '#/components/schemas/AgentRequestDiagnosticsCapabilities'
                        },
                        idempotency: { type: 'object' }
                    }
                },
                AgentModelLimits: {
                    type: 'object',
                    required: ['gpt-image-2'],
                    properties: {
                        'gpt-image-2': {
                            type: 'object',
                            required: [
                                'max_edge',
                                'max_pixels',
                                'edge_multiple',
                                'max_aspect',
                                'min_pixels',
                                'recommended_presets',
                                'large_image_risk'
                            ],
                            properties: {
                                max_edge: { type: 'integer', minimum: 1 },
                                max_pixels: { type: 'integer', minimum: 1 },
                                edge_multiple: { type: 'integer', minimum: 1 },
                                max_aspect: { type: 'number', minimum: 1 },
                                min_pixels: { type: 'integer', minimum: 1 },
                                recommended_presets: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        required: ['name', 'size', 'purpose'],
                                        properties: {
                                            name: { type: 'string' },
                                            size: { type: 'string' },
                                            purpose: { type: 'string' }
                                        }
                                    }
                                },
                                large_image_risk: {
                                    type: 'object',
                                    required: ['applies_to', 'guidance'],
                                    properties: {
                                        applies_to: { type: 'array', items: { type: 'string' } },
                                        guidance: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                },
                ImageUpstreamProfile: {
                    type: 'object',
                    required: ['id', 'generateCount', 'editCount', 'partialImages', 'upload', 'gptImage2'],
                    properties: {
                        id: { type: 'string', enum: ['openai-compatible', 'matsca'] },
                        generateCount: {
                            type: 'object',
                            required: ['min', 'max'],
                            properties: {
                                min: { type: 'integer', minimum: 1 },
                                max: { type: 'integer', minimum: 1 }
                            },
                            additionalProperties: false
                        },
                        editCount: {
                            type: 'object',
                            required: ['min', 'max'],
                            properties: {
                                min: { type: 'integer', minimum: 1 },
                                max: { type: 'integer', minimum: 1 }
                            },
                            additionalProperties: false
                        },
                        partialImages: {
                            type: 'object',
                            required: ['min', 'max'],
                            properties: {
                                min: { type: 'integer', minimum: 0 },
                                max: { type: 'integer', minimum: 0 }
                            },
                            additionalProperties: false
                        },
                        upload: {
                            type: 'object',
                            required: ['maxImages', 'maxSingleBytes'],
                            properties: {
                                maxImages: { type: 'integer', minimum: 1 },
                                maxSingleBytes: { type: 'integer', minimum: 1 },
                                maxTotalBytes: { type: 'integer', minimum: 1 }
                            },
                            additionalProperties: false
                        },
                        gptImage2: {
                            type: 'object',
                            required: ['allowTransparentBackground', 'sizePolicy'],
                            properties: {
                                allowTransparentBackground: { type: 'boolean' },
                                sizePolicy: { type: 'string', enum: ['openai-compatible', 'positive-integer'] }
                            },
                            additionalProperties: false
                        }
                    },
                    additionalProperties: false
                },
                ImageBackendRequirement: {
                    type: 'object',
                    required: ['supported', 'enabled', 'required_env', 'missing_env'],
                    properties: {
                        supported: { type: 'boolean', const: true },
                        enabled: { type: 'boolean' },
                        required_env: { type: 'array', items: { type: 'string' } },
                        missing_env: { type: 'array', items: { type: 'string' } }
                    }
                },
                AppLogRetentionMetadata: {
                    type: 'object',
                    required: [
                        'storage',
                        'max_entries',
                        'default_max_entries',
                        'min_entries',
                        'max_configured_entries',
                        'configured_by',
                        'persisted_across_process_restart',
                        'loss_modes',
                        'bounded',
                        'not_agent_state_backend'
                    ],
                    properties: {
                        storage: {
                            type: 'string',
                            const: capabilities.page_request_diagnostics.retention.storage
                        },
                        max_entries: {
                            type: 'integer',
                            minimum: 1,
                            const: capabilities.page_request_diagnostics.retention.max_entries
                        },
                        default_max_entries: {
                            type: 'integer',
                            minimum: 1,
                            const: capabilities.page_request_diagnostics.retention.default_max_entries
                        },
                        min_entries: {
                            type: 'integer',
                            minimum: 1,
                            const: capabilities.page_request_diagnostics.retention.min_entries
                        },
                        max_configured_entries: {
                            type: 'integer',
                            minimum: 1,
                            const: capabilities.page_request_diagnostics.retention.max_configured_entries
                        },
                        configured_by: {
                            type: 'string',
                            const: capabilities.page_request_diagnostics.retention.configured_by
                        },
                        persisted_across_process_restart: { type: 'boolean', const: true },
                        loss_modes: {
                            type: 'array',
                            items: { type: 'string' },
                            const: capabilities.page_request_diagnostics.retention.loss_modes
                        },
                        bounded: { type: 'boolean', const: true },
                        not_agent_state_backend: { type: 'boolean', const: true }
                    }
                },
                AgentPageRequestDiagnosticsCapabilities: {
                    type: 'object',
                    required: ['supported', 'source', 'endpoints', 'retention', 'no_match_hint'],
                    properties: {
                        supported: { type: 'boolean', const: true },
                        source: { type: 'string', enum: ['app_log'] },
                        endpoints: {
                            type: 'object',
                            required: ['single', 'batch'],
                            properties: {
                                single: { type: 'string', const: AGENT_ENDPOINTS.page_request_diagnostics },
                                batch: { type: 'string', const: AGENT_ENDPOINTS.page_request_diagnostics_batch }
                            }
                        },
                        retention: { $ref: '#/components/schemas/AppLogRetentionMetadata' },
                        no_match_hint: {
                            type: 'string',
                            const: capabilities.page_request_diagnostics.no_match_hint
                        }
                    }
                },
                AgentRequestDiagnosticsRetention: {
                    type: 'object',
                    required: ['storage', 'ttl_seconds', 'bounded', 'loss_modes'],
                    properties: {
                        storage: {
                            type: 'string',
                            const: capabilities.agent_request_diagnostics.retention.storage
                        },
                        ttl_seconds: {
                            type: 'integer',
                            minimum: 1,
                            const: capabilities.agent_request_diagnostics.retention.ttl_seconds
                        },
                        bounded: { type: 'boolean', const: true },
                        loss_modes: {
                            type: 'array',
                            items: { type: 'string' },
                            const: capabilities.agent_request_diagnostics.retention.loss_modes
                        }
                    },
                    additionalProperties: false
                },
                AgentRequestDiagnosticsCapabilities: {
                    type: 'object',
                    required: ['supported', 'source', 'endpoints', 'lookup', 'retention'],
                    properties: {
                        supported: { type: 'boolean', const: true },
                        source: { type: 'string', enum: ['agent_state'] },
                        endpoints: {
                            type: 'object',
                            required: ['lookup', 'single'],
                            properties: {
                                lookup: { type: 'string', const: AGENT_ENDPOINTS.agent_request_diagnostics_lookup },
                                single: { type: 'string', const: AGENT_ENDPOINTS.agent_request_diagnostics }
                            },
                            additionalProperties: false
                        },
                        lookup: {
                            type: 'object',
                            required: ['by_request_id', 'by_idempotency_key'],
                            properties: {
                                by_request_id: { type: 'boolean', const: true },
                                by_idempotency_key: { type: 'boolean', const: true }
                            },
                            additionalProperties: false
                        },
                        retention: { $ref: '#/components/schemas/AgentRequestDiagnosticsRetention' }
                    },
                    additionalProperties: false
                },
                AgentStreamingCapabilities: {
                    type: 'object',
                    required: ['generate', 'edit', 'upstream_sse', 'page_sse'],
                    properties: {
                        generate: { $ref: '#/components/schemas/AgentEndpointStreamingCapability' },
                        edit: { $ref: '#/components/schemas/AgentEndpointStreamingCapability' },
                        upstream_sse: {
                            type: 'object',
                            required: [
                                'supported',
                                'mode',
                                'endpoint',
                                'request_fields',
                                'request_fields_by_mode',
                                'image_backends',
                                'enabled_image_backends',
                                'streaming_strategies',
                                'stream_modes',
                                'activation_strategies',
                                'final_response_contract'
                            ],
                            properties: {
                                supported: { type: 'boolean', const: true },
                                mode: { type: 'string', enum: ['internal_upstream_sse'] },
                                endpoint: { type: 'string' },
                                request_fields: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    const: AGENT_UPSTREAM_SSE_GENERATE_REQUEST_FIELDS
                                },
                                request_fields_by_mode: {
                                    type: 'object',
                                    required: ['generate', 'edit'],
                                    properties: {
                                        generate: {
                                            type: 'array',
                                            items: { type: 'string' },
                                            const: AGENT_UPSTREAM_SSE_GENERATE_REQUEST_FIELDS
                                        },
                                        edit: {
                                            type: 'array',
                                            items: { type: 'string' },
                                            const: AGENT_UPSTREAM_SSE_EDIT_REQUEST_FIELDS
                                        }
                                    }
                                },
                                image_backends: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_IMAGE_BACKENDS }
                                },
                                enabled_image_backends: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_IMAGE_BACKENDS }
                                },
                                streaming_strategies: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_STREAMING_STRATEGIES }
                                },
                                stream_modes: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_STREAM_MODES }
                                },
                                activation_strategies: {
                                    type: 'array',
                                    items: { type: 'string', enum: AGENT_UPSTREAM_SSE_ACTIVATION_STRATEGIES }
                                },
                                final_response_contract: { type: 'string', enum: ['AgentImageResponse'] }
                            }
                        },
                        page_sse: {
                            type: 'object',
                            required: [
                                'supported',
                                'mode',
                                'endpoint',
                                'contract',
                                'transport_contract',
                                'auth',
                                'client_request_id',
                                'agent_usage'
                            ],
                            properties: {
                                supported: { type: 'boolean', const: true },
                                mode: { type: 'string', enum: ['form_data_sse'] },
                                endpoint: { type: 'string' },
                                contract: { type: 'string', enum: ['page_ui_only'] },
                                transport_contract: { type: 'string', enum: ['page_form_data_sse'] },
                                auth: {
                                    type: 'object',
                                    required: ['required', 'schemes', 'form_field'],
                                    properties: {
                                        required: {
                                            type: 'boolean',
                                            const: capabilities.agent_streaming.page_sse.auth.required
                                        },
                                        schemes: {
                                            type: 'array',
                                            items: { type: 'string', enum: ['form-password-hash'] },
                                            const: capabilities.agent_streaming.page_sse.auth.schemes
                                        },
                                        form_field: { type: 'string', const: 'passwordHash' }
                                    }
                                },
                                client_request_id: {
                                    type: 'object',
                                    required: ['form_field', 'source_header', 'max_length'],
                                    properties: {
                                        form_field: { type: 'string', const: 'clientRequestId' },
                                        source_header: { type: 'string', const: 'Idempotency-Key' },
                                        max_length: {
                                            type: 'integer',
                                            const: capabilities.agent_streaming.page_sse.client_request_id.max_length
                                        }
                                    }
                                },
                                agent_usage: {
                                    type: 'string',
                                    enum: ['recommended_for_high_resolution_generate_edit_and_complex_batch']
                                }
                            }
                        }
                    }
                },
                AgentRoutingRules: {
                    type: 'object',
                    required: [
                        'high_resolution_edit',
                        'complex_ui_batch',
                        'long_image_recovery',
                        'agent_generate_small_smoke',
                        'page_sse_large_generate',
                        'retry_recovery'
                    ],
                    properties: {
                        high_resolution_edit: { $ref: '#/components/schemas/AgentRoutingRule' },
                        complex_ui_batch: { $ref: '#/components/schemas/AgentRoutingRule' },
                        long_image_recovery: { $ref: '#/components/schemas/AgentRoutingRule' },
                        agent_generate_small_smoke: { $ref: '#/components/schemas/AgentRoutingRule' },
                        page_sse_large_generate: { $ref: '#/components/schemas/AgentRoutingRule' },
                        retry_recovery: {
                            type: 'object',
                            required: ['reuse_failed_idempotency_key', 'new_attempt_guidance'],
                            properties: {
                                reuse_failed_idempotency_key: { type: 'boolean', const: false },
                                new_attempt_guidance: { type: 'string' }
                            }
                        }
                    }
                },
                AgentRoutingRule: {
                    type: 'object',
                    required: ['when', 'conditions', 'endpoint', 'transport', 'strength', 'action', 'reason'],
                    properties: {
                        when: { type: 'array', items: { type: 'string' } },
                        conditions: { $ref: '#/components/schemas/AgentRoutingCondition' },
                        endpoint: { type: 'string' },
                        transport: {
                            type: 'string',
                            enum: ['agent_json', 'agent_job_polling', 'page_sse'] satisfies AgentRoutingTransport[]
                        },
                        strength: {
                            type: 'string',
                            enum: ['default', 'recommended'] satisfies AgentRoutingStrength[]
                        },
                        action: { $ref: '#/components/schemas/AgentRoutingAction' },
                        reason: { type: 'string' }
                    }
                },
                AgentRoutingCondition: {
                    type: 'object',
                    required: ['operation'],
                    properties: {
                        operation: {
                            type: 'string',
                            enum: ['generate', 'edit', 'generate_or_edit']
                        },
                        max_edge: {
                            type: 'object',
                            required: ['operator', 'value'],
                            properties: {
                                operator: { type: 'string', enum: ['gt', 'lte'] },
                                value: { type: 'integer', minimum: 1 }
                            }
                        },
                        batch: { type: 'boolean' },
                        single_request: { type: 'boolean' },
                        complex_ui: { type: 'boolean' },
                        long_image: { type: 'boolean' },
                        resume_or_recover: { type: 'boolean' }
                    },
                    additionalProperties: false
                },
                AgentRoutingAction: {
                    type: 'object',
                    required: [
                        'endpoint',
                        'transport',
                        'strength',
                        'requires_new_idempotency_key_on_retry',
                        'no_automatic_fallback'
                    ],
                    properties: {
                        endpoint: { type: 'string' },
                        transport: {
                            type: 'string',
                            enum: ['agent_json', 'agent_job_polling', 'page_sse'] satisfies AgentRoutingTransport[]
                        },
                        strength: {
                            type: 'string',
                            enum: ['default', 'recommended'] satisfies AgentRoutingStrength[]
                        },
                        fallback_endpoint: { type: 'string' },
                        fallback_mode: {
                            type: 'string',
                            enum: ['manual_after_diagnosis', 'fix_request_before_retry']
                        },
                        requires_new_idempotency_key_on_retry: { type: 'boolean' },
                        no_automatic_fallback: { type: 'boolean' }
                    },
                    additionalProperties: false
                },
                AgentEndpointStreamingCapability: {
                    type: 'object',
                    required: ['supported', 'mode', 'endpoint'],
                    properties: {
                        supported: { type: 'boolean', const: false },
                        mode: { type: 'string', enum: ['non_streaming_only'] },
                        endpoint: { type: 'string' }
                    }
                },
                AgentJobCapabilities: {
                    type: 'object',
                    required: ['supported', 'mode', 'intended_for', 'endpoints', 'states', 'current_guidance'],
                    properties: {
                        supported: { type: 'boolean', const: true },
                        mode: { type: 'string', enum: ['job_polling'] },
                        intended_for: { type: 'array', items: { type: 'string' } },
                        endpoints: {
                            type: 'object',
                            required: ['create_generate_job', 'get_job', 'get_job_result'],
                            properties: {
                                create_generate_job: { type: 'string' },
                                get_job: { type: 'string' },
                                get_job_result: { type: 'string' }
                            }
                        },
                        states: { type: 'array', items: { type: 'string', enum: AGENT_JOB_STATES } },
                        current_guidance: { type: 'string' }
                    }
                },
                GenerateRequest: {
                    type: 'object',
                    required: ['prompt'],
                    allOf: [
                        {
                            if: {
                                properties: {
                                    image_backend: { const: 'responses-image-generation' }
                                },
                                required: ['image_backend']
                            },
                            then: {
                                properties: {
                                    partial_images: {
                                        type: 'integer',
                                        minimum: capabilities.limits.partial_images_by_backend[
                                            'responses-image-generation'
                                        ].min,
                                        maximum: capabilities.limits.partial_images_by_backend[
                                            'responses-image-generation'
                                        ].max,
                                        default: capabilities.defaults.partial_images
                                    }
                                }
                            }
                        }
                    ],
                    properties: {
                        prompt: { type: 'string', maxLength: MAX_PROMPT_LENGTH },
                        model: { type: 'string', enum: AGENT_MODELS },
                        n: {
                            type: 'integer',
                            minimum: capabilities.limits.generate_images.min,
                            maximum: maxGenerateImageCount
                        },
                        size: { type: 'string' },
                        quality: { type: 'string', enum: AGENT_QUALITIES, default: 'high' },
                        output_format: { type: 'string', enum: AGENT_OUTPUT_FORMATS },
                        output_compression: { type: 'integer', minimum: 0, maximum: 100 },
                        background: { type: 'string', enum: supportedBackgrounds },
                        moderation: { type: 'string', enum: AGENT_MODERATIONS },
                        response_mode: { type: 'string', enum: AGENT_RESPONSE_MODES, default: 'path' },
                        image_backend: {
                            type: 'string',
                            enum: AGENT_IMAGE_BACKENDS,
                            default: 'images-api'
                        },
                        streaming_strategy: {
                            type: 'string',
                            enum: AGENT_STREAMING_STRATEGIES,
                            default: 'auto'
                        },
                        stream_mode: {
                            type: 'string',
                            enum: AGENT_STREAM_MODES,
                            default: 'auto'
                        },
                        partial_images: {
                            type: 'integer',
                            minimum: capabilities.limits.partial_images.min,
                            maximum: capabilities.limits.partial_images.max,
                            default: capabilities.defaults.partial_images
                        }
                    }
                },
                EditRequest: {
                    type: 'object',
                    required: ['prompt'],
                    anyOf: Array.from({ length: maxSourceImageCount }, (_, index) => ({
                        required: [`image_${index}`]
                    })),
                    description:
                        `Agent edit 返回最终 JSON。请求必须至少提供一个 image_0..image_${maxSourceImageCount - 1} 源图字段。高分辨率 edit 默认优先使用页面端 /api/images form-data SSE；页面流式有问题时可显式回退到 Agent edit 诊断或执行。`,
                    properties: {
                        prompt: { type: 'string', maxLength: MAX_PROMPT_LENGTH },
                        model: { type: 'string', enum: AGENT_MODELS, default: 'gpt-image-2' },
                        n: {
                            type: 'integer',
                            minimum: capabilities.limits.edit_images.min,
                            maximum: maxEditImageCount
                        },
                        size: { type: 'string', default: 'auto' },
                        quality: { type: 'string', enum: AGENT_QUALITIES, default: 'auto' },
                        response_mode: { type: 'string', enum: AGENT_RESPONSE_MODES, default: 'path' },
                        stream_mode: { type: 'string', enum: AGENT_STREAM_MODES, default: 'auto' },
                        streaming_strategy: {
                            type: 'string',
                            enum: AGENT_STREAMING_STRATEGIES,
                            default: 'auto'
                        },
                        partial_images: {
                            type: 'integer',
                            minimum: capabilities.limits.partial_images.min,
                            maximum: capabilities.limits.partial_images.max,
                            default: capabilities.defaults.partial_images
                        },
                        ...Object.fromEntries(
                            Array.from({ length: maxSourceImageCount }, (_, index) => [
                                `image_${index}`,
                                { type: 'string', format: 'binary' }
                            ])
                        ),
                        mask: { type: 'string', format: 'binary' }
                    }
                },
                AgentArtifact: {
                    type: 'object',
                    required: [
                        'id',
                        'filename',
                        'content_url',
                        'metadata_url',
                        'output_format',
                        'mime_type',
                        'size_bytes',
                        'width',
                        'height'
                    ],
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
                        created_at: { type: 'string', format: 'date-time' },
                        timing: { $ref: '#/components/schemas/AgentImageResponseTiming' },
                        execution: { $ref: '#/components/schemas/AgentImageResponseExecution' }
                    }
                },
                AgentImageResponseTiming: {
                    type: 'object',
                    required: ['started_at', 'completed_at', 'elapsed_ms', 'server_elapsed_ms'],
                    properties: {
                        started_at: { type: 'string', format: 'date-time' },
                        completed_at: { type: 'string', format: 'date-time' },
                        elapsed_ms: { type: 'integer', minimum: 0 },
                        server_elapsed_ms: { type: 'integer', minimum: 0 }
                    },
                    additionalProperties: false
                },
                AgentImageResponseExecution: {
                    type: 'object',
                    required: [
                        'transport',
                        'endpoint',
                        'route_mode',
                        'operation',
                        'image_backend',
                        'stream_mode',
                        'streaming_strategy',
                        'request_headers'
                    ],
                    properties: {
                        transport: { type: 'string', enum: ['agent_json', 'agent_job_polling', 'page_sse'] },
                        endpoint: { type: 'string' },
                        route_mode: { type: 'string', enum: ['agent', 'job', 'page_sse'] },
                        operation: { type: 'string', enum: ['generate', 'edit'] },
                        image_backend: { type: 'string', enum: AGENT_IMAGE_BACKENDS },
                        stream_mode: { type: 'string', enum: AGENT_STREAM_MODES },
                        streaming_strategy: { type: 'string', enum: AGENT_STREAMING_STRATEGIES },
                        selected_channel_id: { type: 'string' },
                        upstream_host: { type: 'string' },
                        request_headers: { $ref: '#/components/schemas/UpstreamRequestHeaderSummary' }
                    },
                    additionalProperties: false
                },
                AgentJobStatusResponse: {
                    type: 'object',
                    required: ['job'],
                    properties: {
                        job: {
                            type: 'object',
                            required: [
                                'id',
                                'request_id',
                                'idempotency_key',
                                'mode',
                                'state',
                                'created_at',
                                'updated_at',
                                'expires_at'
                            ],
                            properties: {
                                id: { type: 'string' },
                                request_id: { type: 'string' },
                                idempotency_key: { type: 'string' },
                                mode: { type: 'string', enum: ['generate', 'edit'] },
                                state: { type: 'string', enum: AGENT_JOB_STATES },
                                created_at: { type: 'string', format: 'date-time' },
                                updated_at: { type: 'string', format: 'date-time' },
                                expires_at: { type: 'string', format: 'date-time' },
                                result_url: { type: 'string' },
                                retry_after_seconds: { type: 'integer', minimum: 1 },
                                error: {
                                    type: 'object',
                                    required: ['code', 'message', 'retryable'],
                                    properties: {
                                        code: { type: 'string' },
                                        message: { type: 'string' },
                                        retryable: { type: 'boolean' },
                                        details: { type: 'object' },
                                        upstream_status: { type: 'integer' },
                                        diagnostics: { $ref: '#/components/schemas/AgentErrorDiagnostics' }
                                    }
                                }
                            }
                        }
                    }
                },
                ArtifactMetadataResponse: {
                    type: 'object',
                    required: ['artifact'],
                    properties: {
                        artifact: { $ref: '#/components/schemas/AgentArtifact' }
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
                ResultFeedback: {
                    type: 'object',
                    required: ['target_type', 'target_id', 'value', 'source', 'updated_at'],
                    properties: {
                        target_type: { type: 'string', enum: ['page_request', 'agent_request', 'agent_artifact'] },
                        target_id: { type: 'string' },
                        value: { type: 'string', enum: ['usable', 'needs_revision'] },
                        source: { type: 'string', enum: ['webui', 'agent'] },
                        updated_at: { type: 'string', format: 'date-time' },
                        note: { type: 'string', maxLength: 500 }
                    }
                },
                FeedbackTarget: {
                    type: 'object',
                    required: ['type', 'id'],
                    properties: {
                        type: { type: 'string', enum: ['page_request'] },
                        id: { type: 'string' }
                    }
                },
                PageRequestFeedbackBatchRequest: {
                    type: 'object',
                    required: ['ids'],
                    properties: {
                        ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } }
                    }
                },
                PageRequestFeedbackBatchResponse: {
                    type: 'object',
                    required: ['targets', 'feedback'],
                    properties: {
                        targets: { type: 'array', items: { $ref: '#/components/schemas/FeedbackTarget' } },
                        feedback: { type: 'array', items: { $ref: '#/components/schemas/ResultFeedback' } }
                    }
                },
                PageRequestFeedbackResponse: {
                    type: 'object',
                    required: ['target', 'feedback'],
                    properties: {
                        target: { $ref: '#/components/schemas/FeedbackTarget' },
                        feedback: {
                            oneOf: [{ $ref: '#/components/schemas/ResultFeedback' }, { type: 'null' }]
                        }
                    }
                },
                PageRequestDiagnosticsBatchRequest: {
                    type: 'object',
                    required: ['ids'],
                    properties: {
                        ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
                        filenames: { type: 'array', maxItems: 20, items: { type: 'string' } }
                    }
                },
                AgentRequestDiagnosticsLookupResponse: {
                    type: 'object',
                    required: ['found'],
                    properties: {
                        found: { type: 'boolean' },
                        diagnostics: { $ref: '#/components/schemas/AgentRequestDiagnostics' }
                    },
                    additionalProperties: false
                },
                AgentRequestDiagnostics: {
                    type: 'object',
                    required: [
                        'request',
                        'timeline',
                        'artifacts',
                        'state_backend',
                        'diagnostics_retention',
                        'diagnostics_boundary'
                    ],
                    properties: {
                        request: { $ref: '#/components/schemas/AgentRequestDiagnosticsRequest' },
                        timeline: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/AgentRequestTimelineEvent' }
                        },
                        artifacts: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/AgentRequestDiagnosticsArtifact' }
                        },
                        response: { $ref: '#/components/schemas/AgentRequestDiagnosticsResponseSummary' },
                        error: { $ref: '#/components/schemas/AgentRequestDiagnosticsErrorSummary' },
                        feedback: { $ref: '#/components/schemas/ResultFeedback' },
                        state_backend: { type: 'string', enum: ['memory', 'sqlite', 'postgres'] },
                        diagnostics_retention: { $ref: '#/components/schemas/AgentRequestDiagnosticsRetention' },
                        diagnostics_boundary: {
                            type: 'object',
                            required: ['source', 'not_page_request_log', 'raw_request_json_redacted', 'api_key_redacted'],
                            properties: {
                                source: { type: 'string', enum: ['agent_state'] },
                                not_page_request_log: { type: 'boolean', const: true },
                                raw_request_json_redacted: { type: 'boolean', const: true },
                                api_key_redacted: { type: 'boolean', const: true }
                            },
                            additionalProperties: false
                        }
                    },
                    additionalProperties: false
                },
                AgentRequestDiagnosticsRequest: {
                    type: 'object',
                    required: ['request_id', 'idempotency_key', 'mode', 'status', 'cached', 'created_at', 'updated_at', 'expires_at'],
                    properties: {
                        request_id: { type: 'string' },
                        idempotency_key: { type: 'string' },
                        mode: { type: 'string', enum: ['generate', 'edit'] },
                        status: { type: 'string', enum: ['pending', 'running', 'succeeded', 'failed', 'orphaned'] },
                        cached: { type: 'boolean' },
                        created_at: { type: 'string', format: 'date-time' },
                        updated_at: { type: 'string', format: 'date-time' },
                        expires_at: { type: 'string', format: 'date-time' },
                        locked_until: { type: 'string', format: 'date-time' }
                    },
                    additionalProperties: false
                },
                AgentRequestTimelineEvent: {
                    type: 'object',
                    required: ['at', 'event'],
                    properties: {
                        at: { type: 'string', format: 'date-time' },
                        event: { type: 'string', enum: ['created', 'updated', 'locked_until', 'expires'] }
                    },
                    additionalProperties: false
                },
                AgentRequestDiagnosticsArtifact: {
                    type: 'object',
                    required: [
                        'id',
                        'filename',
                        'content_url',
                        'metadata_url',
                        'output_format',
                        'mime_type',
                        'size_bytes',
                        'width',
                        'height',
                        'model',
                        'created_at'
                    ],
                    properties: {
                        id: { type: 'string' },
                        filename: { type: 'string' },
                        content_url: { type: 'string' },
                        metadata_url: { type: 'string' },
                        output_format: { type: 'string' },
                        mime_type: { type: 'string' },
                        size_bytes: { type: 'integer', minimum: 0 },
                        width: { type: ['integer', 'null'] },
                        height: { type: ['integer', 'null'] },
                        model: { type: 'string' },
                        created_at: { type: 'string', format: 'date-time' }
                    },
                    additionalProperties: false
                },
                AgentRequestDiagnosticsResponseSummary: {
                    type: 'object',
                    required: ['request_id', 'idempotency_key', 'cached', 'image_count', 'artifact_ids', 'content_urls', 'created_at'],
                    properties: {
                        request_id: { type: 'string' },
                        idempotency_key: { type: 'string' },
                        cached: { type: 'boolean' },
                        image_count: { type: 'integer', minimum: 0 },
                        artifact_ids: { type: 'array', items: { type: 'string' } },
                        content_urls: { type: 'array', items: { type: 'string' } },
                        created_at: { type: 'string', format: 'date-time' },
                        timing: { $ref: '#/components/schemas/AgentImageResponseTiming' },
                        execution: { $ref: '#/components/schemas/AgentImageResponseExecution' }
                    },
                    additionalProperties: false
                },
                AgentRequestDiagnosticsErrorSummary: {
                    type: 'object',
                    required: ['code', 'message', 'retryable'],
                    properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                        retryable: { type: 'boolean' },
                        upstream_status: { type: 'integer' },
                        diagnostics: { $ref: '#/components/schemas/AgentErrorDiagnostics' }
                    },
                    additionalProperties: false
                },
                PageRequestDiagnosticsBatchItem: {
                    allOf: [
                        { $ref: '#/components/schemas/PageRequestDiagnosticsResponse' },
                        {
                            type: 'object',
                            required: ['client_request_id'],
                            properties: {
                                client_request_id: { type: 'string' }
                            }
                        }
                    ]
                },
                PageRequestDiagnosticsBatchResponse: {
                    type: 'object',
                    required: ['targets', 'diagnostics_retention', 'diagnostics'],
                    properties: {
                        targets: { type: 'array', items: { $ref: '#/components/schemas/FeedbackTarget' } },
                        diagnostics_retention: { $ref: '#/components/schemas/AppLogRetentionMetadata' },
                        diagnostics: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/PageRequestDiagnosticsBatchItem' }
                        }
                    }
                },
                PageRequestDiagnosticsResponse: {
                    type: 'object',
                    required: ['scope', 'matched_log_count', 'events', 'diagnostics_retention'],
                    properties: {
                        scope: {
                            type: 'object',
                            required: ['request_ids', 'filenames', 'filename_matched_request_ids', 'copy_text'],
                            properties: {
                                request_ids: { type: 'array', items: { type: 'string' } },
                                filenames: { type: 'array', items: { type: 'string' } },
                                filename_matched_request_ids: { type: 'array', items: { type: 'string' } },
                                copy_text: { type: 'string' }
                            }
                        },
                        matched_log_count: { type: 'integer', minimum: 0 },
                        events: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/PageRequestDiagnosticEvent' }
                        },
                        diagnostics_retention: { $ref: '#/components/schemas/AppLogRetentionMetadata' },
                        diagnostics_note: { $ref: '#/components/schemas/PageRequestDiagnosticsNote' }
                    }
                },
                PageRequestDiagnosticsNote: {
                    type: 'object',
                    required: ['code', 'message', 'retention'],
                    properties: {
                        code: { type: 'string', enum: ['no_matching_logs_in_retention_window'] },
                        message: { type: 'string' },
                        retention: { $ref: '#/components/schemas/AppLogRetentionMetadata' }
                    }
                },
                PageRequestDiagnosticEvent: {
                    type: 'object',
                    required: ['id', 'at', 'level', 'message'],
                    properties: {
                        id: { type: 'integer' },
                        at: { type: 'string', format: 'date-time' },
                        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
                        message: { type: 'string' },
                        client_request_id: { type: 'string' },
                        filenames: { type: 'array', items: { type: 'string' } },
                        diagnostics: { $ref: '#/components/schemas/PageRequestDiagnosticContext' }
                    }
                },
                PageRequestDiagnosticContext: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        providerDialect: { type: 'string' },
                        normalizedEventCount: { type: 'number' },
                        reason: { type: 'string' },
                        channel_id: { type: 'string' },
                        image_backend: { type: 'string' },
                        operation: { type: 'string' },
                        stream_mode: { type: 'string' },
                        streamingStrategy: { type: 'string' },
                        streaming_strategy: { type: 'string' },
                        partialImages: { type: 'number' },
                        partial_images: { type: 'number' },
                        upstream_status: { type: 'number' },
                        upstream_event_type: { type: 'string' },
                        transport_error: { type: 'boolean' }
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
                                diagnostics: { $ref: '#/components/schemas/AgentErrorDiagnostics' },
                                request_id: { type: 'string' }
                            }
                        }
                    }
                },
                AgentErrorDiagnostics: {
                    type: 'object',
                    properties: {
                        elapsed_ms: { type: 'integer', minimum: 0 },
                        selected_channel_id: { type: 'string' },
                        upstream_host: { type: 'string' },
                        upstream_status: { type: 'integer' },
                        upstream_event_type: { type: 'string' },
                        partial_image_count: { type: 'integer', minimum: 0 },
                        transport_error: { type: 'boolean' },
                        transport_error_kind: {
                            type: 'string',
                            enum: [
                                'dns',
                                'tls',
                                'connect_timeout',
                                'connection_refused',
                                'socket_closed',
                                'upstream_timeout',
                                'sse_final_missing',
                                'fetch_failed',
                                'unknown_transport'
                            ]
                        },
                        retry_after_seconds: { type: 'integer', minimum: 1 },
                        retry_after_ms: { type: 'integer', minimum: 0 },
                        cooldown_until: { type: 'string', format: 'date-time' },
                        cooldown_target: {
                            type: 'object',
                            required: ['channel_id'],
                            properties: {
                                channel_id: { type: 'string' },
                                credential_id: { type: 'string' }
                            },
                            additionalProperties: false
                        },
                        channel_cooldown_scope: { type: 'string', enum: ['credential', 'channel'] },
                        response_headers: {
                            type: 'object',
                            additionalProperties: { type: 'string' }
                        }
                    },
                    additionalProperties: false
                },
                UpstreamRequestHeaderSummary: {
                    type: 'object',
                    required: [
                        'user_agent_effective',
                        'has_extra_headers',
                        'allowed_header_names',
                        'configured_header_names'
                    ],
                    properties: {
                        user_agent_effective: { type: 'string' },
                        has_extra_headers: { type: 'boolean' },
                        allowed_header_names: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        configured_header_names: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    },
                    additionalProperties: false
                },
                ImageTransportCapabilities: {
                    type: 'object',
                    required: [
                        'upstream_timeout_ms',
                        'stream_data_interval_timeout_ms',
                        'upstream_max_retries'
                    ],
                    properties: {
                        upstream_timeout_ms: {
                            type: 'integer',
                            minimum: 1,
                            const: capabilities.image_transport.upstream_timeout_ms
                        },
                        stream_data_interval_timeout_ms: {
                            type: 'integer',
                            minimum: 0,
                            const: capabilities.image_transport.stream_data_interval_timeout_ms
                        },
                        upstream_max_retries: {
                            type: 'integer',
                            minimum: 0,
                            const: capabilities.image_transport.upstream_max_retries
                        }
                    },
                    additionalProperties: false
                }
            }
        }
    };
}
