import { appLogger } from './app-logger';
import type { ChannelCredential } from './channel-router';
import {
    RequestValidationError,
    readBackground,
    readCount,
    readEditQuality,
    readGenerateQuality,
    readImageFiles,
    readMaskFile,
    readModeration,
    readOutputCompression,
    readOutputFormat,
    readSize,
    type Background,
    type EditQuality,
    type GenerateParams,
    type GenerateQuality,
    type GptImageModel,
    type Moderation,
    type StorageMode,
    type ValidOutputFormat
} from './image-request-utils';
import { createImageStreamResponse } from './image-stream-service';
import { createImagesApiGenerateStream } from './images-api-stream';
import {
    appendAccessCookie,
    reportServerCredentialFailure,
    resolveRequestActualCostSafely,
    type AccessCookie,
    type ImageBackend,
    type RequestLogContext
} from './image-route-support';
import {
    createResponsesImageEditStream,
    createResponsesImageStream,
    editImageWithResponsesBackend,
    generateImageWithResponsesBackend,
    type ResponsesImageGenerateInput
} from './responses-image-backend';
import type OpenAI from 'openai';

type CommonModeInput = {
    formData: FormData;
    openai: OpenAI;
    model: GptImageModel;
    prompt: string;
    streamEnabled: boolean;
    partialImagesCount: 1 | 2 | 3;
    storageMode: StorageMode;
    apiBaseUrl?: string;
    apiKey: string;
    startedAtMs: number;
    clientRequestId?: string;
    requestLogContext?: RequestLogContext;
    selectedCredential?: ChannelCredential;
    accessCookie?: AccessCookie;
    abortSignal?: AbortSignal;
    streamFallbackEnabled?: boolean;
    onStreamUnavailable?: (error: unknown, reason: string) => void;
    onStreamingDegraded?: (reason: string) => void;
};

export type ImageModeResult =
    | Response
    | {
          result: OpenAI.Images.ImagesResponse;
          outputFormat: ValidOutputFormat;
      };

type GenerateOptions = {
    n: number;
    size: string;
    quality: GenerateQuality;
    outputFormat: ValidOutputFormat;
    outputCompression?: number;
    background: Background;
    moderation: Moderation;
    forceWeb?: boolean;
    baseParams: GenerateParams;
};

type EditOptions = {
    imageFiles: File[];
    maskFile?: File;
    n: number;
    size: string;
    quality: EditQuality;
    outputFormat: ValidOutputFormat;
    outputCompression?: number;
    moderation: Moderation;
    forceWeb?: boolean;
    baseEditParams: {
        model: GptImageModel;
        prompt: string;
        image: File[];
        n: number;
        size?: OpenAI.Images.ImageEditParams['size'];
        quality?: OpenAI.Images.ImageEditParams['quality'];
        output_format?: OpenAI.Images.ImageEditParams['output_format'];
        output_compression?: number;
        moderation?: Moderation;
        force_web?: boolean;
    };
};

function readGenerateOptions(input: CommonModeInput): GenerateOptions {
    const n = readCount(input.formData, 'n', 1, 1, 10);
    const size = readSize(input.formData, 'size', '1024x1024', input.model);
    const quality = readGenerateQuality(input.formData);
    const outputFormat = readOutputFormat(input.formData);
    const outputCompression = readOutputCompression(input.formData, outputFormat);
    const background = readBackground(input.formData, input.model);
    const moderation = readModeration(input.formData);
    const forceWeb = readBooleanAlias(input.formData, 'force_web', 'forceWeb');
    const baseParams: GenerateParams = {
        model: input.model,
        prompt: input.prompt,
        n,
        size: size as OpenAI.Images.ImageGenerateParams['size'],
        quality,
        output_format: outputFormat,
        background,
        moderation
    };

    if (outputCompression !== undefined) {
        baseParams.output_compression = outputCompression;
    }
    if (forceWeb !== undefined) {
        baseParams.force_web = forceWeb;
    }
    return { n, size, quality, outputFormat, outputCompression, background, moderation, forceWeb, baseParams };
}

