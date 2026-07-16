import { resolveRuntimeHealthStatus } from './runtime-health-status';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('resolveRuntimeHealthStatus', () => {
    it('treats a healthy declared route as ready for the current form request', () => {
        assert.equal(
            resolveRuntimeHealthStatus({
                runtimeCapabilities: {
                    streaming: { defaultBackend: 'images-api' },
                    responsesImageBackend: { enabled: true },
                    channelRouting: {
                        effectiveRequestModes: ['images-non-stream', 'images-sse'],
                        requestModeHealth: [
                            {
                                mode: 'images-sse',
                                healthyCredentialCount: 1,
                                healthyChannelCount: 1
                            }
                        ]
                    }
                },
                hasRequestApiOverride: false,
                imageBackend: 'images-api',
                streamingStrategy: 'auto',
                streamMode: 'stream'
            }),
            'runtime-ready'
        );
    });

    it('keeps auto streaming ready when only the non-stream fallback is healthy', () => {
        assert.equal(
            resolveRuntimeHealthStatus({
                runtimeCapabilities: {
                    streaming: { defaultBackend: 'responses-image-generation' },
                    responsesImageBackend: { enabled: true },
                    channelRouting: {
                        effectiveRequestModes: ['responses-non-stream'],
                        requestModeHealth: [
                            {
                                mode: 'responses-non-stream',
                                healthyCredentialCount: 1,
                                healthyChannelCount: 1
                            }
                        ]
                    }
                },
                hasRequestApiOverride: false,
                imageBackend: 'server-default',
                streamingStrategy: 'auto',
                streamMode: 'auto'
            }),
            'runtime-ready'
        );
    });

    it('marks custom overrides before runtime readiness checks', () => {
        assert.equal(
            resolveRuntimeHealthStatus({
                runtimeCapabilities: null,
                hasRequestApiOverride: true,
                imageBackend: 'images-api',
                streamingStrategy: 'auto',
                streamMode: 'auto'
            }),
            'custom-override'
        );
    });

    it('marks a missing requested route as limited when no healthy mode can satisfy it', () => {
        assert.equal(
            resolveRuntimeHealthStatus({
                runtimeCapabilities: {
                    streaming: { defaultBackend: 'responses-image-generation' },
                    responsesImageBackend: { enabled: false },
                    channelRouting: {
                        effectiveRequestModes: ['images-non-stream'],
                        requestModeHealth: [
                            {
                                mode: 'images-non-stream',
                                healthyCredentialCount: 0,
                                healthyChannelCount: 0
                            }
                        ]
                    }
                },
                hasRequestApiOverride: false,
                imageBackend: 'responses-image-generation',
                streamingStrategy: 'auto',
                streamMode: 'stream'
            }),
            'route-limited'
        );
    });

    it('marks request API key-only overrides before server route health checks', () => {
        assert.equal(
            resolveRuntimeHealthStatus({
                runtimeCapabilities: {
                    streaming: { defaultBackend: 'images-api' },
                    responsesImageBackend: { enabled: true },
                    channelRouting: {
                        effectiveRequestModes: [],
                        requestModeHealth: []
                    }
                },
                hasRequestApiOverride: true,
                imageBackend: 'images-api',
                streamingStrategy: 'auto',
                streamMode: 'auto'
            }),
            'custom-override'
        );
    });
});
