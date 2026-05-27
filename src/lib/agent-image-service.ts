import {
    type AgentGenerateRequest,
    type AgentImageResponse,
    type AgentImageResponseItem,
    type AgentResponseMode,
    validateAgentGenerateRequest
} from './agent-api-contracts';
import { assertArtifactFilepathAllowed, deleteArtifactFileIfAllowed } from './agent-file-utils';
import {
    artifactRecordToResponseItem,
    createArtifactId,
    hashAgentPayload,
    hashText,
    isoDate,
    type AgentArtifactRecord,
    type AgentStateStore
} from './agent-state-store';
import { AgentApiError, normalizeAgentError, type AgentErrorBody } from './api-error-response';
import type { AgentErrorDiagnostics } from './api-error-response';
import { appLogger } from './app-logger';
import {
    type ChannelCredential,
    describeChannelFailure,
    isChannelFailure,
    isCredentialFailure,
    resolveEffectiveCredential
} from './channel-router';
import {
    RequestValidationError,
    readCount,
    readEditQuality,
    readImageFiles,
    readMaskFile,
    readModel,
    readRequiredText,
    readSize,
    validateApiBaseUrl,
    type GptImageModel,
    type ValidOutputFormat
} from './image-request-utils';
import {
    InvalidOpenAiImagesResponseError,
    MissingOpenAiImageDataError,
    persistOpenAiImages as persistSharedOpenAiImages
} from './image-service';
import {
    parseImageStreamModeValue,
    parseImageStreamingStrategyValue,
    resolveImageStreamEnabled,
    type ImageStreamMode,
    type ImageStreamingStrategy
} from './image-upstream-strategy';
import { collectOpenAiImagesFromStream } from './image-stream-collector';
import { createImagesApiGenerateStream } from './images-api-stream';
import {
    createResponsesImageStream,
    generateImageWithResponsesBackend,
    type ResponsesImageGenerateInput
} from './responses-image-backend';
import { getServerChannelState } from './server-channel-router';
import type { StreamingAvailabilityKey } from './streaming-availability';
import { readAffinityKey, readBooleanEnv } from './server-runtime';
import crypto from 'crypto';
import fs from 'fs/promises';
import OpenAI from 'openai';

export type AgentRequestExecutionResult = {
    response: AgentImageResponse;
    stateResponse: AgentImageResponse;
    artifacts: AgentArtifactRecord[];
};

type CredentialContext = {
    openai: OpenAI;
    selectedCredential?: ChannelCredential;
    baseUrl?: string;
    apiKey: string;
};

type AgentStreamOptions = {
    mode: 'generate' | 'edit';
    imageBackend: AgentGenerateRequest['image_backend'];
    streamMode: ImageStreamMode;
    streamingStrategy: ImageStreamingStrategy;
    partialImages: 1 | 2 | 3;
    selectedCredential?: ChannelCredential;
};

type AgentEditStreamRequest = {
    streamMode: ImageStreamMode;
    streamingStrategy: ImageStreamingStrategy;
    partialImages: 1 | 2 | 3;
};

const AGENT_EDIT_UNSUPPORTED_FIELDS = [
    'image_backend',
    'imageBackend',
    'output_format',
    'outputFormat',
    'format',
    'output_compression',
    'outputCompression',
    'responses_model',
    'responsesModel',
    'image_streaming_strategy',
    'imageStreamingStrategy',
    'background',
    'moderation'
] as const;

export function readIdempotencyKey(headers: Headers): string {
    const value = headers.get('idempotency-key')?.trim();
    if (!value) {
        throw new AgentApiError({
            code: 'idempotency_key_required',
            message: 'Agent 图片请求必须提供 Idempotency-Key header。',
            status: 400,
            retryable: false
        });
    }
    if (value.length > 200) {
        throw new AgentApiError({
            code: 'validation_error',
            message: 'Idempotency-Key is too long.',
            status: 422,
            retryable: false,
            details: { fields: { 'Idempotency-Key': '长度不能超过 200 个字符' } }
        });
    }
    return value;
}

export function buildGenerateRequestHash(request: AgentGenerateRequest): string {
    return hashAgentPayload({ mode: 'generate', request });
}

