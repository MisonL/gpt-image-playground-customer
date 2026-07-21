import { buildAgentCapabilities } from './agent-api-contracts';
import { AGENT_ENDPOINTS } from './agent-api-paths.mjs';
import { buildAgentOpenApiDocument } from './agent-openapi';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('Agent channel health diagnostics contract', () => {
    it('declares the non-billable process-local health endpoint in capabilities', () => {
        const capabilities = buildAgentCapabilities({});

        assert.equal(AGENT_ENDPOINTS.channel_health_diagnostics, '/api/agent/diagnostics/channel-health');
        assert.deepEqual(capabilities.channel_health_diagnostics, {
            supported: true,
            endpoint: '/api/agent/diagnostics/channel-health',
            source: 'in_process_channel_router',
            state_scope: 'process_local',
            billable: false
        });
    });

    it('declares the health endpoint and its sanitized response in OpenAPI', () => {
        const document = buildAgentOpenApiDocument({ AGENT_API_TOKEN: 'test-token' });
        const path = document.paths[AGENT_ENDPOINTS.channel_health_diagnostics];

        assert.ok(path);
        assert.ok(path.get);
        assert.equal(path.get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/AgentChannelHealthDiagnosticsResponse');
        assert.ok(path.get.responses['401']);
        assert.ok(path.get.responses['500']);
        assert.equal(
            document.components.schemas.AgentCapabilities.properties.channel_health_diagnostics.$ref,
            '#/components/schemas/AgentChannelHealthDiagnosticsCapabilities'
        );
        assert.equal(
            document.components.schemas.AgentChannelHealthDiagnosticsCapabilities.properties.endpoint.const,
            AGENT_ENDPOINTS.channel_health_diagnostics
        );
        assert.equal(
            document.components.schemas.AgentChannelHealthDiagnosticsResponse.properties.snapshot.$ref,
            '#/components/schemas/AgentChannelHealthSnapshot'
        );
        assert.equal(
            document.components.schemas.AgentChannelHealthDiagnosticsResponse.properties.state_initialized.type,
            'boolean'
        );
        assert.equal(
            document.components.schemas.AgentChannelHealthFailure.properties.message,
            undefined
        );
        assert.deepEqual(document.components.schemas.AgentChannelHealthRequestMode.properties.mode.enum, [
            'images-non-stream',
            'images-sse',
            'responses-non-stream',
            'responses-sse'
        ]);
    });
});
