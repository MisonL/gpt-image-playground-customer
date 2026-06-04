import { resolveMobilePrimaryDisabledReason } from './mobile-primary-action-state';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const messages: Record<string, string> = {
    'sizeError.multiple': '宽边和高边都必须是 {multiple} 的倍数。',
    'upstream.responsesModelRequired': 'Responses image_generation 需要填写 GPT 顶层模型。',
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

type MobileOptions = Parameters<typeof resolveMobilePrimaryDisabledReason>[0];

function resolveReason(overrides: Partial<MobileOptions>): string {
    return resolveMobilePrimaryDisabledReason({
        isLoading: false,
        isSendingToEdit: false,
        mode: 'generate',
        isBatchMode: false,
        prompt: '用户真实提示词',
        batchPromptCount: 0,
        hasEditSourceImage: false,
        hasUnsavedMask: false,
        imageBackend: 'server-default',
        responsesModel: '',
        hasDefaultResponsesModel: true,
        generateSizeValidation: validSize,
        editSizeValidation: validSize,
        t,
        ...overrides
    });
}

describe('resolveMobilePrimaryDisabledReason', () => {
    it('explains an empty prompt before mobile generate submit', () => {
        const reason = resolveReason({
            prompt: '   ',
        });

        assert.equal(reason, '请输入提示词后再提交。');
    });

    it('uses the batch prompt reason in mobile batch mode', () => {
        const reason = resolveReason({
            isBatchMode: true,
            prompt: '   ',
            batchPromptCount: 0
        });

        assert.equal(reason, '请至少填写一条批量提示词。');
    });

    it('explains missing reference images before edit prompt issues', () => {
        const reason = resolveReason({
            mode: 'edit',
            prompt: '',
            hasEditSourceImage: false
        });

        assert.equal(reason, '请先放入参考图。');
    });

    it('surfaces custom size validation after required content is present', () => {
        const reason = resolveReason({ generateSizeValidation: invalidSize });

        assert.equal(reason, '宽边和高边都必须是 16 的倍数。');
    });

    it('blocks mobile generate when Responses backend lacks a top-level model', () => {
        const reason = resolveReason({
            imageBackend: 'responses-image-generation',
            hasDefaultResponsesModel: false,
            responsesModel: ''
        });

        assert.equal(reason, 'Responses image_generation 需要填写 GPT 顶层模型。');
    });

    it('allows mobile generate when Responses backend has a request top-level model', () => {
        const reason = resolveReason({
            imageBackend: 'responses-image-generation',
            hasDefaultResponsesModel: false,
            responsesModel: 'gpt-4.1'
        });

        assert.equal(reason, '');
    });

    it('blocks mobile edit when Responses backend lacks a top-level model after required content is present', () => {
        const reason = resolveReason({
            mode: 'edit',
            prompt: '用户真实编辑要求',
            hasEditSourceImage: true,
            imageBackend: 'responses-image-generation',
            hasDefaultResponsesModel: false,
            responsesModel: ''
        });

        assert.equal(reason, 'Responses image_generation 需要填写 GPT 顶层模型。');
    });

    it('does not show a disabled reason while a request is already running', () => {
        const reason = resolveReason({
            isLoading: true,
            prompt: ''
        });

        assert.equal(reason, '');
    });
});
