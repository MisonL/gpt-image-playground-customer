import { AgentApiError } from './api-error-response';
import {
    isStreamingChannelRequestMode,
    resolveChannelRequestMode,
    type ChannelRequestMode,
    type ChannelRequestModeBackend,
    type ChannelRequestModeDecision
} from './channel-request-mode';
import type { ChannelCredential } from './channel-router';
import { RequestValidationError } from './image-request-utils';
import {
    resolveImageStreamEnabled,
    type ImageStreamMode,
    type ImageStreamingStrategy
} from './image-upstream-strategy';
import type { getServerChannelState } from './server-channel-router';
import { readAffinityKey } from './server-runtime';

export type AgentChannelRequestModePlan = {
    imageBackend: ChannelRequestModeBackend;
    preferred: ChannelRequestMode;
    fallback?: ChannelRequestMode;
    candidates: readonly ChannelRequestMode[];
};

export type AgentChannelSelection = {
    selectedCredential?: ChannelCredential;
    requestMode: ChannelRequestMode;
    preferredRequestMode?: ChannelRequestMode;
    requestModePriority?: readonly ChannelRequestMode[];
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
        return { imageBackend: input.imageBackend, preferred, candidates: [preferred] };
    }
    if (input.streamingStrategy !== 'auto') {
        return { imageBackend: input.imageBackend, preferred, candidates: [preferred] };
    }
    const fallback = resolveChannelRequestMode({ imageBackend: input.imageBackend, streamEnabled: false });
    return {
        imageBackend: input.imageBackend,
        preferred: fallback,
        fallback: preferred,
        candidates: [fallback, preferred]
    };
}

export function selectAgentChannelCredential(input: {
    router: ReturnType<typeof getServerChannelState>['router'];
    headers: Headers;
    requestModePlan: AgentChannelRequestModePlan;
}): AgentChannelSelection {
    if (input.requestModePlan.candidates.length > 1 && input.router) {
        try {
            const selection = input.router.selectWithRequestModes({
                affinityKey: readAffinityKey(input.headers),
                requestModes: input.requestModePlan.candidates
            });
            return {
                selectedCredential: selection.credential,
                requestMode: selection.requestMode,
                preferredRequestMode: selection.preferredRequestMode,
                requestModePriority: selection.requestModePriority,
                fallbackApplied: selection.requestMode !== selection.preferredRequestMode
            };
        } catch (error) {
            throw normalizeChannelSelectionError(error, input.requestModePlan, false);
        }
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
    requestModePlan: AgentChannelRequestModePlan;
    selection: AgentChannelSelection;
    selectedCredential?: ChannelCredential;
    upstreamHost?: string;
}): ChannelRequestModeDecision {
    const selectedChannelId = input.selectedCredential?.channelId ?? input.selection.selectedCredential?.channelId;
    const preferredRequestMode = input.selection.preferredRequestMode ?? input.requestModePlan.preferred;
    const requestModePriority = input.selection.requestModePriority ?? [
        preferredRequestMode,
        ...input.requestModePlan.candidates.filter((mode) => mode !== preferredRequestMode)
    ];
    const fallbackRequestMode = input.requestModePlan.candidates.find((mode) => mode !== preferredRequestMode);
    return {
        requested_backend: input.requestModePlan.imageBackend,
        candidate_channel_request_modes: input.requestModePlan.candidates,
        request_mode_priority: requestModePriority,
        preferred_channel_request_mode: preferredRequestMode,
        ...(fallbackRequestMode ? { fallback_channel_request_mode: fallbackRequestMode } : {}),
        selected_channel_request_mode: input.selection.requestMode,
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
        preferredRequestMode: requestMode,
        requestModePriority: [requestMode],
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
    const requestMode = fallbackApplied
        ? (requestModePlan.fallback ?? requestModePlan.preferred)
        : requestModePlan.preferred;
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
