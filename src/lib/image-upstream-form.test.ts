import {
    IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
    appendImageUpstreamOverrideFields,
    getImageUpstreamRouteImpactKeys,
    hasResponsesChannelRequestMode,
    isImageUpstreamStreamingStrategySelectable,
    isResponsesImageBackendRuntimeEnabled,
    normalizeImageUpstreamRuntimeFields,
    resolveImageUpstreamEffectiveStreamingStrategy,
    shouldAllowResponsesImageBackend,
    shouldAllowResponsesHistoryRoute,
    shouldBlockResponsesRequestWithoutModel,
    shouldBlockExplicitResponsesRequest
} from './image-upstream-form';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function readFormEntries(formData: FormData): Record<string, string> {
    return Object.fromEntries(Array.from(formData.entries()).map(([key, value]) => [key, String(value)]));
}

describe('appendImageUpstreamOverrideFields', () => {
    it('preserves server upstream defaults when the page form uses server-default controls', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            streamingStrategy: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            responsesModel: 'gpt-5.4',
            thinking: 'high',
            promptOptimization: 'off',
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {});
    });

    it('appends explicit page upstream overrides and trims the Responses model', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: 'responses-image-generation',
            streamingStrategy: 'responses-sse',
            responsesModel: '  gpt-5.4  ',
            thinking: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            promptOptimization: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {
            image_backend: 'responses-image-generation',
            image_streaming_strategy: 'responses-sse',
            responsesModel: 'gpt-5.4'
        });
    });

    it('appends explicit Responses compatibility fields only for the Responses backend', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: 'responses-image-generation',
            streamingStrategy: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            responsesModel: '',
            thinking: 'high',
            promptOptimization: 'off',
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {
            image_backend: 'responses-image-generation',
            thinking: 'high',
            promptOptimization: 'false'
        });
    });

    it('appends force_web only for the Images API backend', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: 'images-api',
            streamingStrategy: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            responsesModel: 'gpt-5.4',
            thinking: 'xhigh',
            promptOptimization: 'on',
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {
            image_backend: 'images-api',
            force_web: 'true'
        });
    });
});

describe('isImageUpstreamStreamingStrategySelectable', () => {
    it('keeps Responses SSE exclusive to the enabled Responses backend', () => {
        assert.equal(
            isImageUpstreamStreamingStrategySelectable({
                imageBackend: 'responses-image-generation',
                streamingStrategy: 'responses-sse',
                allowResponsesImageBackend: true
            }),
            true
        );
        assert.equal(
            isImageUpstreamStreamingStrategySelectable({
                imageBackend: 'images-api',
                streamingStrategy: 'responses-sse',
                allowResponsesImageBackend: true
            }),
            false
        );
        assert.equal(
            isImageUpstreamStreamingStrategySelectable({
                imageBackend: 'server-default',
                streamingStrategy: 'responses-sse',
                allowResponsesImageBackend: true
            }),
            false
        );
    });

    it('keeps Images API SSE strategies off the Responses backend', () => {
        for (const streamingStrategy of ['openai-sse', 'newapi-keepalive-sse'] as const) {
            assert.equal(
                isImageUpstreamStreamingStrategySelectable({
                    imageBackend: 'responses-image-generation',
                    streamingStrategy,
                    allowResponsesImageBackend: true
                }),
                false
            );
        }
    });
});

describe('isResponsesImageBackendRuntimeEnabled', () => {
    it('allows the experimental Responses backend only after the runtime explicitly enables it', () => {
        assert.equal(isResponsesImageBackendRuntimeEnabled({}), false);
        assert.equal(isResponsesImageBackendRuntimeEnabled({ responsesImageBackend: null }), false);
        assert.equal(isResponsesImageBackendRuntimeEnabled({ responsesImageBackend: {} }), false);
        assert.equal(isResponsesImageBackendRuntimeEnabled({ responsesImageBackend: { enabled: false } }), false);
        assert.equal(isResponsesImageBackendRuntimeEnabled({ responsesImageBackend: { enabled: true } }), true);
    });
});

