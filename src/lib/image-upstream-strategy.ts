import { RequestValidationError } from './image-request-utils';

export type ImageGenerationBackend = 'images-api' | 'responses-image-generation';

export type ImageStreamingStrategy =
    | 'off'
    | 'auto'
    | 'openai-sse'
    | 'newapi-keepalive-sse'
    | 'responses-sse'
    | 'force-sse';

type ImageUpstreamEnv = Partial<NodeJS.ProcessEnv>;

const IMAGE_BACKEND_ALIASES: Record<string, ImageGenerationBackend> = {
    images: 'images-api',
    'images-api': 'images-api',
    responses: 'responses-image-generation',
    'responses-image-generation': 'responses-image-generation'
};

const VALID_STREAMING_STRATEGIES = new Set<ImageStreamingStrategy>([
    'off',
    'auto',
    'openai-sse',
    'newapi-keepalive-sse',
    'responses-sse',
    'force-sse'
]);

export class ImageUpstreamConfigurationError extends Error {
    readonly status = 500;

    constructor(message: string) {
        super(message);
        this.name = 'ImageUpstreamConfigurationError';
    }
}

function readStringField(formData: FormData, ...fields: string[]): string | undefined {
    for (const field of fields) {
        const value = formData.get(field);
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
}

function readStringEnv(env: ImageUpstreamEnv, key: 'IMAGE_GENERATION_BACKEND' | 'IMAGE_STREAMING_STRATEGY'): string | undefined {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return undefined;
}

function readBackendValue(value: string, source: 'request' | 'env'): ImageGenerationBackend {
    const backend = IMAGE_BACKEND_ALIASES[value];
    if (backend) {
        return backend;
    }
    const message = 'imageBackend 必须是 images-api、responses-image-generation、images 或 responses。';
    if (source === 'env') {
        throw new ImageUpstreamConfigurationError(`服务端 IMAGE_GENERATION_BACKEND 配置无效：${message}`);
    }
    throw new RequestValidationError(message, 400);
}

export function parseImageGenerationBackendValue(value: string): ImageGenerationBackend {
    return readBackendValue(value.trim(), 'request');
}

function readStreamingStrategyValue(value: string, source: 'request' | 'env'): ImageStreamingStrategy {
    if (VALID_STREAMING_STRATEGIES.has(value as ImageStreamingStrategy)) {
        return value as ImageStreamingStrategy;
    }
    const message = '图片流式兼容模式必须是 off、auto、openai-sse、newapi-keepalive-sse、responses-sse 或 force-sse。';
    if (source === 'env') {
        throw new ImageUpstreamConfigurationError(`服务端 IMAGE_STREAMING_STRATEGY 配置无效：${message}`);
    }
    throw new RequestValidationError(message, 400);
}

export function parseImageStreamingStrategyValue(value: string): ImageStreamingStrategy {
    return readStreamingStrategyValue(value.trim(), 'request');
}

export function readImageGenerationBackend(
    formData: FormData,
    env: ImageUpstreamEnv = process.env,
    options: { useEnvDefault?: boolean } = {}
): ImageGenerationBackend {
    const requestValue = readStringField(formData, 'image_backend', 'imageBackend');
    if (requestValue) {
        return readBackendValue(requestValue, 'request');
    }
    if (options.useEnvDefault === false) {
        return 'images-api';
    }
    const envValue = readStringEnv(env, 'IMAGE_GENERATION_BACKEND');
    return envValue ? readBackendValue(envValue, 'env') : 'images-api';
}

export function readImageStreamingStrategy(
    formData: FormData,
    env: ImageUpstreamEnv = process.env
): ImageStreamingStrategy {
    const requestValue = readStringField(formData, 'image_streaming_strategy', 'imageStreamingStrategy');
    if (requestValue) {
        return readStreamingStrategyValue(requestValue, 'request');
    }
    const envValue = readStringEnv(env, 'IMAGE_STREAMING_STRATEGY');
    return envValue ? readStreamingStrategyValue(envValue, 'env') : 'auto';
}

export function resolveImageStreamEnabled(input: {
    imageBackend: ImageGenerationBackend;
    requestedStream: boolean;
    streamingStrategy: ImageStreamingStrategy;
}): boolean {
    if (input.streamingStrategy === 'off') {
        if (input.requestedStream) {
            throw new RequestValidationError('当前图片流式兼容模式已关闭，不能发送 stream 请求。', 400);
        }
        return false;
    }

    const streamEnabled = input.requestedStream || input.streamingStrategy === 'force-sse';
    if (!streamEnabled) return false;

    if (input.imageBackend === 'images-api' && input.streamingStrategy === 'responses-sse') {
        throw new RequestValidationError('Images API 后端不能使用 responses-sse 流式兼容模式。', 400);
    }

    if (
        input.imageBackend === 'responses-image-generation' &&
        (input.streamingStrategy === 'openai-sse' || input.streamingStrategy === 'newapi-keepalive-sse')
    ) {
        throw new RequestValidationError('Responses image_generation 后端不能使用 Images API SSE 流式兼容模式。', 400);
    }

    return true;
}

export function shouldRecommendImageStreaming(input: {
    streamingStrategy: ImageStreamingStrategy;
    quality: 'low' | 'medium' | 'high' | 'auto';
    width: number;
    height: number;
    streamEnabled: boolean;
}): boolean {
    if (input.streamEnabled || input.streamingStrategy !== 'auto' || input.quality !== 'high') {
        return false;
    }
    return Math.max(input.width, input.height) >= 3072;
}
