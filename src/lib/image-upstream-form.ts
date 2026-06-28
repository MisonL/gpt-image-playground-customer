import type { ImageGenerationBackend, ImageStreamingStrategy } from './image-upstream-strategy';

export const IMAGE_UPSTREAM_FORM_SERVER_DEFAULT = 'server-default';

export type ImageUpstreamFormBackend = ImageGenerationBackend | typeof IMAGE_UPSTREAM_FORM_SERVER_DEFAULT;
export type ImageUpstreamFormStreamingStrategy = ImageStreamingStrategy | typeof IMAGE_UPSTREAM_FORM_SERVER_DEFAULT;
export type ImageUpstreamFormThinking =
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | typeof IMAGE_UPSTREAM_FORM_SERVER_DEFAULT;
export type ImageUpstreamFormPromptOptimization = 'on' | 'off' | typeof IMAGE_UPSTREAM_FORM_SERVER_DEFAULT;
export type ImageUpstreamRouteImpactKey =
    | 'upstream.backendImpactImages'
    | 'upstream.backendImpactResponses'
    | 'upstream.backendImpactServerDefault'
    | 'upstream.backendResponsesUnavailable'
    | 'upstream.routeImpactMixedProfile'
    | 'upstream.strategyImpactAuto'
    | 'upstream.strategyImpactOff'
    | 'upstream.strategyImpactSse'
    | 'upstream.strategyImpactForceSse'
    | 'upstream.routeImpactCost';

export type ImageUpstreamRuntimeFields = {
    image_backend: ImageUpstreamFormBackend;
    streaming_strategy: ImageUpstreamFormStreamingStrategy;
    responsesModel: string;
    thinking: ImageUpstreamFormThinking;
    promptOptimization: ImageUpstreamFormPromptOptimization;
};

export function isResponsesImageBackendRuntimeEnabled(input: {
    responsesImageBackend?: { enabled?: boolean } | null;
}): boolean {
    return input.responsesImageBackend?.enabled === true;
}

export function shouldBlockExplicitResponsesRequest(input: {
    imageBackend: ImageUpstreamFormBackend;
    allowResponsesImageBackend: boolean;
}): boolean {
    return input.imageBackend === 'responses-image-generation' && !input.allowResponsesImageBackend;
}

export function shouldBlockResponsesRequestWithoutModel(input: {
    imageBackend: ImageUpstreamFormBackend;
    responsesModel: string;
    hasDefaultResponsesModel: boolean;
}): boolean {
    if (input.imageBackend !== 'responses-image-generation') return false;
    if (input.hasDefaultResponsesModel) return false;
    return input.responsesModel.trim().length === 0;
}

export function shouldAllowResponsesHistoryRoute(input: {
    runtimeCapabilitiesAvailable: boolean;
    allowResponsesImageBackend: boolean;
}): boolean {
    return !input.runtimeCapabilitiesAvailable || input.allowResponsesImageBackend;
}

export function resolveImageUpstreamEffectiveStreamingStrategy(input: {
    streamingStrategy: ImageUpstreamFormStreamingStrategy;
    defaultStreamingStrategy: ImageStreamingStrategy;
}): ImageStreamingStrategy {
    return input.streamingStrategy === IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
        ? input.defaultStreamingStrategy
        : input.streamingStrategy;
}

export function getImageUpstreamRouteImpactKeys(input: {
    backend: ImageUpstreamFormBackend;
    streamingStrategy: ImageUpstreamFormStreamingStrategy;
    defaultStreamingStrategy: ImageStreamingStrategy;
    allowResponsesImageBackend: boolean;
    serverProfileMixed?: boolean;
}): ImageUpstreamRouteImpactKey[] {
    const backendKey =
        input.backend === 'images-api'
            ? 'upstream.backendImpactImages'
            : input.backend === 'responses-image-generation'
              ? 'upstream.backendImpactResponses'
              : 'upstream.backendImpactServerDefault';
    const effectiveStreamingStrategy = resolveImageUpstreamEffectiveStreamingStrategy({
        streamingStrategy: input.streamingStrategy,
        defaultStreamingStrategy: input.defaultStreamingStrategy
    });
    const strategyKey =
        effectiveStreamingStrategy === 'off'
            ? 'upstream.strategyImpactOff'
            : effectiveStreamingStrategy === 'force-sse'
              ? 'upstream.strategyImpactForceSse'
              : effectiveStreamingStrategy === 'auto'
                ? 'upstream.strategyImpactAuto'
                : 'upstream.strategyImpactSse';
    const keys: ImageUpstreamRouteImpactKey[] = [backendKey];
    if (!input.allowResponsesImageBackend) {
        keys.push('upstream.backendResponsesUnavailable');
    }
    if (input.serverProfileMixed) {
        keys.push('upstream.routeImpactMixedProfile');
    }
    keys.push(strategyKey, 'upstream.routeImpactCost');
    return keys;
}