describe('hasResponsesChannelRequestMode', () => {
    it('requires a currently effective Responses request mode on server channels', () => {
        assert.equal(hasResponsesChannelRequestMode({}), false);
        assert.equal(
            hasResponsesChannelRequestMode({
                channelRouting: { effectiveRequestModes: ['images-non-stream', 'images-sse'] }
            }),
            false
        );
        assert.equal(
            hasResponsesChannelRequestMode({
                channelRouting: { effectiveRequestModes: ['responses-non-stream'] }
            }),
            true
        );
        assert.equal(
            hasResponsesChannelRequestMode({
                channelRouting: { effectiveRequestModes: ['responses-sse'] }
            }),
            true
        );
    });
});

describe('shouldAllowResponsesImageBackend', () => {
    it('keeps server-default Responses disabled when no healthy server channel supports it', () => {
        assert.equal(
            shouldAllowResponsesImageBackend({
                runtimeCapabilities: {
                    responsesImageBackend: { enabled: true },
                    channelRouting: { effectiveRequestModes: ['images-non-stream', 'images-sse'] }
                },
                hasRequestApiOverride: false
            }),
            false
        );
    });

    it('allows explicit user-provided upstream credentials to try Responses when the runtime supports the backend', () => {
        assert.equal(
            shouldAllowResponsesImageBackend({
                runtimeCapabilities: {
                    responsesImageBackend: { enabled: true },
                    channelRouting: { effectiveRequestModes: ['images-non-stream', 'images-sse'] }
                },
                hasRequestApiOverride: true
            }),
            true
        );
    });

    it('allows Responses for server channels that advertise a healthy Responses request mode', () => {
        assert.equal(
            shouldAllowResponsesImageBackend({
                runtimeCapabilities: {
                    responsesImageBackend: { enabled: true },
                    channelRouting: { effectiveRequestModes: ['responses-sse'] }
                },
                hasRequestApiOverride: false
            }),
            true
        );
    });
});

describe('shouldBlockExplicitResponsesRequest', () => {
    it('blocks explicit Responses requests unless the runtime has confirmed support', () => {
        assert.equal(
            shouldBlockExplicitResponsesRequest({
                imageBackend: 'responses-image-generation',
                allowResponsesImageBackend: false
            }),
            true
        );
        assert.equal(
            shouldBlockExplicitResponsesRequest({
                imageBackend: 'responses-image-generation',
                allowResponsesImageBackend: true
            }),
            false
        );
    });

    it('does not block server-default or Images API requests while runtime support is unavailable', () => {
        for (const imageBackend of ['server-default', 'images-api'] as const) {
            assert.equal(
                shouldBlockExplicitResponsesRequest({
                    imageBackend,
                    allowResponsesImageBackend: false
                }),
                false
            );
        }
    });
});

describe('shouldBlockResponsesRequestWithoutModel', () => {
    it('blocks explicit Responses requests when neither runtime nor request provides a top-level model', () => {
        assert.equal(
            shouldBlockResponsesRequestWithoutModel({
                imageBackend: 'responses-image-generation',
                responsesModel: '',
                hasDefaultResponsesModel: false
            }),
            true
        );
        assert.equal(
            shouldBlockResponsesRequestWithoutModel({
                imageBackend: 'responses-image-generation',
                responsesModel: '   ',
                hasDefaultResponsesModel: false
            }),
            true
        );
    });

    it('allows explicit Responses requests with a runtime default or request model', () => {
        assert.equal(
            shouldBlockResponsesRequestWithoutModel({
                imageBackend: 'responses-image-generation',
                responsesModel: '',
                hasDefaultResponsesModel: true
            }),
            false
        );
        assert.equal(
            shouldBlockResponsesRequestWithoutModel({
                imageBackend: 'responses-image-generation',
                responsesModel: 'gpt-4.1',
                hasDefaultResponsesModel: false
            }),
            false
        );
    });

    it('does not require a Responses top-level model for non-Responses routes', () => {
        for (const imageBackend of ['server-default', 'images-api'] as const) {
            assert.equal(
                shouldBlockResponsesRequestWithoutModel({
                    imageBackend,
                    responsesModel: '',
                    hasDefaultResponsesModel: false
                }),
                false
            );
        }
    });
});

