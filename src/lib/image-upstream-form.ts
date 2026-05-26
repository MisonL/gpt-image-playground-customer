import type { ImageGenerationBackend, ImageStreamingStrategy } from './image-upstream-strategy';

export const IMAGE_UPSTREAM_FORM_SERVER_DEFAULT = 'server-default';

export type ImageUpstreamFormBackend = ImageGenerationBackend | typeof IMAGE_UPSTREAM_FORM_SERVER_DEFAULT;
export type ImageUpstreamFormStreamingStrategy =
    | ImageStreamingStrategy
    | typeof IMAGE_UPSTREAM_FORM_SERVER_DEFAULT;

export function appendImageUpstreamOverrideFields(
    formData: FormData,
    input: {
        imageBackend: ImageUpstreamFormBackend;
        streamingStrategy: ImageUpstreamFormStreamingStrategy;
        responsesModel: string;
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
}