export function isImageUpstreamStreamingStrategySelectable(input: {
    imageBackend: ImageUpstreamFormBackend;
    streamingStrategy: ImageUpstreamFormStreamingStrategy;
    allowResponsesImageBackend: boolean;
}): boolean {
    if (input.streamingStrategy === 'responses-sse') {
        return input.allowResponsesImageBackend && input.imageBackend === 'responses-image-generation';
    }
    if (
        input.imageBackend === 'responses-image-generation' &&
        (input.streamingStrategy === 'openai-sse' || input.streamingStrategy === 'newapi-keepalive-sse')
    ) {
        return false;
    }
    return true;
}

export function normalizeImageUpstreamRuntimeFields<T extends ImageUpstreamRuntimeFields>(
    fields: T,
    input: { allowResponsesImageBackend: boolean }
): T {
    const resetResponsesBackend =
        !input.allowResponsesImageBackend && fields.image_backend === 'responses-image-generation';
    const nextImageBackend = resetResponsesBackend ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : fields.image_backend;
    const resetResponsesStreaming = !isImageUpstreamStreamingStrategySelectable({
        imageBackend: nextImageBackend,
        streamingStrategy: fields.streaming_strategy,
        allowResponsesImageBackend: input.allowResponsesImageBackend
    });

    if (!resetResponsesBackend && !resetResponsesStreaming) {
        return fields;
    }
    const resetResponsesOptions = nextImageBackend !== 'responses-image-generation';
    return {
        ...fields,
        image_backend: nextImageBackend,
        streaming_strategy: resetResponsesStreaming ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : fields.streaming_strategy,
        responsesModel: resetResponsesOptions ? '' : fields.responsesModel,
        thinking: resetResponsesOptions ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : fields.thinking,
        promptOptimization: resetResponsesOptions ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : fields.promptOptimization
    };
}

export function appendImageUpstreamOverrideFields(
    formData: FormData,
    input: {
        imageBackend: ImageUpstreamFormBackend;
        streamingStrategy: ImageUpstreamFormStreamingStrategy;
        responsesModel: string;
        thinking: ImageUpstreamFormThinking;
        promptOptimization: ImageUpstreamFormPromptOptimization;
        forceWeb: boolean;
    }
): void {
    if (input.imageBackend !== IMAGE_UPSTREAM_FORM_SERVER_DEFAULT) {
        formData.append('image_backend', input.imageBackend);
    }
    if (input.streamingStrategy !== IMAGE_UPSTREAM_FORM_SERVER_DEFAULT) {
        formData.append('image_streaming_strategy', input.streamingStrategy);
    }
    const responsesModel = input.responsesModel.trim();
    if (input.imageBackend === 'responses-image-generation' && responsesModel) {
        formData.append('responsesModel', responsesModel);
    }
    if (input.imageBackend === 'responses-image-generation' && input.thinking !== IMAGE_UPSTREAM_FORM_SERVER_DEFAULT) {
        formData.append('thinking', input.thinking);
    }
    if (
        input.imageBackend === 'responses-image-generation' &&
        input.promptOptimization !== IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    ) {
        formData.append('promptOptimization', input.promptOptimization === 'on' ? 'true' : 'false');
    }
    if (input.imageBackend === 'images-api' && input.forceWeb) {
        formData.append('force_web', 'true');
    }
}
