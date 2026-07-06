import { readImageDimensions } from './image-dimensions.mjs';
import { errorMessage, parseImageSizeValue, resolveSameOriginUrl } from './script-utils.mjs';

export const FAILURE_KIND_DIMENSION_CHECK = 'generated_artifact_failed_dimension_check';
export const DEFAULT_DIMENSION_CHECK_MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const DEFAULT_DIMENSION_CHECK_NEXT_STEP =
    '确认当前渠道是否支持请求尺寸，或调整任务接受实际返回尺寸；重新执行必须使用新的 Idempotency-Key。';
const DEFAULT_READ_URL_FIELDS = ['absolute_content_url', 'content_url'];

export class DimensionCheckError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'DimensionCheckError';
        this.code = 'dimension_check_failed';
        this.retryable = false;
        this.billable = true;
        this.nextStep = details.nextStep || DEFAULT_DIMENSION_CHECK_NEXT_STEP;
        this.expectedDimensions = details.expected;
        this.actualDimensions = details.actual;
        this.response = sanitizeImageResponse(details.response);
    }
}

export function isDimensionCheckError(error) {
    return Boolean(error && typeof error === 'object' && error.code === 'dimension_check_failed');
}

export function parseExpectedDimensions(size) {
    return size && size !== 'auto' ? parseImageSizeValue(size) : undefined;
}

export function sanitizeImageResponse(response) {
    if (!response || !Array.isArray(response.images)) return response;
    return {
        ...response,
        images: response.images.map((image) => {
            if (!image || typeof image !== 'object' || !Object.prototype.hasOwnProperty.call(image, 'b64_json')) {
                return image;
            }
            const { b64_json: b64Json, ...safeImage } = image;
            return {
                ...safeImage,
                ...(typeof b64Json === 'string' ? { b64_json_length: b64Json.length } : {})
            };
        })
    };
}

export async function assertImageDimensions({
    response,
    expected,
    baseUrl,
    authHeaders,
    timeoutMs,
    maxImageBytes = DEFAULT_DIMENSION_CHECK_MAX_IMAGE_BYTES,
    messagePrefix = '尺寸校验失败',
    missingSizeMessage = '--dimension-check 需要 size 为 WIDTHxHEIGHT。',
    nextStep,
    readUrlFields = DEFAULT_READ_URL_FIELDS
}) {
    if (!expected) {
        throw new DimensionCheckError(missingSizeMessage, { nextStep });
    }
    if (!Array.isArray(response?.images) || response.images.length === 0) {
        throw new DimensionCheckError(`${messagePrefix}：响应中没有可验收的图片。`, {
            expected,
            response,
            nextStep
        });
    }

    const images = [];
    let mismatch;
    for (const image of response.images) {
        let actual;
        try {
            const bytes = await readImageBytes({
                image,
                baseUrl,
                authHeaders,
                timeoutMs,
                maxImageBytes,
                readUrlFields
            });
            actual = readImageDimensions(bytes);
        } catch (error) {
            throw new DimensionCheckError(`${messagePrefix}：${errorMessage(error)}`, {
                expected,
                response: { ...response, images: [...images, sanitizeImageResponse({ images: [image] }).images[0]] },
                nextStep
            });
        }
        images.push({ ...image, dimensions: actual });
        if (actual.width !== expected.width || actual.height !== expected.height) {
            mismatch ??= actual;
        }
    }
    if (mismatch) {
        throw new DimensionCheckError(
            `${messagePrefix}：期望 ${expected.width}x${expected.height}，实际 ${mismatch.width}x${mismatch.height}。`,
            { expected, actual: mismatch, response: { ...response, images }, nextStep }
        );
    }
    return { ...response, images };
}

export function buildDimensionCheckFailureBody(error, routing) {
    return {
        billable: error.billable !== false,
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            expected_dimensions: readDimensionObject(error.expectedDimensions),
            actual_dimensions: readDimensionObject(error.actualDimensions)
        },
        validation_failure_kind: FAILURE_KIND_DIMENSION_CHECK,
        response: error.response,
        routing,
        ...(typeof error?.nextStep === 'string' ? { next_step: error.nextStep } : {})
    };
}

