import type OpenAI from 'openai';

type ImageUsage = OpenAI.Images.ImagesResponse['usage'];
type JsonRecord = Record<string, unknown>;

type ResponsesCreateClient = {
    create(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<{
        output?: unknown[];
        usage?: unknown;
    }>;
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

function asRecord(value: unknown): JsonRecord | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    return value as JsonRecord;
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
        if (record.status !== 'completed' || typeof record.result !== 'string' || !record.result.trim()) {
            return [];
        }
        return [record.result.trim()];
    });
}

export async function generateImageWithResponsesBackend(
    input: ResponsesImageGenerateInput
): Promise<OpenAI.Images.ImagesResponse> {
    const imageTool: OpenAI.Responses.Tool = {
        type: 'image_generation',
        action: 'generate',
        model: input.imageModel,
        size: input.size,
        quality: input.quality,
        output_format: input.outputFormat,
        background: input.background,
        moderation: input.moderation,
        ...(input.outputCompression !== undefined ? { output_compression: input.outputCompression } : {})
    };
    const response = await input.responses.create({
        model: input.responsesModel,
        input: input.prompt,
        stream: false,
        tool_choice: { type: 'image_generation' },
        tools: [imageTool]
    });
    const imageResults = extractCompletedImageResults(response.output);

    if (imageResults.length === 0) {
        throw new Error('Responses API 未返回已完成的 image_generation_call.result。');
    }

    return {
        created: Math.floor(Date.now() / 1000),
        data: imageResults.map((b64Json) => ({ b64_json: b64Json })),
        ...(response.usage ? { usage: response.usage as ImageUsage } : {})
    };
}
