import { MAX_PROMPT_LENGTH } from './image-request-limits';
import { resolveMobilePrimaryDisabledReason } from './mobile-primary-action-state';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const messages: Record<string, string> = {
    'sizeError.multiple': '宽边和高边都必须是 {multiple} 的倍数。',
    'sizeError.positive': '宽度和高度必须为正数。',
    'upstream.responsesModelRequired': 'Responses image_generation 需要填写 GPT 顶层模型。',
    'ux.disabledBatchPrompts': '请至少填写一条批量提示词。',
    'ux.disabledBatchPromptLength': '第 {index} 条批量提示词不能超过 {limit} 个字符。',
    'ux.disabledPrompt': '请输入提示词后再提交。',
    'ux.disabledPromptLength': '提示词不能超过 {limit} 个字符。',
    'ux.disabledSourceImage': '请先放入参考图。',
    'ux.disabledUnsavedMask': '请先保存已绘制的蒙版。'
};

function t(key: string, values?: Record<string, string | number>): string {
    return (messages[key] || key).replace(/\{(\w+)\}/g, (match, valueKey) => String(values?.[valueKey] ?? match));
}

const validSize = { valid: true as const };
const invalidSize = {
    valid: false as const,
    reason: '宽度和高度必须为正数。',
    reasonKey: 'sizeError.positive'
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
        batchPromptOverLimitIndex: null,
        hasEditSourceImage: false,
        editSourceValidationMessage: '',
        backendCompatibilityMessage: '',
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
            prompt: '   '
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

    it('blocks an oversized single prompt with the same limit as the form', () => {
        const reason = resolveReason({
            prompt: 'a'.repeat(MAX_PROMPT_LENGTH + 1)
        });

        assert.equal(reason, `提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符。`);
    });

    it('identifies the oversized line in a mobile batch request', () => {
        const reason = resolveReason({
            isBatchMode: true,
            batchPromptCount: 2,
            batchPromptOverLimitIndex: 1
        });

        assert.equal(reason, `第 2 条批量提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符。`);
    });

    it('does not apply the aggregate prompt limit to valid mobile batch lines', () => {
        const reason = resolveReason({
            isBatchMode: true,
            prompt: `${'a'.repeat(20_000)}\n${'b'.repeat(20_000)}`,
            batchPromptCount: 2
        });

        assert.equal(reason, '');
    });

    it('explains missing reference images before edit prompt issues', () => {
        const reason = resolveReason({
            mode: 'edit',
            prompt: '',
            hasEditSourceImage: false
        });

        assert.equal(reason, '请先放入参考图。');
    });

    it('uses the same edit upload validation message as the desktop submit control', () => {
        const reason = resolveReason({
            mode: 'edit',
            prompt: '用户真实编辑要求',
            hasEditSourceImage: true,
            editSourceValidationMessage: '单张参考图不能超过 25 MB。'
        });

        assert.equal(reason, '单张参考图不能超过 25 MB。');
    });

    it('blocks a backend with incompatible provider constraints before submission', () => {
        const reason = resolveReason({
            backendCompatibilityMessage: '图片数量范围没有可用交集（min=2, max=1）。'
        });

        assert.equal(reason, '图片数量范围没有可用交集（min=2, max=1）。');
    });

    it('surfaces custom size validation after required content is present', () => {
        const reason = resolveReason({ generateSizeValidation: invalidSize });

        assert.equal(reason, '宽度和高度必须为正数。');
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
