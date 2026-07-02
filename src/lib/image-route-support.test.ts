import { describeInvalidImagesResponse, readClientRequestId } from './image-route-support';
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
