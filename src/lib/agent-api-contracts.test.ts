import {
    buildAgentCapabilities,
    buildAgentOpenApiDocument,
    validateAgentGenerateRequest
} from './agent-api-contracts';
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
            quality: 'auto',
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
                assert.match(details.fields.prompt, /required/);
                assert.match(details.fields.n, /between 1 and 10/);
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
                assert.match(details.fields.size, /pixels|multiple|Maximum|Aspect|positive/);
                return true;
            }
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
        assert.equal(capabilities.auth.required, true);
        assert.equal(capabilities.storage.postgres_configured, true);
        assert.equal(capabilities.idempotency.header, 'Idempotency-Key');
        assert.ok(capabilities.supported.models.includes('gpt-image-2'));
    });

    it('generates an OpenAPI document with the Agent generate endpoint', () => {
        const document = buildAgentOpenApiDocument({ AGENT_PUBLIC_BASE_URL: 'https://images.example.test' });
        assert.equal(document.openapi, '3.1.0');
        assert.deepEqual(document.servers, [{ url: 'https://images.example.test' }]);
        assert.ok('/api/agent/openapi.json' in document.paths);
        assert.ok('/api/agent/images/generate' in document.paths);
        assert.ok('AgentCapabilities' in document.components.schemas);
        assert.ok('AgentImageResponse' in document.components.schemas);
        assert.ok('AgentArtifact' in document.components.schemas);
        assert.ok('EditRequest' in document.components.schemas);
        assert.ok('AgentError' in document.components.schemas);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['200']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['422']);
    });

    it('describes Agent authentication and common runtime failures in OpenAPI', () => {
        const document = buildAgentOpenApiDocument({});

        assert.ok(document.components.securitySchemes.BearerAuth);
        assert.ok(document.components.securitySchemes.AppPasswordHash);
        assert.deepEqual(document.paths['/api/agent/images/generate'].post.security, [
            { BearerAuth: [] },
            { AppPasswordHash: [] }
        ]);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['401']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['415']);
        assert.ok(document.paths['/api/agent/images/generate'].post.responses['502']);
        assert.ok(document.paths['/api/agent/images/edit'].post.responses['401']);
        assert.ok(document.paths['/api/agent/images/edit'].post.responses['415']);
        assert.ok(document.paths['/api/agent/images/edit'].post.responses['502']);
    });

    it('marks artifact routes as authenticated in OpenAPI', () => {
        const document = buildAgentOpenApiDocument({});
        const expectedSecurity = [{ BearerAuth: [] }, { AppPasswordHash: [] }];

        assert.deepEqual(document.paths['/api/agent/artifacts/{id}'].get.security, expectedSecurity);
        assert.deepEqual(document.paths['/api/agent/artifacts/{id}'].delete.security, expectedSecurity);
        assert.deepEqual(document.paths['/api/agent/artifacts/{id}/content'].get.security, expectedSecurity);
    });

    it('describes artifact metadata responses without server file paths', () => {
        const document = buildAgentOpenApiDocument({});
        const responseSchema = document.components.schemas.ArtifactMetadataResponse;
        const schema = document.components.schemas.AgentArtifact;

        assert.equal(responseSchema.properties.artifact.$ref, '#/components/schemas/AgentArtifact');
        assert.equal('filepath' in schema.properties, false);
        assert.ok('content_url' in schema.properties);
        assert.ok('metadata_url' in schema.properties);
        assert.ok('output_format' in schema.properties);
        assert.ok('mime_type' in schema.properties);
        assert.ok('size_bytes' in schema.properties);
    });
});
