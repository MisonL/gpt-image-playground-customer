import { IMAGE_UPSTREAM_PROFILES } from './image-upstream-profile';
import { getPresetDimensions, getPresetTooltip, getSizePresetOptions } from './size-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('size presets', () => {
    it('keeps legacy ratio presets stable for existing form state', () => {
        assert.equal(getPresetDimensions('square', 'gpt-image-1'), '1024x1024');
        assert.equal(getPresetDimensions('landscape', 'gpt-image-1'), '1536x1024');
        assert.equal(getPresetDimensions('portrait', 'gpt-image-1'), '1024x1536');
        assert.equal(getPresetDimensions('square', 'gpt-image-2'), '2048x2048');
        assert.equal(getPresetDimensions('landscape', 'gpt-image-2'), '3072x2048');
        assert.equal(getPresetDimensions('portrait', 'gpt-image-2'), '2048x3072');
    });

    it('adds profile-aware resolution presets for gpt-image-2', () => {
        const openAiOptions = getSizePresetOptions({
            model: 'gpt-image-2',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES['openai-compatible']
        }).map((option) => option.value);
        const matscaOptions = getSizePresetOptions({
            model: 'gpt-image-2',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        }).map((option) => option.value);

        assert.ok(openAiOptions.includes('square-1k'));
        assert.ok(openAiOptions.includes('square-2k'));
        assert.ok(openAiOptions.includes('wide-4k'));
        assert.ok(openAiOptions.includes('tall-4k'));
        assert.equal(openAiOptions.includes('square-4k'), false);
        assert.ok(matscaOptions.includes('square-4k'));
    });

    it('does not expose gpt-image-2-only custom and resolution presets for legacy models', () => {
        const options = getSizePresetOptions({
            model: 'gpt-image-1',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        }).map((option) => option.value);

        assert.deepEqual(options, ['auto', 'square', 'landscape', 'portrait']);
    });

    it('reports common resolution preset tooltip ratios', () => {
        assert.match(getPresetTooltip('wide-4k', 'gpt-image-2') || '', /16:9/);
        assert.match(getPresetTooltip('tall-4k', 'gpt-image-2') || '', /9:16/);
        assert.match(getPresetTooltip('square-2k', 'gpt-image-2') || '', /1:1/);
    });
});