export async function buildEditRequestHash(formData: FormData): Promise<string> {
    return buildEditRequestHashFromSnapshot(await snapshotAgentEditFormData(formData));
}

export function buildEditRequestHashFromSnapshot(snapshot: Record<string, unknown>): string {
    return hashAgentPayload(snapshot);
}

export async function snapshotAgentEditFormData(formData: FormData): Promise<Record<string, unknown>> {
    const fields: Record<string, unknown> = {};
    const fileFields: Array<Promise<{ key: string; name: string; size: number; type: string; sha256: string }>> = [];
    for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
            fileFields.push(snapshotFileField(key, value));
        } else {
            fields[key] = value;
        }
    }
    const files = await Promise.all(fileFields);
    return { mode: 'edit', fields, files: files.sort((a, b) => a.key.localeCompare(b.key)) };
}

async function snapshotFileField(
    key: string,
    file: File
): Promise<{ key: string; name: string; size: number; type: string; sha256: string }> {
    const buffer = Buffer.from(await file.arrayBuffer());
    return {
        key,
        name: file.name,
        size: file.size,
        type: file.type,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex')
    };
}

export async function executeAgentGenerate(options: {
    request: AgentGenerateRequest;
    headers: Headers;
    requestId: string;
    idempotencyKey: string;
    cached: boolean;
    abortSignal?: AbortSignal;
}): Promise<AgentRequestExecutionResult> {
    const credentialContext = createOpenAiClient(options.headers);
    const startedAtMs = Date.now();
    try {
        const result = await executeAgentGenerateUpstream(
            options.request,
            credentialContext,
            options.abortSignal
        );
        return await persistOpenAiImages({
            result,
            mode: 'generate',
            model: options.request.model,
            prompt: options.request.prompt,
            outputFormat: options.request.output_format,
            responseMode: options.request.response_mode,
            requestId: options.requestId,
            idempotencyKey: options.idempotencyKey,
            cached: options.cached
        });
    } catch (error) {
        reportServerCredentialFailure(credentialContext.selectedCredential, error);
        throw normalizeAgentError(error, buildAgentExecutionDiagnostics(credentialContext, startedAtMs));
    }
}

async function executeAgentGenerateUpstream(
    request: AgentGenerateRequest,
    credentialContext: CredentialContext,
    abortSignal?: AbortSignal
): Promise<OpenAI.Images.ImagesResponse> {
    const { openai } = credentialContext;
    const streamOptions: AgentStreamOptions = {
        mode: 'generate',
        imageBackend: request.image_backend,
        streamMode: request.stream_mode,
        streamingStrategy: request.streaming_strategy,
        partialImages: request.partial_images,
        selectedCredential: credentialContext.selectedCredential
    };
    if (request.image_backend === 'responses-image-generation') {
        return executeAgentResponsesGenerate(request, credentialContext, abortSignal);
    }
    const baseParams = {
        model: request.model,
        prompt: request.prompt,
        n: request.n,
        size: request.size as OpenAI.Images.ImageGenerateParams['size'],
        quality: request.quality as OpenAI.Images.ImageGenerateParams['quality'],
        output_format: request.output_format,
        background: request.background as OpenAI.Images.ImageGenerateParams['background'],
        moderation: request.moderation as OpenAI.Images.ImageGenerateParams['moderation'],
        ...(request.output_compression !== undefined ? { output_compression: request.output_compression } : {})
    };
    if (!shouldUseAgentUpstreamStream(streamOptions)) {
        return openai.images.generate(
            { ...baseParams, stream: false },
            abortSignal ? { signal: abortSignal } : undefined
        );
    }
    const fallback = () =>
        openai.images.generate({ ...baseParams, stream: false }, abortSignal ? { signal: abortSignal } : undefined);
    try {
        const stream = await createImagesApiGenerateStream({
            apiBaseUrl: credentialContext.baseUrl,
            apiKey: credentialContext.apiKey,
            abortSignal,
            params: {
                ...baseParams,
                stream: true,
                partial_images: request.partial_images
            }
        });
        return await collectOpenAiImagesFromStream(stream, {
            onStreamingDegraded: (reason) => markAgentStreamingUnavailable(streamOptions, reason, 200)
        });
    } catch (error) {
        if (request.stream_mode === 'stream' || isAbortLikeError(error, abortSignal)) throw error;
        markAgentStreamingUnavailable(streamOptions, 'stream_error_without_final_image', undefined, error);
        return fallback();
    }
}

