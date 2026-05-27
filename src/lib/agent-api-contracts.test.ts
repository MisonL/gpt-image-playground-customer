import {
    AGENT_SCHEMA_VERSION,
    PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH,
    buildAgentAuthCapabilities,
    buildAgentCapabilities,
    readAgentLeaseMs,
    readAgentPublicBaseUrl,
    readAgentRecoveryIntervalMs,
    readAgentRequestTtlSeconds,
    validateAgentGenerateRequest
} from './agent-api-contracts';
import { AGENT_ENDPOINTS, AGENT_JOB_ENDPOINTS } from './agent-api-paths.mjs';
import { buildAgentOpenApiDocument } from './agent-openapi';
import { RequestValidationError } from './image-request-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('validateAgentGenerateRequest', () => {
    it('accepts a minimal JSON generate request and applies Agent defaults', () => {
        assert.deepEqual(validateAgentGenerateRequest({ prompt: 'draw a stable test image' }), {
            model: 'gpt-image-2',
            prompt: 'draw a stable test image',
            n: 1,
            size: '1024x1024',
            quality: 'high',
            output_format: 'png',
            background: 'auto',
            moderation: 'auto',
            response_mode: 'path',
            image_backend: 'images-api',
            stream_mode: 'auto',
            streaming_strategy: 'auto',
            partial_images: 2
        });
    });

    it('accepts explicit Agent upstream streaming strategy fields', () => {
        assert.deepEqual(
            validateAgentGenerateRequest({
                prompt: 'draw a stable streaming image',
                image_backend: 'images',
                streaming_strategy: 'newapi-keepalive-sse',
                partial_images: 3
            }),
            {
                model: 'gpt-image-2',
                prompt: 'draw a stable streaming image',
                n: 1,
                size: '1024x1024',
                quality: 'high',
                output_format: 'png',
                background: 'auto',
                moderation: 'auto',
                response_mode: 'path',
                image_backend: 'images-api',
                stream_mode: 'auto',
                streaming_strategy: 'newapi-keepalive-sse',
                partial_images: 3
            }
        );
    });

    it('rejects non-string Agent upstream strategy fields instead of defaulting them', () => {
        assert.throws(
            () =>
                validateAgentGenerateRequest({
                    prompt: 'bad upstream strategy fields',
                    image_backend: 123,
                    streaming_strategy: true
                }),
            (error) => {
                assert.ok(error instanceof RequestValidationError);
                assert.equal(error.status, 422);
                const details = JSON.parse(error.message) as { fields: Record<string, string> };
                assert.match(details.fields.image_backend, /字符串/);
                assert.match(details.fields.streaming_strategy, /字符串/);
                return true;
            }
        );
    });

    it('returns field-level validation errors for agent-correctable inputs', () => {
        assert.throws(
            () =>
                validateAgentGenerateRequest({
                    prompt: '',
                    n: 99,
                    output_format: 'gif',
                    response_mode: 'url'
                }),
            (error) => {
                assert.ok(error instanceof RequestValidationError);
                assert.equal(error.status, 422);
                const details = JSON.parse(error.message) as { fields: Record<string, string> };
                assert.match(details.fields.prompt, /必填/);
                assert.match(details.fields.n, /1 到 10/);
                assert.match(details.fields.output_format, /png/);
                assert.match(details.fields.response_mode, /path/);
                return true;
            }
        );
    });

    it('rejects incompatible Agent image backend and streaming strategy combinations', () => {
        assert.throws(
            () =>
                validateAgentGenerateRequest({
                    prompt: 'bad strategy',
                    image_backend: 'images-api',
                    streaming_strategy: 'responses-sse'
                }),
            (error) => {
                assert.ok(error instanceof RequestValidationError);
                assert.equal(error.status, 422);
                const details = JSON.parse(error.message) as { fields: Record<string, string> };
                assert.match(details.fields.streaming_strategy, /Images API/);
                return true;
            }
        );
    });

    it('rejects transparent background for gpt-image-2', () => {
        assert.throws(
            () =>
                validateAgentGenerateRequest({
                    prompt: 'transparent object',
                    model: 'gpt-image-2',
                    background: 'transparent'
                }),
            /transparent/
        );
    });

    it('rejects gpt-image-2 sizes outside the image size contract', () => {
        for (const { size, pattern } of [
            { size: '512x512', pattern: /至少/ },
            { size: '3840x3840', pattern: /不能超过/ }
        ]) {
            assert.throws(
                () =>
                    validateAgentGenerateRequest({
                        prompt: 'out of range image',
                        model: 'gpt-image-2',
                        size
                    }),
                (error) => {
                    assert.ok(error instanceof RequestValidationError);
                    assert.equal(error.status, 422);
                    const details = JSON.parse(error.message) as { fields: Record<string, string> };
                    assert.match(details.fields.size, pattern);
                    return true;
                }
            );
        }
    });
});

