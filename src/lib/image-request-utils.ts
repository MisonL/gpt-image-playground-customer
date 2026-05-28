import { validateGptImage2Size } from './size-utils';
import type OpenAI from 'openai';

export const VALID_IMAGE_FILENAME_PATTERN = /^\d{13}(?:-[a-f0-9]{16})?-\d+\.(png|jpe?g|webp)$/i;
export const MAX_IMAGE_COUNT = 10;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PROMPT_LENGTH = 32000;

const VALID_MODE_VALUES = ['generate', 'edit'] as const;
const VALID_MODEL_VALUES = ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2'] as const;
const VALID_OUTPUT_FORMAT_VALUES = ['png', 'jpeg', 'webp'] as const;
const VALID_GENERATE_QUALITY_VALUES = ['low', 'medium', 'high', 'auto'] as const;
const VALID_EDIT_QUALITY_VALUES = ['low', 'medium', 'high', 'auto'] as const;
const VALID_BACKGROUND_VALUES = ['transparent', 'opaque', 'auto'] as const;
const VALID_MODERATION_VALUES = ['low', 'auto'] as const;
const VALID_LEGACY_SIZE_VALUES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
const IMAGE_UPLOAD_CONTROL_FIELDS = new Set(['image_streaming_strategy']);

export type ImageMode = (typeof VALID_MODE_VALUES)[number];
export type GptImageModel = (typeof VALID_MODEL_VALUES)[number];
export type ValidOutputFormat = (typeof VALID_OUTPUT_FORMAT_VALUES)[number];
export type GenerateQuality = (typeof VALID_GENERATE_QUALITY_VALUES)[number];
export type EditQuality = (typeof VALID_EDIT_QUALITY_VALUES)[number];
export type Background = (typeof VALID_BACKGROUND_VALUES)[number];
export type Moderation = (typeof VALID_MODERATION_VALUES)[number];
export type StorageMode = 'fs' | 'indexeddb';

export class RequestValidationError extends Error {
    readonly status: number;
    readonly details?: Record<string, unknown>;

    constructor(message: string, status = 400, details?: Record<string, unknown>) {
        super(message);
        this.name = 'RequestValidationError';
        this.status = status;
        this.details = details;
    }
}

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
    return (allowed as readonly string[]).includes(value);
}

export function readRequiredText(formData: FormData, field: string, maxLength = MAX_PROMPT_LENGTH): string {
    const value = formData.get(field);
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(`缺少必填参数：${field}`);
    }
    if (value.length > maxLength) {
        throw new RequestValidationError(`${field} 超过 ${maxLength} 个字符的最大长度。`);
    }
    return value;
}

export function readMode(formData: FormData): ImageMode {
    const value = formData.get('mode');
    if (typeof value !== 'string' || !isOneOf(value, VALID_MODE_VALUES)) {
        throw new RequestValidationError('mode 无效，必须是 generate 或 edit。');
    }
    return value;
}

export function readModel(formData: FormData): GptImageModel {
    const value = formData.get('model');
    if (value === null) return 'gpt-image-2';
    if (typeof value !== 'string' || !isOneOf(value, VALID_MODEL_VALUES)) {
        throw new RequestValidationError('model 无效。');
    }
    return value;
}

export function readCount(formData: FormData, field: string, fallback: number, min: number, max: number): number {
    const rawValue = formData.get(field);
    if (rawValue === null) return fallback;
    if (typeof rawValue !== 'string' || !/^\d+$/.test(rawValue)) {
        throw new RequestValidationError(`${field} 必须是整数。`);
    }
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RequestValidationError(`${field} 必须在 ${min} 到 ${max} 之间。`);
    }
    return value;
}

