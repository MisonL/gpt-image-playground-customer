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
            responsesModel: 'gpt-5.4'
        });

        assert.deepEqual(readFormEntries(formData), {});
    });

    it('appends explicit page upstream overrides and trims the Responses model', () => {
        const formData = new FormData();

        appendImageUpstreamOverrideFields(formData, {
            imageBackend: 'responses-image-generation',
            streamingStrategy: 'responses-sse',
            responsesModel: '  gpt-5.4  '
        });

        assert.deepEqual(readFormEntries(formData), {
            image_backend: 'responses-image-generation',
            image_streaming_strategy: 'responses-sse',
            responsesModel: 'gpt-5.4'
        });
    });
});
