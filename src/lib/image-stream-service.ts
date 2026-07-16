import { writeFileAtomic } from './agent-file-utils';
import { appLogger } from './app-logger';
import { createImageResult, type StorageMode, type ValidOutputFormat } from './image-request-utils';
import { normalizeUpstreamImageStreamEventWithDiagnostics } from './image-stream-events';
import type { UpstreamRequestHeaders } from './image-upstream-profile';
import { downloadSameOriginImageAsBase64 } from './image-url-result';
import { readImageStreamDataIntervalTimeoutMs } from './openai-image-transport';
import { createBatchId, createImageFilename, resolveImageOutputDir } from './server-runtime';
import { withStreamDataIntervalTimeout } from './stream-data-interval-timeout';
import type { ActualCostDetails } from './upstream-cost/types';
import type OpenAI from 'openai';
import path from 'path';

type StreamingEvent = {
    type: 'partial_image' | 'completed' | 'error' | 'done';
    index?: number;
    partial_image_index?: number;
    partialImageIndex?: number;
    b64_json?: string;
    filename?: string;
    path?: string;
    output_format?: string;
    outputFormat?: string;
    usage?: OpenAI.Images.ImagesResponse['usage'];
    images?: Array<{
        filename: string;
        b64_json: string;
        path?: string;
        output_format: string;
        clientRequestId?: string;
    }>;
    client_request_id?: string;
    clientRequestId?: string;
    actual_cost?: ActualCostDetails;
    actualCost?: ActualCostDetails;
    fallback_used?: boolean;
    fallbackUsed?: boolean;
    streaming_degraded?: boolean;
    streamingDegraded?: boolean;
    error?: string;
    status?: number;
};

type CompletedImage = NonNullable<StreamingEvent['images']>[number];
type ImageUsage = OpenAI.Images.ImagesResponse['usage'];
type SseWriter = ReturnType<typeof createSseWriter>;

type ResolveStreamCostInput = {
    apiBaseUrl?: string;
    apiKey: string;
    upstreamHeaders?: UpstreamRequestHeaders;
    model: string;
    startedAtMs: number;
    expectedImageCount: number;
    requestLogContext?: { clientRequestId: string };
};

export type ImageStreamResponseOptions = {
    stream: AsyncIterable<unknown>;
    modeLabel: '生成' | '编辑';
    outputFormat: ValidOutputFormat;
    storageMode: StorageMode;
    apiBaseUrl?: string;
    apiKey: string;
    upstreamHeaders?: UpstreamRequestHeaders;
    model: string;
    startedAtMs: number;
    abortSignal?: AbortSignal;
    clientRequestId?: string;
    requestLogContext?: { clientRequestId: string };
    resolveActualCost: (input: ResolveStreamCostInput) => Promise<ActualCostDetails>;
    logProviderDiagnostics?: boolean;
    onError?: (error: unknown) => void;
    onStreamUnavailable?: (error: unknown, reason: string) => void;
    onStreamingDegraded?: (reason: string) => void;
    fallbackOnError?: (error: unknown) => Promise<OpenAI.Images.ImagesResponse>;
};

type StreamState = {
    completedImages: CompletedImage[];
    completedImageDedupeKeys: Set<string>;
    finalUsage?: ImageUsage;
    imageIndex: number;
    fallbackUsed: boolean;
    streamingDegraded: boolean;
};

type StreamRuntime = {
    options: ImageStreamResponseOptions;
    batchId: string;
    sse: SseWriter;
    state: StreamState;
};

type LinkedAbortController = {
    signal: AbortSignal;
    abort: (reason?: unknown) => void;
    cleanup: () => void;
};

function readErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    if ('status' in error && typeof error.status === 'number') return error.status;
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
    return undefined;
}

function isClosedStreamControllerError(error: unknown): boolean {
    return error instanceof TypeError && /controller is already closed|invalid state/i.test(error.message);
}

function isAbortLikeError(error: unknown, abortSignal?: AbortSignal): boolean {
    if (abortSignal?.aborted) return true;
    if (typeof error !== 'object' || error === null) return false;
    const name = 'name' in error ? error.name : undefined;
    return name === 'AbortError' || name === 'CanceledError';
}

