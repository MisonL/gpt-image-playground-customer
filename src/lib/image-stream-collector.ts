import { readAcceptedImageTaskDetails } from './accepted-image-task';
import { normalizeUpstreamImageStreamEventWithDiagnostics } from './image-stream-events';
import type { UpstreamRequestHeaders } from './image-upstream-profile';
import { downloadSameOriginImageAsBase64 } from './image-url-result';
import { readImageStreamDataIntervalTimeoutMs } from './openai-image-transport';
import { withStreamDataIntervalTimeout } from './stream-data-interval-timeout';
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

export class AcceptedImageTaskStreamResultError extends Error {
    readonly status = 502;
    readonly taskId?: string;
    readonly pollUrl?: string;

    constructor(input: { taskId?: string; pollUrl?: string }) {
        super('上游返回了异步图片任务，但当前服务不支持该任务态的自动轮询。');
        this.name = 'AcceptedImageTaskStreamResultError';
        this.taskId = input.taskId;
        this.pollUrl = input.pollUrl;
    }
}

export async function collectOpenAiImagesFromStream(
    stream: AsyncIterable<unknown>,
    options: {
        apiBaseUrl?: string;
        apiKey?: string;
        upstreamHeaders?: UpstreamRequestHeaders;
        abortSignal?: AbortSignal;
        onStreamingDegraded?: (reason: string) => void;
        streamDataIntervalTimeoutMs?: number;
    } = {}
): Promise<OpenAI.Images.ImagesResponse> {
    const data: Array<{ b64_json: string }> = [];
    const seenCompletedKeys = new Set<string>();
    let usage: ImageUsage | undefined;
    let upstreamEventType: string | undefined;
    let partialImageCount = 0;
    let acceptedTaskInfo: { taskId?: string; pollUrl?: string } | undefined;

    for await (const event of withStreamDataIntervalTimeout(
        stream,
        options.streamDataIntervalTimeoutMs ?? readImageStreamDataIntervalTimeoutMs()
    )) {
        const diagnostics = normalizeUpstreamImageStreamEventWithDiagnostics(event);
        if (diagnostics.providerDialect === 'image_task_accepted') {
            acceptedTaskInfo = readAcceptedImageTaskDetails(event) ?? {};
            continue;
        }
        if (diagnostics.providerDialect === 'sdk_parsed_fallback') {
            options.onStreamingDegraded?.('json_final_fallback');
        }
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
                const b64Json =
                    normalizedEvent.b64Json ||
                    (normalizedEvent.imageUrl
                        ? await downloadSameOriginImageAsBase64({
                              imageUrl: normalizedEvent.imageUrl,
                              apiBaseUrl: options.apiBaseUrl,
                              apiKey: options.apiKey,
                              upstreamHeaders: options.upstreamHeaders,
                              abortSignal: options.abortSignal
                          })
                        : undefined);
                if (!b64Json) continue;
                data.push({ b64_json: b64Json });
                if (normalizedEvent.dedupeKey) {
                    seenCompletedKeys.add(normalizedEvent.dedupeKey);
                }
                if (normalizedEvent.usage) {
                    usage = normalizedEvent.usage;
                }
            }
        }
    }

    if (acceptedTaskInfo) {
        throw new AcceptedImageTaskStreamResultError(acceptedTaskInfo);
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