async function executeAgentResponsesGenerate(
    request: AgentGenerateRequest,
    credentialContext: CredentialContext,
    abortSignal?: AbortSignal
): Promise<OpenAI.Images.ImagesResponse> {
    const { openai } = credentialContext;
    if (!readBooleanEnv(process.env, 'ENABLE_RESPONSES_IMAGE_BACKEND')) {
        throw new RequestValidationError(
            'Responses API 图片后端仍是实验能力，必须设置 ENABLE_RESPONSES_IMAGE_BACKEND=true 后才能使用。',
            400
        );
    }
    if (request.n !== 1) {
        throw new RequestValidationError('Responses API 图片后端当前只支持单张生成。', 400);
    }
    const input: ResponsesImageGenerateInput = {
        responses: openai.responses,
        prompt: request.prompt,
        responsesModel: readAgentResponsesApiModel(),
        imageModel: request.model,
        size: readAgentResponsesImageSize(request.size),
        quality: request.quality,
        outputFormat: request.output_format,
        background: request.background,
        moderation: request.moderation,
        abortSignal,
        ...(request.output_compression !== undefined ? { outputCompression: request.output_compression } : {})
    };
    const streamOptions: AgentStreamOptions = {
        mode: 'generate',
        imageBackend: request.image_backend,
        streamMode: request.stream_mode,
        streamingStrategy: request.streaming_strategy,
        partialImages: request.partial_images,
        selectedCredential: credentialContext.selectedCredential
    };
    if (!shouldUseAgentUpstreamStream(streamOptions)) {
        return generateImageWithResponsesBackend(input);
    }
    try {
        return await collectOpenAiImagesFromStream(
            await createResponsesImageStream({ ...input, partialImagesCount: request.partial_images }),
            { onStreamingDegraded: (reason) => markAgentStreamingUnavailable(streamOptions, reason, 200) }
        );
    } catch (error) {
        if (request.stream_mode === 'stream' || isAbortLikeError(error, abortSignal)) throw error;
        markAgentStreamingUnavailable(streamOptions, 'stream_error_without_final_image', undefined, error);
        return generateImageWithResponsesBackend(input);
    }
}

function shouldUseAgentUpstreamStream(input: AgentStreamOptions): boolean {
    const key = createAgentStreamingAvailabilityKey(input);
    const availability = getServerChannelState().streamingAvailability;
    if (input.streamMode === 'non_stream') return false;
    if (input.streamMode === 'auto' && availability.isUnavailable(key)) return false;
    return resolveImageStreamEnabled({
        imageBackend: input.imageBackend,
        requestedStream: true,
        streamingStrategy: input.streamingStrategy
    });
}

function createAgentStreamingAvailabilityKey(input: AgentStreamOptions): StreamingAvailabilityKey {
    return {
        channelId: input.selectedCredential?.channelId,
        imageBackend: input.imageBackend,
        streamingStrategy: input.streamingStrategy,
        operation: input.mode
    };
}

function readErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    if ('status' in error && typeof error.status === 'number') return error.status;
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
    return undefined;
}

function readErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    if ('code' in error && typeof error.code === 'string') return error.code;
    return undefined;
}

function markAgentStreamingUnavailable(
    input: AgentStreamOptions,
    reason: string,
    status?: number,
    error?: unknown
): void {
    const finalStatus = status ?? readErrorStatus(error);
    getServerChannelState().streamingAvailability.markUnavailable({
        ...createAgentStreamingAvailabilityKey(input),
        reason,
        ...(finalStatus !== undefined ? { status: finalStatus } : {}),
        ...(readErrorCode(error) ? { code: readErrorCode(error) } : {})
    });
}

function isAbortLikeError(error: unknown, abortSignal?: AbortSignal): boolean {
    if (abortSignal?.aborted) return true;
    if (typeof error !== 'object' || error === null) return false;
    const name = 'name' in error ? error.name : undefined;
    return name === 'AbortError' || name === 'CanceledError';
}

