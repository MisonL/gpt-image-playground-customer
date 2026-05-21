import {
    buildAgentAuthCapabilities,
    buildAgentCapabilities,
    readAgentLeaseMs,
    readAgentPublicBaseUrl,
    readAgentRecoveryIntervalMs,
    readAgentRequestTtlSeconds,
    validateAgentGenerateRequest
} from './agent-api-contracts';
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
            response_mode: 'path'
        });
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
        assert.throws(
            () =>
                validateAgentGenerateRequest({
                    prompt: 'tiny image',
                    model: 'gpt-image-2',
                    size: '1x1'
                }),
            (error) => {
                assert.ok(error instanceof RequestValidationError);
                assert.equal(error.status, 422);
                const details = JSON.parse(error.message) as { fields: Record<string, string> };
                assert.match(details.fields.size, /像素|倍数|宽高比|正数/);
                return true;
            }
        );
    });
});

describe('Agent numeric configuration', () => {
    it('uses defaults when optional numeric env values are absent', () => {
        assert.equal(readAgentRequestTtlSeconds({}), 86400);
        assert.equal(readAgentLeaseMs({}), 600000);
        assert.equal(readAgentRecoveryIntervalMs({}), 30000);
    });

    it('fails explicitly when numeric env values are invalid', () => {
        assert.throws(() => readAgentRequestTtlSeconds({ AGENT_REQUEST_TTL_SECONDS: 'abc' }), /AGENT_REQUEST_TTL_SECONDS/);
        assert.throws(() => readAgentLeaseMs({ AGENT_REQUEST_LEASE_MS: '0' }), /AGENT_REQUEST_LEASE_MS/);
        assert.throws(() => readAgentRecoveryIntervalMs({ AGENT_RECOVERY_INTERVAL_MS: '-1' }), /AGENT_RECOVERY_INTERVAL_MS/);
    });

    it('validates the public OpenAPI server URL', () => {
        assert.equal(readAgentPublicBaseUrl({}), '/');
        assert.equal(readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'https://images.example.test/' }), 'https://images.example.test');
        assert.equal(readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'http://localhost:4783' }), 'http://localhost:4783');
        assert.throws(() => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'not a url' }), /AGENT_PUBLIC_BASE_URL/);
        assert.throws(() => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'javascript:alert(1)' }), /AGENT_PUBLIC_BASE_URL/);
        assert.throws(() => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'https://user:pass@images.example.test' }), /AGENT_PUBLIC_BASE_URL/);
        assert.throws(() => readAgentPublicBaseUrl({ AGENT_PUBLIC_BASE_URL: 'https://images.example.test?token=secret' }), /AGENT_PUBLIC_BASE_URL/);
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
        assert.equal(capabilities.auth.required, true);
        assert.deepEqual(capabilities.auth.schemes, ['bearer']);
        assert.equal(capabilities.storage.postgres_configured, true);
        assert.equal('sqlite_path' in capabilities.storage, false);
        assert.equal(capabilities.idempotency.header, 'Idempotency-Key');
        assert.ok(capabilities.supported.models.includes('gpt-image-2'));
        assert.equal(capabilities.model_limits['gpt-image-2'].max_edge, 3840);
        assert.equal(capabilities.model_limits['gpt-image-2'].edge_multiple, 16);
        assert.equal(capabilities.model_limits['gpt-image-2'].max_pixels, 8294400);
        assert.equal(capabilities.agent_streaming.generate.supported, false);
        assert.equal(capabilities.agent_streaming.generate.mode, 'non_streaming_only');
        assert.equal(capabilities.agent_streaming.page_sse.endpoint, '/api/images');
        assert.equal(capabilities.endpoints.create_generate_job, '/api/agent/jobs/images/generate');
        assert.equal(capabilities.agent_jobs.supported, true);
        assert.equal(capabilities.agent_jobs.mode, 'job_polling');
        assert.equal(capabilities.agent_jobs.endpoints.create_generate_job, '/api/agent/jobs/images/generate');
        assert.deepEqual(capabilities.agent_jobs.states, ['queued', 'running', 'succeeded', 'failed', 'expired']);
        assert.match(capabilities.agent_jobs.current_guidance, /poll/i);
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
        assert.ok('/api/agent/openapi.json' in document.paths);
        assert.ok('/api/agent/images/generate' in document.paths);
        assert.ok('/api/agent/jobs/images/generate' in document.paths);
        assert.ok('/api/agent/jobs/{id}' in document.paths);
        assert.ok('/api/agent/jobs/{id}/result' in document.paths);
        assert.ok('AgentCapabilities' in document.components.schemas);
        assert.ok('AgentImageResponse' in document.components.schemas);
        assert.ok('AgentJobStatusResponse' in document.components.schemas);
        assert.ok('AgentArtifact' in document.components.schemas);
        assert.ok('EditRequest' in document.components.schemas);
        assert.ok('AgentError' in document.components.schemas);
        assert.ok('AgentModelLimits' in document.components.schemas);
        assert.ok('AgentStreamingCapabilities' in document.components.schemas);
        assert.ok('AgentJobCapabilities' in document.components.schemas);
        assert.ok('AgentErrorDiagnostics' in document.components.schemas);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['200']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['403']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['429']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['422']);
        assert.ok(document.paths['/api/agent/jobs/images/generate'].post.responses['202']);
        assert.ok(document.paths['/api/agent/jobs/{id}/result'].get.responses['200']);
        assert.ok(document.paths['/api/agent/jobs/{id}/result'].get.responses['409']);
        assert.ok(document.paths['/api/agent/jobs/{id}/result'].get.responses['422']);
        assert.ok(document.paths['/api/agent/jobs/{id}/result'].get.responses['429']);
        assert.ok(document.paths['/api/agent/jobs/{id}/result'].get.responses['502']);
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
        assert.deepEqual(document.components.schemas.AgentCapabilities.properties.auth.properties.schemes.const, ['bearer']);
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
