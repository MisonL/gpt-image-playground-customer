import { AgentApiError } from './api-error-response';
import type { ChannelCredential } from './channel-router';
import { RequestValidationError } from './image-request-utils';
import {
    isStreamingChannelRequestMode,
    resolveChannelRequestMode,
    type ChannelRequestMode,
    type ChannelRequestModeBackend,
    type ChannelRequestModeDecision
} from './channel-request-mode';
import { resolveImageStreamEnabled, type ImageStreamMode, type ImageStreamingStrategy } from './image-upstream-strategy';
import { readAffinityKey } from './server-runtime';
import type { getServerChannelState } from './server-channel-router';

export type AgentChannelRequestModePlan = {
    imageBackend: ChannelRequestModeBackend;
    preferred: ChannelRequestMode;
    fallback?: ChannelRequestMode;
};

export type AgentChannelSelection = {
    selectedCredential?: ChannelCredential;
    requestMode?: ChannelRequestMode;
    fallbackApplied: boolean;
    noChannelReason?: string;
};

export function createAgentChannelRequestModePlan(input: {
    imageBackend: ChannelRequestModeBackend;
    streamMode: ImageStreamMode;
    streamingStrategy: ImageStreamingStrategy;
}): AgentChannelRequestModePlan {
    const preferred = resolveChannelRequestMode({
        imageBackend: input.imageBackend,
        streamEnabled: resolveStaticAgentStreamEnabled(input)
    });
    if (input.streamMode !== 'auto' || !isStreamingChannelRequestMode(preferred)) {
        return { imageBackend: input.imageBackend, preferred };
    }
    return {
        imageBackend: input.imageBackend,
        preferred,
        fallback: resolveChannelRequestMode({ imageBackend: input.imageBackend, streamEnabled: false })
    };
}

export function selectAgentChannelCredential(input: {
    router: ReturnType<typeof getServerChannelState>['router'];
    headers: Headers;
    requestModePlan?: AgentChannelRequestModePlan;
}): AgentChannelSelection {
    if (!input.requestModePlan) {
        return {
            selectedCredential: input.router?.select({ affinityKey: readAffinityKey(input.headers) }),
            fallbackApplied: false
        };
    }

    try {
        return selectAgentChannelForMode(input, input.requestModePlan.preferred, false);
    } catch (error) {
        if (!input.requestModePlan.fallback || !(error instanceof RequestValidationError)) {
            throw normalizeChannelSelectionError(error, input.requestModePlan, false);
        }
        try {
            return selectAgentChannelForMode(input, input.requestModePlan.fallback, true);
        } catch (fallbackError) {
            throw normalizeChannelSelectionError(fallbackError, input.requestModePlan, true);
        }
    }
}

export function buildAgentChannelRequestModeDecision(input: {
    requestModePlan?: AgentChannelRequestModePlan;
    selection: AgentChannelSelection;
    selectedCredential?: ChannelCredential;
    upstreamHost?: string;
}): ChannelRequestModeDecision {
    const selectedChannelId = input.selectedCredential?.channelId ?? input.selection.selectedCredential?.channelId;
    return {
        requested_backend: input.requestModePlan?.imageBackend ?? 'images-api',
        ...(input.requestModePlan?.preferred
            ? { preferred_channel_request_mode: input.requestModePlan.preferred }
            : {}),
        ...(input.requestModePlan?.fallback
            ? { fallback_channel_request_mode: input.requestModePlan.fallback }
            : {}),
        ...(input.selection.requestMode
            ? { selected_channel_request_mode: input.selection.requestMode }
            : {}),
        fallback_applied: input.selection.fallbackApplied,
        ...(selectedChannelId ? { selected_channel_id: selectedChannelId } : {}),
        ...(input.upstreamHost ? { upstream_host: input.upstreamHost } : {}),
        ...(input.selection.noChannelReason ? { no_channel_reason: input.selection.noChannelReason } : {})
    };
}

function resolveStaticAgentStreamEnabled(input: {
    imageBackend: ChannelRequestModeBackend;
    streamMode: ImageStreamMode;
    streamingStrategy: ImageStreamingStrategy;
}): boolean {
    if (input.streamMode === 'non_stream') return false;
    if (input.streamMode === 'auto' && input.streamingStrategy === 'off') return false;
    return resolveImageStreamEnabled({
        imageBackend: input.imageBackend,
        requestedStream: true,
        streamingStrategy: input.streamingStrategy
    });
}

function selectAgentChannelForMode(
    input: {
        router: ReturnType<typeof getServerChannelState>['router'];
        headers: Headers;
    },
    requestMode: ChannelRequestMode,
    fallbackApplied: boolean
): AgentChannelSelection {
    return {
        selectedCredential: input.router?.select({
            affinityKey: readAffinityKey(input.headers),
            requestMode
        }),
        requestMode,
        fallbackApplied
    };
}

function normalizeChannelSelectionError(
    error: unknown,
    requestModePlan: AgentChannelRequestModePlan,
    fallbackApplied: boolean
): unknown {
    if (!(error instanceof RequestValidationError)) {
        return error;
    }
    const requestMode = fallbackApplied ? requestModePlan.fallback ?? requestModePlan.preferred : requestModePlan.preferred;
    return new AgentApiError({
        code: error.status >= 500 ? 'configuration_error' : 'validation_error',
        message: error.message,
        status: error.status,
        retryable: false,
        details: error.details,
        diagnostics: {
            channel_request_mode: requestMode,
            channel_request_mode_fallback_applied: fallbackApplied,
            route_decision: buildAgentChannelRequestModeDecision({
                requestModePlan,
                selection: {
                    requestMode,
                    fallbackApplied,
                    noChannelReason: error.message
                }
            })
        }
    });
}