export function readOutputFormat(formData: FormData): ValidOutputFormat {
    const rawValue = formData.get('output_format');
    if (rawValue === null) return 'png';
    if (typeof rawValue !== 'string') {
        throw new RequestValidationError('output_format 必须是字符串。');
    }
    const normalized = rawValue.toLowerCase();
    const mapped = normalized === 'jpg' ? 'jpeg' : normalized;
    if (!isOneOf(mapped, VALID_OUTPUT_FORMAT_VALUES)) {
        throw new RequestValidationError('output_format 无效，必须是 png、jpeg 或 webp。');
    }
    return mapped;
}

export function readGenerateQuality(formData: FormData): GenerateQuality {
    const value = formData.get('quality');
    if (value === null) return 'high';
    if (typeof value !== 'string' || !isOneOf(value, VALID_GENERATE_QUALITY_VALUES)) {
        throw new RequestValidationError('quality 无效。');
    }
    return value;
}

export function readEditQuality(formData: FormData): EditQuality {
    const value = formData.get('quality');
    if (value === null) return 'auto';
    if (typeof value !== 'string' || !isOneOf(value, VALID_EDIT_QUALITY_VALUES)) {
        throw new RequestValidationError('quality 无效。');
    }
    return value;
}

export function readBackground(formData: FormData, model: GptImageModel): Background {
    const value = formData.get('background');
    if (value === null) return 'auto';
    if (typeof value !== 'string' || !isOneOf(value, VALID_BACKGROUND_VALUES)) {
        throw new RequestValidationError('background 无效。');
    }
    if (model === 'gpt-image-2' && value === 'transparent') {
        throw new RequestValidationError('gpt-image-2 不支持 transparent 背景。');
    }
    return value;
}

export function readModeration(formData: FormData): Moderation {
    const value = formData.get('moderation');
    if (value === null) return 'auto';
    if (typeof value !== 'string' || !isOneOf(value, VALID_MODERATION_VALUES)) {
        throw new RequestValidationError('moderation 无效。');
    }
    return value;
}

export function readSize(formData: FormData, field: string, fallback: string, model: GptImageModel): string {
    const value = formData.get(field);
    if (value === null) return fallback;
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(`${field} 必须是字符串。`);
    }
    if (model !== 'gpt-image-2' && !isOneOf(value, VALID_LEGACY_SIZE_VALUES)) {
        throw new RequestValidationError(`${field} 对 ${model} 无效。`);
    }
    if (model === 'gpt-image-2' && value !== 'auto' && !/^\d+x\d+$/.test(value)) {
        throw new RequestValidationError(`${field} 必须是 auto 或 WxH 格式的尺寸值。`);
    }
    if (model === 'gpt-image-2' && value !== 'auto') {
        const [width, height] = value.split('x').map(Number);
        const validation = validateGptImage2Size(width, height);
        if (!validation.valid) {
            throw new RequestValidationError(`${field} 对 ${model} 无效：${validation.reason}`);
        }
    }
    return value;
}

export function readOutputCompression(formData: FormData, outputFormat: ValidOutputFormat): number | undefined {
    const value = formData.get('output_compression');
    if (value === null) return undefined;
    if (outputFormat === 'png') {
        throw new RequestValidationError('output_compression 仅适用于 jpeg 或 webp 输出。');
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new RequestValidationError('output_compression 必须是整数。');
    }
    const compression = Number(value);
    if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
        throw new RequestValidationError('output_compression 必须在 0 到 100 之间。');
    }
    return compression;
}

export function readStorageMode(env: NodeJS.ProcessEnv): StorageMode {
    const explicitMode = env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;
    if (explicitMode === 'fs' || explicitMode === 'indexeddb') return explicitMode;
    if (explicitMode) {
        throw new RequestValidationError('NEXT_PUBLIC_IMAGE_STORAGE_MODE 必须是 fs 或 indexeddb。', 500);
    }
    return env.VERCEL === '1' ? 'indexeddb' : 'fs';
}

export function assertSafeApiOverride(requestApiKey: string, requestApiBaseUrl: string): void {
    if (requestApiBaseUrl && !requestApiKey) {
        throw new RequestValidationError('填写自定义 API URL 时必须同时填写 API Key，避免服务器密钥被发送到未知地址。');
    }
}