describe('shouldAllowResponsesHistoryRoute', () => {
    it('preserves Responses history while runtime capabilities are still unknown', () => {
        assert.equal(
            shouldAllowResponsesHistoryRoute({
                runtimeCapabilitiesAvailable: false,
                allowResponsesImageBackend: false
            }),
            true
        );
    });

    it('cleans Responses history only after runtime capabilities explicitly disable the backend', () => {
        assert.equal(
            shouldAllowResponsesHistoryRoute({
                runtimeCapabilitiesAvailable: true,
                allowResponsesImageBackend: false
            }),
            false
        );
        assert.equal(
            shouldAllowResponsesHistoryRoute({
                runtimeCapabilitiesAvailable: true,
                allowResponsesImageBackend: true
            }),
            true
        );
    });
});

describe('resolveImageUpstreamEffectiveStreamingStrategy', () => {
    it('uses the runtime default when the page selects server-default', () => {
        assert.equal(
            resolveImageUpstreamEffectiveStreamingStrategy({
                streamingStrategy: 'server-default',
                defaultStreamingStrategy: 'off'
            }),
            'off'
        );
        assert.equal(
            resolveImageUpstreamEffectiveStreamingStrategy({
                streamingStrategy: 'server-default',
                defaultStreamingStrategy: 'force-sse'
            }),
            'force-sse'
        );
    });

    it('keeps explicit page strategies unchanged', () => {
        assert.equal(
            resolveImageUpstreamEffectiveStreamingStrategy({
                streamingStrategy: 'auto',
                defaultStreamingStrategy: 'off'
            }),
            'auto'
        );
    });
});

describe('getImageUpstreamRouteImpactKeys', () => {
    it('describes the resolved runtime default streaming strategy instead of raw server-default', () => {
        assert.deepEqual(
            getImageUpstreamRouteImpactKeys({
                backend: 'server-default',
                streamingStrategy: 'server-default',
                defaultStreamingStrategy: 'off',
                allowResponsesImageBackend: true
            }),
            ['upstream.backendImpactServerDefault', 'upstream.strategyImpactOff', 'upstream.routeImpactCost']
        );
        assert.deepEqual(
            getImageUpstreamRouteImpactKeys({
                backend: 'server-default',
                streamingStrategy: 'server-default',
                defaultStreamingStrategy: 'force-sse',
                allowResponsesImageBackend: true
            }),
            ['upstream.backendImpactServerDefault', 'upstream.strategyImpactForceSse', 'upstream.routeImpactCost']
        );
    });

    it('includes backend availability diagnostics when Responses is disabled', () => {
        assert.deepEqual(
            getImageUpstreamRouteImpactKeys({
                backend: 'images-api',
                streamingStrategy: 'auto',
                defaultStreamingStrategy: 'off',
                allowResponsesImageBackend: false
            }),
            [
                'upstream.backendImpactImages',
                'upstream.backendResponsesUnavailable',
                'upstream.strategyImpactAuto',
                'upstream.routeImpactCost'
            ]
        );
    });

    it('includes server mixed-profile diagnostics when the active pool uses different upstream modes', () => {
        assert.deepEqual(
            getImageUpstreamRouteImpactKeys({
                backend: 'server-default',
                streamingStrategy: 'server-default',
                defaultStreamingStrategy: 'auto',
                allowResponsesImageBackend: true,
                serverProfileMixed: true
            }),
            [
                'upstream.backendImpactServerDefault',
                'upstream.routeImpactMixedProfile',
                'upstream.strategyImpactAuto',
                'upstream.routeImpactCost'
            ]
        );
    });
});