async function readImageBytes({ image, baseUrl, authHeaders, timeoutMs, maxImageBytes, readUrlFields }) {
    if (image.b64_json) {
        assertBase64ImageSizeWithinLimit(image.b64_json, maxImageBytes);
        const bytes = Buffer.from(image.b64_json, 'base64');
        assertImageBytesWithinLimit(bytes.length, maxImageBytes);
        return bytes;
    }
    const source = readFirstUrl(image, readUrlFields);
    if (!source) throw new Error(`dimension-check 需要 b64_json 或 ${formatUrlFieldList(readUrlFields)}。`);
    const resolved = resolveSameOriginUrl(baseUrl, source.url, source.field);
    const headers = typeof authHeaders === 'function' ? authHeaders() : authHeaders;
    const { response, bytes } = await fetchBytes(resolved, headers, timeoutMs, maxImageBytes);
    if (!response.ok) throw new Error(`下载产物失败，状态码 ${response.status}。`);
    return bytes;
}

function formatUrlFieldList(fields) {
    const readable = normalizeUrlFields(fields);
    return readable.length > 0 ? readable.join(' 或 ') : DEFAULT_READ_URL_FIELDS.join(' 或 ');
}

function readFirstUrl(image, fields) {
    for (const field of normalizeUrlFields(fields)) {
        if (typeof image?.[field] === 'string' && image[field]) return { field, url: image[field] };
    }
    return undefined;
}

function normalizeUrlFields(fields) {
    return Array.isArray(fields)
        ? fields.filter((field) => typeof field === 'string' && field)
        : DEFAULT_READ_URL_FIELDS;
}

function readDimensionObject(value) {
    if (!value || typeof value !== 'object') return null;
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

async function fetchBytes(
    url,
    headers = {},
    timeoutMs = 420000,
    maxImageBytes = DEFAULT_DIMENSION_CHECK_MAX_IMAGE_BYTES
) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const signal = controller.signal;
        const response = await fetch(url, { headers, signal });
        return { response, bytes: await readResponseBytes(response, { maxImageBytes, signal, timeoutMs }) };
    } catch (error) {
        if (error?.name === 'AbortError' || error?.code === 'download_timeout')
            throw createDownloadTimeoutError(timeoutMs);
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function readResponseBytes(response, { maxImageBytes, signal, timeoutMs }) {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isSafeInteger(contentLength)) assertImageBytesWithinLimit(contentLength, maxImageBytes);
    if (!response.body) {
        const bytes = Buffer.from(await response.arrayBuffer());
        assertImageBytesWithinLimit(bytes.length, maxImageBytes);
        return bytes;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await readChunkWithAbort(reader, signal, timeoutMs);
            if (done) break;
            const chunk = Buffer.from(value);
            total += chunk.length;
            if (total > maxImageBytes) {
                await reader.cancel();
                assertImageBytesWithinLimit(total, maxImageBytes);
            }
            chunks.push(chunk);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
}

function readChunkWithAbort(reader, signal, timeoutMs) {
    if (!signal) return reader.read();
    if (signal.aborted) return Promise.reject(createDownloadTimeoutError(timeoutMs));
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            reader.cancel().catch(() => {});
            reject(createDownloadTimeoutError(timeoutMs));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        reader
            .read()
            .then(resolve, reject)
            .finally(() => {
                signal.removeEventListener('abort', onAbort);
            });
    });
}

function createDownloadTimeoutError(timeoutMs) {
    const error = new Error(`下载产物超时，已等待 ${timeoutMs}ms。`);
    error.code = 'download_timeout';
    return error;
}

function assertBase64ImageSizeWithinLimit(value, maxImageBytes) {
    const estimatedBytes = estimateBase64DecodedBytes(value);
    assertImageBytesWithinLimit(estimatedBytes, maxImageBytes);
}

function estimateBase64DecodedBytes(value) {
    const normalized = String(value).replace(/\s/g, '');
    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function assertImageBytesWithinLimit(byteLength, maxImageBytes) {
    if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes < 1) {
        throw new Error('dimension-check 图片大小上限配置无效。');
    }
    if (byteLength <= maxImageBytes) return;
    throw new Error(`图片数据超过 ${maxImageBytes} 字节限制。`);
}
