const IMAGE_DATA_URL_PATTERN = /^data:([^;,]+);base64,/i;
const BASE64_PAYLOAD_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ALLOWED_IMAGE_DATA_URL_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/avif'
]);

export function extractImageBase64FromDataUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const match = IMAGE_DATA_URL_PATTERN.exec(value);
    if (!match || !ALLOWED_IMAGE_DATA_URL_MIME_TYPES.has(match[1].toLowerCase())) return undefined;
    const separator = value.indexOf(',');
    if (separator < 0) return undefined;
    const payload = value.slice(separator + 1).trim();
    return isBase64Payload(payload) ? payload : undefined;
}

export function isRemoteHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function readResponsesImageResultBase64(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    const dataUrlPayload = extractImageBase64FromDataUrl(normalized);
    if (dataUrlPayload) return dataUrlPayload;
    if (normalized.startsWith('data:') || isRemoteHttpUrl(normalized)) return undefined;
    return isBase64Payload(normalized) ? normalized : undefined;
}

function isBase64Payload(value: string): boolean {
    return value.length > 0 && value.length % 4 === 0 && BASE64_PAYLOAD_PATTERN.test(value);
}
