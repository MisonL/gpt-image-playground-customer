import { MAX_IMAGE_COUNT, MAX_PROMPT_LENGTH } from './image-request-utils';
import {
    AGENT_BACKGROUNDS,
    AGENT_JOB_STATES,
    AGENT_MODERATIONS,
    AGENT_MODELS,
    AGENT_OUTPUT_FORMATS,
    AGENT_QUALITIES,
    AGENT_RESPONSE_MODES,
    type AgentAuthScheme,
    buildAgentCapabilities,
    readAgentPublicBaseUrl
} from './agent-api-contracts';

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
            '/api/agent/capabilities': {
                get: {
                    summary: '获取机器可读的 Agent API 能力信息',
                    responses: {
                        '200': jsonContent('#/components/schemas/AgentCapabilities')
                    }
                }
            },
            '/api/agent/openapi.json': {
                get: {
                    summary: '获取 Agent API 的 OpenAPI 文档',
                    responses: {
                        '200': { description: 'OpenAPI 文档' }
                    }
                }
            },
            '/api/agent/images/generate': {
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
            '/api/agent/images/edit': {
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
            '/api/agent/jobs/images/generate': {
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
            '/api/agent/jobs/{id}': {
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
            '/api/agent/jobs/{id}/result': {
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
            '/api/agent/artifacts/{id}': {
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
            '/api/agent/artifacts/{id}/content': {
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
                        'defaults',
                        'limits',
                        'model_limits',
                        'agent_streaming',
                        'agent_jobs',
                        'supported',
                        'storage',
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
                        defaults: { type: 'object' },
                        limits: { type: 'object' },
                        model_limits: { $ref: '#/components/schemas/AgentModelLimits' },
                        agent_streaming: { $ref: '#/components/schemas/AgentStreamingCapabilities' },
                        agent_jobs: { $ref: '#/components/schemas/AgentJobCapabilities' },
                        supported: { type: 'object' },
                        storage: {
                            type: 'object',
                            required: ['image_storage_mode', 'postgres_configured'],
                            properties: {
                                image_storage_mode: { type: 'string' },
                                postgres_configured: { type: 'boolean' }
                            }
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
                                'high_4k_risk'
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
                                high_4k_risk: {
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
                AgentStreamingCapabilities: {
                    type: 'object',
                    required: ['generate', 'edit', 'page_sse'],
                    properties: {
                        generate: { $ref: '#/components/schemas/AgentEndpointStreamingCapability' },
                        edit: { $ref: '#/components/schemas/AgentEndpointStreamingCapability' },
                        page_sse: {
                            type: 'object',
                            required: ['supported', 'mode', 'endpoint', 'contract'],
                            properties: {
                                supported: { type: 'boolean', const: true },
                                mode: { type: 'string', enum: ['form_data_sse'] },
                                endpoint: { type: 'string' },
                                contract: { type: 'string', enum: ['page_ui_only'] }
                            }
                        }
                    }
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
                    required: [
                        'supported',
                        'mode',
                        'intended_for',
                        'endpoints',
                        'states',
                        'current_guidance'
                    ],
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
                    properties: {
                        prompt: { type: 'string', maxLength: MAX_PROMPT_LENGTH },
                        model: { type: 'string', enum: AGENT_MODELS },
                        n: { type: 'integer', minimum: 1, maximum: MAX_IMAGE_COUNT },
                        size: { type: 'string' },
                        quality: { type: 'string', enum: AGENT_QUALITIES, default: 'high' },
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
                        transport_error: { type: 'boolean' },
                        retry_after_seconds: { type: 'integer', minimum: 1 },
                        channel_cooldown_scope: { type: 'string', enum: ['credential', 'channel'] },
                        response_headers: {
                            type: 'object',
                            additionalProperties: { type: 'string' }
                        }
                    },
                    additionalProperties: false
                }
            }
        }
    };
}
