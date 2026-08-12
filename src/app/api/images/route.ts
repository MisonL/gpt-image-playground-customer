import { appLogger } from '@/lib/app-logger';
import type { ChannelCapacityLease } from '@/lib/channel-capacity-queue';
import {
    getEffectiveChannelRequestModes,
    isStreamingChannelRequestMode,
    resolveChannelRequestMode,
    type ChannelRequestMode
} from '@/lib/channel-request-mode';
import {
    isChannelCredentialRequestModeHealthy,
    type ChannelCredential,
    resolveEffectiveCredential
} from '@/lib/channel-router';
import {
    RequestValidationError,
    assertSafeApiOverride,
    readCount,
    readBackground,
    readImageFiles,
    readMaskFile,
    readMode,
    readModel,
    readPlainHttpApiBaseUrlAllowlist,
    readRequiredText,
    readSize,
    readStorageMode,
    validateApiBaseUrl
} from '@/lib/image-request-utils';
import type { ImageMode } from '@/lib/image-request-utils';
import { handleEditImageMode, handleGenerateImageMode } from '@/lib/image-route-mode-handlers';
import {
    assertResponsesImageBackendAllowed,
    attachAccessCookie,
    describeInvalidImagesResponse,
    ensureOutputDirExists,
    inspectInvalidImagesResponse,
    inspectUpstreamError,
    readClientRequestId,
    reportServerCredentialFailure,
    resolveRequestActualCostSafely,
    type AccessCookie,
    type RequestLogContext,
    type UpstreamResponseDiagnostics
} from '@/lib/image-route-support';
import {
    InvalidOpenAiImagesResponseError,
    MissingOpenAiImageDataError,
    persistedImageToLegacyResponse,
    persistOpenAiImages
} from '@/lib/image-service';
import {
    clampIntegerToRange,
    getImageBackendCompatibility,
    isIntegerWithinRange,
    mergeUpstreamHeadersWithFixed,
    readImageUpstreamProfile,
    type PartialImagesCount
} from '@/lib/image-upstream-profile';
import {
    readImageGenerationBackend,
    readImageStreamMode,
    readImageStreamingStrategy,
    resolveImageStreamEnabled,
    type ImageGenerationBackend,
    type ImageStreamMode,
    type ImageStreamingStrategy
} from '@/lib/image-upstream-strategy';
import { createOpenAIImageClientOptions } from '@/lib/openai-image-transport';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { getServerChannelState } from '@/lib/server-channel-router';
import { buildAccessCookie, readAffinityKey, verifyPasswordHash } from '@/lib/server-runtime';
import type { StreamingAvailabilityKey, StreamingOperation } from '@/lib/streaming-availability';
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
    forceNonStream?: boolean;
};

type StreamResolution = {
    availabilityKey: StreamingAvailabilityKey;
    streamEnabled: boolean;
    streamFallbackEnabled: boolean;
    streamingMarkedUnavailable: boolean;
};

type ChannelRequestModePlan = {
    preferred: ChannelRequestMode;
    fallback?: ChannelRequestMode;
    candidates: readonly ChannelRequestMode[];
};

type PageChannelSelection = {
    selectedCredential?: ChannelCredential;
    requestMode: ChannelRequestMode;
    forcedNonStream: boolean;
    fallbackApplied: boolean;
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

function readOptionalPositiveCount(formData: FormData, field: string): number | undefined {
    const value = formData.get(field);
    if (value === null) return undefined;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new RequestValidationError(`${field} 必须是整数。`);
    }
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new RequestValidationError(`${field} 必须是正整数。`);
    }
    return count;
}

function readOptionalInteger(formData: FormData, field: string): number | undefined {
    const value = formData.get(field);
    if (value === null) return undefined;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new RequestValidationError(`${field} 必须是整数。`);
    }
    const count = Number(value);
    if (!Number.isSafeInteger(count)) {
        throw new RequestValidationError(`${field} 必须是整数。`);
    }
    return count;
}

function readOptionalPartialImages(formData: FormData): number | undefined {
    const value = readOptionalInteger(formData, 'partial_images');
    return value === undefined ? undefined : toPartialImagesCount(value);
}