describe('normalizeImageUpstreamRuntimeFields', () => {
    it('keeps explicit Responses backend fields when the runtime allows the backend', () => {
        const fields = {
            image_backend: 'responses-image-generation' as const,
            streaming_strategy: 'responses-sse' as const,
            responsesModel: 'gpt-5.4',
            thinking: 'high' as const,
            promptOptimization: 'on' as const
        };

        assert.deepEqual(normalizeImageUpstreamRuntimeFields(fields, { allowResponsesImageBackend: true }), fields);
    });

    it('keeps explicit Responses backend fields while runtime capability is still unknown', () => {
        const fields = {
            image_backend: 'responses-image-generation' as const,
            streaming_strategy: 'responses-sse' as const,
            responsesModel: 'gpt-5.4',
            thinking: 'medium' as const,
            promptOptimization: 'off' as const
        };

        assert.deepEqual(normalizeImageUpstreamRuntimeFields(fields, { allowResponsesImageBackend: true }), fields);
    });

    it('normalizes disabled Responses backend fields back to safe page defaults', () => {
        assert.deepEqual(
            normalizeImageUpstreamRuntimeFields(
                {
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'responses-sse',
                    responsesModel: 'gpt-5.4',
                    thinking: 'high',
                    promptOptimization: 'on'
                },
                { allowResponsesImageBackend: false }
            ),
            {
                image_backend: 'server-default',
                streaming_strategy: 'server-default',
                responsesModel: '',
                thinking: 'server-default',
                promptOptimization: 'server-default'
            }
        );
    });

    it('keeps non-Responses streaming strategy choices when only the backend is unavailable', () => {
        assert.deepEqual(
            normalizeImageUpstreamRuntimeFields(
                {
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'force-sse',
                    responsesModel: 'gpt-5.4',
                    thinking: 'high',
                    promptOptimization: 'off'
                },
                { allowResponsesImageBackend: false }
            ),
            {
                image_backend: 'server-default',
                streaming_strategy: 'force-sse',
                responsesModel: '',
                thinking: 'server-default',
                promptOptimization: 'server-default'
            }
        );
    });

    it('normalizes Responses SSE strategy even when the backend field uses the server default', () => {
        assert.deepEqual(
            normalizeImageUpstreamRuntimeFields(
                {
                    image_backend: 'server-default',
                    streaming_strategy: 'responses-sse',
                    responsesModel: 'stale-model',
                    thinking: 'high',
                    promptOptimization: 'on'
                },
                { allowResponsesImageBackend: false }
            ),
            {
                image_backend: 'server-default',
                streaming_strategy: 'server-default',
                responsesModel: '',
                thinking: 'server-default',
                promptOptimization: 'server-default'
            }
        );
    });

    it('normalizes Responses SSE strategy when the backend field uses Images API', () => {
        assert.deepEqual(
            normalizeImageUpstreamRuntimeFields(
                {
                    image_backend: 'images-api',
                    streaming_strategy: 'responses-sse',
                    responsesModel: 'stale-model',
                    thinking: 'high',
                    promptOptimization: 'on'
                },
                { allowResponsesImageBackend: true }
            ),
            {
                image_backend: 'images-api',
                streaming_strategy: 'server-default',
                responsesModel: '',
                thinking: 'server-default',
                promptOptimization: 'server-default'
            }
        );
    });

    it('normalizes Images API SSE strategies when the backend field uses Responses', () => {
        assert.deepEqual(
            normalizeImageUpstreamRuntimeFields(
                {
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'openai-sse',
                    responsesModel: 'gpt-5.4',
                    thinking: 'high',
                    promptOptimization: 'on'
                },
                { allowResponsesImageBackend: true }
            ),
            {
                image_backend: 'responses-image-generation',
                streaming_strategy: 'server-default',
                responsesModel: 'gpt-5.4',
                thinking: 'high',
                promptOptimization: 'on'
            }
        );
    });
});
