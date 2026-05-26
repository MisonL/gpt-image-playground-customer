import { normalizeUpstreamImageStreamEventWithDiagnostics } from './image-stream-events';
import type OpenAI from 'openai';

type ImageUsage = OpenAI.Images.ImagesResponse['usage'];

export class MissingFinalImageStreamResultError extends Error {
    readonly status = 502;
    readonly upstreamEventType?: string;
    readonly partialImageCount: number;

    constructor(options: { upstreamEventType?: string; partialImageCount: number }) {
        super('流式图片响应未返回最终图片 b64_json。');
        this.name = 'MissingFinalImageStreamResultError';
        this.upstreamEventType = options.upstreamEventType;
        this.partialImageCount = options.partialImageCount;
    }
}

export async function collectOpenAiImagesFromStream(
    stream: AsyncIterable<unknown>
): Promise<OpenAI.Images.ImagesResponse> {
    const data: Array<{ b64_json: string }> = [];
    const seenCompletedKeys = new Set<string>();
    let usage: ImageUsage | undefined;
    let upstreamEventType: string | undefined;
    let partialImageCount = 0;

    for await (const event of stream) {
        const diagnostics = normalizeUpstreamImageStreamEventWithDiagnostics(event);
        upstreamEventType = diagnostics.upstreamEventType ?? upstreamEventType;
        for (const normalizedEvent of diagnostics.events) {
            if (normalizedEvent.type === 'partial_image') {
                partialImageCount += 1;
            }
            if (normalizedEvent.type === 'completed') {
                if (normalizedEvent.dedupeKey && seenCompletedKeys.has(normalizedEvent.dedupeKey)) {
                    if (normalizedEvent.usage) {
                        usage = normalizedEvent.usage;
                    }
                    continue;
                }
                data.push({ b64_json: normalizedEvent.b64Json });
                if (normalizedEvent.dedupeKey) {
                    seenCompletedKeys.add(normalizedEvent.dedupeKey);
                }
                if (normalizedEvent.usage) {
                    usage = normalizedEvent.usage;
                }
            }
        }
    }

    if (data.length === 0) {
        throw new MissingFinalImageStreamResultError({ upstreamEventType, partialImageCount });
    }

    return {
        created: Math.floor(Date.now() / 1000),
        data,
        ...(usage ? { usage } : {})
    };
}