function createLinkedAbortController(parentSignal?: AbortSignal): LinkedAbortController {
    const controller = new AbortController();
    const abort = (reason?: unknown) => {
        try {
            controller.abort(reason);
        } catch {
            controller.abort();
        }
    };
    const parentAbort = () => abort(parentSignal?.reason);
    if (parentSignal?.aborted) {
        parentAbort();
    } else if (parentSignal) {
        parentSignal.addEventListener('abort', parentAbort, { once: true });
    }
    return {
        signal: controller.signal,
        abort,
        cleanup: () => {
            parentSignal?.removeEventListener('abort', parentAbort);
        }
    };
}

function createSseWriter(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder) {
    let isClosed = false;

    return {
        send(event: StreamingEvent): boolean {
            if (isClosed) return false;
            try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                return true;
            } catch (error) {
                if (isClosedStreamControllerError(error)) {
                    isClosed = true;
                    return false;
                }
                throw error;
            }
        },
        close() {
            if (isClosed) return;
            isClosed = true;
            try {
                controller.close();
            } catch (error) {
                if (!isClosedStreamControllerError(error)) {
                    throw error;
                }
            }
        }
    };
}

function logProviderDialect(input: {
    modeLabel: ImageStreamResponseOptions['modeLabel'];
    enabled: boolean;
    requestLogContext?: { clientRequestId: string };
    providerDialect: string;
    upstreamEventType?: string;
    normalizedEventCount: number;
}) {
    if (!input.enabled) return;
    appLogger.info(`流式${input.modeLabel}上游事件诊断。`, {
        ...input.requestLogContext,
        providerDialect: input.providerDialect,
        normalizedEventCount: input.normalizedEventCount,
        ...(input.upstreamEventType ? { upstreamEventType: input.upstreamEventType } : {})
    });
}

async function createPartialStreamingEvent(input: {
    runtime: StreamRuntime;
    normalizedEvent: Extract<
        ReturnType<typeof normalizeUpstreamImageStreamEventWithDiagnostics>['events'][number],
        { type: 'partial_image' }
    >;
    imageIndex: number;
}): Promise<StreamingEvent | undefined> {
    const b64Json =
        input.normalizedEvent.b64Json ||
        (input.normalizedEvent.imageUrl
            ? await downloadOptionalPartialImage(input.runtime, input.normalizedEvent.imageUrl)
            : undefined);
    if (!b64Json) return undefined;
    return {
        type: 'partial_image',
        index: input.imageIndex,
        partial_image_index: input.normalizedEvent.partialImageIndex,
        partialImageIndex: input.normalizedEvent.partialImageIndex,
        b64_json: b64Json
    };
}

async function downloadOptionalPartialImage(runtime: StreamRuntime, imageUrl: string): Promise<string | undefined> {
    try {
        return await downloadSameOriginImageAsBase64({
            imageUrl,
            apiBaseUrl: runtime.options.apiBaseUrl,
            apiKey: runtime.options.apiKey,
            upstreamHeaders: runtime.options.upstreamHeaders,
            abortSignal: runtime.options.abortSignal
        });
    } catch (error) {
        if (runtime.options.logProviderDiagnostics ?? process.env.NODE_ENV !== 'test') {
            appLogger.warn(`流式${runtime.options.modeLabel}：跳过无法物化的预览图 URL。`, {
                ...runtime.options.requestLogContext,
                error: error instanceof Error ? error.message : String(error)
            });
        }
        return undefined;
    }
}

async function persistStreamedImage(input: { options: ImageStreamResponseOptions; filename: string; b64Json: string }) {
    if (input.options.storageMode !== 'fs') return;
    const buffer = Buffer.from(input.b64Json, 'base64');
    const filepath = path.join(resolveImageOutputDir(), input.filename);
    await writeFileAtomic(filepath, buffer);
    appLogger.info(`流式${input.options.modeLabel}：已保存图片 ${input.filename}`, {
        ...input.options.requestLogContext,
        filenames: [input.filename]
    });
}

