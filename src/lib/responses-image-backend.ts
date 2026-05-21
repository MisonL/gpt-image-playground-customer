import { asRecord } from './json-record';
import type OpenAI from 'openai';

type ImageUsage = OpenAI.Images.ImagesResponse['usage'];

type ResponsesCreateClient = {
    create(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<{
        output?: unknown[];
        usage?: unknown;
    }>;
    create(params: OpenAI.Responses.ResponseCreateParamsStreaming): Promise<AsyncIterable<unknown>>;
};

export type ResponsesImageGenerateInput = {
    responses: ResponsesCreateClient;
    prompt: string;
    responsesModel: string;
    imageModel: string;
    size: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
    quality: 'low' | 'medium' | 'high' | 'auto';
    outputFormat: 'png' | 'webp' | 'jpeg';
    background: 'transparent' | 'opaque' | 'auto';
    moderation: 'auto' | 'low';
    outputCompression?: number;
};

export type ResponsesImageStreamInput = ResponsesImageGenerateInput & {
    partialImagesCount: 1 | 2 | 3;
};

class ResponsesImageGenerationError extends Error {
    readonly status = 502;

    constructor(message: string) {
        super(message);
        this.name = 'ResponsesImageGenerationError';
    }
}

function extractBase64FromDataUrl(value: string): string | undefined {
    if (!value.startsWith('data:')) return undefined;
    const separator = value.indexOf(',');
    if (separator < 0) return undefined;
    const payload = value.slice(separator + 1).trim();
    return payload || undefined;
}

function isRemoteHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function readImageGenerationResultBase64(value: string): string | undefined {
    const normalized = value.trim();
    if (!normalized) return undefined;
    const dataUrlPayload = extractBase64FromDataUrl(normalized);
    if (dataUrlPayload) return dataUrlPayload;
    if (isRemoteHttpUrl(normalized)) return undefined;
    return normalized;
}

function readCompletedImageRecordBase64(record: Record<string, unknown>): string | undefined {
    if (typeof record.result === 'string') {
        const resultBase64 = readImageGenerationResultBase64(record.result);
        if (resultBase64) return resultBase64;
    }
    if (typeof record.url === 'string') {
        return extractBase64FromDataUrl(record.url);
    }
    return undefined;
}

function extractCompletedImageResults(output: unknown[] | undefined): string[] {
    if (!Array.isArray(output)) {
        return [];
    }

    return output.flatMap((item) => {
        const record = asRecord(item);
        if (!record || record.type !== 'image_generation_call') {
            return [];
        }
        if (record.status === 'failed') {
            return [];
        }
        const b64Json = readCompletedImageRecordBase64(record);
        return b64Json ? [b64Json] : [];
    });
}

function readResponseImageError(record: Record<string, unknown>): string | undefined {
    const error = asRecord(record.error);
    if (error) {
        if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
        if (typeof error.code === 'string' && error.code.trim()) return error.code.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
    return undefined;
}

function readFailedImageGenerationCallMessage(output: unknown[] | undefined): string | undefined {
    if (!Array.isArray(output)) return undefined;
    for (const item of output) {
        const record = asRecord(item);
        if (!record || record.type !== 'image_generation_call' || record.status !== 'failed') continue;
        return readResponseImageError(record) || '上游未提供错误信息。';
    }
    return undefined;
}

function hasRemoteOnlyCompletedImageResult(output: unknown[] | undefined): boolean {
    if (!Array.isArray(output)) return false;
    return output.some((item) => {
        const record = asRecord(item);
        if (!record) return false;
        return (
            record.type === 'image_generation_call' &&
            record.status !== 'failed' &&
            ((typeof record.result === 'string' && isRemoteHttpUrl(record.result.trim())) ||
                (typeof record.url === 'string' && isRemoteHttpUrl(record.url.trim()))) &&
            !readCompletedImageRecordBase64(record)
        );
    });
}

function buildResponsesImageTool(
    input: ResponsesImageGenerateInput,
    partialImagesCount?: 1 | 2 | 3
): OpenAI.Responses.Tool {
    return {
        type: 'image_generation',
        action: 'generate',
        model: input.imageModel,
        size: input.size,
        quality: input.quality,
        output_format: input.outputFormat,
        background: input.background,
        moderation: input.moderation,
        ...(input.outputCompression !== undefined ? { output_compression: input.outputCompression } : {}),
        ...(partialImagesCount !== undefined ? { partial_images: partialImagesCount } : {})
    };
}

export async function generateImageWithResponsesBackend(
    input: ResponsesImageGenerateInput
): Promise<OpenAI.Images.ImagesResponse> {
    const response = await input.responses.create({
        model: input.responsesModel,
        input: input.prompt,
        stream: false,
        tool_choice: { type: 'image_generation' },
        tools: [buildResponsesImageTool(input)]
    });
    const imageResults = extractCompletedImageResults(response.output);

    if (imageResults.length === 0) {
        const failedMessage = readFailedImageGenerationCallMessage(response.output);
        if (failedMessage) {
            throw new ResponsesImageGenerationError(`Responses API image_generation_call 失败：${failedMessage}`);
        }
        if (hasRemoteOnlyCompletedImageResult(response.output)) {
            throw new ResponsesImageGenerationError(
                'Responses API 只返回远程图片 URL，缺少可保存的 image_generation_call.result base64 数据。'
            );
        }
        throw new ResponsesImageGenerationError('Responses API 未返回已完成的 image_generation_call.result。');
    }

    return {
        created: Math.floor(Date.now() / 1000),
        data: imageResults.map((b64Json) => ({ b64_json: b64Json })),
        ...(response.usage ? { usage: response.usage as ImageUsage } : {})
    };
}

export async function createResponsesImageStream(input: ResponsesImageStreamInput): Promise<AsyncIterable<unknown>> {
    return input.responses.create({
        model: input.responsesModel,
        input: input.prompt,
        stream: true,
        tool_choice: { type: 'image_generation' },
        tools: [buildResponsesImageTool(input, input.partialImagesCount)]
    });
}
