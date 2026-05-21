import { normalizeUpstreamImageStreamEventWithDiagnostics } from './image-stream-events';
import type OpenAI from 'openai';

type ImageUsage = OpenAI.Images.ImagesResponse['usage'];

export class MissingFinalImageStreamResultError extends Error {
    readonly status = 502;

    constructor() {
        super('流式图片响应未返回最终图片 b64_json。');
        this.name = 'MissingFinalImageStreamResultError';
    }
}

export async function collectOpenAiImagesFromStream(
    stream: AsyncIterable<unknown>
): Promise<OpenAI.Images.ImagesResponse> {
    const data: Array<{ b64_json: string }> = [];
    let usage: ImageUsage | undefined;

    for await (const event of stream) {
        const diagnostics = normalizeUpstreamImageStreamEventWithDiagnostics(event);
        for (const normalizedEvent of diagnostics.events) {
            if (normalizedEvent.type === 'completed') {
                data.push({ b64_json: normalizedEvent.b64Json });
                if (normalizedEvent.usage) {
                    usage = normalizedEvent.usage;
                }
            }
        }
    }

    if (data.length === 0) {
        throw new MissingFinalImageStreamResultError();
    }

    return {
        created: Math.floor(Date.now() / 1000),
        data,
        ...(usage ? { usage } : {})
    };
}