function readResponsesImageSize(size: string): string {
    return size;
}

function readStringField(formData: FormData, ...fields: string[]): string | undefined {
    for (const field of fields) {
        const value = formData.get(field);
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function readBooleanAlias(formData: FormData, ...fields: string[]): boolean | undefined {
    const value = readStringField(formData, ...fields);
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new RequestValidationError(`${fields[0]} 必须是 true 或 false。`, 400);
}

function readThinking(formData: FormData): string | undefined {
    const value = readStringField(formData, 'thinking');
    if (!value) return undefined;
    if (!['minimal', 'none', 'low', 'medium', 'high', 'xhigh'].includes(value)) {
        throw new RequestValidationError('thinking 必须是 minimal、none、low、medium、high 或 xhigh。', 400);
    }
    return value;
}

function readResponsesApiModel(formData: FormData): string {
    const requestValue = readStringField(formData, 'responsesModel', 'responses_model', 'gptModel', 'gpt_model');
    const rawValue =
        typeof requestValue === 'string' && requestValue.trim() ? requestValue : process.env.OPENAI_RESPONSES_API_MODEL;
    const model = rawValue?.trim();
    if (!model) {
        throw new RequestValidationError(
            'Responses API 图片后端必须配置 OPENAI_RESPONSES_API_MODEL 或请求字段 responsesModel，作为 /responses 顶层模型。',
            400
        );
    }
    if (model.length > 128) {
        throw new RequestValidationError('Responses API 顶层模型名称不能超过 128 个字符。', 400);
    }
    return model;
}

function readResponsesImageExtensions(
    formData: FormData
): Pick<ResponsesImageGenerateInput, 'promptOptimization' | 'thinking'> {
    const promptOptimization = readBooleanAlias(formData, 'promptOptimization', 'prompt_optimization');
    const thinking = readThinking(formData);
    return {
        ...(promptOptimization !== undefined ? { promptOptimization } : {}),
        ...(thinking ? { thinking } : {})
    };
}

function openAiRequestOptions(input: CommonModeInput): OpenAI.RequestOptions | undefined {
    return input.abortSignal ? { signal: input.abortSignal } : undefined;
}

async function createResponsesImageResult(input: CommonModeInput, options: GenerateOptions): Promise<ImageModeResult> {
    if (options.n !== 1) {
        throw new RequestValidationError('Responses API 图片后端当前只支持单张生成。', 400);
    }
    appLogger.info('调用 Responses API image_generation 实验后端。', input.requestLogContext);
    return {
        outputFormat: options.outputFormat,
        result: await generateImageWithResponsesBackend({
            responses: input.openai.responses,
            prompt: input.prompt,
            responsesModel: readResponsesApiModel(input.formData),
            imageModel: input.model,
            size: readResponsesImageSize(options.size),
            quality: options.quality,
            outputFormat: options.outputFormat,
            background: options.background,
            moderation: options.moderation,
            abortSignal: input.abortSignal,
            ...(options.outputCompression !== undefined ? { outputCompression: options.outputCompression } : {}),
            ...readResponsesImageExtensions(input.formData)
        })
    };
}

async function createResponsesImageResultOnly(
    input: CommonModeInput,
    options: GenerateOptions
): Promise<OpenAI.Images.ImagesResponse> {
    if (options.n !== 1) {
        throw new RequestValidationError('Responses API 图片后端当前只支持单张生成。', 400);
    }
    return generateImageWithResponsesBackend({
        responses: input.openai.responses,
        prompt: input.prompt,
        responsesModel: readResponsesApiModel(input.formData),
        imageModel: input.model,
        size: readResponsesImageSize(options.size),
        quality: options.quality,
        outputFormat: options.outputFormat,
        background: options.background,
        moderation: options.moderation,
        abortSignal: input.abortSignal,
        ...(options.outputCompression !== undefined ? { outputCompression: options.outputCompression } : {}),
        ...readResponsesImageExtensions(input.formData)
    });
}

async function createResponsesImageStreamResponse(
    input: CommonModeInput,
    options: GenerateOptions
): Promise<ImageModeResult> {
    if (options.n !== 1) {
        throw new RequestValidationError('Responses API 图片后端当前只支持单张生成。', 400);
    }
    const streamInput = {
        responses: input.openai.responses,
        prompt: input.prompt,
        responsesModel: readResponsesApiModel(input.formData),
        imageModel: input.model,
        size: readResponsesImageSize(options.size),
        quality: options.quality,
        outputFormat: options.outputFormat,
        background: options.background,
        moderation: options.moderation,
        partialImagesCount: input.partialImagesCount,
        abortSignal: input.abortSignal,
        ...(options.outputCompression !== undefined ? { outputCompression: options.outputCompression } : {}),
        ...readResponsesImageExtensions(input.formData)
    };
    let stream;
    try {
        stream = await createResponsesImageStream(streamInput);
    } catch (error) {
        if (!input.streamFallbackEnabled) throw error;
        input.onStreamUnavailable?.(error, 'stream_request_failed');
        return { outputFormat: options.outputFormat, result: await createResponsesImageResultOnly(input, options) };
    }
    const response = createImageStreamResponse({
        stream,
        modeLabel: '生成',
        outputFormat: options.outputFormat,
        storageMode: input.storageMode,
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        model: input.model,
        startedAtMs: input.startedAtMs,
        abortSignal: input.abortSignal,
        clientRequestId: input.clientRequestId,
        requestLogContext: input.requestLogContext,
        resolveActualCost: resolveRequestActualCostSafely,
        onError: (error) => reportServerCredentialFailure(input.selectedCredential, error),
        onStreamUnavailable: input.onStreamUnavailable,
        onStreamingDegraded: input.onStreamingDegraded,
        fallbackOnError: input.streamFallbackEnabled
            ? () => createResponsesImageResultOnly(input, options)
            : undefined
    });
    return appendAccessCookie(response, input.accessCookie);
}

async function createImagesGenerateResultOnly(
    input: CommonModeInput,
    options: GenerateOptions
): Promise<OpenAI.Images.ImagesResponse> {
    const params: OpenAI.Images.ImageGenerateParamsNonStreaming = { ...options.baseParams, stream: false };
    appLogger.info('调用 OpenAI generate。', input.requestLogContext);
    appLogger.debug('调用 OpenAI generate，参数：', { ...params, ...input.requestLogContext });
    return input.openai.images.generate(params, openAiRequestOptions(input));
}

async function createGenerateStreamResponse(input: CommonModeInput, options: GenerateOptions): Promise<ImageModeResult> {
    const streamParams = {
        ...options.baseParams,
        stream: true as const,
        partial_images: input.partialImagesCount
    } satisfies OpenAI.Images.ImageGenerateParamsStreaming;
    let stream;
    try {
        stream = await createImagesApiGenerateStream({
            apiBaseUrl: input.apiBaseUrl,
            apiKey: input.apiKey,
            abortSignal: input.abortSignal,
            params: streamParams
        });
    } catch (error) {
        if (!input.streamFallbackEnabled) throw error;
        input.onStreamUnavailable?.(error, 'stream_request_failed');
        return { outputFormat: options.outputFormat, result: await createImagesGenerateResultOnly(input, options) };
    }
    const response = createImageStreamResponse({
        stream,
        modeLabel: '生成',
        outputFormat: options.outputFormat,
        storageMode: input.storageMode,
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        model: input.model,
        startedAtMs: input.startedAtMs,
        abortSignal: input.abortSignal,
        clientRequestId: input.clientRequestId,
        requestLogContext: input.requestLogContext,
        resolveActualCost: resolveRequestActualCostSafely,
        onError: (error) => reportServerCredentialFailure(input.selectedCredential, error),
        onStreamUnavailable: input.onStreamUnavailable,
        onStreamingDegraded: input.onStreamingDegraded,
        fallbackOnError: input.streamFallbackEnabled
            ? () => createImagesGenerateResultOnly(input, options)
            : undefined
    });
    return appendAccessCookie(response, input.accessCookie);
}

export async function handleGenerateImageMode(
    input: CommonModeInput & { imageBackend: ImageBackend }
): Promise<ImageModeResult> {
    const options = readGenerateOptions(input);
    if (input.imageBackend === 'responses-image-generation') {
        if (input.streamEnabled) {
            return createResponsesImageStreamResponse(input, options);
        }
        return createResponsesImageResult(input, options);
    }
    if (!input.streamEnabled) {
        return {
            outputFormat: options.outputFormat,
            result: await createImagesGenerateResultOnly(input, options)
        };
    }
    return createGenerateStreamResponse(input, options);
}

function readEditOptions(input: CommonModeInput): EditOptions {
    const n = readCount(input.formData, 'n', 1, 1, 10);
    const size = readSize(input.formData, 'size', 'auto', input.model);
    const quality = readEditQuality(input.formData);
    const outputFormat = readOutputFormat(input.formData);
    const outputCompression = readOutputCompression(input.formData, outputFormat);
    const moderation = readModeration(input.formData);
    const forceWeb = readBooleanAlias(input.formData, 'force_web', 'forceWeb');
    const imageFiles = readImageFiles(input.formData);
    const maskFile = readMaskFile(input.formData);
    const baseEditParams: EditOptions['baseEditParams'] = {
        model: input.model,
        prompt: input.prompt,
        image: imageFiles,
        n,
        size: size === 'auto' ? undefined : (size as OpenAI.Images.ImageEditParams['size']),
        quality,
        output_format: outputFormat,
        moderation
    };
    if (outputCompression !== undefined) {
        baseEditParams.output_compression = outputCompression;
    }
    if (forceWeb !== undefined) {
        baseEditParams.force_web = forceWeb;
    }
    return {
        imageFiles,
        ...(maskFile ? { maskFile } : {}),
        n,
        size,
        quality,
        outputFormat,
        moderation,
        ...(outputCompression !== undefined ? { outputCompression } : {}),
        ...(forceWeb !== undefined ? { forceWeb } : {}),
        baseEditParams
    };
}

function logEditParams(input: CommonModeInput, options: EditOptions, params: object) {
    appLogger.debug('调用 OpenAI edit，参数：', {
        ...params,
        image: `[${options.imageFiles.map((file) => file.name).join(', ')}]`,
        mask: options.maskFile ? options.maskFile.name : 'N/A',
        ...input.requestLogContext
    });
}

async function createEditResultOnly(
    input: CommonModeInput,
    options: EditOptions
): Promise<OpenAI.Images.ImagesResponse> {
    const params: OpenAI.Images.ImageEditParamsNonStreaming & {
        output_compression?: number;
        moderation?: Moderation;
        force_web?: boolean;
    } = {
        ...options.baseEditParams,
        stream: false,
        ...(options.maskFile ? { mask: options.maskFile } : {})
    };
    appLogger.info('调用 OpenAI edit。', input.requestLogContext);
    logEditParams(input, options, params);
    return input.openai.images.edit(params, openAiRequestOptions(input));
}

async function createEditStreamResponse(input: CommonModeInput, options: EditOptions): Promise<ImageModeResult> {
    appLogger.info('调用 OpenAI edit 流式接口。', input.requestLogContext);
    appLogger.debug('调用 OpenAI edit 流式接口，参数：', {
        ...options.baseEditParams,
        stream: true,
        partial_images: input.partialImagesCount,
        image: `[${options.imageFiles.map((file) => file.name).join(', ')}]`,
        mask: options.maskFile ? options.maskFile.name : 'N/A',
        ...input.requestLogContext
    });
    const streamEditParams = {
        ...options.baseEditParams,
        stream: true as const,
        partial_images: input.partialImagesCount,
        ...(options.maskFile ? { mask: options.maskFile } : {})
    };
    let stream;
    try {
        stream = await input.openai.images.edit(streamEditParams, openAiRequestOptions(input));
    } catch (error) {
        if (!input.streamFallbackEnabled) throw error;
        input.onStreamUnavailable?.(error, 'stream_request_failed');
        return { outputFormat: options.outputFormat, result: await createEditResultOnly(input, options) };
    }
    const response = createImageStreamResponse({
        stream,
        modeLabel: '编辑',
        outputFormat: options.outputFormat,
        storageMode: input.storageMode,
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        model: input.model,
        startedAtMs: input.startedAtMs,
        abortSignal: input.abortSignal,
        clientRequestId: input.clientRequestId,
        requestLogContext: input.requestLogContext,
        resolveActualCost: resolveRequestActualCostSafely,
        onError: (error) => reportServerCredentialFailure(input.selectedCredential, error),
        onStreamUnavailable: input.onStreamUnavailable,
        onStreamingDegraded: input.onStreamingDegraded,
        fallbackOnError: input.streamFallbackEnabled ? () => createEditResultOnly(input, options) : undefined
    });
    return appendAccessCookie(response, input.accessCookie);
}

export async function handleEditImageMode(
    input: CommonModeInput & { imageBackend: ImageBackend }
): Promise<ImageModeResult> {
    const options = readEditOptions(input);
    if (input.imageBackend === 'responses-image-generation') {
        if (options.n !== 1) {
            throw new RequestValidationError('Responses API 图片后端当前只支持单张编辑。', 400);
        }
        const responseInput = {
            responses: input.openai.responses,
            prompt: input.prompt,
            responsesModel: readResponsesApiModel(input.formData),
            imageModel: input.model,
            imageFiles: options.imageFiles,
            ...(options.maskFile ? { maskFile: options.maskFile } : {}),
            size: readResponsesImageSize(options.size),
            quality: options.quality || 'auto',
            outputFormat: options.outputFormat,
            background: 'auto' as const,
            moderation: options.moderation,
            abortSignal: input.abortSignal,
            ...(options.outputCompression !== undefined ? { outputCompression: options.outputCompression } : {}),
            ...readResponsesImageExtensions(input.formData)
        };
        if (input.streamEnabled) {
            let stream;
            try {
                stream = await createResponsesImageEditStream({
                    ...responseInput,
                    partialImagesCount: input.partialImagesCount
                });
            } catch (error) {
                if (!input.streamFallbackEnabled) throw error;
                reportServerCredentialFailure(input.selectedCredential, error);
                input.onStreamUnavailable?.(error, 'stream_request_failed');
                return { outputFormat: options.outputFormat, result: await editImageWithResponsesBackend(responseInput) };
            }
            const response = createImageStreamResponse({
                stream,
                modeLabel: '编辑',
                outputFormat: options.outputFormat,
                storageMode: input.storageMode,
                apiBaseUrl: input.apiBaseUrl,
                apiKey: input.apiKey,
                model: input.model,
                startedAtMs: input.startedAtMs,
                abortSignal: input.abortSignal,
                clientRequestId: input.clientRequestId,
                requestLogContext: input.requestLogContext,
                resolveActualCost: resolveRequestActualCostSafely,
                onError: (error) => reportServerCredentialFailure(input.selectedCredential, error),
                onStreamUnavailable: input.onStreamUnavailable,
                onStreamingDegraded: input.onStreamingDegraded,
                fallbackOnError: input.streamFallbackEnabled
                    ? () => editImageWithResponsesBackend(responseInput)
                    : undefined
            });
            return appendAccessCookie(response, input.accessCookie);
        }
        return { outputFormat: options.outputFormat, result: await editImageWithResponsesBackend(responseInput) };
    }
    if (!input.streamEnabled) {
        return { outputFormat: options.outputFormat, result: await createEditResultOnly(input, options) };
    }
    return createEditStreamResponse(input, options);
}