function readAgentResponsesApiModel(): string {
    const model = process.env.OPENAI_RESPONSES_API_MODEL?.trim();
    if (!model) {
        throw new RequestValidationError(
            'Responses API 图片后端必须配置 OPENAI_RESPONSES_API_MODEL，作为 /responses 顶层模型。',
            500
        );
    }
    return model;
}

function readAgentResponsesImageSize(size: string): ResponsesImageGenerateInput['size'] {
    if (size === 'auto' || size === '1024x1024' || size === '1024x1536' || size === '1536x1024') {
        return size;
    }
    throw new RequestValidationError(
        'Responses API 图片后端当前只支持 auto、1024x1024、1024x1536 或 1536x1024 尺寸。',
        400
    );
}

export async function executeAgentEdit(options: {
    formData: FormData;
    headers: Headers;
    requestId: string;
    idempotencyKey: string;
    cached: boolean;
    abortSignal?: AbortSignal;
}): Promise<AgentRequestExecutionResult> {
    let credentialContext: CredentialContext | undefined;
    const startedAtMs = Date.now();
    try {
        const prompt = readRequiredText(options.formData, 'prompt');
        const model = readModel(options.formData);
        const n = readCount(options.formData, 'n', 1, 1, 10);
        const size = readSize(options.formData, 'size', 'auto', model) as OpenAI.Images.ImageEditParams['size'];
        const quality = readEditQuality(options.formData) as OpenAI.Images.ImageEditParams['quality'];
        const responseMode = readAgentResponseModeFromForm(options.formData);
        const streamRequest = readAgentEditStreamRequest(options.formData);
        const imageFiles = readImageFiles(options.formData);
        const maskFile = readMaskFile(options.formData);

        credentialContext = createOpenAiClient(options.headers);
        const editParams: OpenAI.Images.ImageEditParamsNonStreaming = {
            model,
            prompt,
            image: imageFiles,
            n,
            size: size === 'auto' ? undefined : size,
            quality: quality === 'auto' ? undefined : quality,
            ...(maskFile ? { mask: maskFile } : {})
        };
        const streamOptions: AgentStreamOptions = {
            mode: 'edit',
            imageBackend: 'images-api',
            streamMode: streamRequest.streamMode,
            streamingStrategy: streamRequest.streamingStrategy,
            partialImages: streamRequest.partialImages,
            selectedCredential: credentialContext.selectedCredential
        };
        const result = shouldUseAgentUpstreamStream(streamOptions)
            ? await executeAgentEditStream({
                  credentialContext,
                  params: editParams,
                  streamOptions,
                  abortSignal: options.abortSignal
              })
            : await credentialContext.openai.images.edit(
                  editParams,
                  options.abortSignal ? { signal: options.abortSignal } : undefined
              );

        return await persistOpenAiImages({
            result,
            mode: 'edit',
            model,
            prompt,
            outputFormat: 'png',
            responseMode,
            requestId: options.requestId,
            idempotencyKey: options.idempotencyKey,
            cached: options.cached
        });
    } catch (error) {
        reportServerCredentialFailure(credentialContext?.selectedCredential, error);
        throw normalizeAgentError(error, buildAgentExecutionDiagnostics(credentialContext, startedAtMs));
    }
}

async function executeAgentEditStream(input: {
    credentialContext: CredentialContext;
    params: OpenAI.Images.ImageEditParamsNonStreaming;
    streamOptions: AgentStreamOptions;
    abortSignal?: AbortSignal;
}): Promise<OpenAI.Images.ImagesResponse> {
    const requestOptions = input.abortSignal ? { signal: input.abortSignal } : undefined;
    const fallback = () => input.credentialContext.openai.images.edit(input.params, requestOptions);
    try {
        const stream = await input.credentialContext.openai.images.edit(
            {
                ...input.params,
                stream: true,
                partial_images: input.streamOptions.partialImages
            },
            requestOptions
        );
        return await collectOpenAiImagesFromStream(stream, {
            onStreamingDegraded: (reason) => markAgentStreamingUnavailable(input.streamOptions, reason, 200)
        });
    } catch (error) {
        if (input.streamOptions.streamMode === 'stream' || isAbortLikeError(error, input.abortSignal)) throw error;
        markAgentStreamingUnavailable(input.streamOptions, 'stream_error_without_final_image', undefined, error);
        return fallback();
    }
}