function isPageCredentialEligible(input: {
    credential: ChannelCredential;
    requestMode?: ChannelRequestMode;
    mode: ImageMode;
    imageBackend: ImageGenerationBackend;
    formData: FormData;
    model: ReturnType<typeof readModel>;
    forceRequest: boolean;
    streamMode: ImageStreamMode;
    streamingStrategy: ImageStreamingStrategy;
    requestedImageCount?: number;
    requestedPartialImages?: number;
}): boolean {
    if (!input.requestMode) return true;
    if (
        input.streamMode === 'auto' &&
        isStreamingChannelRequestMode(input.requestMode) &&
        getServerChannelState().streamingAvailability.isUnavailable({
            channelId: input.credential.channelId,
            imageBackend: input.imageBackend,
            streamingStrategy: input.streamingStrategy,
            operation: input.mode
        })
    ) {
        return false;
    }
    const upstreamProfile =
        input.credential.providerProfile ||
        readImageUpstreamProfile({
            explicitProfile: input.credential.upstreamProfile,
            channelId: input.credential.channelId,
            baseUrl: input.credential.baseUrl
        });
    const validatePartialImages = isStreamingChannelRequestMode(input.requestMode);
    const compatibility = getImageBackendCompatibility(upstreamProfile, input.mode, input.imageBackend, undefined, {
        validatePartialImages
    });
    const imageCountRange = compatibility.imageCountRange;
    if (!compatibility.compatible || !imageCountRange) return false;
    if (input.requestedImageCount !== undefined && !isIntegerWithinRange(input.requestedImageCount, imageCountRange)) {
        return false;
    }
    if (validatePartialImages) {
        const partialImagesRange = compatibility.partialImagesRange;
        if (
            !partialImagesRange ||
            (input.requestedPartialImages !== undefined &&
                !isIntegerWithinRange(input.requestedPartialImages, partialImagesRange))
        ) {
            return false;
        }
    }
    try {
        if (input.mode === 'generate') {
            readBackground(input.formData, input.model, upstreamProfile, { forceRequest: input.forceRequest });
            readSize(input.formData, 'size', '1024x1024', input.model, upstreamProfile, {
                forceRequest: input.forceRequest
            });
        } else {
            readSize(input.formData, 'size', 'auto', input.model, upstreamProfile, {
                forceRequest: input.forceRequest
            });
            readImageFiles(input.formData, upstreamProfile);
            readMaskFile(input.formData, upstreamProfile);
        }
        return true;
    } catch (error) {
        if (error instanceof RequestValidationError) return false;
        throw error;
    }
}

