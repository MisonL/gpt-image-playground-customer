import { MAX_RESPONSES_EDIT_INPUT_BYTES } from './image-request-limits';
import { resolveImageBackendSelection, type ImageUpstreamProfile } from './image-upstream-profile';
import type { ImageGenerationBackend } from './image-upstream-strategy';

const SUPPORTED_EDIT_SOURCE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;
type EditUploadFile = Pick<File, 'name' | 'size' | 'type'>;

export type EditSourceValidationFailure =
    | { code: 'too-many-images'; maxImages: number }
    | { code: 'source-empty' }
    | { code: 'source-invalid-type' }
    | { code: 'source-too-large'; maxBytes: number }
    | { code: 'source-total-too-large'; maxBytes: number }
    | { code: 'mask-empty' }
    | { code: 'mask-invalid-type' }
    | { code: 'mask-too-large'; maxBytes: number }
    | { code: 'responses-input-too-large'; maxBytes: number };

export function hasReachedEditSourceImageLimit(input: { currentCount: number; maxImages: number }): boolean {
    return input.currentCount >= input.maxImages;
}

export function validateEditSourceInput(input: {
    imageFiles: readonly EditUploadFile[];
    maskFile?: EditUploadFile | null;
    upstreamProfile: Pick<ImageUpstreamProfile, 'upload'>;
    imageBackend: ImageGenerationBackend | 'server-default';
    defaultImageBackend?: ImageGenerationBackend | null;
}): EditSourceValidationFailure | undefined {
    if (input.imageFiles.length > input.upstreamProfile.upload.maxImages) {
        return { code: 'too-many-images', maxImages: input.upstreamProfile.upload.maxImages };
    }

    for (const file of input.imageFiles) {
        if (file.size <= 0) return { code: 'source-empty' };
        if (!isSupportedEditSourceImageType(file.type)) return { code: 'source-invalid-type' };
        if (file.size > input.upstreamProfile.upload.maxSingleBytes) {
            return { code: 'source-too-large', maxBytes: input.upstreamProfile.upload.maxSingleBytes };
        }
    }

    const sourceTotalBytes = sumFileBytes(input.imageFiles);
    if (
        input.upstreamProfile.upload.maxTotalBytes !== undefined &&
        sourceTotalBytes > input.upstreamProfile.upload.maxTotalBytes
    ) {
        return { code: 'source-total-too-large', maxBytes: input.upstreamProfile.upload.maxTotalBytes };
    }

    if (input.maskFile) {
        if (input.maskFile.size <= 0) return { code: 'mask-empty' };
        if (input.maskFile.type !== 'image/png') return { code: 'mask-invalid-type' };
        if (input.maskFile.size > input.upstreamProfile.upload.maxSingleBytes) {
            return { code: 'mask-too-large', maxBytes: input.upstreamProfile.upload.maxSingleBytes };
        }
    }

    const effectiveBackend = resolveImageBackendSelection(input.imageBackend, input.defaultImageBackend);
    if (
        effectiveBackend === 'responses-image-generation' &&
        sourceTotalBytes + (input.maskFile?.size ?? 0) > MAX_RESPONSES_EDIT_INPUT_BYTES
    ) {
        return { code: 'responses-input-too-large', maxBytes: MAX_RESPONSES_EDIT_INPUT_BYTES };
    }

    return undefined;
}

export function isResponsesEditInputLimitActive(input: {
    imageBackend: ImageGenerationBackend | 'server-default';
    defaultImageBackend?: ImageGenerationBackend | null;
}): boolean {
    return resolveImageBackendSelection(input.imageBackend, input.defaultImageBackend) === 'responses-image-generation';
}

export function formatEditUploadLimit(bytes: number): string {
    return `${bytes / 1024 / 1024} MB`;
}

export function getResponsesEditInputLimitLabel(): string {
    return formatEditUploadLimit(MAX_RESPONSES_EDIT_INPUT_BYTES);
}

export function formatEditSourceValidationFailure(failure: EditSourceValidationFailure, t: Translate): string {
    switch (failure.code) {
        case 'too-many-images':
            return t('alert.maxImages', { count: failure.maxImages });
        case 'source-empty':
            return t('alert.editReferenceEmpty');
        case 'source-invalid-type':
            return t('alert.editReferenceInvalidType');
        case 'source-too-large':
            return t('alert.editReferenceTooLarge', { limit: formatEditUploadLimit(failure.maxBytes) });
        case 'source-total-too-large':
            return t('alert.editReferenceTotalTooLarge', { limit: formatEditUploadLimit(failure.maxBytes) });
        case 'mask-empty':
            return t('alert.maskEmpty');
        case 'mask-invalid-type':
            return t('alert.maskInvalidType');
        case 'mask-too-large':
            return t('alert.maskTooLarge', { limit: formatEditUploadLimit(failure.maxBytes) });
        case 'responses-input-too-large':
            return t('alert.responsesEditInputTooLarge', { limit: formatEditUploadLimit(failure.maxBytes) });
    }
}

function isSupportedEditSourceImageType(type: string): boolean {
    return SUPPORTED_EDIT_SOURCE_IMAGE_TYPES.includes(type as (typeof SUPPORTED_EDIT_SOURCE_IMAGE_TYPES)[number]);
}

function sumFileBytes(files: readonly EditUploadFile[]): number {
    return files.reduce((total, file) => total + file.size, 0);
}
