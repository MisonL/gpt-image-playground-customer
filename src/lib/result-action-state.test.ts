import { resolveResultActionState } from './result-action-state';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('resolveResultActionState', () => {
    it('allows a completed text-to-image result to be generated again', () => {
        assert.deepEqual(
            resolveResultActionState({
                isBusy: false,
                hasResultImages: true,
                currentMode: 'generate',
                currentPrompt: '当前提示词',
                activeResultSource: { mode: 'generate', prompt: '历史提示词' }
            }),
            { canCreateVariant: true, canReusePrompt: true }
        );
    });

    it('does not turn an image-edit result into a text-to-image variant', () => {
        assert.deepEqual(
            resolveResultActionState({
                isBusy: false,
                hasResultImages: true,
                currentMode: 'edit',
                currentPrompt: '当前编辑提示词',
                activeResultSource: { mode: 'edit', prompt: '历史编辑提示词' }
            }),
            { canCreateVariant: false, canReusePrompt: true }
        );
    });

    it('does not substitute an unrelated current prompt when the selected history result has no prompt', () => {
        assert.deepEqual(
            resolveResultActionState({
                isBusy: false,
                hasResultImages: true,
                currentMode: 'generate',
                currentPrompt: '不应被借用的当前提示词',
                activeResultSource: { mode: 'generate', prompt: '   ' }
            }),
            { canCreateVariant: false, canReusePrompt: false }
        );
    });

    it('only enables a source-less result when the current form is text-to-image and ready', () => {
        assert.equal(
            resolveResultActionState({
                isBusy: false,
                hasResultImages: true,
                currentMode: 'edit',
                currentPrompt: '编辑提示词',
                activeResultSource: null
            }).canCreateVariant,
            false
        );
        assert.equal(
            resolveResultActionState({
                isBusy: false,
                hasResultImages: true,
                currentMode: 'generate',
                currentPrompt: '生成提示词',
                activeResultSource: null
            }).canCreateVariant,
            true
        );
    });

    it('disables both result actions while a request or edit-source transfer is in progress', () => {
        assert.deepEqual(
            resolveResultActionState({
                isBusy: true,
                hasResultImages: true,
                currentMode: 'generate',
                currentPrompt: '当前提示词',
                activeResultSource: null
            }),
            { canCreateVariant: false, canReusePrompt: false }
        );
    });
});
