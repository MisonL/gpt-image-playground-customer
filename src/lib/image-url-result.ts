import { RequestValidationError } from './image-request-utils';
import { mergeUpstreamHeadersWithFixed, type UpstreamRequestHeaders } from './image-upstream-profile';

const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;
const REMOTE_IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;

export class RemoteImageResultError extends Error {
    readonly status = 502;

    constructor(message: string) {
        super(message);
        this.name = 'RemoteImageResultError';
    }
}

function resolveSameOriginImageUrl(rawUrl: string, apiBaseUrl: string | undefined): URL {
    if (!apiBaseUrl) {
        throw new RemoteImageResultError('上游返回远程图片 URL，但当前请求缺少 API Base URL，无法安全下载。');
    }
    let base: URL;
    let resolved: URL;
    try {
        base = new URL(apiBaseUrl);
        resolved = new URL(rawUrl, base);
    } catch {
        throw new RemoteImageResultError('上游返回的图片 URL 格式无效。');
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        throw new RemoteImageResultError('上游图片 URL 必须使用 http 或 https。');
    }
    if (resolved.username || resolved.password) {
        throw new RemoteImageResultError('上游图片 URL 不能包含用户名或密码。');
    }
    if (resolved.origin !== base.origin) {
        throw new RemoteImageResultError('上游图片 URL 必须与 API Base URL 同源。');
    }
    return resolved;
}

export async function downloadSameOriginImageAsBase64(input: {
    imageUrl: string;
    apiBaseUrl?: string;
    apiKey?: string;
    upstreamHeaders?: UpstreamRequestHeaders;
    abortSignal?: AbortSignal;
}): Promise<string> {
    const url = resolveSameOriginImageUrl(input.imageUrl, input.apiBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_DOWNLOAD_TIMEOUT_MS);
    const abortListener = () => controller.abort();
    input.abortSignal?.addEventListener('abort', abortListener, { once: true });
    try {
        const response = await fetch(url, {
            headers: buildDownloadHeaders(input.apiKey, input.upstreamHeaders),
            signal: controller.signal
        });
        if (!response.ok) {
            throw new RemoteImageResultError(`下载上游图片失败：HTTP ${response.status}。`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().startsWith('image/')) {
            throw new RemoteImageResultError('下载上游图片失败：响应不是图片类型。');
        }
        const contentLength = response.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_REMOTE_IMAGE_BYTES) {
            throw new RemoteImageResultError('下载上游图片失败：图片超过 25 MB 限制。');
        }
        const buffer = await readBoundedResponseBody(response);
        if (buffer.length === 0) {
            throw new RemoteImageResultError('下载上游图片失败：图片为空。');
        }
        return buffer.toString('base64');
    } catch (error) {
        if (error instanceof RemoteImageResultError) throw error;
        if (controller.signal.aborted) {
            throw new RemoteImageResultError('下载上游图片失败：请求超时或已取消。');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        input.abortSignal?.removeEventListener('abort', abortListener);
    }
}

function buildDownloadHeaders(
    apiKey: string | undefined,
    upstreamHeaders: UpstreamRequestHeaders | undefined
): UpstreamRequestHeaders | undefined {
    const headers = apiKey
        ? mergeUpstreamHeadersWithFixed(upstreamHeaders, { Authorization: `Bearer ${apiKey}` })
        : { ...(upstreamHeaders || {}) };
    return Object.keys(headers).length > 0 ? headers : undefined;
}

async function readBoundedResponseBody(response: Response): Promise<Buffer> {
    if (!response.body) {
        const contentLength = response.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_REMOTE_IMAGE_BYTES) {
            throw new RemoteImageResultError('下载上游图片失败：图片超过 25 MB 限制。');
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
            throw new RemoteImageResultError('下载上游图片失败：图片超过 25 MB 限制。');
        }
        return buffer;
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_REMOTE_IMAGE_BYTES) {
                throw new RemoteImageResultError('下载上游图片失败：图片超过 25 MB 限制。');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export function assertRemoteImageResultSafety(apiBaseUrl: string | undefined, imageUrl: string): void {
    try {
        resolveSameOriginImageUrl(imageUrl, apiBaseUrl);
    } catch (error) {
        if (error instanceof RemoteImageResultError) throw error;
        throw new RequestValidationError('上游图片 URL 无效。', 502);
    }
}