export async function parseAgentGenerateRequest(request: Request): Promise<AgentGenerateRequest> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new RequestValidationError('Agent 生成端点要求使用 application/json。', 415);
    }
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        throw new RequestValidationError('请求正文必须是有效 JSON。', 422);
    }
    return validateAgentGenerateRequest(body);
}

export async function parseAgentEditFormData(request: Request): Promise<FormData> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
        throw new RequestValidationError('Agent 编辑端点要求使用 multipart/form-data。', 415);
    }
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        throw new RequestValidationError('请求正文必须是有效的 multipart/form-data。', 422);
    }
    validateAgentEditUnsupportedFields(formData);
    return formData;
}

function validateAgentEditUnsupportedFields(formData: FormData): void {
    const fields: Record<string, string> = {};
    for (const field of AGENT_EDIT_UNSUPPORTED_FIELDS) {
        if (formData.has(field)) {
            fields[field] =
                field === 'image_streaming_strategy' || field === 'imageStreamingStrategy'
                    ? 'Agent edit 不接受页面专用字段，请使用 streaming_strategy。'
                    : 'Agent edit 不接受该字段。';
        }
    }
    if (Object.keys(fields).length > 0) {
        throw new RequestValidationError('Agent edit 请求包含不支持的字段。', 422, { fields });
    }
}

export async function deleteAgentArtifactFiles(store: AgentStateStore, id: string): Promise<boolean> {
    const artifact = await store.getArtifact(id);
    if (!artifact) return false;
    await deleteArtifactFileIfAllowed(artifact.filepath);
    await store.deleteArtifact(id);
    await store.failRequest({
        requestId: artifact.requestId,
        error: {
            error: {
                code: 'artifact_not_found',
                message: '产物已删除。',
                retryable: false,
                request_id: artifact.requestId
            }
        }
    });
    return true;
}

export async function deleteAgentExecutionFiles(execution: AgentRequestExecutionResult): Promise<void> {
    const results = await Promise.allSettled(
        execution.artifacts.map((artifact) => deleteArtifactFileIfAllowed(artifact.filepath))
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') {
        throw failed.reason;
    }
}

export async function saveAgentExecutionArtifacts(
    store: AgentStateStore,
    execution: AgentRequestExecutionResult
): Promise<void> {
    await store.saveArtifacts(execution.artifacts);
}

export async function completeAgentExecutionState(
    store: AgentStateStore,
    execution: AgentRequestExecutionResult
): Promise<void> {
    await store.completeRequest({
        requestId: execution.response.request_id,
        response: execution.stateResponse,
        artifacts: []
    });
}

export function createArtifactPersistenceError(): AgentApiError {
    return new AgentApiError({
        code: 'unexpected_error',
        message: '保存产物元数据失败。',
        status: 500,
        retryable: true
    });
}

export function createCompletionPersistenceError(): AgentApiError {
    return new AgentApiError({
        code: 'unexpected_error',
        message: '保存请求完成状态失败。',
        status: 500,
        retryable: true
    });
}

export function errorToAgentErrorBody(error: unknown, requestId: string): AgentErrorBody {
    const normalized = normalizeAgentError(error);
    return {
        error: {
            code: normalized.code,
            message: normalized.message,
            retryable: normalized.retryable,
            ...(normalized.details ? { details: normalized.details } : {}),
            ...(normalized.upstreamStatus ? { upstream_status: normalized.upstreamStatus } : {}),
            ...(normalized.diagnostics ? { diagnostics: normalized.diagnostics } : {}),
            request_id: requestId
        }
    };
}

export async function hydrateAgentReplayResponse(
    store: AgentStateStore,
    record: { requestId: string; requestJson: unknown },
    response: AgentImageResponse,
    cached = true
): Promise<AgentImageResponse> {
    const responseMode = readAgentResponseModeFromRequestJson(record.requestJson);
    if (!shouldIncludeBase64(responseMode)) {
        return { ...response, cached };
    }
    const artifacts = await store.listArtifactsForRequest(record.requestId);
    const encodedById = new Map<string, string>();
    for (const artifact of artifacts) {
        assertArtifactFilepathAllowed(artifact.filepath);
        encodedById.set(artifact.id, await readArtifactBase64(artifact.filepath));
    }
    return {
        ...response,
        cached,
        images: response.images.map((image) => ({
            ...image,
            ...(encodedById.has(image.id) ? { b64_json: encodedById.get(image.id) } : {})
        }))
    };
}

