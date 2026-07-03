import { readAcceptedImageTaskDetails } from './accepted-image-task';
import { detectImageFormat, readImageDimensions, writeFileAtomic } from './agent-file-utils';
import { createImageResult, type StorageMode, type ValidOutputFormat } from './image-request-utils';
import type { UpstreamRequestHeaders } from './image-upstream-profile';
import { downloadSameOriginImageAsBase64 } from './image-url-result';
import { createBatchId, createImageFilename, outputDir } from './server-runtime';
import fs from 'fs/promises';
import type OpenAI from 'openai';
import path from 'path';

export { readAcceptedImageTaskDetails } from './accepted-image-task';
export type { AcceptedImageTaskDetails } from './accepted-image-task';

const DEFAULT_ACCEPTED_IMAGE_TASK_MAX_ATTEMPTS = 3;
const DEFAULT_ACCEPTED_IMAGE_TASK_RETRY_DELAY_MS = 5_000;
const MAX_ACCEPTED_IMAGE_TASK_RETRY_DELAY_MS = 15_000;
const MAX_ACCEPTED_IMAGE_TASK_RETRY_AFTER_SECONDS = 300;

export type PersistedOpenAiImage = {
    filename: string;
    b64Json: string;
    responseJson?: string;
    path?: string;
    outputFormat: ValidOutputFormat;
    filepath: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
};

type ValidImagesResponse = OpenAI.Images.ImagesResponse & {
    data: NonNullable<OpenAI.Images.ImagesResponse['data']>;
};

export class InvalidOpenAiImagesResponseError extends Error {
    readonly result: unknown;

    constructor(result: unknown) {
        super('Images 响应无效或为空。');
        this.name = 'InvalidOpenAiImagesResponseError';
        this.result = result;
    }
}

export class MissingOpenAiImageDataError extends Error {
    readonly index: number;
    readonly result: unknown;
    readonly status = 502;

    constructor(index: number, result?: unknown) {
        super(`索引 ${index} 的图片数据缺少 base64 数据。`);
        this.name = 'MissingOpenAiImageDataError';
        this.index = index;
        this.result = result;
    }
}

export class AcceptedImageTaskResponseError extends Error {
    readonly taskId?: string;
    readonly pollUrl?: string;
    readonly retryAfterSeconds?: number;
    readonly status = 502;

    constructor(input: { taskId?: string; pollUrl?: string; retryAfterSeconds?: number }) {
        super('上游返回了异步图片任务，但没有拿到可直接消费的最终图片结果。');
        this.name = 'AcceptedImageTaskResponseError';
        this.taskId = input.taskId;
        this.pollUrl = input.pollUrl;
        this.retryAfterSeconds = input.retryAfterSeconds;
    }
}

export function assertOpenAiImagesResponse(result: unknown): asserts result is ValidImagesResponse {
    const candidate = result as Partial<OpenAI.Images.ImagesResponse> | null | undefined;
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.data) || candidate.data.length === 0) {
        throw new InvalidOpenAiImagesResponseError(result);
    }
}

export function readRetryAfterSecondsHeader(value: unknown): number | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    if (!/^[1-9]\d*$/.test(normalized)) return undefined;
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
}

export async function resolveAcceptedImageTaskResponse<T extends OpenAI.Images.ImagesResponse>(
    operation: () => Promise<{ data: T; response?: Response }>,
    options: {
        abortSignal?: AbortSignal;
        maxAttempts?: number;
        retryDelayMs?: number;
        sleep?: (ms: number, abortSignal?: AbortSignal) => Promise<void>;
        onAcceptedTask?: (details: AcceptedImageTaskResponseError, attempt: number, delayMs: number) => void;
    } = {}
): Promise<T> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_ACCEPTED_IMAGE_TASK_MAX_ATTEMPTS);
    const sleep = options.sleep ?? delayAcceptedImageTaskResponse;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfAcceptedImageTaskRetryAborted(options.abortSignal);
        const { data, response } = await operation();
        const acceptedTask = readAcceptedImageTaskDetails(data);
        if (!acceptedTask) return data;

        const retryDelayMs = readAcceptedImageTaskRetryDelayMs(
            response?.headers.get('retry-after'),
            options.retryDelayMs ?? DEFAULT_ACCEPTED_IMAGE_TASK_RETRY_DELAY_MS
        );
        const error = new AcceptedImageTaskResponseError({
            ...acceptedTask,
            retryAfterSeconds: Math.ceil(retryDelayMs / 1000)
        });
        if (attempt >= maxAttempts) throw error;
        options.onAcceptedTask?.(error, attempt, retryDelayMs);
        await sleep(retryDelayMs, options.abortSignal);
    }

    throw new Error('UNREACHABLE: resolveAcceptedImageTaskResponse exhausted without return or throw.');
}

