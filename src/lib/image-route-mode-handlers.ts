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
    type GenerateParams,
    type GenerateQuality,
    type GptImageModel,
    type Moderation,
    type StorageMode,
    type ValidOutputFormat
} from './image-request-utils';
import { createImageStreamResponse } from './image-stream-service';
import {
    createResponsesImageStream,
    generateImageWithResponsesBackend,
    type ResponsesImageGenerateInput
} from './responses-image-backend';
import {
    appendAccessCookie,
    reportServerCredentialFailure,
    resolveRequestActualCostSafely,
    type AccessCookie,
    type ImageBackend,
    type RequestLogContext
} from './image-route-support';
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
    baseParams: GenerateParams;
};

type EditOptions = {
    imageFiles: File[];
    maskFile?: File;
    baseEditParams: {
        model: GptImageModel;
        prompt: string;
        image: File[];
        n: number;
        size?: OpenAI.Images.ImageEditParams['size'];
        quality?: OpenAI.Images.ImageEditParams['quality'];
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
    return { n, size, quality, outputFormat, outputCompression, background, moderation, baseParams };
}

function readResponsesImageSize(size: string): ResponsesImageGenerateInput['size'] {
    if (size === 'auto' || size === '1024x1024' || size === '1024x1536' || size === '1536x1024') {
        return size;
    }
    throw new RequestValidationError('Responses API 图片后端当前只支持 auto、1024x1024、1024x1536 或 1536x1024 尺寸。', 400);
}

function readResponsesApiModel(formData: FormData): string {
    const requestValue = formData.get('responsesModel');
    const rawValue =
        typeof requestValue === 'string' && requestValue.trim()
            ? requestValue
            : process.env.OPENAI_RESPONSES_API_MODEL;
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

async function createResponsesImageResult(
    input: CommonModeInput,
    options: GenerateOptions
): Promise<ImageModeResult> {
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
            ...(options.outputCompression !== undefined ? { outputCompression: options.outputCompression } : {})
        })
    };
}

async function createResponsesImageStreamResponse(
    input: CommonModeInput,
    options: GenerateOptions
): Promise<Response> {
    if (options.n !== 1) {
        throw new RequestValidationError('Responses API 图片后端当前只支持单张生成。', 400);
    }
    const stream = await createResponsesImageStream({
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
        ...(options.outputCompression !== undefined ? { outputCompression: options.outputCompression } : {})
    });
    const response = createImageStreamResponse({
        stream,
        modeLabel: '生成',
        outputFormat: options.outputFormat,
        storageMode: input.storageMode,
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        model: input.model,
        startedAtMs: input.startedAtMs,
        clientRequestId: input.clientRequestId,
        requestLogContext: input.requestLogContext,
        resolveActualCost: resolveRequestActualCostSafely,
        onError: (error) => reportServerCredentialFailure(input.selectedCredential, error)
    });
    return appendAccessCookie(response, input.accessCookie);
}

async function createGenerateStreamResponse(input: CommonModeInput, options: GenerateOptions): Promise<Response> {
    const streamParams = {
        ...options.baseParams,
        stream: true as const,
        partial_images: input.partialImagesCount
    } satisfies OpenAI.Images.ImageGenerateParamsStreaming;
    const stream = await input.openai.images.generate(streamParams);
    const response = createImageStreamResponse({
        stream,
        modeLabel: '生成',
        outputFormat: options.outputFormat,
        storageMode: input.storageMode,
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        model: input.model,
        startedAtMs: input.startedAtMs,
        clientRequestId: input.clientRequestId,
        requestLogContext: input.requestLogContext,
        resolveActualCost: resolveRequestActualCostSafely,
        onError: (error) => reportServerCredentialFailure(input.selectedCredential, error)
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
        const params: OpenAI.Images.ImageGenerateParamsNonStreaming = { ...options.baseParams, stream: false };
        appLogger.info('调用 OpenAI generate。', input.requestLogContext);
        appLogger.debug('调用 OpenAI generate，参数：', { ...params, ...input.requestLogContext });
        return { outputFormat: options.outputFormat, result: await input.openai.images.generate(params) };
    }
    return createGenerateStreamResponse(input, options);
}

function readEditOptions(input: CommonModeInput): EditOptions {
    const n = readCount(input.formData, 'n', 1, 1, 10);
    const size = readSize(input.formData, 'size', 'auto', input.model) as OpenAI.Images.ImageEditParams['size'];
    const quality = readEditQuality(input.formData) as OpenAI.Images.ImageEditParams['quality'];
    const imageFiles = readImageFiles(input.formData);
    const maskFile = readMaskFile(input.formData);
    const baseEditParams = {
        model: input.model,
        prompt: input.prompt,
        image: imageFiles,
        n,
        size: size === 'auto' ? undefined : size,
        quality: quality === 'auto' ? undefined : quality
    };
    return { imageFiles, ...(maskFile ? { maskFile } : {}), baseEditParams };
}

function logEditParams(input: CommonModeInput, options: EditOptions, params: object) {
    appLogger.debug('调用 OpenAI edit，参数：', {
        ...params,
        image: `[${options.imageFiles.map((file) => file.name).join(', ')}]`,
        mask: options.maskFile ? options.maskFile.name : 'N/A',
        ...input.requestLogContext
    });
}

async function createEditStreamResponse(input: CommonModeInput, options: EditOptions): Promise<Response> {
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
    const stream = await input.openai.images.edit(streamEditParams);
    const response = createImageStreamResponse({
        stream,
        modeLabel: '编辑',
        outputFormat: 'png',
        storageMode: input.storageMode,
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        model: input.model,
        startedAtMs: input.startedAtMs,
        clientRequestId: input.clientRequestId,
        requestLogContext: input.requestLogContext,
        resolveActualCost: resolveRequestActualCostSafely,
        onError: (error) => reportServerCredentialFailure(input.selectedCredential, error)
    });
    return appendAccessCookie(response, input.accessCookie);
}

export async function handleEditImageMode(input: CommonModeInput): Promise<ImageModeResult> {
    const options = readEditOptions(input);
    if (!input.streamEnabled) {
        const params: OpenAI.Images.ImageEditParams = {
            ...options.baseEditParams,
            ...(options.maskFile ? { mask: options.maskFile } : {})
        };
        appLogger.info('调用 OpenAI edit。', input.requestLogContext);
        logEditParams(input, options, params);
        return { outputFormat: 'png', result: await input.openai.images.edit(params) };
    }
    return createEditStreamResponse(input, options);
}
