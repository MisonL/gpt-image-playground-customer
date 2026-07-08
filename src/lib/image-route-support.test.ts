import {
    describeInvalidImagesResponse,
    inspectInvalidImagesResponse,
    inspectUpstreamError,
    readClientRequestId
} from './image-route-support';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function formDataWithClientRequestId(value: string): FormData {
    const formData = new FormData();
    formData.append('clientRequestId', value);
    return formData;
}

describe('describeInvalidImagesResponse', () => {
    it('explains accepted async image tasks explicitly', () => {
        const message = describeInvalidImagesResponse({
            object: 'image.task',
            status: 'pending',
            task_id: 'sync-gen-task',
            poll_url: '/api/image-tasks?ids=sync-gen-task&signature=secret'
        });

        assert.match(message, /同一业务幂等键有界重试后仍拿不到最终图片/);
        assert.match(message, /poll_url=present/);
        assert.equal(message.includes('signature=secret'), false);
    });

    it('keeps the generic explanation for ordinary invalid Images responses', () => {
        assert.match(describeInvalidImagesResponse({}), /不是 OpenAI Images 格式/);
    });
});

describe('inspectInvalidImagesResponse', () => {
    it('classifies Responses outputs that never expose a completed image result', () => {
        const diagnostics = inspectInvalidImagesResponse({
            output: [
                {
                    type: 'image_generation_call',
                    status: 'pending'
                }
            ]
        });

        assert.equal(diagnostics.category, 'missing_image_call_result');
    });

    it('classifies text-only Responses outputs as unsupported image_generation results', () => {
        const diagnostics = inspectInvalidImagesResponse({
            output: [
                {
                    type: 'message',
                    status: 'completed',
                    content: [{ type: 'output_text', text: 'I cannot generate images here.' }]
                }
            ]
        });

        assert.equal(diagnostics.category, 'missing_image_call_result');
        assert.match(diagnostics.diagnostic_hint || '', /只兼容文本 Responses/);
    });

    it('redacts sensitive upstream response fields while preserving structure', () => {
        const diagnostics = inspectInvalidImagesResponse({
            data: [
                {
                    url: 'https://provider.example.test/final.png',
                    b64_json: 'secret-base64',
                    prompt: 'secret prompt'
                }
            ],
            api_key: 'sk-secret'
        });

        assert.equal(diagnostics.category, 'url_only_result');
        const serialized = JSON.stringify(diagnostics);
        assert.equal(serialized.includes('https://provider.example.test/final.png'), false);
        assert.equal(serialized.includes('secret-base64'), false);
        assert.equal(serialized.includes('secret prompt'), false);
        assert.equal(serialized.includes('sk-secret'), false);
        assert.equal(serialized.includes('"redacted":true'), true);
    });
});

describe('inspectUpstreamError', () => {
    it('classifies disabled Responses image_generation groups', () => {
        const diagnostics = inspectUpstreamError(
            new Error('403 Image generation is not enabled for this group: image_generation')
        );

        assert.equal(diagnostics?.category, 'responses_disabled');
    });

    it('classifies partial-only stream failures', () => {
        const diagnostics = inspectUpstreamError(new Error('流式图片响应未返回最终图片 b64_json。'));

        assert.equal(diagnostics?.category, 'partial_no_final');
    });
});

describe('readClientRequestId', () => {
    it('rejects all HTTP header control characters', () => {
        for (const value of ['bad\u0000request', 'bad\u007frequest', 'bad\trequest']) {
            assert.throws(() => readClientRequestId(formDataWithClientRequestId(value)), /控制字符/);
        }
    });

    it('treats trimmed full-width whitespace as an empty request id', () => {
        assert.equal(readClientRequestId(formDataWithClientRequestId('\u3000')), undefined);
    });
});