describe('Agent numeric configuration', () => {
    it('uses defaults when optional numeric env values are absent', () => {
        assert.equal(readAgentRequestTtlSeconds({}), 86400);
        assert.equal(readAgentLeaseMs({}), 600000);
        assert.equal(readAgentRecoveryIntervalMs({}), 30000);
    });

    it('fails explicitly when numeric env values are invalid', () => {
        assert.throws(
            () => readAgentRequestTtlSeconds({ AGENT_REQUEST_TTL_SECONDS: 'abc' }),
            /AGENT_REQUEST_TTL_SECONDS/
        );
        assert.throws(() => readAgentLeaseMs({ AGENT_REQUEST_LEASE_MS: '0' }), /AGENT_REQUEST_LEASE_MS/);
        assert.throws(
            () => readAgentRecoveryIntervalMs({ AGENT_RECOVERY_INTERVAL_MS: '-1' }),
            /AGENT_RECOVERY_INTERVAL_MS/
        );
    });

    it('validates the public OpenAPI server URL', () => {
        assert.equal(readAgentPublicBaseUrl({}), '/');
        assert.equal(
            readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'https://images.example.test/' }),
            'https://images.example.test'
        );
        assert.equal(
            readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'http://localhost:4783' }),
            'http://localhost:4783'
        );
        assert.throws(() => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'not a url' }), /AGENT_PUBLIC_BASE_URL/);
        assert.throws(
            () => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'javascript:alert(1)' }),
            /AGENT_PUBLIC_BASE_URL/
        );
        assert.throws(
            () => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'https://user:pass@images.example.test' }),
            /AGENT_PUBLIC_BASE_URL/
        );
        assert.throws(
            () => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'https://images.example.test?token=secret' }),
            /AGENT_PUBLIC_BASE_URL/
        );
    });
});

