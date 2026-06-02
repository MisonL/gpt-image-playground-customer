import { resolveMobilePrimaryDisabledReason } from './mobile-primary-action-state';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const messages: Record<string, string> = {
    'sizeError.multiple': '宽边和高边都必须是 {multiple} 的倍数。',
    'ux.disabledBatchPrompts': '请至少填写一条批量提示词。',
    'ux.disabledPrompt': '请输入提示词后再提交。',
    'ux.disabledSourceImage': '请先放入参考图。',
    'ux.disabledUnsavedMask': '请先保存已绘制的蒙版。'
};

function t(key: string, values?: Record<string, string | number>): string {
    return (messages[key] || key).replace(/\{(\w+)\}/g, (match, valueKey) => String(values?.[valueKey] ?? match));
}

const validSize = { valid: true as const };
const invalidSize = {
    valid: false as const,
    reason: '宽边和高边都必须是 16 的倍数。',
    reasonKey: 'sizeError.multiple',
    values: { multiple: 16 }
};

describe('resolveMobilePrimaryDisabledReason', () => {
    it('explains an empty prompt before mobile generate submit', () => {
        const reason = resolveMobilePrimaryDisabledReason({
            isLoading: false,
            isSendingToEdit: false,
            mode: 'generate',
            isBatchMode: false,
            prompt: '   ',
            batchPromptCount: 0,
            hasEditSourceImage: false,
            hasUnsavedMask: false,
            generateSizeValidation: validSize,
            editSizeValidation: validSize,
            t
        });

        assert.equal(reason, '请输入提示词后再提交。');
    });

    it('uses the batch prompt reason in mobile batch mode', () => {
        const reason = resolveMobilePrimaryDisabledReason({
            isLoading: false,
            isSendingToEdit: false,
            mode: 'generate',
            isBatchMode: true,
            prompt: '   ',
            batchPromptCount: 0,
            hasEditSourceImage: false,
            hasUnsavedMask: false,
            generateSizeValidation: validSize,
            editSizeValidation: validSize,
            t
        });

        assert.equal(reason, '请至少填写一条批量提示词。');
    });

    it('explains missing reference images before edit prompt issues', () => {
        const reason = resolveMobilePrimaryDisabledReason({
            isLoading: false,
            isSendingToEdit: false,
            mode: 'edit',
            isBatchMode: false,
            prompt: '',
            batchPromptCount: 0,
            hasEditSourceImage: false,
            hasUnsavedMask: false,
            generateSizeValidation: validSize,
            editSizeValidation: validSize,
            t
        });

        assert.equal(reason, '请先放入参考图。');
    });

    it('surfaces custom size validation after required content is present', () => {
        const reason = resolveMobilePrimaryDisabledReason({
            isLoading: false,
            isSendingToEdit: false,
            mode: 'generate',
            isBatchMode: false,
            prompt: '窗边花束',
            batchPromptCount: 0,
            hasEditSourceImage: false,
            hasUnsavedMask: false,
            generateSizeValidation: invalidSize,
            editSizeValidation: validSize,
            t
        });

        assert.equal(reason, '宽边和高边都必须是 16 的倍数。');
    });

    it('does not show a disabled reason while a request is already running', () => {
        const reason = resolveMobilePrimaryDisabledReason({
            isLoading: true,
            isSendingToEdit: false,
            mode: 'generate',
            isBatchMode: false,
            prompt: '',
            batchPromptCount: 0,
            hasEditSourceImage: false,
            hasUnsavedMask: false,
            generateSizeValidation: validSize,
            editSizeValidation: validSize,
            t
        });

        assert.equal(reason, '');
    });
});