export function validateApiBaseUrl(baseUrl: string): void {
    if (!baseUrl) return;
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        throw new RequestValidationError('API URL 格式无效。');
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        throw new RequestValidationError('API URL 必须使用 https，localhost 调试地址除外。');
    }
}

export function isValidImageFilename(filename: string): boolean {
    return VALID_IMAGE_FILENAME_PATTERN.test(filename);
}

export function safeImagePath(baseDir: string, filename: string): string {
    if (!isValidImageFilename(filename)) {
        throw new RequestValidationError('文件名无效');
    }
    return `${baseDir}/${filename}`;
}

export function readImageFiles(formData: FormData): File[] {
    const imageFilesByIndex = new Map<number, File>();
    for (const [key, value] of formData.entries()) {
        if (!key.startsWith('image_')) continue;
        if (IMAGE_UPLOAD_CONTROL_FIELDS.has(key)) continue;
        const imageIndex = readImageFileIndex(key);
        if (imageIndex === undefined) {
            throw new RequestValidationError(`图片字段 ${key} 无效，必须使用 image_0 到 image_9。`);
        }
        if (imageFilesByIndex.has(imageIndex)) {
            throw new RequestValidationError(`图片字段 ${key} 重复。`);
        }
        if (!(value instanceof File)) {
            throw new RequestValidationError(`${key} 必须是图片文件。`);
        }
        imageFilesByIndex.set(imageIndex, value);
    }
    const imageFiles = Array.from(imageFilesByIndex.entries())
        .sort(([left], [right]) => left - right)
        .map(([, file]) => file);
    if (imageFiles.length === 0) {
        throw new RequestValidationError('编辑时必须提供图片文件。');
    }
    if (imageFiles.length > MAX_IMAGE_COUNT) {
        throw new RequestValidationError(`一次最多只能编辑 ${MAX_IMAGE_COUNT} 张图片。`);
    }
    imageFiles.forEach((file) => validateUploadFile(file));
    return imageFiles;
}

function readImageFileIndex(key: string): number | undefined {
    if (!key.startsWith('image_')) return undefined;
    const suffix = key.slice('image_'.length);
    if (!/^(?:0|[1-9]\d*)$/.test(suffix)) return undefined;
    const index = Number(suffix);
    return Number.isInteger(index) && index >= 0 && index < MAX_IMAGE_COUNT ? index : undefined;
}

export function readMaskFile(formData: FormData): File | undefined {
    const value = formData.get('mask');
    if (value === null) return undefined;
    if (!(value instanceof File)) {
        throw new RequestValidationError('mask 必须是 PNG 文件。');
    }
    validateUploadFile(value, { requirePng: true, fieldName: 'mask' });
    return value;
}

function validateUploadFile(file: File, options: { requirePng?: boolean; fieldName?: string } = {}): void {
    const fieldName = options.fieldName || file.name || 'image';
    if (file.size <= 0) {
        throw new RequestValidationError(`${fieldName} 为空。`);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
        throw new RequestValidationError(`${fieldName} 超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 限制。`);
    }
    if (!file.type.startsWith('image/')) {
        throw new RequestValidationError(`${fieldName} 必须是图片文件。`);
    }
    if (options.requirePng && file.type !== 'image/png') {
        throw new RequestValidationError(`${fieldName} 必须是 PNG 文件。`);
    }
}

export function createImageResult(
    filename: string,
    b64Json: string,
    outputFormat: ValidOutputFormat,
    storageMode: StorageMode
): { filename: string; b64_json: string; path?: string; output_format: string } {
    return {
        filename,
        b64_json: b64Json,
        output_format: outputFormat,
        ...(storageMode === 'fs' ? { path: `/api/image/${filename}` } : {})
    };
}

export type GenerateParams = Omit<OpenAI.Images.ImageGenerateParams, 'output_compression'> & {
    output_compression?: number;
    force_web?: boolean;
};