describe('buildAgentCapabilities', () => {
    it('exposes machine-readable defaults, limits, auth, and storage metadata', () => {
        const capabilities = buildAgentCapabilities({
            AGENT_STATE_BACKEND: 'postgres',
            AGENT_DATABASE_URL: 'postgres://example',
            AGENT_API_TOKEN: 'token',
            NEXT_PUBLIC_IMAGE_STORAGE_MODE: 'fs'
        });

        assert.equal(capabilities.defaults.state_backend, 'postgres');
        assert.equal(capabilities.schema_version, AGENT_SCHEMA_VERSION);
        assert.equal(capabilities.defaults.image_backend, 'images-api');
        assert.equal(capabilities.defaults.stream_mode, 'auto');
        assert.equal(capabilities.defaults.streaming_strategy, 'auto');
        assert.equal(capabilities.defaults.partial_images, 2);
        assert.equal(capabilities.auth.required, true);
        assert.deepEqual(capabilities.auth.schemes, ['bearer']);
        assert.equal(capabilities.storage.postgres_configured, true);
        assert.equal('sqlite_path' in capabilities.storage, false);
        assert.equal(capabilities.idempotency.header, 'Idempotency-Key');
        assert.ok(capabilities.supported.models.includes('gpt-image-2'));
        assert.equal(capabilities.model_limits['gpt-image-2'].max_edge, 3840);
        assert.equal(capabilities.model_limits['gpt-image-2'].edge_multiple, 16);
        assert.equal(capabilities.model_limits['gpt-image-2'].max_pixels, 8294400);
        assert.equal(capabilities.model_limits['gpt-image-2'].min_pixels, 655360);
        assert.equal(capabilities.model_limits['gpt-image-2'].max_aspect, 3);
        assert.deepEqual(capabilities.model_limits['gpt-image-2'].large_image_risk.applies_to, [
            'max_edge>2048',
            'long_running_upstream'
        ]);
        assert.match(capabilities.model_limits['gpt-image-2'].large_image_risk.guidance, /大尺寸/);
        assert.equal(capabilities.agent_streaming.generate.supported, false);
        assert.equal(capabilities.agent_streaming.generate.mode, 'non_streaming_only');
        assert.equal(capabilities.agent_streaming.upstream_sse.supported, true);
        assert.equal(capabilities.agent_streaming.upstream_sse.mode, 'internal_upstream_sse');
        assert.deepEqual(capabilities.agent_streaming.upstream_sse.request_fields, [
            'image_backend',
            'stream_mode',
            'streaming_strategy',
            'partial_images'
        ]);
        assert.deepEqual(capabilities.agent_streaming.upstream_sse.request_fields_by_mode, {
            generate: ['image_backend', 'stream_mode', 'streaming_strategy', 'partial_images'],
            edit: ['stream_mode', 'streaming_strategy', 'partial_images']
        });
        assert.deepEqual(capabilities.agent_streaming.upstream_sse.image_backends, [
            'images-api',
            'responses-image-generation'
        ]);
        assert.deepEqual(capabilities.agent_streaming.upstream_sse.enabled_image_backends, ['images-api']);
        assert.deepEqual(capabilities.agent_streaming.upstream_sse.streaming_strategies, [
            'off',
            'auto',
            'openai-sse',
            'newapi-keepalive-sse',
            'responses-sse',
            'force-sse'
        ]);
        assert.deepEqual(capabilities.agent_streaming.upstream_sse.activation_strategies, [
            'auto',
            'openai-sse',
            'newapi-keepalive-sse',
            'responses-sse',
            'force-sse'
        ]);
        assert.deepEqual(capabilities.agent_streaming.upstream_sse.stream_modes, ['auto', 'stream', 'non_stream']);
        assert.equal(capabilities.agent_streaming.upstream_sse.final_response_contract, 'AgentImageResponse');
        assert.equal(capabilities.agent_streaming.page_sse.endpoint, '/api/images');
        assert.equal(capabilities.agent_streaming.page_sse.contract, 'page_ui_only');
        assert.equal(capabilities.agent_streaming.page_sse.transport_contract, 'page_form_data_sse');
        assert.deepEqual(capabilities.agent_streaming.page_sse.auth, {
            required: false,
            schemes: [],
            form_field: 'passwordHash'
        });
        assert.deepEqual(capabilities.agent_streaming.page_sse.client_request_id, {
            form_field: 'clientRequestId',
            source_header: 'Idempotency-Key',
            max_length: PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH
        });
        assert.equal(
            capabilities.agent_streaming.page_sse.agent_usage,
            'recommended_for_high_resolution_generate_edit_and_complex_batch'
        );
        assert.deepEqual(capabilities.routing_rules.high_resolution_edit, {
            when: ['operation=edit', 'max_edge>2048'],
            endpoint: '/api/images',
            transport: 'page_sse',
            strength: 'default',
            reason: 'High-resolution edit defaults to the page form-data SSE endpoint; if streaming has issues, diagnose first and explicitly fall back to Agent edit.'
        });
        assert.equal(capabilities.routing_rules.complex_ui_batch.endpoint, '/api/images');
        assert.equal(capabilities.routing_rules.complex_ui_batch.strength, 'recommended');
        assert.equal(capabilities.routing_rules.long_image_recovery.endpoint, '/api/images');
        assert.equal(capabilities.routing_rules.long_image_recovery.transport, 'page_sse');
        assert.equal(capabilities.routing_rules.agent_generate_small_smoke.endpoint, AGENT_ENDPOINTS.generate);
        assert.equal(capabilities.routing_rules.page_sse_large_generate.endpoint, '/api/images');
        assert.equal(capabilities.routing_rules.page_sse_large_generate.transport, 'page_sse');
        assert.equal(capabilities.routing_rules.page_sse_large_generate.strength, 'recommended');
        assert.equal(capabilities.routing_rules.retry_recovery.reuse_failed_idempotency_key, false);
        assert.match(capabilities.routing_rules.retry_recovery.new_attempt_guidance, /new Idempotency-Key/);
        assert.deepEqual(capabilities.supported.image_backends, ['images-api', 'responses-image-generation']);
        assert.deepEqual(capabilities.supported.enabled_image_backends, ['images-api']);
        assert.deepEqual(capabilities.supported.image_backend_requirements['images-api'], {
            supported: true,
            enabled: true,
            required_env: [],
            missing_env: []
        });
        assert.deepEqual(capabilities.supported.image_backend_requirements['responses-image-generation'], {
            supported: true,
            enabled: false,
            required_env: ['ENABLE_RESPONSES_IMAGE_BACKEND', 'OPENAI_RESPONSES_API_MODEL'],
            missing_env: ['ENABLE_RESPONSES_IMAGE_BACKEND', 'OPENAI_RESPONSES_API_MODEL']
        });
        assert.deepEqual(capabilities.supported.streaming_strategies, [
            'off',
            'auto',
            'openai-sse',
            'newapi-keepalive-sse',
            'responses-sse',
            'force-sse'
        ]);
        assert.deepEqual(capabilities.supported.stream_modes, ['auto', 'stream', 'non_stream']);
        assert.equal(capabilities.endpoints.create_generate_job, AGENT_ENDPOINTS.create_generate_job);
        assert.equal(capabilities.agent_jobs.supported, true);
        assert.equal(capabilities.agent_jobs.mode, 'job_polling');
        assert.deepEqual(capabilities.agent_jobs.intended_for, [
            'explicit_job_route',
            'manual_after_diagnosis',
            'long_running_upstream_when_page_sse_not_selected'
        ]);
        assert.equal(capabilities.agent_jobs.endpoints.create_generate_job, AGENT_JOB_ENDPOINTS.create_generate_job);
        assert.deepEqual(capabilities.agent_jobs.states, ['queued', 'running', 'succeeded', 'failed', 'expired']);
        assert.match(capabilities.agent_jobs.current_guidance, /\/api\/images SSE/);
        assert.match(capabilities.agent_jobs.current_guidance, /不自动回退/);
        assert.match(capabilities.agent_jobs.current_guidance, /job/);
    });

    it('exposes only the runtime-accepted bearer auth scheme when Agent token is configured', () => {
        assert.deepEqual(
            buildAgentAuthCapabilities({
                AGENT_API_TOKEN: 'token',
                APP_PASSWORD: 'page-access-code'
            }),
            { required: true, schemes: ['bearer'] }
        );
    });

    it('marks Responses image backend runtime-enabled only when its feature flag and model are configured', () => {
        const missingModel = buildAgentCapabilities({
            ENABLE_RESPONSES_IMAGE_BACKEND: 'true'
        });
        assert.deepEqual(missingModel.supported.enabled_image_backends, ['images-api']);
        assert.deepEqual(missingModel.supported.image_backend_requirements['responses-image-generation'].missing_env, [
            'OPENAI_RESPONSES_API_MODEL'
        ]);

        const enabled = buildAgentCapabilities({
            ENABLE_RESPONSES_IMAGE_BACKEND: 'true',
            OPENAI_RESPONSES_API_MODEL: 'gpt-4.1'
        });
        assert.deepEqual(enabled.agent_streaming.upstream_sse.enabled_image_backends, [
            'images-api',
            'responses-image-generation'
        ]);
        assert.deepEqual(enabled.supported.enabled_image_backends, ['images-api', 'responses-image-generation']);
        assert.deepEqual(enabled.supported.image_backend_requirements['responses-image-generation'], {
            supported: true,
            enabled: true,
            required_env: ['ENABLE_RESPONSES_IMAGE_BACKEND', 'OPENAI_RESPONSES_API_MODEL'],
            missing_env: []
        });
    });

    it('exposes page SSE form password auth separately from Agent bearer auth', () => {
        const capabilities = buildAgentCapabilities({
            AGENT_API_TOKEN: 'token',
            APP_PASSWORD: 'page-access-code'
        });

        assert.deepEqual(capabilities.auth, { required: true, schemes: ['bearer'] });
        assert.deepEqual(capabilities.agent_streaming.page_sse.auth, {
            required: true,
            schemes: ['form-password-hash'],
            form_field: 'passwordHash'
        });
    });

    it('exposes access-code hash auth only when no Agent token is configured', () => {
        assert.deepEqual(buildAgentAuthCapabilities({ APP_PASSWORD: 'page-access-code' }), {
            required: true,
            schemes: ['x-app-password-hash']
        });
    });

    it('marks Agent auth as optional when no auth env is configured', () => {
        assert.deepEqual(
            buildAgentAuthCapabilities({
                AGENT_API_TOKEN: '   ',
                APP_PASSWORD: '   '
            }),
            { required: false, schemes: [] }
        );
    });

    it('exposes memory state backend for ephemeral deployments', () => {
        const capabilities = buildAgentCapabilities({
            AGENT_STATE_BACKEND: 'memory',
            NEXT_PUBLIC_IMAGE_STORAGE_MODE: 'fs'
        });

        assert.equal(capabilities.defaults.state_backend, 'memory');
        assert.equal(capabilities.storage.postgres_configured, false);
    });

    it('generates an OpenAPI document with the Agent generate endpoint', () => {
        const document = buildAgentOpenApiDocument({ AGENT_PUBLIC_BASE_URL: 'https://images.example.test' });
        assert.equal(document.openapi, '3.1.0');
        assert.deepEqual(document.servers, [{ url: 'https://images.example.test' }]);
        assert.ok(AGENT_ENDPOINTS.openapi in document.paths);
        assert.ok(AGENT_ENDPOINTS.generate in document.paths);
        assert.ok(AGENT_ENDPOINTS.create_generate_job in document.paths);
        assert.ok(AGENT_ENDPOINTS.job in document.paths);
        assert.ok(AGENT_ENDPOINTS.job_result in document.paths);
        assert.ok('AgentCapabilities' in document.components.schemas);
        assert.ok('AgentImageResponse' in document.components.schemas);
        assert.ok('AgentJobStatusResponse' in document.components.schemas);
        assert.ok('AgentArtifact' in document.components.schemas);
        assert.ok('EditRequest' in document.components.schemas);
        assert.ok('AgentError' in document.components.schemas);
        assert.ok('AgentModelLimits' in document.components.schemas);
        assert.ok('AgentStreamingCapabilities' in document.components.schemas);
        assert.ok('AgentJobCapabilities' in document.components.schemas);
        assert.ok('AgentRoutingRules' in document.components.schemas);
        assert.ok('AgentRoutingRule' in document.components.schemas);
        assert.ok('AgentErrorDiagnostics' in document.components.schemas);
        assert.ok(document.paths[AGENT_ENDPOINTS.generate].post.responses['200']);
        assert.ok(document.paths[AGENT_ENDPOINTS.generate].post.responses['403']);
        assert.ok(document.paths[AGENT_ENDPOINTS.generate].post.responses['429']);
        assert.ok(document.paths[AGENT_ENDPOINTS.generate].post.responses['422']);
        assert.ok(document.paths[AGENT_ENDPOINTS.create_generate_job].post.responses['202']);
        assert.ok(document.paths[AGENT_ENDPOINTS.job_result].get.responses['200']);
        assert.ok(document.paths[AGENT_ENDPOINTS.job_result].get.responses['409']);
        assert.ok(document.paths[AGENT_ENDPOINTS.job_result].get.responses['422']);
        assert.ok(document.paths[AGENT_ENDPOINTS.job_result].get.responses['429']);
        assert.ok(document.paths[AGENT_ENDPOINTS.job_result].get.responses['502']);
        const generateProperties = document.components.schemas.GenerateRequest.properties;
        assert.deepEqual(generateProperties.image_backend.enum, ['images-api', 'responses-image-generation']);
        assert.deepEqual(generateProperties.streaming_strategy.enum, [
            'off',
            'auto',
            'openai-sse',
            'newapi-keepalive-sse',
            'responses-sse',
            'force-sse'
        ]);
        assert.deepEqual(generateProperties.stream_mode.enum, ['auto', 'stream', 'non_stream']);
        assert.ok('partial_images' in generateProperties);
        const editProperties = document.components.schemas.EditRequest.properties;
        assert.equal('image_backend' in editProperties, false);
        assert.equal('output_format' in editProperties, false);
        assert.equal('output_compression' in editProperties, false);
        assert.equal('background' in editProperties, false);
        assert.equal('moderation' in editProperties, false);
        assert.deepEqual(document.components.schemas.EditRequest.required, ['prompt']);
        assert.match(document.components.schemas.EditRequest.description, /至少提供一个 image_0\.\.image_9/);
        assert.deepEqual(
            document.components.schemas.EditRequest.anyOf,
            Array.from({ length: 10 }, (_, index) => ({ required: [`image_${index}`] }))
        );
        for (let index = 0; index < 10; index += 1) {
            assert.deepEqual(editProperties[`image_${index}`], { type: 'string', format: 'binary' });
        }
        const capabilityProperties = document.components.schemas.AgentCapabilities.properties;
        assert.equal(capabilityProperties.routing_rules.$ref, '#/components/schemas/AgentRoutingRules');
        assert.deepEqual(capabilityProperties.defaults.properties.image_backend.enum, [
            'images-api',
            'responses-image-generation'
        ]);
        assert.deepEqual(capabilityProperties.supported.properties.image_backends.items.enum, [
            'images-api',
            'responses-image-generation'
        ]);
        assert.deepEqual(capabilityProperties.supported.properties.enabled_image_backends.items.enum, [
            'images-api',
            'responses-image-generation'
        ]);
        assert.ok(capabilityProperties.supported.properties.image_backend_requirements);
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.upstream_sse.properties.request_fields
                .const,
            ['image_backend', 'stream_mode', 'streaming_strategy', 'partial_images']
        );
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.upstream_sse.properties
                .request_fields_by_mode.properties.generate.const,
            ['image_backend', 'stream_mode', 'streaming_strategy', 'partial_images']
        );
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.upstream_sse.properties
                .request_fields_by_mode.properties.edit.const,
            ['stream_mode', 'streaming_strategy', 'partial_images']
        );
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.upstream_sse.properties
                .enabled_image_backends.items.enum,
            ['images-api', 'responses-image-generation']
        );
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.upstream_sse.properties
                .streaming_strategies.items.enum,
            ['off', 'auto', 'openai-sse', 'newapi-keepalive-sse', 'responses-sse', 'force-sse']
        );
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.upstream_sse.properties
                .activation_strategies.items.enum,
            ['auto', 'openai-sse', 'newapi-keepalive-sse', 'responses-sse', 'force-sse']
        );
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.upstream_sse.properties
                .stream_modes.items.enum,
            ['auto', 'stream', 'non_stream']
        );
        assert.equal(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.contract.enum[0],
            'page_ui_only'
        );
        assert.equal(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.transport_contract
                .enum[0],
            'page_form_data_sse'
        );
        assert.equal(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.auth.properties
                .form_field.const,
            'passwordHash'
        );
        assert.equal(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.client_request_id
                .properties.max_length.const,
            PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH
        );
        assert.equal(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.client_request_id
                .properties.source_header.const,
            'Idempotency-Key'
        );
        assert.equal(document.components.schemas.AgentRoutingRules.required.includes('high_resolution_edit'), true);
        assert.equal(document.components.schemas.AgentRoutingRules.required.includes('long_image_recovery'), true);
        assert.match(document.components.schemas.EditRequest.description, /\/api\/images/);
        assert.ok('upstream_event_type' in document.components.schemas.AgentErrorDiagnostics.properties);
        assert.ok('partial_image_count' in document.components.schemas.AgentErrorDiagnostics.properties);
    });

    it('describes public capabilities without server-local SQLite paths', () => {
        const document = buildAgentOpenApiDocument({});
        const storageSchema = document.components.schemas.AgentCapabilities.properties.storage;

        assert.ok(storageSchema.properties.image_storage_mode);
        assert.ok(storageSchema.properties.postgres_configured);
        assert.equal('sqlite_path' in storageSchema.properties, false);
    });

    it('describes bearer authentication and common runtime failures in OpenAPI', () => {
        const document = buildAgentOpenApiDocument({
            AGENT_API_TOKEN: 'token',
            APP_PASSWORD: 'page-access-code'
        });

        assert.ok(document.components.securitySchemes.BearerAuth);
        assert.equal('AppPasswordHash' in document.components.securitySchemes, false);
        assert.deepEqual(document.components.schemas.AgentCapabilities.properties.auth.properties.schemes.const, [
            'bearer'
        ]);
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.auth.properties
                .schemes.const,
            ['form-password-hash']
        );
        assert.equal(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.auth.properties
                .required.const,
            true
        );
        assert.deepEqual(document.paths['/api/agent/images/generate'].post.security, [{ BearerAuth: [] }]);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['401']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['415']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['502']);
        assert.ok(document.paths['/api/agent/images/edit'].post.responses['401']);
        assert.ok(document.paths['/api/agent/images/edit'].post.responses['409'].headers['Retry-After']);
        assert.ok(document.paths['/api/agent/images/edit'].post.responses['415']);
        assert.ok(document.paths['/api/agent/images/edit'].post.responses['502']);
    });

    it('describes access-code hash authentication in OpenAPI when no Agent token is configured', () => {
        const document = buildAgentOpenApiDocument({ APP_PASSWORD: 'page-access-code' });

        assert.equal('BearerAuth' in document.components.securitySchemes, false);
        assert.ok(document.components.securitySchemes.AppPasswordHash);
        assert.deepEqual(document.components.schemas.AgentCapabilities.properties.auth.properties.schemes.const, [
            'x-app-password-hash'
        ]);
        assert.deepEqual(document.paths['/api/agent/images/generate'].post.security, [{ AppPasswordHash: [] }]);
    });

    it('does not require Agent authentication in OpenAPI when no auth env is configured', () => {
        const document = buildAgentOpenApiDocument({});

        assert.deepEqual(document.components.securitySchemes, {});
        assert.deepEqual(document.components.schemas.AgentCapabilities.properties.auth.properties.schemes.const, []);
        assert.deepEqual(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.auth.properties
                .schemes.const,
            []
        );
        assert.equal(
            document.components.schemas.AgentStreamingCapabilities.properties.page_sse.properties.auth.properties
                .required.const,
            false
        );
        assert.deepEqual(document.paths['/api/agent/images/generate'].post.security, []);
    });

    it('marks artifact routes as authenticated in OpenAPI', () => {
        const document = buildAgentOpenApiDocument({ AGENT_API_TOKEN: 'token' });
        const expectedSecurity = [{ BearerAuth: [] }];

        assert.deepEqual(document.paths['/api/agent/artifacts/{id}'].get.security, expectedSecurity);
        assert.deepEqual(document.paths['/api/agent/artifacts/{id}'].delete.security, expectedSecurity);
        assert.deepEqual(document.paths['/api/agent/artifacts/{id}/content'].get.security, expectedSecurity);
    });

    it('describes artifact metadata responses without server file paths', () => {
        const document = buildAgentOpenApiDocument({});
        const responseSchema = document.components.schemas.ArtifactMetadataResponse;
        const schema = document.components.schemas.AgentArtifact;

        assert.equal(responseSchema.properties.artifact.$ref, '#/components/schemas/AgentArtifact');
        assert.equal('AgentArtifactRecord' in document.components.schemas, false);
        assert.equal('filepath' in schema.properties, false);
        assert.ok('content_url' in schema.properties);
        assert.ok('metadata_url' in schema.properties);
        assert.ok('output_format' in schema.properties);
        assert.ok('mime_type' in schema.properties);
        assert.ok('size_bytes' in schema.properties);
    });
});
