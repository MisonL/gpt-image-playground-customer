import {
    formatEditSourceValidationFailure,
    hasReachedEditSourceImageLimit,
    isResponsesEditInputLimitActive,
    validateEditSourceInput
} from './edit-source-limits';
import { MAX_OPENAI_UPLOAD_BYTES, MAX_RESPONSES_EDIT_INPUT_BYTES } from './image-request-limits';
import { IMAGE_UPSTREAM_PROFILES } from './image-upstream-profile';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function makeFile(input: { name?: string; size: number; type: string }): File {
    return {
        name: input.name ?? 'source.png',
        size: input.size,
        type: input.type
    } as File;
}

function validate(input: Partial<Parameters<typeof validateEditSourceInput>[0]>) {
    return validateEditSourceInput({
        imageFiles: [makeFile({ size: 1, type: 'image/png' })],
        upstreamProfile: IMAGE_UPSTREAM_PROFILES['openai-compatible'],
        imageBackend: 'images-api',
        ...input
    });
}

describe('hasReachedEditSourceImageLimit', () => {
    it('uses the active upstream profile upload limit for edit-source entry points', () => {
        assert.equal(
            hasReachedEditSourceImageLimit({
                currentCount: 8,
                maxImages: IMAGE_UPSTREAM_PROFILES.matsca.upload.maxImages
            }),
            true
        );
        assert.equal(
            hasReachedEditSourceImageLimit({
                currentCount: 8,
                maxImages: IMAGE_UPSTREAM_PROFILES['openai-compatible'].upload.maxImages
            }),
            false
        );
    });
});

describe('validateEditSourceInput', () => {
    it('rejects empty, unsupported, and oversized reference images before they are sent', () => {
        assert.equal(validate({ imageFiles: [makeFile({ size: 0, type: 'image/png' })] })?.code, 'source-empty');
        assert.equal(validate({ imageFiles: [makeFile({ size: 1, type: 'image/gif' })] })?.code, 'source-invalid-type');
        assert.equal(
            validate({ imageFiles: [makeFile({ size: MAX_OPENAI_UPLOAD_BYTES + 1, type: 'image/png' })] })?.code,
            'source-too-large'
        );
    });

    it('enforces profile-level reference totals independently of individual file limits', () => {
        const profile = {
            upload: {
                ...IMAGE_UPSTREAM_PROFILES.matsca.upload,
                maxImages: 9
            }
        };
        const imageFiles = Array.from({ length: 9 }, () => makeFile({ size: 9 * 1024 * 1024, type: 'image/png' }));

        const failure = validate({ imageFiles, upstreamProfile: profile });

        assert.deepEqual(failure, {
            code: 'source-total-too-large',
            maxBytes: IMAGE_UPSTREAM_PROFILES.matsca.upload.maxTotalBytes
        });
    });

    it('validates mask type and size with the same active profile limit', () => {
        assert.equal(validate({ maskFile: makeFile({ size: 1, type: 'image/jpeg' }) })?.code, 'mask-invalid-type');
        assert.equal(validate({ maskFile: makeFile({ size: 0, type: 'image/png' }) })?.code, 'mask-empty');
        assert.equal(
            validate({ maskFile: makeFile({ size: MAX_OPENAI_UPLOAD_BYTES + 1, type: 'image/png' }) })?.code,
            'mask-too-large'
        );
    });

    it('applies the Responses combined input limit to explicit and default Responses routes', () => {
        const imageFiles = [
            makeFile({ name: 'source-a.png', size: MAX_OPENAI_UPLOAD_BYTES, type: 'image/png' }),
            makeFile({ name: 'source-b.png', size: MAX_OPENAI_UPLOAD_BYTES, type: 'image/png' })
        ];
        const maskFile = makeFile({ name: 'mask.png', size: 1, type: 'image/png' });

        const explicitFailure = validate({
            imageFiles,
            maskFile,
            imageBackend: 'responses-image-generation'
        });
        const defaultFailure = validate({
            imageFiles,
            maskFile,
            imageBackend: 'server-default',
            defaultImageBackend: 'responses-image-generation'
        });

        assert.deepEqual(explicitFailure, {
            code: 'responses-input-too-large',
            maxBytes: MAX_RESPONSES_EDIT_INPUT_BYTES
        });
        assert.deepEqual(defaultFailure, explicitFailure);
        assert.equal(
            validate({ imageFiles, maskFile, imageBackend: 'images-api' }),
            undefined,
            'Images API does not inherit the Responses-only combined limit'
        );
        assert.equal(
            isResponsesEditInputLimitActive({
                imageBackend: 'server-default',
                defaultImageBackend: 'responses-image-generation'
            }),
            true
        );
    });

    it('returns localized validation text without embedding UI strings in the validator', () => {
        const failure = validate({ imageFiles: [makeFile({ size: 0, type: 'image/png' })] });
        assert.ok(failure);

        const message = formatEditSourceValidationFailure(failure, (key) => key);

        assert.equal(message, 'alert.editReferenceEmpty');
    });
});