async function emitCompletedImage(
    runtime: StreamRuntime,
    normalizedEvent: Extract<
        ReturnType<typeof normalizeUpstreamImageStreamEventWithDiagnostics>['events'][number],
        { type: 'completed' }
    >
): Promise<boolean> {
    const b64Json =
        normalizedEvent.b64Json ||
        (normalizedEvent.imageUrl
            ? await downloadSameOriginImageAsBase64({
                  imageUrl: normalizedEvent.imageUrl,
                  apiBaseUrl: runtime.options.apiBaseUrl,
                  apiKey: runtime.options.apiKey,
                  upstreamHeaders: runtime.options.upstreamHeaders,
                  abortSignal: runtime.options.abortSignal
              })
            : undefined);
    if (!b64Json) {
        throw new Error('流式图片完成事件缺少 b64_json。');
    }
    const currentIndex = runtime.state.imageIndex;
    const filename = createImageFilename(runtime.batchId, currentIndex, runtime.options.outputFormat);
    await persistStreamedImage({ options: runtime.options, filename, b64Json });

    const imageData = createImageResult(filename, b64Json, runtime.options.outputFormat, runtime.options.storageMode);
    runtime.state.completedImages.push(imageData);

    const completedEvent: StreamingEvent = {
        type: 'completed',
        index: currentIndex,
        filename,
        b64_json: b64Json,
        path: runtime.options.storageMode === 'fs' ? `/api/image/${filename}` : undefined,
        output_format: runtime.options.outputFormat,
        outputFormat: runtime.options.outputFormat,
        client_request_id: runtime.options.clientRequestId,
        clientRequestId: runtime.options.clientRequestId
    };
    if (!runtime.sse.send(completedEvent)) return false;
    runtime.state.imageIndex++;
    if (normalizedEvent.usage) {
        runtime.state.finalUsage = normalizedEvent.usage;
    }
    return true;
}

async function emitNormalizedEvent(
    runtime: StreamRuntime,
    normalizedEvent: ReturnType<typeof normalizeUpstreamImageStreamEventWithDiagnostics>['events'][number]
): Promise<boolean> {
    if (normalizedEvent.type === 'partial_image') {
        const partialEvent = await createPartialStreamingEvent({
            runtime,
            normalizedEvent,
            imageIndex: runtime.state.imageIndex
        });
        return partialEvent ? runtime.sse.send(partialEvent) : true;
    }
    return emitCompletedImage(runtime, normalizedEvent);
}

async function consumeUpstreamStream(runtime: StreamRuntime): Promise<boolean> {
    const stream = withStreamDataIntervalTimeout(
        runtime.options.stream,
        readImageStreamDataIntervalTimeoutMs(),
        runtime.options.abortSignal
    );
    for await (const event of stream) {
        const diagnostics = normalizeUpstreamImageStreamEventWithDiagnostics(event);
        if (diagnostics.providerDialect === 'sdk_parsed_fallback' && !runtime.state.streamingDegraded) {
            runtime.state.streamingDegraded = true;
            runtime.options.onStreamingDegraded?.('json_final_fallback');
        }
        logProviderDialect({
            modeLabel: runtime.options.modeLabel,
            enabled: runtime.options.logProviderDiagnostics ?? process.env.NODE_ENV !== 'test',
            requestLogContext: runtime.options.requestLogContext,
            providerDialect: diagnostics.providerDialect,
            upstreamEventType: diagnostics.upstreamEventType,
            normalizedEventCount: diagnostics.events.length
        });
        for (const normalizedEvent of diagnostics.events) {
            if (normalizedEvent.type === 'completed') {
                if (!normalizedEvent.dedupeKey) {
                    if (!(await emitNormalizedEvent(runtime, normalizedEvent))) return false;
                    continue;
                }
                if (!runtime.state.completedImageDedupeKeys.has(normalizedEvent.dedupeKey)) {
                    if (!(await emitNormalizedEvent(runtime, normalizedEvent))) return false;
                    runtime.state.completedImageDedupeKeys.add(normalizedEvent.dedupeKey);
                    continue;
                }
                if (normalizedEvent.usage) {
                    runtime.state.finalUsage = normalizedEvent.usage;
                }
                continue;
            }
            if (!(await emitNormalizedEvent(runtime, normalizedEvent))) return false;
        }
    }
    return true;
}

