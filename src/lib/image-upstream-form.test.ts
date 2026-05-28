import {
    IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
    appendImageUpstreamOverrideFields
} from './image-upstream-form';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function readFormEntries(formData: FormData): Record<string, string> {
    return Object.fromEntries(
        Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
    );
}

describe('appendImageUpstreamOverrideFields', () => {
    it('preserves server upstream defaults when the page form uses server-default controls', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            streamingStrategy: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            responsesModel: 'gpt-5.4',
            thinking: 'high',
            promptOptimization: 'off',
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {});
    });

    it('appends explicit page upstream overrides and trims the Responses model', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: 'responses-image-generation',
            streamingStrategy: 'responses-sse',
            responsesModel: '  gpt-5.4  ',
            thinking: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            promptOptimization: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {
            image_backend: 'responses-image-generation',
            image_streaming_strategy: 'responses-sse',
            responsesModel: 'gpt-5.4'
        });
    });

    it('appends explicit Responses compatibility fields only for the Responses backend', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: 'responses-image-generation',
            streamingStrategy: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            responsesModel: '',
            thinking: 'high',
            promptOptimization: 'off',
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {
            image_backend: 'responses-image-generation',
            thinking: 'high',
            promptOptimization: 'false'
        });
    });

    it('appends force_web only for the Images API backend', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: 'images-api',
            streamingStrategy: IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
            responsesModel: 'gpt-5.4',
            thinking: 'xhigh',
            promptOptimization: 'on',
            forceWeb: true
        });

        assert.deepEqual(readFormEntries(formData), {
            image_backend: 'images-api',
            force_web: 'true'
        });
    });
});
