import type OpenAI from 'openai';

export const VALID_IMAGE_FILENAME_PATTERN = /^\d{13}-\d+\.(png|jpe?g|webp)$/i;
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

    constructor(message: string, status = 400) {
        super(message);
        this.name = 'RequestValidationError';
        this.status = status;
    }
}

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
    return (allowed as readonly string[]).includes(value);
}

export function readRequiredText(formData: FormData, field: string, maxLength = MAX_PROMPT_LENGTH): string {
    const value = formData.get(field);
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(`Missing required parameter: ${field}`);
    }
    if (value.length > maxLength) {
        throw new RequestValidationError(`${field} exceeds the maximum length of ${maxLength} characters.`);
    }
    return value;
}

export function readMode(formData: FormData): ImageMode {
    const value = formData.get('mode');
    if (typeof value !== 'string' || !isOneOf(value, VALID_MODE_VALUES)) {
        throw new RequestValidationError('Invalid mode. Expected generate or edit.');
    }
    return value;
}

export function readModel(formData: FormData): GptImageModel {
    const value = formData.get('model');
    if (value === null) return 'gpt-image-2';
    if (typeof value !== 'string' || !isOneOf(value, VALID_MODEL_VALUES)) {
        throw new RequestValidationError('Invalid model.');
    }
    return value;
}

export function readCount(formData: FormData, field: string, fallback: number, min: number, max: number): number {
    const rawValue = formData.get(field);
    if (rawValue === null) return fallback;
    if (typeof rawValue !== 'string' || !/^\d+$/.test(rawValue)) {
        throw new RequestValidationError(`${field} must be an integer.`);
    }
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RequestValidationError(`${field} must be between ${min} and ${max}.`);
    }
    return value;
}

export function readOutputFormat(formData: FormData): ValidOutputFormat {
    const rawValue = formData.get('output_format');
    if (rawValue === null) return 'png';
    if (typeof rawValue !== 'string') {
        throw new RequestValidationError('output_format must be a string.');
    }
    const normalized = rawValue.toLowerCase();
    const mapped = normalized === 'jpg' ? 'jpeg' : normalized;
    if (!isOneOf(mapped, VALID_OUTPUT_FORMAT_VALUES)) {
        throw new RequestValidationError('Invalid output_format. Expected png, jpeg, or webp.');
    }
    return mapped;
}

export function readGenerateQuality(formData: FormData): GenerateQuality {
    const value = formData.get('quality');
    if (value === null) return 'auto';
    if (typeof value !== 'string' || !isOneOf(value, VALID_GENERATE_QUALITY_VALUES)) {
        throw new RequestValidationError('Invalid quality.');
    }
    return value;
}

export function readEditQuality(formData: FormData): EditQuality {
    const value = formData.get('quality');
    if (value === null) return 'auto';
    if (typeof value !== 'string' || !isOneOf(value, VALID_EDIT_QUALITY_VALUES)) {
        throw new RequestValidationError('Invalid quality.');
    }
    return value;
}

export function readBackground(formData: FormData, model: GptImageModel): Background {
    const value = formData.get('background');
    if (value === null) return 'auto';
    if (typeof value !== 'string' || !isOneOf(value, VALID_BACKGROUND_VALUES)) {
        throw new RequestValidationError('Invalid background.');
    }
    if (model === 'gpt-image-2' && value === 'transparent') {
        throw new RequestValidationError('transparent background is not supported for gpt-image-2.');
    }
    return value;
}

export function readModeration(formData: FormData): Moderation {
    const value = formData.get('moderation');
    if (value === null) return 'auto';
    if (typeof value !== 'string' || !isOneOf(value, VALID_MODERATION_VALUES)) {
        throw new RequestValidationError('Invalid moderation.');
    }
    return value;
}

export function readSize(formData: FormData, field: string, fallback: string, model: GptImageModel): string {
    const value = formData.get(field);
    if (value === null) return fallback;
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(`${field} must be a string.`);
    }
    if (model !== 'gpt-image-2' && !isOneOf(value, VALID_LEGACY_SIZE_VALUES)) {
        throw new RequestValidationError(`${field} is not valid for ${model}.`);
    }
    if (model === 'gpt-image-2' && value !== 'auto' && !/^\d+x\d+$/.test(value)) {
        throw new RequestValidationError(`${field} must be auto or a WxH value.`);
    }
    return value;
}

export function readOutputCompression(formData: FormData, outputFormat: ValidOutputFormat): number | undefined {
    const value = formData.get('output_compression');
    if (value === null) return undefined;
    if (outputFormat === 'png') {
        throw new RequestValidationError('output_compression is only valid for jpeg or webp output.');
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new RequestValidationError('output_compression must be an integer.');
    }
    const compression = Number(value);
    if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
        throw new RequestValidationError('output_compression must be between 0 and 100.');
    }
    return compression;
}

export function readStorageMode(env: NodeJS.ProcessEnv): StorageMode {
    const explicitMode = env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;
    if (explicitMode === 'fs' || explicitMode === 'indexeddb') return explicitMode;
    if (explicitMode) {
        throw new RequestValidationError('NEXT_PUBLIC_IMAGE_STORAGE_MODE must be fs or indexeddb.', 500);
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
        throw new RequestValidationError('Invalid filename');
    }
    return `${baseDir}/${filename}`;
}

export function readImageFiles(formData: FormData): File[] {
    const imageFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
        if (key.startsWith('image_') && value instanceof File) {
            imageFiles.push(value);
        }
    }
    if (imageFiles.length === 0) {
        throw new RequestValidationError('No image file provided for editing.');
    }
    if (imageFiles.length > MAX_IMAGE_COUNT) {
        throw new RequestValidationError(`No more than ${MAX_IMAGE_COUNT} images can be edited at once.`);
    }
    imageFiles.forEach((file) => validateUploadFile(file));
    return imageFiles;
}

export function readMaskFile(formData: FormData): File | undefined {
    const value = formData.get('mask');
    if (value === null) return undefined;
    if (!(value instanceof File)) {
        throw new RequestValidationError('mask must be a PNG file.');
    }
    validateUploadFile(value, { requirePng: true, fieldName: 'mask' });
    return value;
}

function validateUploadFile(file: File, options: { requirePng?: boolean; fieldName?: string } = {}): void {
    const fieldName = options.fieldName || file.name || 'image';
    if (file.size <= 0) {
        throw new RequestValidationError(`${fieldName} is empty.`);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
        throw new RequestValidationError(`${fieldName} exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`);
    }
    if (!file.type.startsWith('image/')) {
        throw new RequestValidationError(`${fieldName} must be an image file.`);
    }
    if (options.requirePng && file.type !== 'image/png') {
        throw new RequestValidationError(`${fieldName} must be a PNG file.`);
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
};
