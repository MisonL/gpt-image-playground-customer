import { IMAGE_UPSTREAM_FORM_SERVER_DEFAULT, type ImageUpstreamFormBackend } from './image-upstream-form';
import type { ImageGenerationBackend, ImageStreamMode, ImageStreamingStrategy } from './image-upstream-strategy';

type RuntimeRequestMode = 'images-non-stream' | 'images-sse' | 'responses-non-stream' | 'responses-sse';

export type RuntimeHealthStatus = 'runtime-ready' | 'route-limited' | 'disconnected' | 'custom-override';

export type RuntimeHealthCapabilities = {
    streaming?: {
        defaultBackend?: ImageGenerationBackend | null;
    } | null;
    responsesImageBackend?: {
        enabled?: boolean | null;
    } | null;
    channelRouting?: {
        effectiveRequestModes?: readonly string[] | null;
        requestModeHealth?: Array<{
            mode: string;
            healthyCredentialCount: number;
            healthyChannelCount: number;
        }> | null;
    } | null;
};

function resolveRequestedBackend(input: {
    runtimeCapabilities: RuntimeHealthCapabilities | null;
    imageBackend: ImageUpstreamFormBackend;
}): ImageGenerationBackend {
    if (input.imageBackend !== IMAGE_UPSTREAM_FORM_SERVER_DEFAULT) {
        return input.imageBackend;
    }
    return input.runtimeCapabilities?.streaming?.defaultBackend === 'responses-image-generation'
        ? 'responses-image-generation'
        : 'images-api';
}

function resolvePreferredRequestMode(input: {
    runtimeCapabilities: RuntimeHealthCapabilities | null;
    imageBackend: ImageUpstreamFormBackend;
    streamingStrategy: ImageStreamingStrategy;
    streamMode: ImageStreamMode;
}): RuntimeRequestMode {
    const backend = resolveRequestedBackend({
        runtimeCapabilities: input.runtimeCapabilities,
        imageBackend: input.imageBackend
    });
    const streamEnabled = input.streamMode === 'stream' || (input.streamMode === 'auto' && input.streamingStrategy !== 'off');
    if (backend === 'responses-image-generation') {
        return streamEnabled ? 'responses-sse' : 'responses-non-stream';
    }
    return streamEnabled ? 'images-sse' : 'images-non-stream';
}

function resolveFallbackRequestMode(input: {
    runtimeCapabilities: RuntimeHealthCapabilities | null;
    imageBackend: ImageUpstreamFormBackend;
    streamingStrategy: ImageStreamingStrategy;
    streamMode: ImageStreamMode;
}): RuntimeRequestMode | null {
    if (input.streamMode !== 'auto' || input.streamingStrategy === 'off') return null;
    const backend = resolveRequestedBackend({
        runtimeCapabilities: input.runtimeCapabilities,
        imageBackend: input.imageBackend
    });
    return backend === 'responses-image-generation' ? 'responses-non-stream' : 'images-non-stream';
}

function hasHealthyRequestMode(
    runtimeCapabilities: RuntimeHealthCapabilities | null,
    requestMode: RuntimeRequestMode
): boolean {
    const healthItems = runtimeCapabilities?.channelRouting?.requestModeHealth;
    if (Array.isArray(healthItems)) {
        const healthItem = healthItems.find((item) => item.mode === requestMode);
        if (healthItem) {
            return healthItem.healthyCredentialCount > 0 && healthItem.healthyChannelCount > 0;
        }
    }
    return runtimeCapabilities?.channelRouting?.effectiveRequestModes?.includes(requestMode) === true;
}

export function resolveRuntimeHealthStatus(input: {
    runtimeCapabilities: RuntimeHealthCapabilities | null;
    hasPairedRequestApiOverride: boolean;
    imageBackend: ImageUpstreamFormBackend;
    streamingStrategy: ImageStreamingStrategy;
    streamMode: ImageStreamMode;
}): RuntimeHealthStatus {
    if (input.hasPairedRequestApiOverride) return 'custom-override';
    if (input.runtimeCapabilities === null) return 'disconnected';
    const requestedBackend = resolveRequestedBackend({
        runtimeCapabilities: input.runtimeCapabilities,
        imageBackend: input.imageBackend
    });
    if (
        requestedBackend === 'responses-image-generation' &&
        input.runtimeCapabilities.responsesImageBackend?.enabled !== true
    ) {
        return 'route-limited';
    }
    const preferredRequestMode = resolvePreferredRequestMode(input);
    if (hasHealthyRequestMode(input.runtimeCapabilities, preferredRequestMode)) {
        return 'runtime-ready';
    }
    const fallbackRequestMode = resolveFallbackRequestMode(input);
    if (fallbackRequestMode && hasHealthyRequestMode(input.runtimeCapabilities, fallbackRequestMode)) {
        return 'runtime-ready';
    }
    return 'route-limited';
}
