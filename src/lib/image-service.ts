import { mimeTypeForOutputFormat, readImageDimensions, writeFileAtomic } from './agent-file-utils';
import {
    createImageResult,
    type StorageMode,
    type ValidOutputFormat
} from './image-request-utils';
import { createBatchId, createImageFilename, outputDir } from './server-runtime';
import fs from 'fs/promises';
import type OpenAI from 'openai';
import path from 'path';

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
    readonly status = 502;

    constructor(index: number) {
        super(`索引 ${index} 的图片数据缺少 base64 数据。`);
        this.name = 'MissingOpenAiImageDataError';
        this.index = index;
    }
}

export function assertOpenAiImagesResponse(result: unknown): asserts result is ValidImagesResponse {
    const candidate = result as Partial<OpenAI.Images.ImagesResponse> | null | undefined;
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.data) || candidate.data.length === 0) {
        throw new InvalidOpenAiImagesResponseError(result);
    }
}

export async function persistOpenAiImages(options: {
    result: OpenAI.Images.ImagesResponse;
    outputFormat: ValidOutputFormat;
    storageMode: StorageMode;
    includeBase64: boolean;
    batchId?: string;
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
        if (!imageData.b64_json) {
            throw new MissingOpenAiImageDataError(index);
        }
        const buffer = Buffer.from(imageData.b64_json, 'base64');
        const filename = createImageFilename(batchId, index, options.outputFormat);
        const filepath = path.join(outputDir, filename);
        if (options.storageMode === 'fs') {
            await writeFileAtomic(filepath, buffer);
        }
        const dimensions = readImageDimensions(buffer);
        const legacyResult = createImageResult(filename, imageData.b64_json, options.outputFormat, options.storageMode);
        persisted.push({
            filename,
            b64Json: imageData.b64_json,
            ...(options.includeBase64 ? { responseJson: imageData.b64_json } : {}),
            ...(legacyResult.path ? { path: legacyResult.path } : {}),
            outputFormat: options.outputFormat,
            filepath,
            mimeType: mimeTypeForOutputFormat(options.outputFormat),
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
