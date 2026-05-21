import {
    type ChannelCredential,
    describeChannelFailure,
    isChannelFailure,
    isCredentialFailure,
    resolveEffectiveCredential
} from './channel-router';
import {
    type AgentGenerateRequest,
    type AgentImageResponse,
    type AgentImageResponseItem,
    type AgentResponseMode,
    validateAgentGenerateRequest
} from './agent-api-contracts';
import { AgentApiError, normalizeAgentError, type AgentErrorBody } from './api-error-response';
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
import { appLogger } from './app-logger';
import fs from 'fs/promises';
import {
    InvalidOpenAiImagesResponseError,
    MissingOpenAiImageDataError,
    persistOpenAiImages as persistSharedOpenAiImages
} from './image-service';
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
import { getServerChannelState } from './server-channel-router';
import { readAffinityKey } from './server-runtime';
import crypto from 'crypto';
import OpenAI from 'openai';
import type { AgentErrorDiagnostics } from './api-error-response';

export type AgentRequestExecutionResult = {
    response: AgentImageResponse;
    stateResponse: AgentImageResponse;
    artifacts: AgentArtifactRecord[];
};

type CredentialContext = {
    openai: OpenAI;
    selectedCredential?: ChannelCredential;
    baseUrl?: string;
};

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
}): Promise<AgentRequestExecutionResult> {
    const credentialContext = createOpenAiClient(options.headers);
    const startedAtMs = Date.now();
    try {
        const result = await credentialContext.openai.images.generate({
            model: options.request.model,
            prompt: options.request.prompt,
            n: options.request.n,
            size: options.request.size as OpenAI.Images.ImageGenerateParams['size'],
            quality: options.request.quality as OpenAI.Images.ImageGenerateParams['quality'],
            output_format: options.request.output_format,
            background: options.request.background as OpenAI.Images.ImageGenerateParams['background'],
            moderation: options.request.moderation as OpenAI.Images.ImageGenerateParams['moderation'],
            ...(options.request.output_compression !== undefined
                ? { output_compression: options.request.output_compression }
                : {}),
            stream: false
        });
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

export async function executeAgentEdit(options: {
    formData: FormData;
    headers: Headers;
    requestId: string;
    idempotencyKey: string;
    cached: boolean;
}): Promise<AgentRequestExecutionResult> {
    const credentialContext = createOpenAiClient(options.headers);
    const startedAtMs = Date.now();
    try {
        const prompt = readRequiredText(options.formData, 'prompt');
        const model = readModel(options.formData);
        const n = readCount(options.formData, 'n', 1, 1, 10);
        const size = readSize(options.formData, 'size', 'auto', model) as OpenAI.Images.ImageEditParams['size'];
        const quality = readEditQuality(options.formData) as OpenAI.Images.ImageEditParams['quality'];
        const responseMode = readAgentResponseModeFromForm(options.formData);
        const imageFiles = readImageFiles(options.formData);
        const maskFile = readMaskFile(options.formData);

        const result = await credentialContext.openai.images.edit({
            model,
            prompt,
            image: imageFiles,
            n,
            size: size === 'auto' ? undefined : size,
            quality: quality === 'auto' ? undefined : quality,
            ...(maskFile ? { mask: maskFile } : {})
        });

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
        reportServerCredentialFailure(credentialContext.selectedCredential, error);
        throw normalizeAgentError(error, buildAgentExecutionDiagnostics(credentialContext, startedAtMs));
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
    try {
        return await request.formData();
    } catch {
        throw new RequestValidationError('请求正文必须是有效的 multipart/form-data。', 422);
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
    const { apiKey, baseUrl, selectedCredential: effectiveSelectedCredential } = resolveEffectiveCredential({
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
        baseUrl
    };
}

function buildAgentExecutionDiagnostics(context: CredentialContext, startedAtMs: number): AgentErrorDiagnostics {
    const upstreamHost = context.baseUrl ? readUrlHost(context.baseUrl) : undefined;
    return {
        elapsed_ms: Date.now() - startedAtMs,
        ...(context.selectedCredential?.channelId ? { selected_channel_id: context.selectedCredential.channelId } : {}),
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
        appLogger.warn(`Temporarily cooling down API channel credential: ${credential.channelId}/${credential.id}`, reason);
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
