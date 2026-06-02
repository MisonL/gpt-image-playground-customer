import {
    buildCompletedHistoryEntry,
    buildFailedHistoryEntry,
    buildHistoryGenerationFormData,
    readHistorySizeSelection,
    resolveHistoryImageClientRequestId,
    type HistoryMetadata
} from './history-metadata';
import type { GenerationFormData } from '@/components/generation-form';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const fallbackGenerationForm: GenerationFormData = {
    prompt: '当前表单提示词',
    n: 1,
    size: 'square',
    customWidth: 2048,
    customHeight: 2048,
    quality: 'medium',
    output_format: 'png',
    background: 'auto',
    moderation: 'auto',
    model: 'gpt-image-2',
    image_backend: 'server-default',
    streaming_strategy: 'server-default',
    responsesModel: '',
    thinking: 'auto',
    promptOptimization: 'auto',
    forceWeb: false
};

function historyWithSize(size: string): HistoryMetadata {
    return {
        timestamp: 1,
        images: [],
        durationMs: 100,
        quality: 'high',
        background: 'auto',
        moderation: 'auto',
        prompt: '提示词',
        mode: 'generate',
        costDetails: null,
        model: 'gpt-image-2',
        size
    };
}

describe('buildCompletedHistoryEntry', () => {
    it('records the submitted form data instead of unrelated current UI state', () => {
        const submittedForm: GenerationFormData = {
            ...fallbackGenerationForm,
            prompt: '历史图变体提示词',
            n: 2,
            size: 'portrait',
            quality: 'high',
            output_format: 'webp',
            output_compression: 82,
            background: 'opaque',
            moderation: 'low',
            model: 'gpt-image-1.5'
        };

        const entry = buildCompletedHistoryEntry({
            images: [{ filename: 'variant.webp', clientRequestId: 'request-1' }],
            usage: {
                input_tokens_details: { text_tokens: 10, image_tokens: 0 },
                output_tokens: 20
            },
            actualCost: undefined,
            durationMs: 1200,
            formData: submittedForm,
            requestMode: 'generate',
            storageMode: 'indexeddb'
        });

        assert.equal(entry.prompt, '历史图变体提示词');
        assert.equal(entry.model, 'gpt-image-1.5');
        assert.equal(entry.size, '1024x1536');
        assert.equal(entry.quality, 'high');
        assert.equal(entry.output_format, 'webp');
        assert.equal(entry.background, 'opaque');
        assert.equal(entry.moderation, 'low');
        assert.deepEqual(entry.clientRequestIds, ['request-1']);
    });

    it('uses an explicit prompt override for prompt batch history display', () => {
        const entry = buildCompletedHistoryEntry({
            images: [{ filename: 'batch-1.png' }],
            usage: null,
            actualCost: undefined,
            durationMs: 900,
            formData: {
                ...fallbackGenerationForm,
                prompt: '第一行',
                batchPrompts: ['第一行', '第二行']
            },
            requestMode: 'generate',
            storageMode: 'fs',
            promptOverride: '第一行\n第二行'
        });

        assert.equal(entry.prompt, '第一行\n第二行');
        assert.equal(entry.costDetails, null);
    });
});

describe('buildFailedHistoryEntry', () => {
    it('records failed prompt batches as the submitted batch text', () => {
        const entry = buildFailedHistoryEntry({
            message: '上游失败',
            durationMs: 300,
            formData: {
                ...fallbackGenerationForm,
                prompt: '第一行',
                batchPrompts: ['第一行', '第二行']
            },
            requestMode: 'generate',
            storageMode: 'fs'
        });

        assert.equal(entry.status, 'failed');
        assert.equal(entry.failureMessage, '上游失败');
        assert.equal(entry.prompt, '第一行\n第二行');
        assert.equal(entry.model, 'gpt-image-2');
        assert.equal(entry.size, '2048x2048');
    });
});

describe('history metadata helpers', () => {
    it('restores compatible history size presets and custom gpt-image-2 dimensions', () => {
        assert.deepEqual(readHistorySizeSelection(historyWithSize('3072x2048'), 'gpt-image-2'), {
            size: 'landscape',
            customWidth: null,
            customHeight: null,
            restored: true
        });
        assert.deepEqual(readHistorySizeSelection(historyWithSize('2304x1536'), 'gpt-image-2'), {
            size: 'custom',
            customWidth: 2304,
            customHeight: 1536,
            restored: true
        });
    });

    it('restores legacy preset dimensions even when the current fallback model differs', () => {
        assert.deepEqual(readHistorySizeSelection(historyWithSize('1536x1024'), 'gpt-image-2'), {
            size: 'landscape',
            customWidth: null,
            customHeight: null,
            restored: true
        });
        assert.deepEqual(readHistorySizeSelection(historyWithSize('1024x1536'), 'gpt-image-2'), {
            size: 'portrait',
            customWidth: null,
            customHeight: null,
            restored: true
        });
    });

    it('builds generation form data from a selected history entry', () => {
        const form = buildHistoryGenerationFormData(
            {
                timestamp: 1,
                images: [{ filename: 'a.png' }, { filename: 'b.png' }],
                durationMs: 100,
                quality: 'high',
                background: 'transparent',
                moderation: 'low',
                prompt: '历史提示词',
                mode: 'generate',
                costDetails: null,
                output_format: 'jpeg',
                model: 'gpt-image-2',
                size: '2048x3072'
            },
            fallbackGenerationForm
        );

        assert.equal(form.prompt, '历史提示词');
        assert.equal(form.n, 2);
        assert.equal(form.size, 'portrait');
        assert.equal(form.quality, 'high');
        assert.equal(form.output_format, 'jpeg');
        assert.equal(form.background, 'transparent');
        assert.equal(form.moderation, 'low');
        assert.equal(form.model, 'gpt-image-2');
        assert.equal(form.batchPrompts, undefined);
    });

    it('restores failed batch history as batch prompts for retry', () => {
        const form = buildHistoryGenerationFormData(
            {
                timestamp: 1,
                images: [],
                status: 'failed',
                failureMessage: '上游失败',
                durationMs: 100,
                quality: 'medium',
                background: 'opaque',
                moderation: 'low',
                prompt: '第一行\n第二行',
                mode: 'generate',
                costDetails: null,
                output_format: 'webp',
                model: 'gpt-image-1.5',
                size: '1024x1536'
            },
            {
                ...fallbackGenerationForm,
                output_format: 'webp',
                output_compression: 88
            }
        );

        assert.equal(form.prompt, '第一行');
        assert.deepEqual(form.batchPrompts, ['第一行', '第二行']);
        assert.equal(form.model, 'gpt-image-1.5');
        assert.equal(form.size, 'portrait');
        assert.equal(form.quality, 'medium');
        assert.equal(form.output_format, 'webp');
        assert.equal(form.output_compression, 88);
        assert.equal(form.background, 'opaque');
        assert.equal(form.moderation, 'low');
    });

    it('resolves image-level request ids before entry-level request ids', () => {
        assert.equal(
            resolveHistoryImageClientRequestId(
                {
                    timestamp: 1,
                    images: [{ filename: 'a.png' }, { filename: 'b.png', clientRequestId: 'image-b' }],
                    durationMs: 100,
                    quality: 'high',
                    background: 'auto',
                    moderation: 'auto',
                    prompt: '提示词',
                    mode: 'generate',
                    costDetails: null,
                    clientRequestIds: ['entry-a', 'entry-b']
                },
                1
            ),
            'image-b'
        );
    });
});