function validatePageInputAgainstConfiguredProfiles(input: {
    credentials: readonly ChannelCredential[];
    formData: FormData;
    mode: ImageMode;
    imageBackend: ImageGenerationBackend;
    model: ReturnType<typeof readModel>;
    forceRequest: boolean;
    requestedImageCount?: number;
    requestedPartialImages?: number;
    requestModes: readonly ChannelRequestMode[];
}): void {
    let firstValidationError: RequestValidationError | undefined;
    let hasHealthyRequestMode = false;
    const router = getServerChannelState().router;
    for (const credential of input.credentials) {
        const profile =
            credential.providerProfile ||
            readImageUpstreamProfile({
                explicitProfile: credential.upstreamProfile,
                channelId: credential.channelId,
                baseUrl: credential.baseUrl
            });
        const requestModes = input.requestModes.filter((requestMode) =>
            getEffectiveChannelRequestModes(credential).includes(requestMode)
        );
        if (requestModes.length === 0) continue;
        for (const requestMode of requestModes) {
            if (!isChannelCredentialRequestModeHealthy(router, credential, requestMode)) continue;
            hasHealthyRequestMode = true;
            try {
                const validatePartialImages = isStreamingChannelRequestMode(requestMode);
                const compatibility = getImageBackendCompatibility(profile, input.mode, input.imageBackend, undefined, {
                    validatePartialImages
                });
                const imageCountRange = compatibility.imageCountRange;
                if (!compatibility.compatible || !imageCountRange) {
                    throw new RequestValidationError(
                        compatibility.errors.map((error) => error.message).join(' ') ||
                            '当前图片后端没有可用的图片数量约束。',
                        422
                    );
                }
                if (
                    input.requestedImageCount !== undefined &&
                    !isIntegerWithinRange(input.requestedImageCount, imageCountRange)
                ) {
                    throw new RequestValidationError(
                        imageCountRange.allowedValues
                            ? `n 必须是以下值之一：${imageCountRange.allowedValues.join(', ')}。`
                            : `n 必须在 ${imageCountRange.min} 到 ${imageCountRange.max} 之间。`,
                        422
                    );
                }
                if (validatePartialImages) {
                    const partialImagesRange = compatibility.partialImagesRange;
                    if (
                        !partialImagesRange ||
                        (input.requestedPartialImages !== undefined &&
                            !isIntegerWithinRange(input.requestedPartialImages, partialImagesRange))
                    ) {
                        throw new RequestValidationError(
                            partialImagesRange
                                ? partialImagesRange.allowedValues
                                    ? `partial_images 必须是以下值之一：${partialImagesRange.allowedValues.join(', ')}。`
                                    : `partial_images 必须在 ${partialImagesRange.min} 到 ${partialImagesRange.max} 之间。`
                                : '当前图片后端没有可用的 partial_images 约束。',
                            422
                        );
                    }
                }
                if (input.mode === 'generate') {
                    readBackground(input.formData, input.model, profile, { forceRequest: input.forceRequest });
                    readSize(input.formData, 'size', '1024x1024', input.model, profile, {
                        forceRequest: input.forceRequest
                    });
                } else {
                    readSize(input.formData, 'size', 'auto', input.model, profile, {
                        forceRequest: input.forceRequest
                    });
                    readImageFiles(input.formData, profile);
                    readMaskFile(input.formData, profile);
                }
                return;
            } catch (error) {
                if (!(error instanceof RequestValidationError)) throw error;
                firstValidationError ??= error;
            }
        }
    }
    if (hasHealthyRequestMode && firstValidationError) throw firstValidationError;
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

function createAvailabilitySourceId(input: {
    selectedCredential?: ChannelCredential;
    baseUrl?: string;
}): string | undefined {
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
    if (input.forceNonStream) {
        return {
            availabilityKey,
            streamEnabled: false,
            streamFallbackEnabled: false,
            streamingMarkedUnavailable: streamingAvailability.isUnavailable(availabilityKey)
        };
    }
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

function resolvePageChannelRequestModePlan(input: {
    streamMode: ImageStreamMode;
    imageBackend: ImageGenerationBackend;
    streamingStrategy: ImageStreamingStrategy;
}): ChannelRequestModePlan {
    if (input.streamMode === 'non_stream') {
        const preferred = resolveChannelRequestMode({ imageBackend: input.imageBackend, streamEnabled: false });
        return {
            preferred,
            candidates: [preferred]
        };
    }
    if (input.streamMode === 'auto' && input.streamingStrategy === 'off') {
        const preferred = resolveChannelRequestMode({ imageBackend: input.imageBackend, streamEnabled: false });
        return {
            preferred,
            candidates: [preferred]
        };
    }
    const preferred = resolveChannelRequestMode({
        imageBackend: input.imageBackend,
        streamEnabled: resolveImageStreamEnabled({
            imageBackend: input.imageBackend,
            requestedStream: true,
            streamingStrategy: input.streamingStrategy
        })
    });
    if (input.streamMode !== 'auto' || !isStreamingChannelRequestMode(preferred)) {
        return { preferred, candidates: [preferred] };
    }
    if (input.streamingStrategy !== 'auto') {
        return { preferred, candidates: [preferred] };
    }
    const fallback = resolveChannelRequestMode({ imageBackend: input.imageBackend, streamEnabled: false });
    return {
        preferred: fallback,
        fallback: preferred,
        candidates: [fallback, preferred]
    };
}

function selectPageServerCredential(input: {
    router: NonNullable<ReturnType<typeof getServerChannelState>['router']>;
    affinityKey: string;
    plan: ChannelRequestModePlan;
    isEligible?: (credential: ChannelCredential, requestMode?: ChannelRequestMode) => boolean;
}): PageChannelSelection {
    if (input.plan.candidates.length > 1) {
        const selection = input.router.selectWithRequestModes({
            affinityKey: input.affinityKey,
            requestModes: input.plan.candidates,
            isEligible: input.isEligible
        });
        return {
            selectedCredential: selection.credential,
            requestMode: selection.requestMode,
            forcedNonStream: !isStreamingChannelRequestMode(selection.requestMode),
            fallbackApplied: selection.requestMode !== selection.preferredRequestMode
        };
    }
    try {
        return {
            selectedCredential: input.router.select({
                affinityKey: input.affinityKey,
                requestMode: input.plan.preferred,
                isEligible: input.isEligible
            }),
            requestMode: input.plan.preferred,
            forcedNonStream: !isStreamingChannelRequestMode(input.plan.preferred),
            fallbackApplied: false
        };
    } catch (error) {
        if (!input.plan.fallback || !(error instanceof RequestValidationError)) {
            throw error;
        }
        return {
            selectedCredential: input.router.select({
                affinityKey: input.affinityKey,
                requestMode: input.plan.fallback,
                isEligible: input.isEligible
            }),
            requestMode: input.plan.fallback,
            forcedNonStream: true,
            fallbackApplied: true
        };
    }
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

function appendChannelQueueHeaders(response: Response, lease: ChannelCapacityLease | undefined): Response {
    if (!lease) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Channel-Queue-Wait-Ms', String(lease.waitMs));
    headers.set('X-Channel-Queue-Queued', lease.queued ? 'true' : 'false');
    headers.set('X-Channel-Queue-Capacity', String(lease.capacity));
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

function releaseChannelLeaseAfterResponse(response: Response, lease: ChannelCapacityLease): Response {
    if (!response.body) {
        const responseWithHeaders = appendChannelQueueHeaders(response, lease);
        lease.release();
        return responseWithHeaders;
    }

    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const result = await reader.read();
                if (result.done) {
                    lease.release();
                    controller.close();
                    return;
                }
                controller.enqueue(result.value);
            } catch (error) {
                lease.release();
                controller.error(error);
            }
        },
        async cancel(reason) {
            try {
                await reader.cancel(reason);
            } finally {
                lease.release();
            }
        }
    });
    return appendChannelQueueHeaders(
        new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        }),
        lease
    );
}

