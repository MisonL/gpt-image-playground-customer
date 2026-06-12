import { appLogger } from '@/lib/app-logger';
import { type ChannelCredential, resolveEffectiveCredential } from '@/lib/channel-router';
import {
    RequestValidationError,
    assertSafeApiOverride,
    readCount,
    readMode,
    readModel,
    readPlainHttpApiBaseUrlAllowlist,
    readRequiredText,
    readStorageMode,
    validateApiBaseUrl
} from '@/lib/image-request-utils';
import {
    mergeUpstreamHeadersWithFixed,
    readImageUpstreamProfile,
    type PartialImagesCount
} from '@/lib/image-upstream-profile';
import { handleEditImageMode, handleGenerateImageMode } from '@/lib/image-route-mode-handlers';
import {
    assertResponsesImageBackendAllowed,
    attachAccessCookie,
    describeInvalidImagesResponse,
    ensureOutputDirExists,
    readClientRequestId,
    reportServerCredentialFailure,
    resolveRequestActualCostSafely,
    type AccessCookie,
    type RequestLogContext
} from '@/lib/image-route-support';
import {
    InvalidOpenAiImagesResponseError,
    MissingOpenAiImageDataError,
    persistedImageToLegacyResponse,
    persistOpenAiImages
} from '@/lib/image-service';
import {
    readImageGenerationBackend,
    readImageStreamMode,
    readImageStreamingStrategy,
    resolveImageStreamEnabled,
    type ImageGenerationBackend,
    type ImageStreamMode,
    type ImageStreamingStrategy
} from '@/lib/image-upstream-strategy';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { getServerChannelState } from '@/lib/server-channel-router';
import { createOpenAIImageClientOptions } from '@/lib/openai-image-transport';
import type { StreamingAvailabilityKey, StreamingOperation } from '@/lib/streaming-availability';
import { buildAccessCookie, readAffinityKey, verifyPasswordHash } from '@/lib/server-runtime';
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

type StreamResolutionInput = {
    streamMode: ImageStreamMode;
    imageBackend: ImageGenerationBackend;
    streamingStrategy: ImageStreamingStrategy;
    operation: StreamingOperation;
    selectedCredential?: ChannelCredential;
    sourceId?: string;
};

type StreamResolution = {
    availabilityKey: StreamingAvailabilityKey;
    streamEnabled: boolean;
    streamFallbackEnabled: boolean;
    streamingMarkedUnavailable: boolean;
};

function readErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    if ('status' in error && typeof error.status === 'number') return error.status;
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
    return undefined;
}

function readErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    if ('code' in error && typeof error.code === 'string') return error.code;
    if ('error' in error && typeof error.error === 'object' && error.error !== null) {
        const nested = error.error as Record<string, unknown>;
        return typeof nested.code === 'string' ? nested.code : undefined;
    }
    return undefined;
}

function toPartialImagesCount(value: number): PartialImagesCount {
    if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) return value;
    throw new RequestValidationError('partial_images 必须在 0 到 4 之间。');
}

function createAvailabilityKey(input: StreamResolutionInput): StreamingAvailabilityKey {
    return {
        channelId: input.selectedCredential?.channelId,
        sourceId: input.selectedCredential ? undefined : input.sourceId,
        imageBackend: input.imageBackend,
        streamingStrategy: input.streamingStrategy,
        operation: input.operation
    };
}

function createAvailabilitySourceId(input: { selectedCredential?: ChannelCredential; baseUrl?: string }): string | undefined {
    if (input.selectedCredential) return undefined;
    const normalized = normalizeAvailabilityBaseUrl(input.baseUrl);
    const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `upstream:${digest}`;
}

function normalizeAvailabilityBaseUrl(baseUrl: string | undefined): string {
    const rawValue = baseUrl && baseUrl.trim() ? baseUrl.trim() : 'https://api.openai.com/v1';
    try {
        const parsed = new URL(rawValue);
        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.protocol}//${parsed.host}${pathname}`.toLowerCase();
    } catch {
        return 'invalid-upstream';
    }
}

function resolvePageStream(input: StreamResolutionInput): StreamResolution {
    const availabilityKey = createAvailabilityKey(input);
    const streamingAvailability = getServerChannelState().streamingAvailability;
    if (input.streamMode === 'non_stream') {
        return {
            availabilityKey,
            streamEnabled: false,
            streamFallbackEnabled: false,
            streamingMarkedUnavailable: streamingAvailability.isUnavailable(availabilityKey)
        };
    }

    if (input.streamMode === 'auto' && input.streamingStrategy === 'off') {
        return {
            availabilityKey,
            streamEnabled: false,
            streamFallbackEnabled: false,
            streamingMarkedUnavailable: streamingAvailability.isUnavailable(availabilityKey)
        };
    }

    if (input.streamMode === 'auto' && streamingAvailability.isUnavailable(availabilityKey)) {
        return {
            availabilityKey,
            streamEnabled: false,
            streamFallbackEnabled: false,
            streamingMarkedUnavailable: true
        };
    }

    return {
        availabilityKey,
        streamEnabled: resolveImageStreamEnabled({
            imageBackend: input.imageBackend,
            requestedStream: true,
            streamingStrategy: input.streamingStrategy
        }),
        streamFallbackEnabled: input.streamMode === 'auto',
        streamingMarkedUnavailable: false
    };
}

