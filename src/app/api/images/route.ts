import {
    type ChannelCredential,
    describeChannelFailure,
    isChannelFailure,
    isCredentialFailure,
    resolveEffectiveCredential
} from '@/lib/channel-router';
import {
    RequestValidationError,
    assertSafeApiOverride,
    createImageResult,
    readBackground,
    readCount,
    readEditQuality,
    readGenerateQuality,
    readImageFiles,
    readMaskFile,
    readMode,
    readModel,
    readModeration,
    readOutputCompression,
    readOutputFormat,
    readRequiredText,
    readSize,
    readStorageMode,
    validateApiBaseUrl,
    type GenerateParams,
    type ValidOutputFormat
} from '@/lib/image-request-utils';
import { appLogger } from '@/lib/app-logger';
import {
    InvalidOpenAiImagesResponseError,
    MissingOpenAiImageDataError,
    persistedImageToLegacyResponse,
    persistOpenAiImages
} from '@/lib/image-service';
import { getServerChannelState } from '@/lib/server-channel-router';
import { createBatchId, createImageFilename, outputDir, readAffinityKey, verifyPasswordHash } from '@/lib/server-runtime';
import { resolveActualCost, type ActualCostDetails } from '@/lib/upstream-cost/resolve';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import path from 'path';

// 流式事件类型。
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

function readClientRequestId(formData: FormData): string | undefined {
    const value = formData.get('clientRequestId');
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    return normalized.slice(0, 128);
}

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
            if (isClosed) {
                return false;
            }
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
            if (isClosed) {
                return;
            }
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

function reportServerCredentialFailure(credential: ChannelCredential | undefined, error: unknown) {
    const serverChannelRouter = getServerChannelState().router;
    if (!credential || !serverChannelRouter) {
        return;
    }
    if (isChannelFailure(error)) {
        const reason = describeChannelFailure(error, 'channel');
        serverChannelRouter.reportFailure(credential, { scope: 'channel', reason });
        appLogger.warn(`暂时冷却 API 渠道：${credential.channelId}`, reason);
        return;
    }
    if (isCredentialFailure(error)) {
        const reason = describeChannelFailure(error, 'credential');
        serverChannelRouter.reportFailure(credential, { reason });
        appLogger.warn(`暂时冷却 API 渠道凭证：${credential.channelId}/${credential.id}`, reason);
    }
}

function describeInvalidImagesResponse(result: unknown): string {
    if (typeof result === 'string') {
        const normalized = result.trim().toLowerCase();
        if (normalized.includes('<!doctype html') || normalized.includes('<html')) {
            return 'API 返回的是 HTML 页面，不是 OpenAI Images JSON 响应。请确认 API URL 填的是兼容接口根地址，通常需要以 /v1 结尾，例如 https://api.openai.com/v1；不要填写管理后台或网页首页地址。';
        }
    }

    return 'API 返回的数据不是 OpenAI Images 格式。请确认 API URL 是 OpenAI 兼容接口，并且该接口支持 Images generate/edit。';
}

