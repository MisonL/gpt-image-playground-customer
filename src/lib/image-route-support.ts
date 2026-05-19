import { appLogger } from './app-logger';
import {
    type ChannelCredential,
    describeChannelFailure,
    isChannelFailure,
    isCredentialFailure
} from './channel-router';
import { RequestValidationError } from './image-request-utils';
import { getServerChannelState } from './server-channel-router';
import { buildAccessCookie, outputDir, readBooleanEnv, serializeAccessCookie } from './server-runtime';
import { resolveActualCost, type ActualCostDetails } from './upstream-cost/resolve';
import fs from 'fs/promises';
import { NextResponse } from 'next/server';

export type AccessCookie = ReturnType<typeof buildAccessCookie>;
export type ImageBackend = 'images' | 'responses';
export type RequestLogContext = { clientRequestId: string };

export function readClientRequestId(formData: FormData): string | undefined {
    const value = formData.get('clientRequestId');
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    return normalized.slice(0, 128);
}

export function readImageBackend(formData: FormData): ImageBackend {
    const value = formData.get('imageBackend');
    if (value === null || value === undefined || value === '' || value === 'images') {
        return 'images';
    }
    if (value === 'responses') {
        return 'responses';
    }
    throw new RequestValidationError('imageBackend 必须是 images 或 responses。', 400);
}

export function assertResponsesImageBackendAllowed(input: {
    imageBackend: ImageBackend;
    mode: string;
    streamEnabled: boolean;
}) {
    if (input.imageBackend !== 'responses') return;
    if (!readBooleanEnv(process.env, 'ENABLE_RESPONSES_IMAGE_BACKEND')) {
        throw new RequestValidationError(
            'Responses API 图片后端仍是实验能力，必须设置 ENABLE_RESPONSES_IMAGE_BACKEND=true 后才能使用。',
            400
        );
    }
    if (input.mode !== 'generate') {
        throw new RequestValidationError('Responses API 图片后端当前只支持 generate 模式。', 400);
    }
    if (input.streamEnabled) {
        throw new RequestValidationError('Responses API 图片后端当前不接入现有 Images API 流式预览。', 400);
    }
}

export function reportServerCredentialFailure(credential: ChannelCredential | undefined, error: unknown) {
    const serverChannelRouter = getServerChannelState().router;
    if (!credential || !serverChannelRouter) return;
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

export function describeInvalidImagesResponse(result: unknown): string {
    if (typeof result === 'string') {
        const normalized = result.trim().toLowerCase();
        if (normalized.includes('<!doctype html') || normalized.includes('<html')) {
            return 'API 返回的是 HTML 页面，不是 OpenAI Images JSON 响应。请确认 API URL 填的是兼容接口根地址，通常需要以 /v1 结尾，例如 https://api.openai.com/v1；不要填写管理后台或网页首页地址。';
        }
    }
    return 'API 返回的数据不是 OpenAI Images 格式。请确认 API URL 是 OpenAI 兼容接口，并且该接口支持 Images generate/edit。';
}

export function appendAccessCookie(response: Response, accessCookie: AccessCookie | undefined): Response {
    if (accessCookie) {
        response.headers.append('Set-Cookie', serializeAccessCookie(accessCookie));
    }
    return response;
}

export function attachAccessCookie<T extends NextResponse>(response: T, accessCookie: AccessCookie | undefined): T {
    if (accessCookie) {
        response.cookies.set(accessCookie.name, accessCookie.value, accessCookie.options);
    }
    return response;
}

export async function ensureOutputDirExists() {
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
            return;
        }
        appLogger.error(`访问图片输出目录失败 ${outputDir}：`, error);
        throw new Error(
            `访问或确认图片输出目录失败。原始错误：${error instanceof Error ? error.message : String(error)}`
        );
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

export async function resolveRequestActualCostSafely(input: {
    apiBaseUrl?: string;
    apiKey: string;
    model: string;
    startedAtMs: number;
    expectedImageCount: number;
    requestLogContext?: RequestLogContext;
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
