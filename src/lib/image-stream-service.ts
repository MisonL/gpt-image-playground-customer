import { appLogger } from './app-logger';
import { writeFileAtomic } from './agent-file-utils';
import { createImageResult, type StorageMode, type ValidOutputFormat } from './image-request-utils';
import { normalizeUpstreamImageStreamEventWithDiagnostics } from './image-stream-events';
import { createBatchId, createImageFilename, outputDir } from './server-runtime';
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
    error?: string;
    status?: number;
};

type CompletedImage = NonNullable<StreamingEvent['images']>[number];
type ImageUsage = OpenAI.Images.ImagesResponse['usage'];
type SseWriter = ReturnType<typeof createSseWriter>;

type ResolveStreamCostInput = {
    apiBaseUrl?: string;
    apiKey: string;
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
    model: string;
    startedAtMs: number;
    clientRequestId?: string;
    requestLogContext?: { clientRequestId: string };
    resolveActualCost: (input: ResolveStreamCostInput) => Promise<ActualCostDetails>;
    onError?: (error: unknown) => void;
};

type StreamState = {
    completedImages: CompletedImage[];
    completedImageDedupeKeys: Set<string>;
    finalUsage?: ImageUsage;
    imageIndex: number;
};

type StreamRuntime = {
    options: ImageStreamResponseOptions;
    batchId: string;
    sse: SseWriter;
    state: StreamState;
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
    requestLogContext?: { clientRequestId: string };
    providerDialect: string;
    upstreamEventType?: string;
    normalizedEventCount: number;
}) {
    appLogger.info(`流式${input.modeLabel}上游事件诊断。`, {
        ...input.requestLogContext,
        providerDialect: input.providerDialect,
        normalizedEventCount: input.normalizedEventCount,
        ...(input.upstreamEventType ? { upstreamEventType: input.upstreamEventType } : {})
    });
}

function createPartialStreamingEvent(input: {
    normalizedEvent: Extract<
        ReturnType<typeof normalizeUpstreamImageStreamEventWithDiagnostics>['events'][number],
        { type: 'partial_image' }
    >;
    imageIndex: number;
}): StreamingEvent {
    return {
        type: 'partial_image',
        index: input.imageIndex,
        partial_image_index: input.normalizedEvent.partialImageIndex,
        partialImageIndex: input.normalizedEvent.partialImageIndex,
        b64_json: input.normalizedEvent.b64Json
    };
}

async function persistStreamedImage(input: { options: ImageStreamResponseOptions; filename: string; b64Json: string }) {
    if (input.options.storageMode !== 'fs') return;
    const buffer = Buffer.from(input.b64Json, 'base64');
    const filepath = path.join(outputDir, input.filename);
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
    const currentIndex = runtime.state.imageIndex;
    const filename = createImageFilename(runtime.batchId, currentIndex, runtime.options.outputFormat);
    await persistStreamedImage({ options: runtime.options, filename, b64Json: normalizedEvent.b64Json });

    const imageData = createImageResult(
        filename,
        normalizedEvent.b64Json,
        runtime.options.outputFormat,
        runtime.options.storageMode
    );
    runtime.state.completedImages.push(imageData);

    const completedEvent: StreamingEvent = {
        type: 'completed',
        index: currentIndex,
        filename,
        b64_json: normalizedEvent.b64Json,
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
        return runtime.sse.send(createPartialStreamingEvent({ normalizedEvent, imageIndex: runtime.state.imageIndex }));
    }
    return emitCompletedImage(runtime, normalizedEvent);
}

async function consumeUpstreamStream(runtime: StreamRuntime): Promise<boolean> {
    for await (const event of runtime.options.stream) {
        const diagnostics = normalizeUpstreamImageStreamEventWithDiagnostics(event);
        logProviderDialect({
            modeLabel: runtime.options.modeLabel,
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
    const readableStream = new ReadableStream({
        async start(controller) {
            const sse = createSseWriter(controller, encoder);
            const runtime: StreamRuntime = {
                options,
                batchId,
                sse,
                state: { completedImages: [], completedImageDedupeKeys: new Set(), imageIndex: 0 }
            };
            try {
                if (!(await consumeUpstreamStream(runtime))) return;
                if (!(await emitDoneEvent(runtime))) return;
                sse.close();
            } catch (error) {
                if (!emitErrorEvent(runtime, error)) return;
                sse.close();
            }
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