function markStreamingUnavailable(input: {
    key: StreamingAvailabilityKey;
    error?: unknown;
    reason: string;
    status?: number;
}) {
    const status = input.status ?? readErrorStatus(input.error);
    getServerChannelState().streamingAvailability.markUnavailable({
        ...input.key,
        reason: input.reason,
        ...(status !== undefined ? { status } : {}),
        ...(readErrorCode(input.error) ? { code: readErrorCode(input.error) } : {})
    });
}

export async function POST(request: NextRequest) {
    let selectedServerCredential: ChannelCredential | undefined;
    let clientRequestId: string | undefined;
    let requestLogContext: RequestLogContext | undefined;
    let accessCookie: AccessCookie | undefined;
    try {
        const serverChannelState = getServerChannelState();
        const serverChannelRouter = serverChannelState.router;
        const contentType = request.headers.get('content-type') || '';
        if (
            !contentType.includes('multipart/form-data') &&
            !contentType.includes('application/x-www-form-urlencoded')
        ) {
            return NextResponse.json({ error: '请求正文无效：必须是 multipart/form-data。' }, { status: 400 });
        }
        const formData = await request.formData();
        clientRequestId = readClientRequestId(formData);
        requestLogContext = clientRequestId ? { clientRequestId } : undefined;
        const requestApiKey = String(formData.get('apiKey') || '').trim();
        const requestApiBaseUrl = String(formData.get('apiBaseUrl') || '').trim();
        const allowedPlainHttpBaseUrls = readPlainHttpApiBaseUrlAllowlist(
            process.env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS
        );
        assertSafeApiOverride(requestApiKey, requestApiBaseUrl);
        validateApiBaseUrl(requestApiBaseUrl, { allowedPlainHttpBaseUrls });
        selectedServerCredential = requestApiKey
            ? undefined
            : serverChannelRouter?.select({ affinityKey: readAffinityKey(request.headers) });
        const {
            apiKey: effectiveApiKey,
            baseUrl: effectiveApiBaseUrl,
            upstreamProfile: effectiveUpstreamProfileId,
            providerProfile,
            upstreamHeaders,
            selectedCredential
        } = resolveEffectiveCredential({
            requestApiKey,
            requestApiBaseUrl,
            legacyBaseUrl: process.env.OPENAI_API_BASE_URL,
            selectedCredential: selectedServerCredential
        });
        validateApiBaseUrl(effectiveApiBaseUrl || '', { allowedPlainHttpBaseUrls });

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

        const openai = new OpenAI(
            createOpenAIImageClientOptions({
                apiKey: effectiveApiKey,
                baseURL: effectiveApiBaseUrl || undefined,
                defaultHeaders: mergeUpstreamHeadersWithFixed(upstreamHeaders, {})
            })
        );
        const upstreamProfile =
            providerProfile ||
            readImageUpstreamProfile({
                explicitProfile: effectiveUpstreamProfileId,
                channelId: selectedCredential?.channelId,
                baseUrl: effectiveApiBaseUrl
            });

        const effectiveStorageMode = readStorageMode(process.env);
        appLogger.info(`实际图片存储模式：${effectiveStorageMode}`, requestLogContext);

        if (effectiveStorageMode === 'fs') {
            await ensureOutputDirExists();
        }

        const appPassword = process.env.APP_PASSWORD?.trim();
        if (appPassword) {
            const clientPasswordHash = formData.get('passwordHash');
            if (typeof clientPasswordHash !== 'string' || !clientPasswordHash) {
                appLogger.error('缺少访问码哈希。', requestLogContext);
                return NextResponse.json(
                    { error: '未授权：缺少访问码哈希。', code: PAGE_PASSWORD_AUTH_ERROR_CODES.missing },
                    { status: 401 }
                );
            }
            if (!verifyPasswordHash(clientPasswordHash, appPassword)) {
                appLogger.error('访问码哈希无效。', requestLogContext);
                return NextResponse.json(
                    { error: '未授权：访问码无效。', code: PAGE_PASSWORD_AUTH_ERROR_CODES.invalid },
                    { status: 401 }
                );
            }
            accessCookie = buildAccessCookie(appPassword, request.headers);
        }

        const mode = readMode(formData);
        const prompt = readRequiredText(formData, 'prompt');
        const model = readModel(formData);
        const upstreamStartedAtMs = Date.now();

        appLogger.info(`开始处理图片请求。模式：${mode}，模型：${model}`, requestLogContext);
        appLogger.debug(
            `模式：${mode}，模型：${model}，提示词：${prompt ? prompt.substring(0, 50) + '...' : 'N/A'}`,
            requestLogContext
        );

        const streamMode = readImageStreamMode(formData, process.env);
        const partialImagesCount = toPartialImagesCount(
            readCount(formData, 'partial_images', 2, upstreamProfile.partialImages.min, upstreamProfile.partialImages.max)
        );
        const imageBackend = readImageGenerationBackend(formData, process.env, {
            useEnvDefault: mode === 'generate'
        });
        const streamingStrategy = readImageStreamingStrategy(formData, process.env, {
            useEnvDefault: mode === 'generate'
        });
        const streamResolution = resolvePageStream({
            streamMode,
            imageBackend,
            streamingStrategy,
            operation: mode,
            selectedCredential,
            sourceId: createAvailabilitySourceId({
                selectedCredential,
                baseUrl: effectiveApiBaseUrl
            })
        });
        assertResponsesImageBackendAllowed({ imageBackend, mode });
        appLogger.info('图片上游兼容策略。', {
            ...requestLogContext,
            imageBackend,
            streamingStrategy,
            streamMode,
            streamEnabled: streamResolution.streamEnabled,
            streamFallbackEnabled: streamResolution.streamFallbackEnabled,
            streamingMarkedUnavailable: streamResolution.streamingMarkedUnavailable,
            upstreamProfile: upstreamProfile.id,
            upstreamExtraHeaders: Boolean(upstreamHeaders)
        });

        const modeResult =
            mode === 'generate'
                ? await handleGenerateImageMode({
                      formData,
                      openai,
                      model,
                      prompt,
                      streamEnabled: streamResolution.streamEnabled,
                      partialImagesCount,
                      upstreamProfile,
                      upstreamHeaders,
                      imageBackend,
                      storageMode: effectiveStorageMode,
                      apiBaseUrl: effectiveApiBaseUrl,
                      apiKey: effectiveApiKey,
                      startedAtMs: upstreamStartedAtMs,
                      clientRequestId,
                      requestLogContext,
                      selectedCredential,
                      accessCookie,
                      abortSignal: request.signal,
                      streamFallbackEnabled: streamResolution.streamFallbackEnabled,
                      onStreamUnavailable: (error, reason) =>
                          markStreamingUnavailable({ key: streamResolution.availabilityKey, error, reason }),
                      onStreamingDegraded: (reason) =>
                          markStreamingUnavailable({
                              key: streamResolution.availabilityKey,
                              reason,
                              status: 200
                          })
                  })
                : await handleEditImageMode({
                      formData,
                      openai,
                      model,
                      prompt,
                      streamEnabled: streamResolution.streamEnabled,
                      partialImagesCount,
                      upstreamProfile,
                      upstreamHeaders,
                      imageBackend,
                      storageMode: effectiveStorageMode,
                      apiBaseUrl: effectiveApiBaseUrl,
                      apiKey: effectiveApiKey,
                      startedAtMs: upstreamStartedAtMs,
                      clientRequestId,
                      requestLogContext,
                      selectedCredential,
                      accessCookie,
                      abortSignal: request.signal,
                      streamFallbackEnabled: streamResolution.streamFallbackEnabled,
                      onStreamUnavailable: (error, reason) =>
                          markStreamingUnavailable({ key: streamResolution.availabilityKey, error, reason }),
                      onStreamingDegraded: (reason) =>
                          markStreamingUnavailable({
                              key: streamResolution.availabilityKey,
                              reason,
                              status: 200
                          })
                  });
        if (modeResult instanceof Response) {
            return modeResult;
        }
        const { result, outputFormat: responseOutputFormat } = modeResult;

        appLogger.info('OpenAI API 调用成功。', requestLogContext);

        try {
            const savedImages = await persistOpenAiImages({
                result,
                outputFormat: responseOutputFormat,
                storageMode: effectiveStorageMode,
                includeBase64: true,
                apiBaseUrl: effectiveApiBaseUrl,
                apiKey: effectiveApiKey,
                upstreamHeaders,
                abortSignal: request.signal
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

            return attachAccessCookie(
                NextResponse.json({ images: savedImagesData, usage: result.usage, actualCost, clientRequestId }),
                accessCookie
            );
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
        appLogger.error('/api/images 处理失败：', {
            ...requestLogContext,
            error: error instanceof Error ? error.message : String(error)
        });

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
