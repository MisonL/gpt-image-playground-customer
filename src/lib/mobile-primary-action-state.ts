import type { SizeValidation } from './size-utils';

type Translate = (key: string, values?: Record<string, string | number>) => string;

type MobilePrimaryDisabledReasonOptions = {
    isLoading: boolean;
    isSendingToEdit: boolean;
    mode: 'generate' | 'edit';
    isBatchMode: boolean;
    prompt: string;
    batchPromptCount: number;
    hasEditSourceImage: boolean;
    hasUnsavedMask: boolean;
    generateSizeValidation: SizeValidation;
    editSizeValidation: SizeValidation;
    t: Translate;
};

function readSizeValidationReason(validation: SizeValidation, t: Translate): string {
    if (validation.valid) return '';
    return t(validation.reasonKey, validation.values);
}

export function resolveMobilePrimaryDisabledReason(options: MobilePrimaryDisabledReasonOptions): string {
    if (options.isLoading || options.isSendingToEdit) return '';

    if (options.mode === 'edit') {
        if (!options.hasEditSourceImage) return options.t('ux.disabledSourceImage');
        if (!options.prompt.trim()) return options.t('ux.disabledPrompt');
        if (options.hasUnsavedMask) return options.t('ux.disabledUnsavedMask');
        return readSizeValidationReason(options.editSizeValidation, options.t);
    }

    if (options.isBatchMode && options.batchPromptCount === 0) {
        return options.t('ux.disabledBatchPrompts');
    }
    if (!options.prompt.trim()) return options.t('ux.disabledPrompt');
    return readSizeValidationReason(options.generateSizeValidation, options.t);
}