function createOpenAiClient(headers: Headers): CredentialContext {
    const serverChannelRouter = getServerChannelState().router;
    const selectedCredential = serverChannelRouter?.select({ affinityKey: readAffinityKey(headers) });
    const {
        apiKey,
        baseUrl,
        selectedCredential: effectiveSelectedCredential
    } = resolveEffectiveCredential({
        requestApiKey: '',
        requestApiBaseUrl: '',
        legacyBaseUrl: process.env.OPENAI_API_BASE_URL,
        selectedCredential
    });
    validateApiBaseUrl(baseUrl || '');
    if (!apiKey) {
        throw new AgentApiError({
            code: 'configuration_error',
            message: '未配置服务端 API Key。请设置 OPENAI_API_KEY 或 OPENAI_CHANNEL_N_API_KEYS。',
            status: 500,
            retryable: false
        });
    }
    return {
        openai: new OpenAI({
            apiKey,
            baseURL: baseUrl || undefined
        }),
        selectedCredential: effectiveSelectedCredential,
        baseUrl,
        apiKey
    };
}

function buildAgentExecutionDiagnostics(
    context: CredentialContext | undefined,
    startedAtMs: number
): AgentErrorDiagnostics {
    const upstreamHost = context?.baseUrl ? readUrlHost(context.baseUrl) : undefined;
    return {
        elapsed_ms: Date.now() - startedAtMs,
        ...(context?.selectedCredential?.channelId
            ? { selected_channel_id: context.selectedCredential.channelId }
            : {}),
        ...(upstreamHost ? { upstream_host: upstreamHost } : {})
    };
}

function readUrlHost(value: string): string | undefined {
    try {
        return new URL(value).host;
    } catch {
        return undefined;
    }
}

function reportServerCredentialFailure(credential: ChannelCredential | undefined, error: unknown) {
    const serverChannelRouter = getServerChannelState().router;
    if (!credential || !serverChannelRouter) return;
    if (isChannelFailure(error)) {
        const reason = describeChannelFailure(error, 'channel');
        serverChannelRouter.reportFailure(credential, { scope: 'channel', reason });
        appLogger.warn(`Temporarily cooling down API channel: ${credential.channelId}`, reason);
        return;
    }
    if (isCredentialFailure(error)) {
        const reason = describeChannelFailure(error, 'credential');
        serverChannelRouter.reportFailure(credential, { reason });
        appLogger.warn(
            `Temporarily cooling down API channel credential: ${credential.channelId}/${credential.id}`,
            reason
        );
    }
}

async function persistOpenAiImages(options: {
    result: OpenAI.Images.ImagesResponse;
    mode: 'generate' | 'edit';
    model: GptImageModel;
    prompt: string;
    outputFormat: ValidOutputFormat;
    responseMode: AgentResponseMode;
    requestId: string;
    idempotencyKey: string;
    cached: boolean;
}): Promise<AgentRequestExecutionResult> {
    let persistedImages;
    try {
        persistedImages = await persistSharedOpenAiImages({
            result: options.result,
            outputFormat: options.outputFormat,
            storageMode: 'fs',
            includeBase64: shouldIncludeBase64(options.responseMode)
        });
    } catch (error) {
        if (!(error instanceof InvalidOpenAiImagesResponseError) && !(error instanceof MissingOpenAiImageDataError)) {
            throw error;
        }
        throw new AgentApiError({
            code: 'upstream_unavailable',
            message:
                error instanceof MissingOpenAiImageDataError
                    ? `索引 ${error.index} 的图片数据缺少 base64 数据。`
                    : '上游返回了空的 Images 响应。',
            status: 502,
            retryable: true,
            upstreamStatus: 502,
            retryAfterSeconds: 15
        });
    }

    const createdAt = isoDate(new Date());
    const images: AgentImageResponseItem[] = [];
    const stateImages: AgentImageResponseItem[] = [];
    const artifacts: AgentArtifactRecord[] = [];
    const promptHash = hashText(options.prompt);

    for (const persistedImage of persistedImages) {
        const artifactId = createArtifactId();
        const contentUrl = `/api/agent/artifacts/${artifactId}/content`;
        const metadataUrl = `/api/agent/artifacts/${artifactId}`;
        const artifact: AgentArtifactRecord = {
            id: artifactId,
            requestId: options.requestId,
            filename: persistedImage.filename,
            filepath: persistedImage.filepath,
            contentUrl,
            metadataUrl,
            outputFormat: options.outputFormat,
            mimeType: persistedImage.mimeType,
            sizeBytes: persistedImage.sizeBytes,
            width: persistedImage.width,
            height: persistedImage.height,
            model: options.model,
            promptHash,
            createdAt
        };
        artifacts.push(artifact);
        images.push(artifactRecordToResponseItem(artifact, persistedImage.responseJson));
        stateImages.push(artifactRecordToResponseItem(artifact));
    }

    return {
        artifacts,
        response: {
            request_id: options.requestId,
            idempotency_key: options.idempotencyKey,
            cached: options.cached,
            images,
            usage: options.result.usage,
            created_at: createdAt
        },
        stateResponse: {
            request_id: options.requestId,
            idempotency_key: options.idempotencyKey,
            cached: options.cached,
            images: stateImages,
            usage: options.result.usage,
            created_at: createdAt
        }
    };
}