async function ensureOutputDirExists() {
    try {
        await fs.access(outputDir);
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            try {
                await fs.mkdir(outputDir, { recursive: true });
                appLogger.info(`已创建图片输出目录：${outputDir}`);
            } catch (mkdirError) {
                appLogger.error(`创建图片输出目录失败 ${outputDir}：`, mkdirError);
                throw new Error('创建图片输出目录失败。');
            }
        } else {
            appLogger.error(`访问图片输出目录失败 ${outputDir}：`, error);
            throw new Error(
                `访问或确认图片输出目录失败。原始错误：${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

async function resolveRequestActualCost(input: {
    apiBaseUrl?: string;
    apiKey: string;
    model: string;
    startedAtMs: number;
    expectedImageCount: number;
}): Promise<ActualCostDetails> {
    const finishedAtMs = Date.now();
    if (!input.apiBaseUrl) {
        return resolveActualCost({
            model: input.model,
            startedAtMs: input.startedAtMs,
            finishedAtMs,
            expectedImageCount: input.expectedImageCount
        });
    }
    return resolveActualCost({
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        model: input.model,
        startedAtMs: input.startedAtMs,
        finishedAtMs,
        expectedImageCount: input.expectedImageCount
    });
}

async function resolveRequestActualCostSafely(input: {
    apiBaseUrl?: string;
    apiKey: string;
    model: string;
    startedAtMs: number;
    expectedImageCount: number;
    requestLogContext?: { clientRequestId: string };
}): Promise<ActualCostDetails> {
    try {
        return await resolveRequestActualCost(input);
    } catch (error) {
        appLogger.warn('解析实际扣费失败，继续返回图片结果。', {
            ...input.requestLogContext,
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            currency: 'usd-equivalent',
            source: 'unavailable',
            confidence: 'none',
            upstreamProvider: 'unknown',
            reason: '解析实际扣费失败。'
        };
    }
}

export async function POST(request: NextRequest) {
    let selectedServerCredential: ChannelCredential | undefined;
    let clientRequestId: string | undefined;
    let requestLogContext: { clientRequestId: string } | undefined;
    try {
        const serverChannelRouter = getServerChannelState().router;
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
            return NextResponse.json({ error: '请求正文无效：必须是 multipart/form-data。' }, { status: 400 });
        }
        const formData = await request.formData();
        clientRequestId = readClientRequestId(formData);
        requestLogContext = clientRequestId ? { clientRequestId } : undefined;
        const requestApiKey = String(formData.get('apiKey') || '').trim();
        const requestApiBaseUrl = String(formData.get('apiBaseUrl') || '').trim();
        assertSafeApiOverride(requestApiKey, requestApiBaseUrl);
        validateApiBaseUrl(requestApiBaseUrl);
        selectedServerCredential = requestApiKey
            ? undefined
            : serverChannelRouter?.select({ affinityKey: readAffinityKey(request.headers) });
        const {
            apiKey: effectiveApiKey,
            baseUrl: effectiveApiBaseUrl,
            selectedCredential
        } = resolveEffectiveCredential({
            requestApiKey,
            requestApiBaseUrl,
            legacyBaseUrl: process.env.OPENAI_API_BASE_URL,
            selectedCredential: selectedServerCredential
        });
        validateApiBaseUrl(effectiveApiBaseUrl || '');

        if (!effectiveApiKey) {
            appLogger.error('未设置 OPENAI_API_KEY，且请求未提供 API Key。', requestLogContext);
            return NextResponse.json(
                { error: '请在 API 设置中填写 API Key，或配置 OPENAI_API_KEY 环境变量。' },
                { status: 400 }
            );
        }
        if (selectedCredential) {
            appLogger.info(
                `已选择 API 渠道：${selectedCredential.channelId}，凭证：${selectedCredential.id}，策略：server`,
                requestLogContext
            );
        }

        const openai = new OpenAI({
            apiKey: effectiveApiKey,
            baseURL: effectiveApiBaseUrl || undefined
        });

        const effectiveStorageMode = readStorageMode(process.env);
        appLogger.info(`实际图片存储模式：${effectiveStorageMode}`, requestLogContext);

        if (effectiveStorageMode === 'fs') {
            await ensureOutputDirExists();
        }

        const appPassword = process.env.APP_PASSWORD;
        if (appPassword) {
            const clientPasswordHash = formData.get('passwordHash');
            if (typeof clientPasswordHash !== 'string' || !clientPasswordHash) {
                appLogger.error('缺少密码哈希。', requestLogContext);
                return NextResponse.json({ error: '未授权：缺少密码哈希。' }, { status: 401 });
            }
            if (!verifyPasswordHash(clientPasswordHash, appPassword)) {
                appLogger.error('密码哈希无效。', requestLogContext);
                return NextResponse.json({ error: '未授权：密码无效。' }, { status: 401 });
            }
        }

        const mode = readMode(formData);
        const prompt = readRequiredText(formData, 'prompt');
        const model = readModel(formData);
        const upstreamStartedAtMs = Date.now();

        appLogger.info(`开始处理图片请求。模式：${mode}，模型：${model}`, requestLogContext);
        appLogger.debug(`模式：${mode}，模型：${model}，提示词：${prompt ? prompt.substring(0, 50) + '...' : 'N/A'}`, requestLogContext);

        const streamEnabled = formData.get('stream') === 'true';
        const partialImagesCount = readCount(formData, 'partial_images', 2, 1, 3) as 1 | 2 | 3;

        let result: OpenAI.Images.ImagesResponse;
        let responseOutputFormat: ValidOutputFormat = 'png';

        if (mode === 'generate') {
            const n = readCount(formData, 'n', 1, 1, 10);
            const size = readSize(formData, 'size', '1024x1024', model) as OpenAI.Images.ImageGenerateParams['size'];
            const quality = readGenerateQuality(formData) as OpenAI.Images.ImageGenerateParams['quality'];
            const outputFormat = readOutputFormat(formData);
            const outputCompression = readOutputCompression(formData, outputFormat);
            const background = readBackground(formData, model) as OpenAI.Images.ImageGenerateParams['background'];
            const moderation = readModeration(formData) as OpenAI.Images.ImageGenerateParams['moderation'];
            responseOutputFormat = outputFormat;

            const baseParams: GenerateParams = {
                model,
                prompt,
                n,
                size,
                quality,
                output_format: outputFormat,
                background,
                moderation
            };

            if (outputCompression !== undefined) {
                baseParams.output_compression = outputCompression;
            }

            // 处理生成模式的流式响应。
            if (streamEnabled) {
                const streamParams = {
                    ...baseParams,
                    stream: true as const,
                    partial_images: partialImagesCount
                } satisfies OpenAI.Images.ImageGenerateParamsStreaming;

                const stream = await openai.images.generate(streamParams);

                // 创建 SSE 响应。
                const encoder = new TextEncoder();
                const batchId = createBatchId();
                const fileExtension = outputFormat;

                const readableStream = new ReadableStream({
                    async start(controller) {
                        const sse = createSseWriter(controller, encoder);
                        try {
                            const completedImages: Array<{
                                filename: string;
                                b64_json: string;
                                path?: string;
                                output_format: string;
                            }> = [];
                            let finalUsage: OpenAI.Images.ImagesResponse['usage'] | undefined;
                            let imageIndex = 0;

                            for await (const event of stream) {
                                if (event.type === 'image_generation.partial_image') {
                                    const partialEvent: StreamingEvent = {
                                        type: 'partial_image',
                                        index: imageIndex,
                                        partial_image_index: event.partial_image_index,
                                        partialImageIndex: event.partial_image_index,
                                        b64_json: event.b64_json
                                    };
                                    sse.send(partialEvent);
                                } else if (event.type === 'image_generation.completed') {
                                    const currentIndex = imageIndex;
                                    const filename = createImageFilename(batchId, currentIndex, fileExtension);

                                    // fs 模式下保存到文件系统。
                                    if (effectiveStorageMode === 'fs' && event.b64_json) {
                                        const buffer = Buffer.from(event.b64_json, 'base64');
                                        const filepath = path.join(outputDir, filename);
                                        await fs.writeFile(filepath, buffer);
                                        appLogger.info(`流式生成：已保存图片 ${filename}`, {
                                            ...requestLogContext,
                                            filenames: [filename]
                                        });
                                    }

                                    const imageData = createImageResult(
                                        filename,
                                        event.b64_json || '',
                                        fileExtension,
                                        effectiveStorageMode
                                    );
                                    completedImages.push(imageData);

                                    const completedEvent: StreamingEvent = {
                                        type: 'completed',
                                        index: currentIndex,
                                        filename,
                                        b64_json: event.b64_json,
                                        path: effectiveStorageMode === 'fs' ? `/api/image/${filename}` : undefined,
                                        output_format: fileExtension,
                                        outputFormat: fileExtension,
                                        client_request_id: clientRequestId,
                                        clientRequestId
                                    };
                                    sse.send(completedEvent);

                                    imageIndex++;

                                    // 如果完成事件带有 usage，则记录用量。
                                    if ('usage' in event && event.usage) {
                                        finalUsage = event.usage as OpenAI.Images.ImagesResponse['usage'];
                                    }
                                }
                            }

                            const actualCost = await resolveRequestActualCostSafely({
                                apiBaseUrl: effectiveApiBaseUrl,
                                apiKey: effectiveApiKey,
                                model,
                                startedAtMs: upstreamStartedAtMs,
                                expectedImageCount: completedImages.length,
                                requestLogContext
                            });

                            // 发送包含全部图片、用量和实际扣费状态的最终 done 事件。
                            const doneEvent: StreamingEvent = {
                                type: 'done',
                                images: completedImages,
                                usage: finalUsage,
                                actual_cost: actualCost,
                                actualCost,
                                client_request_id: clientRequestId,
                                clientRequestId
                            };
                            sse.send(doneEvent);
                            sse.close();
                        } catch (error) {
                            reportServerCredentialFailure(selectedCredential, error);
                            appLogger.error('流式生成失败：', { ...requestLogContext, error: error instanceof Error ? error.message : String(error) });
                            const status = readErrorStatus(error);
                            const errorEvent: StreamingEvent = {
                                type: 'error',
                                error: error instanceof Error ? error.message : '流式处理失败',
                                ...(status ? { status } : {})
                            };
                            sse.send(errorEvent);
                            sse.close();
                        }
                    }
                });

                return new Response(readableStream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        ...(clientRequestId ? { 'X-Client-Request-Id': clientRequestId } : {})
                    }
                });
            }

            const params: OpenAI.Images.ImageGenerateParamsNonStreaming = { ...baseParams, stream: false };
            appLogger.info('调用 OpenAI generate。', requestLogContext);
            appLogger.debug('调用 OpenAI generate，参数：', { ...params, ...requestLogContext });
            result = await openai.images.generate(params);
        } else if (mode === 'edit') {
            const n = readCount(formData, 'n', 1, 1, 10);
            const size = readSize(formData, 'size', 'auto', model) as OpenAI.Images.ImageEditParams['size'];
            const quality = readEditQuality(formData) as OpenAI.Images.ImageEditParams['quality'];
            const imageFiles = readImageFiles(formData);
            const maskFile = readMaskFile(formData);

            const baseEditParams = {
                model,
                prompt,
                image: imageFiles,
                n,
                size: size === 'auto' ? undefined : size,
                quality: quality === 'auto' ? undefined : quality
            };

            // 处理编辑模式的流式响应。
            if (streamEnabled) {
                appLogger.info('调用 OpenAI edit 流式接口。', requestLogContext);
                appLogger.debug('调用 OpenAI edit 流式接口，参数：', {
                    ...baseEditParams,
                    stream: true,
                    partial_images: partialImagesCount,
                    image: `[${imageFiles.map((f) => f.name).join(', ')}]`,
                    mask: maskFile ? maskFile.name : 'N/A',
                    ...requestLogContext
                });

                const streamEditParams = {
                    ...baseEditParams,
                    stream: true as const,
                    partial_images: partialImagesCount,
                    ...(maskFile ? { mask: maskFile } : {})
                };

                const stream = await openai.images.edit(streamEditParams);

                // 为编辑请求创建 SSE 响应。
                const encoder = new TextEncoder();
                const batchId = createBatchId();
                const fileExtension: ValidOutputFormat = 'png';

                const readableStream = new ReadableStream({
                    async start(controller) {
                        const sse = createSseWriter(controller, encoder);
                        try {
                            const completedImages: Array<{
                                filename: string;
                                b64_json: string;
                                path?: string;
                                output_format: string;
                            }> = [];
                            let finalUsage: OpenAI.Images.ImagesResponse['usage'] | undefined;
                            let imageIndex = 0;

                            for await (const event of stream) {
                                if (event.type === 'image_edit.partial_image') {
                                    const partialEvent: StreamingEvent = {
                                        type: 'partial_image',
                                        index: imageIndex,
                                        partial_image_index: event.partial_image_index,
                                        partialImageIndex: event.partial_image_index,
                                        b64_json: event.b64_json
                                    };
                                    sse.send(partialEvent);
                                } else if (event.type === 'image_edit.completed') {
                                    const currentIndex = imageIndex;
                                    const filename = createImageFilename(batchId, currentIndex, fileExtension);

                                    // fs 模式下保存到文件系统。
                                    if (effectiveStorageMode === 'fs' && event.b64_json) {
                                        const buffer = Buffer.from(event.b64_json, 'base64');
                                        const filepath = path.join(outputDir, filename);
                                        await fs.writeFile(filepath, buffer);
                                        appLogger.info(`流式编辑：已保存图片 ${filename}`, {
                                            ...requestLogContext,
                                            filenames: [filename]
                                        });
                                    }

                                    const imageData = createImageResult(
                                        filename,
                                        event.b64_json || '',
                                        fileExtension,
                                        effectiveStorageMode
                                    );
                                    completedImages.push(imageData);

                                    const completedEvent: StreamingEvent = {
                                        type: 'completed',
                                        index: currentIndex,
                                        filename,
                                        b64_json: event.b64_json,
                                        path: effectiveStorageMode === 'fs' ? `/api/image/${filename}` : undefined,
                                        output_format: fileExtension,
                                        outputFormat: fileExtension,
                                        client_request_id: clientRequestId,
                                        clientRequestId
                                    };
                                    sse.send(completedEvent);

                                    imageIndex++;

                                    // 如果完成事件带有 usage，则记录用量。
                                    if ('usage' in event && event.usage) {
                                        finalUsage = event.usage as OpenAI.Images.ImagesResponse['usage'];
                                    }
                                }
                            }

                            const actualCost = await resolveRequestActualCostSafely({
                                apiBaseUrl: effectiveApiBaseUrl,
                                apiKey: effectiveApiKey,
                                model,
                                startedAtMs: upstreamStartedAtMs,
                                expectedImageCount: completedImages.length,
                                requestLogContext
                            });

                            // 发送包含全部图片、用量和实际扣费状态的最终 done 事件。
                            const doneEvent: StreamingEvent = {
                                type: 'done',
                                images: completedImages,
                                usage: finalUsage,
                                actual_cost: actualCost,
                                actualCost,
                                client_request_id: clientRequestId,
                                clientRequestId
                            };
                            sse.send(doneEvent);
                            sse.close();
                        } catch (error) {
                            reportServerCredentialFailure(selectedCredential, error);
                            appLogger.error('流式编辑失败：', { ...requestLogContext, error: error instanceof Error ? error.message : String(error) });
                            const status = readErrorStatus(error);
                            const errorEvent: StreamingEvent = {
                                type: 'error',
                                error: error instanceof Error ? error.message : '流式处理失败',
                                ...(status ? { status } : {})
                            };
                            sse.send(errorEvent);
                            sse.close();
                        }
                    }
                });

                return new Response(readableStream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        ...(clientRequestId ? { 'X-Client-Request-Id': clientRequestId } : {})
                    }
                });
            }

            const params: OpenAI.Images.ImageEditParams = {
                ...baseEditParams,
                ...(maskFile ? { mask: maskFile } : {})
            };

            appLogger.info('调用 OpenAI edit。', requestLogContext);
            appLogger.debug('调用 OpenAI edit，参数：', {
                ...params,
                image: `[${imageFiles.map((f) => f.name).join(', ')}]`,
                mask: maskFile ? maskFile.name : 'N/A',
                ...requestLogContext
            });
            result = await openai.images.edit(params);
        } else {
            return NextResponse.json({ error: 'mode 无效' }, { status: 400 });
        }

        appLogger.info('OpenAI API 调用成功。', requestLogContext);

        try {
            const savedImages = await persistOpenAiImages({
                result,
                outputFormat: responseOutputFormat,
                storageMode: effectiveStorageMode,
                includeBase64: true
            });
            const savedImagesData = savedImages.map((image) => ({
                ...persistedImageToLegacyResponse(image),
                ...(clientRequestId ? { clientRequestId } : {})
            }));
            const actualCost = await resolveRequestActualCostSafely({
                apiBaseUrl: effectiveApiBaseUrl,
                apiKey: effectiveApiKey,
                model,
                startedAtMs: upstreamStartedAtMs,
                expectedImageCount: savedImagesData.length,
                requestLogContext
            });

            appLogger.info(`所有图片已处理。模式：${effectiveStorageMode}`, {
                ...requestLogContext,
                filenames: savedImagesData.map((image) => image.filename)
            });

            return NextResponse.json({ images: savedImagesData, usage: result.usage, actualCost, clientRequestId });
        } catch (persistError) {
            if (persistError instanceof MissingOpenAiImageDataError) {
                appLogger.error(`第 ${persistError.index} 个图片数据缺少 b64_json。`, requestLogContext);
                throw persistError;
            }
            if (!(persistError instanceof InvalidOpenAiImagesResponseError)) {
                throw persistError;
            }
            const invalidResult: unknown = persistError.result;
            appLogger.error('OpenAI API 返回的数据无效或为空：', {
                type: typeof invalidResult,
                preview: typeof invalidResult === 'string' ? invalidResult.slice(0, 300) : invalidResult,
                ...requestLogContext
            });
            reportServerCredentialFailure(selectedCredential, { status: 502 });
            return NextResponse.json({ error: describeInvalidImagesResponse(invalidResult) }, { status: 502 });
        }
    } catch (error: unknown) {
        reportServerCredentialFailure(selectedServerCredential, error);
        appLogger.error('/api/images 处理失败：', { ...requestLogContext, error: error instanceof Error ? error.message : String(error) });

        let errorMessage = '发生未知错误。';
        let status = 500;

        if (error instanceof RequestValidationError) {
            errorMessage = error.message;
            status = error.status;
        } else if (error instanceof Error) {
            errorMessage = error.message;
            if (errorMessage.includes('<!DOCTYPE html') || errorMessage.includes('<html')) {
                errorMessage = describeInvalidImagesResponse(errorMessage);
            }
            if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        } else if (typeof error === 'object' && error !== null) {
            if ('message' in error && typeof error.message === 'string') {
                errorMessage = error.message;
            }
            if ('status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
}