function delayAcceptedImageTaskResponse(ms: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            abortSignal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timeout);
            reject(readAbortReason(abortSignal));
        };

        if (abortSignal?.aborted) {
            onAbort();
            return;
        }
        abortSignal?.addEventListener('abort', onAbort, { once: true });
    });
}

function throwIfAcceptedImageTaskRetryAborted(abortSignal?: AbortSignal): void {
    if (!abortSignal?.aborted) return;
    throw readAbortReason(abortSignal);
}

function readAbortReason(abortSignal?: AbortSignal): Error {
    if (abortSignal?.reason instanceof Error) return abortSignal.reason;
    if (abortSignal?.reason !== undefined) {
        return new DOMException(`The operation was aborted: ${String(abortSignal.reason)}`, 'AbortError');
    }
    return new DOMException('The operation was aborted.', 'AbortError');
}

function readAcceptedImageTaskRetryDelayMs(value: unknown, fallbackMs: number): number {
    const retryAfterSeconds = readRetryAfterSecondsHeader(value);
    if (retryAfterSeconds === undefined) return Math.min(fallbackMs, MAX_ACCEPTED_IMAGE_TASK_RETRY_DELAY_MS);
    return Math.min(retryAfterSeconds, MAX_ACCEPTED_IMAGE_TASK_RETRY_AFTER_SECONDS) * 1000;
}

export async function persistOpenAiImages(options: {
    result: OpenAI.Images.ImagesResponse;
    outputFormat: ValidOutputFormat;
    storageMode: StorageMode;
    includeBase64: boolean;
    batchId?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    upstreamHeaders?: UpstreamRequestHeaders;
    abortSignal?: AbortSignal;
}): Promise<PersistedOpenAiImage[]> {
    const result = options.result;
    assertOpenAiImagesResponse(result);
    if (options.storageMode === 'fs') {
        await fs.mkdir(outputDir, { recursive: true });
    }
    const batchId = options.batchId || createBatchId();
    const persisted: PersistedOpenAiImage[] = [];
    const imageItems = result.data;

    for (const [index, imageData] of imageItems.entries()) {
        const b64Json =
            imageData.b64_json ||
            (imageData.url
                ? await downloadSameOriginImageAsBase64({
                      imageUrl: imageData.url,
                      apiBaseUrl: options.apiBaseUrl,
                      apiKey: options.apiKey,
                      upstreamHeaders: options.upstreamHeaders,
                      abortSignal: options.abortSignal
                  })
                : undefined);
        if (!b64Json) {
            throw new MissingOpenAiImageDataError(index, result);
        }
        const buffer = Buffer.from(b64Json, 'base64');
        const detectedFormat = detectImageFormat(buffer, options.outputFormat);
        const filename = createImageFilename(batchId, index, detectedFormat.outputFormat);
        const filepath = path.join(outputDir, filename);
        if (options.storageMode === 'fs') {
            await writeFileAtomic(filepath, buffer);
        }
        const dimensions = readImageDimensions(buffer);
        const legacyResult = createImageResult(filename, b64Json, detectedFormat.outputFormat, options.storageMode);
        persisted.push({
            filename,
            b64Json,
            ...(options.includeBase64 ? { responseJson: b64Json } : {}),
            ...(legacyResult.path ? { path: legacyResult.path } : {}),
            outputFormat: detectedFormat.outputFormat,
            filepath,
            mimeType: detectedFormat.mimeType,
            sizeBytes: buffer.byteLength,
            width: dimensions.width,
            height: dimensions.height
        });
    }

    return persisted;
}

export function persistedImageToLegacyResponse(image: PersistedOpenAiImage): {
    filename: string;
    b64_json: string;
    path?: string;
    output_format: string;
} {
    return {
        filename: image.filename,
        b64_json: image.responseJson || image.b64Json,
        output_format: image.outputFormat,
        ...(image.path ? { path: image.path } : {})
    };
}