async function emitFallbackImages(runtime: StreamRuntime, result: OpenAI.Images.ImagesResponse): Promise<boolean> {
    if (!Array.isArray(result.data) || result.data.length === 0) {
        throw new Error('非流式回退未返回图片数据。');
    }
    runtime.state.fallbackUsed = true;
    for (const [index, image] of result.data.entries()) {
        const b64Json =
            image.b64_json ||
            (image.url
                ? await downloadSameOriginImageAsBase64({
                      imageUrl: image.url,
                      apiBaseUrl: runtime.options.apiBaseUrl,
                      apiKey: runtime.options.apiKey,
                      upstreamHeaders: runtime.options.upstreamHeaders,
                      abortSignal: runtime.options.abortSignal
                  })
                : undefined);
        if (!b64Json) {
            throw new Error(`非流式回退第 ${index} 个图片缺少 b64_json 或 url。`);
        }
        const emitted = await emitCompletedImage(runtime, {
            type: 'completed',
            b64Json,
            usage: index === result.data.length - 1 ? result.usage : undefined
        });
        if (!emitted) return false;
    }
    if (result.usage) {
        runtime.state.finalUsage = result.usage;
    }
    return true;
}

async function emitDoneEvent(runtime: StreamRuntime): Promise<boolean> {
    if (runtime.state.completedImages.length === 0) {
        throw new Error('流式图片响应未返回最终图片 b64_json。');
    }

    const actualCost = await runtime.options.resolveActualCost({
        apiBaseUrl: runtime.options.apiBaseUrl,
        apiKey: runtime.options.apiKey,
        model: runtime.options.model,
        startedAtMs: runtime.options.startedAtMs,
        expectedImageCount: runtime.state.completedImages.length,
        requestLogContext: runtime.options.requestLogContext
    });

    return runtime.sse.send({
        type: 'done',
        images: runtime.state.completedImages,
        usage: runtime.state.finalUsage,
        actual_cost: actualCost,
        actualCost,
        ...(runtime.state.fallbackUsed ? { fallback_used: true, fallbackUsed: true } : {}),
        ...(runtime.state.streamingDegraded ? { streaming_degraded: true, streamingDegraded: true } : {}),
        client_request_id: runtime.options.clientRequestId,
        clientRequestId: runtime.options.clientRequestId
    });
}

function emitErrorEvent(runtime: StreamRuntime, error: unknown): boolean {
    runtime.options.onError?.(error);
    appLogger.error(`流式${runtime.options.modeLabel}失败：`, {
        ...runtime.options.requestLogContext,
        error: error instanceof Error ? error.message : String(error)
    });
    const status = readErrorStatus(error);
    return runtime.sse.send({
        type: 'error',
        error: error instanceof Error ? error.message : '流式处理失败',
        ...(status ? { status } : {})
    });
}

export function createImageStreamResponse(options: ImageStreamResponseOptions): Response {
    const encoder = new TextEncoder();
    const batchId = createBatchId();
    const linkedAbort = createLinkedAbortController(options.abortSignal);
    const runtimeOptions: ImageStreamResponseOptions = {
        ...options,
        abortSignal: linkedAbort.signal
    };
    const readableStream = new ReadableStream({
        async start(controller) {
            const sse = createSseWriter(controller, encoder);
            const runtime: StreamRuntime = {
                options: runtimeOptions,
                batchId,
                sse,
                state: {
                    completedImages: [],
                    completedImageDedupeKeys: new Set(),
                    imageIndex: 0,
                    fallbackUsed: false,
                    streamingDegraded: false
                }
            };
            try {
                if (!(await consumeUpstreamStream(runtime))) return;
                if (!(await emitDoneEvent(runtime))) return;
                sse.close();
            } catch (error) {
                if (isAbortLikeError(error, runtimeOptions.abortSignal)) {
                    sse.close();
                    return;
                }
                if (runtime.state.completedImages.length === 0 && runtimeOptions.fallbackOnError) {
                    runtime.options.onStreamUnavailable?.(error, 'stream_error_without_final_image');
                    try {
                        if (!(await emitFallbackImages(runtime, await runtimeOptions.fallbackOnError(error)))) return;
                        if (!(await emitDoneEvent(runtime))) return;
                        sse.close();
                        return;
                    } catch (fallbackError) {
                        if (!emitErrorEvent(runtime, fallbackError)) return;
                        sse.close();
                        return;
                    }
                }
                if (!emitErrorEvent(runtime, error)) return;
                sse.close();
            } finally {
                linkedAbort.cleanup();
            }
        },
        cancel(reason) {
            linkedAbort.abort(reason);
            linkedAbort.cleanup();
        }
    });

    return new Response(readableStream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...(options.clientRequestId ? { 'X-Client-Request-Id': options.clientRequestId } : {})
        }
    });
}