function reportPersistDiagnosticsFailure(input: {
    credential?: ChannelCredential;
    diagnostics: UpstreamResponseDiagnostics;
    requestMode?: ChannelRequestMode;
}) {
    if (input.diagnostics.category !== 'responses_disabled') return;
    reportServerCredentialFailure(
        input.credential,
        {
            status: 403,
            error: { message: 'Image generation is not enabled for this group' }
        },
        input.requestMode
    );
}

function readBooleanAlias(formData: FormData, ...fields: string[]): boolean | undefined {
    for (const field of fields) {
        const value = formData.get(field);
        if (value === null || value === '') continue;
        if (typeof value !== 'string') {
            throw new RequestValidationError(`${field} 必须是 true 或 false。`);
        }
        if (value === 'true') return true;
        if (value === 'false') return false;
        throw new RequestValidationError(`${field} 必须是 true 或 false。`);
    }
    return undefined;
}

export async function POST(request: NextRequest) {
    let selectedServerCredential: ChannelCredential | undefined;
    let selectedServerRequestMode: ChannelRequestMode | undefined;
    let channelLease: ChannelCapacityLease | undefined;
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
        const upstreamIdempotencyKey = clientRequestId || crypto.randomUUID();
        requestLogContext = clientRequestId ? { clientRequestId } : undefined;
        const requestApiKey = String(formData.get('apiKey') || '').trim();
        const requestApiBaseUrl = String(formData.get('apiBaseUrl') || '').trim();
        const allowedPlainHttpBaseUrls = readPlainHttpApiBaseUrlAllowlist(
            process.env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS
        );
        assertSafeApiOverride(requestApiKey, requestApiBaseUrl);
        validateApiBaseUrl(requestApiBaseUrl, { allowedPlainHttpBaseUrls });
        const streamMode = readImageStreamMode(formData, process.env);
        const imageBackend = readImageGenerationBackend(formData, process.env);
        const streamingStrategy = readImageStreamingStrategy(formData, process.env);
        const mode = readMode(formData);
        const model = readModel(formData);
        const forceRequest = readBooleanAlias(formData, 'force_request', 'forceRequest') === true;
        const requestedImageCount = readOptionalPositiveCount(formData, 'n');
        const requestedPartialImages = readOptionalPartialImages(formData);
        const requestModePlan = resolvePageChannelRequestModePlan({ streamMode, imageBackend, streamingStrategy });
        if (!requestApiKey && serverChannelRouter) {
            validatePageInputAgainstConfiguredProfiles({
                credentials: serverChannelState.config.credentials,
                formData,
                mode,
                imageBackend,
                model,
                forceRequest,
                requestedImageCount,
                requestedPartialImages,
                requestModes: requestModePlan.candidates
            });
        }
        const channelSelection =
            requestApiKey || !serverChannelRouter
                ? {
                      selectedCredential: undefined,
                      requestMode: requestModePlan.preferred,
                      forcedNonStream: !isStreamingChannelRequestMode(requestModePlan.preferred),
                      fallbackApplied: false
                  }
                : selectPageServerCredential({
                      router: serverChannelRouter,
                      affinityKey: readAffinityKey(request.headers),
                      plan: requestModePlan,
                      isEligible: (credential, requestMode) =>
                          isPageCredentialEligible({
                              credential,
                              requestMode,
                              mode,
                              imageBackend,
                              formData,
                              model,
                              forceRequest,
                              streamMode,
                              streamingStrategy,
                              requestedImageCount,
                              requestedPartialImages
                          })
                  });
        selectedServerCredential = channelSelection.selectedCredential;
        selectedServerRequestMode = channelSelection.requestMode;
        const {
            apiKey: effectiveApiKey,
            baseUrl: effectiveApiBaseUrl,
            upstreamProxyUrl: effectiveUpstreamProxyUrl,
            upstreamProfile: effectiveUpstreamProfileId,
            providerProfile,
            upstreamHeaders,
            selectedCredential
        } = resolveEffectiveCredential({
            requestApiKey,
            requestApiBaseUrl,
            legacyBaseUrl: process.env.OPENAI_API_BASE_URL,
            legacyUpstreamProxyUrl: process.env.OPENAI_UPSTREAM_PROXY_URL,
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
                {
                    ...requestLogContext,
                    channelRequestMode: channelSelection.requestMode,
                    channelRequestModeFallbackApplied: channelSelection.fallbackApplied
                }
            );
        }

        const openai = new OpenAI(
            createOpenAIImageClientOptions({
                apiKey: effectiveApiKey,
                baseURL: effectiveApiBaseUrl || undefined,
                upstreamProxyUrl: effectiveUpstreamProxyUrl,
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

        const prompt = readRequiredText(formData, 'prompt');
        const upstreamStartedAtMs = Date.now();

        appLogger.info(`开始处理图片请求。模式：${mode}，模型：${model}`, requestLogContext);
        appLogger.debug(
            `模式：${mode}，模型：${model}，提示词：${prompt ? prompt.substring(0, 50) + '...' : 'N/A'}`,
            requestLogContext
        );

        assertResponsesImageBackendAllowed({ imageBackend, mode });
        const streamResolution = resolvePageStream({
            streamMode,
            imageBackend,
            streamingStrategy,
            operation: mode,
            selectedCredential,
            sourceId: createAvailabilitySourceId({
                selectedCredential,
                baseUrl: effectiveApiBaseUrl
            }),
            forceNonStream: channelSelection.forcedNonStream
        });
        const backendCompatibility = getImageBackendCompatibility(upstreamProfile, mode, imageBackend, undefined, {
            validatePartialImages: streamResolution.streamEnabled
        });
        if (!backendCompatibility.compatible) {
            throw new RequestValidationError(backendCompatibility.errors.map((error) => error.message).join(' '), 422);
        }
        const partialImagesCount = streamResolution.streamEnabled
            ? (() => {
                  const partialImagesRange = backendCompatibility.partialImagesRange;
                  if (!partialImagesRange) {
                      throw new RequestValidationError('当前图片后端没有可用的 partial_images 约束。', 422);
                  }
                  return toPartialImagesCount(
                      readCount(
                          formData,
                          'partial_images',
                          clampIntegerToRange(2, partialImagesRange),
                          partialImagesRange.min,
                          partialImagesRange.max,
                          partialImagesRange
                      )
                  );
              })()
            : toPartialImagesCount(requestedPartialImages ?? 2);
        appLogger.info('图片上游兼容策略。', {
            ...requestLogContext,
            imageBackend,
            streamingStrategy,
            streamMode,
            streamEnabled: streamResolution.streamEnabled,
            streamFallbackEnabled: streamResolution.streamFallbackEnabled,
            streamingMarkedUnavailable: streamResolution.streamingMarkedUnavailable,
            channelRequestMode: channelSelection.requestMode,
            channelRequestModeFallbackApplied: channelSelection.fallbackApplied,
            upstreamProfile: upstreamProfile.id,
            upstreamExtraHeaders: Boolean(upstreamHeaders)
        });

        if (selectedCredential) {
            channelLease = await serverChannelState.channelCapacityQueue.acquire(selectedCredential.id, {
                signal: request.signal
            });
            appLogger.info('渠道凭证并发容量已获取。', {
                ...requestLogContext,
                channelId: selectedCredential.channelId,
                credentialId: selectedCredential.id,
                queued: channelLease.queued,
                waitMs: channelLease.waitMs,
                queueCapacity: channelLease.capacity,
                queuedCount: channelLease.queuedCount
            });
        }

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
                      upstreamProxyUrl: effectiveUpstreamProxyUrl,
                      startedAtMs: upstreamStartedAtMs,
                      upstreamIdempotencyKey,
                      clientRequestId,
                      requestLogContext,
                      selectedCredential,
                      channelRequestMode: channelSelection.requestMode,
                      accessCookie,
                      forceRequest,
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
                      upstreamProxyUrl: effectiveUpstreamProxyUrl,
                      startedAtMs: upstreamStartedAtMs,
                      upstreamIdempotencyKey,
                      clientRequestId,
                      requestLogContext,
                      selectedCredential,
                      channelRequestMode: channelSelection.requestMode,
                      accessCookie,
                      forceRequest,
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
            if (!channelLease) return modeResult;
            const response = releaseChannelLeaseAfterResponse(modeResult, channelLease);
            channelLease = undefined;
            return response;
        }
        const { result, outputFormat: responseOutputFormat } = modeResult;

        appLogger.info('OpenAI API 调用成功。', requestLogContext);

        try {
            const savedImages = await persistOpenAiImages({
                result,
                outputFormat: responseOutputFormat,
                storageMode: effectiveStorageMode,
                includeBase64: true,
                normalizeOutputFormat: true,
                apiBaseUrl: effectiveApiBaseUrl,
                apiKey: effectiveApiKey,
                upstreamProxyUrl: effectiveUpstreamProxyUrl,
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
                upstreamProxyUrl: effectiveUpstreamProxyUrl,
                model,
                startedAtMs: upstreamStartedAtMs,
                expectedImageCount: savedImagesData.length,
                requestLogContext
            });

            appLogger.info(`所有图片已处理。模式：${effectiveStorageMode}`, {
                ...requestLogContext,
                filenames: savedImagesData.map((image) => image.filename)
            });

            const response = attachAccessCookie(
                NextResponse.json({ images: savedImagesData, usage: result.usage, actualCost, clientRequestId }),
                accessCookie
            );
            const responseWithHeaders = appendChannelQueueHeaders(response, channelLease);
            channelLease?.release();
            channelLease = undefined;
            return responseWithHeaders;
        } catch (persistError) {
            if (persistError instanceof MissingOpenAiImageDataError) {
                const invalidResult = persistError.result;
                const diagnostics = inspectInvalidImagesResponse(invalidResult);
                appLogger.error(`第 ${persistError.index} 个图片数据缺少 b64_json。`, {
                    upstreamDiagnostics: diagnostics,
                    ...requestLogContext
                });
                reportPersistDiagnosticsFailure({
                    credential: selectedCredential,
                    diagnostics,
                    requestMode: selectedServerRequestMode
                });
                const response = NextResponse.json(
                    { error: describeInvalidImagesResponse(invalidResult), diagnostics },
                    { status: 502 }
                );
                const responseWithHeaders = appendChannelQueueHeaders(response, channelLease);
                channelLease?.release();
                channelLease = undefined;
                return responseWithHeaders;
            }
            if (!(persistError instanceof InvalidOpenAiImagesResponseError)) {
                throw persistError;
            }
            const invalidResult: unknown = persistError.result;
            const diagnostics = inspectInvalidImagesResponse(invalidResult);
            appLogger.error('OpenAI API 返回的数据无效或为空：', {
                type: typeof invalidResult,
                upstreamDiagnostics: diagnostics,
                ...requestLogContext
            });
            reportPersistDiagnosticsFailure({
                credential: selectedCredential,
                diagnostics,
                requestMode: selectedServerRequestMode
            });
            const response = NextResponse.json(
                { error: describeInvalidImagesResponse(invalidResult), diagnostics },
                { status: 502 }
            );
            const responseWithHeaders = appendChannelQueueHeaders(response, channelLease);
            channelLease?.release();
            channelLease = undefined;
            return responseWithHeaders;
        }
    } catch (error: unknown) {
        channelLease?.release();
        channelLease = undefined;
        reportServerCredentialFailure(selectedServerCredential, error, selectedServerRequestMode);
        const upstreamDiagnostics = inspectUpstreamError(error);
        appLogger.error('/api/images 处理失败：', {
            ...requestLogContext,
            error: error instanceof Error ? error.message : String(error),
            ...(upstreamDiagnostics ? { upstreamDiagnostics } : {})
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

        return NextResponse.json(
            { error: errorMessage, ...(upstreamDiagnostics ? { diagnostics: upstreamDiagnostics } : {}) },
            { status }
        );
    }
}