function shouldIncludeBase64(responseMode: AgentResponseMode): boolean {
    return responseMode === 'base64' || responseMode === 'both';
}

function readAgentResponseModeFromForm(formData: FormData): AgentResponseMode {
    const value = formData.get('response_mode');
    if (value === null) return 'path';
    if (value === 'path' || value === 'base64' || value === 'both') return value;
    throw new RequestValidationError('response_mode 必须是 path、base64 或 both。', 422);
}

function readAgentEditStreamRequest(formData: FormData): AgentEditStreamRequest {
    const streamMode = readAgentEditStreamMode(formData);
    const streamingStrategy = readAgentEditStreamingStrategy(formData);
    if (streamMode !== 'non_stream') {
        resolveImageStreamEnabled({
            imageBackend: 'images-api',
            requestedStream: true,
            streamingStrategy
        });
    }
    return {
        streamMode,
        streamingStrategy,
        partialImages: readCount(formData, 'partial_images', 2, 1, 3) as 1 | 2 | 3
    };
}

function readAgentEditStreamMode(formData: FormData): ImageStreamMode {
    const value = formData.get('stream_mode');
    if (value === null && formData.get('streaming_strategy') === 'off') return 'non_stream';
    if (value === null) return 'auto';
    if (typeof value !== 'string') {
        throw new RequestValidationError('stream_mode 必须是 auto、stream 或 non_stream。', 422);
    }
    try {
        return parseImageStreamModeValue(value);
    } catch (error) {
        throw new RequestValidationError(error instanceof Error ? error.message : 'stream_mode 无效。', 422);
    }
}

function readAgentEditStreamingStrategy(formData: FormData): ImageStreamingStrategy {
    const value = formData.get('streaming_strategy');
    if (value === null) return 'auto';
    if (typeof value !== 'string') {
        throw new RequestValidationError(
            'streaming_strategy 必须是 off、auto、openai-sse、newapi-keepalive-sse、responses-sse 或 force-sse。',
            422
        );
    }
    try {
        return parseImageStreamingStrategyValue(value);
    } catch (error) {
        throw new RequestValidationError(error instanceof Error ? error.message : 'streaming_strategy 无效。', 422);
    }
}

function readAgentResponseModeFromRequestJson(requestJson: unknown): AgentResponseMode {
    if (typeof requestJson !== 'object' || requestJson === null) return 'path';
    const body = requestJson as Record<string, unknown>;
    const directValue = body.response_mode;
    if (directValue === 'path' || directValue === 'base64' || directValue === 'both') return directValue;
    const fields = body.fields;
    if (typeof fields !== 'object' || fields === null) return 'path';
    const formValue = (fields as Record<string, unknown>).response_mode;
    return formValue === 'path' || formValue === 'base64' || formValue === 'both' ? formValue : 'path';
}

async function readArtifactBase64(filepath: string): Promise<string> {
    const buffer = await fs.readFile(filepath);
    return buffer.toString('base64');
}
