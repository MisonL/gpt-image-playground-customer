import {
    AcceptedImageTaskResponseError,
    assertOpenAiImagesResponse,
    readAcceptedImageTaskDetails,
    readRetryAfterSecondsHeader,
    resolveAcceptedImageTaskResponse
} from './image-service';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type OpenAI from 'openai';

describe('readAcceptedImageTaskDetails', () => {
    it('extracts task metadata from async upstream image payloads', () => {
        assert.deepEqual(
            readAcceptedImageTaskDetails({
                object: 'image.task',
                status: 'pending',
                task_id: '  sync-gen-task  ',
                poll_url: '  /api/image-tasks?ids=sync-gen-task  '
            }),
            {
                taskId: 'sync-gen-task',
                pollUrl: '/api/image-tasks?ids=sync-gen-task'
            }
        );
    });

    it('ignores regular image responses', () => {
        assert.equal(readAcceptedImageTaskDetails({ data: [{ b64_json: 'abc' }] }), undefined);
    });

    it('requires accepted task object and pending status', () => {
        assert.equal(readAcceptedImageTaskDetails(null), undefined);
        assert.equal(readAcceptedImageTaskDetails([]), undefined);
        assert.equal(readAcceptedImageTaskDetails({ object: 'image.task', status: 'completed' }), undefined);
        assert.equal(readAcceptedImageTaskDetails({ object: 'image.job', status: 'pending' }), undefined);
        assert.deepEqual(readAcceptedImageTaskDetails({ object: 'image.task', status: 'pending' }), {});
        assert.deepEqual(readAcceptedImageTaskDetails({ object: ' image.task ', status: ' pending ' }), {});
    });
});

describe('assertOpenAiImagesResponse', () => {
    it('rejects async task payloads that are not final OpenAI Images results', () => {
        assert.throws(() =>
            assertOpenAiImagesResponse({
                object: 'image.task',
                status: 'pending',
                task_id: 'sync-gen-task'
            })
        );
    });
});

describe('resolveAcceptedImageTaskResponse', () => {
    it('retries accepted task payloads until the final image result arrives', async () => {
        const calls: number[] = [];
        const sleeps: number[] = [];
        const result = await resolveAcceptedImageTaskResponse(
            async () => {
                calls.push(Date.now());
                if (calls.length === 1) {
                    return {
                        data: {
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'sync-gen-task',
                            poll_url: '/api/image-tasks?ids=sync-gen-task'
                        } as unknown as OpenAI.Images.ImagesResponse,
                        response: new Response('', { headers: { 'retry-after': '1' } })
                    };
                }
                return {
                    data: {
                        data: [{ b64_json: 'final-base64' }],
                        created: 123
                    } as OpenAI.Images.ImagesResponse,
                    response: new Response('', { headers: { 'retry-after': '1' } })
                };
            },
            {
                sleep: async (ms) => {
                    sleeps.push(ms);
                }
            }
        );

        assert.equal(calls.length, 2);
        assert.deepEqual(sleeps, [1000]);
        assert.equal(result.data[0]?.b64_json, 'final-base64');
    });

    it('throws a structured error after exhausting accepted-task retries', async () => {
        await assert.rejects(
            () =>
                resolveAcceptedImageTaskResponse(
                    async () => ({
                        data: {
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'sync-gen-task',
                            poll_url: '/api/image-tasks?ids=sync-gen-task'
                        } as unknown as OpenAI.Images.ImagesResponse,
                        response: new Response('', { headers: { 'retry-after': '1' } })
                    }),
                    { maxAttempts: 1 }
                ),
            (error) => {
                assert.ok(error instanceof AcceptedImageTaskResponseError);
                assert.equal(error.taskId, 'sync-gen-task');
                assert.equal(error.pollUrl, '/api/image-tasks?ids=sync-gen-task');
                assert.equal(error.retryAfterSeconds, 1);
                return true;
            }
        );
    });

    it('uses the default retry delay for fractional Retry-After values', async () => {
        const sleeps: number[] = [];
        const result = await resolveAcceptedImageTaskResponse(
            async () => {
                if (sleeps.length === 0) {
                    return {
                        data: {
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'fractional-retry-after-task'
                        } as unknown as OpenAI.Images.ImagesResponse,
                        response: new Response('', { headers: { 'retry-after': '0.5' } })
                    };
                }
                return {
                    data: {
                        data: [{ b64_json: 'final-base64' }],
                        created: 123
                    } as OpenAI.Images.ImagesResponse,
                    response: new Response('')
                };
            },
            {
                retryDelayMs: 2500,
                sleep: async (ms) => {
                    sleeps.push(ms);
                }
            }
        );

        assert.deepEqual(sleeps, [2500]);
        assert.equal(result.data[0]?.b64_json, 'final-base64');
    });

    it('caps fallback retry delays for accepted task responses', async () => {
        const sleeps: number[] = [];
        const result = await resolveAcceptedImageTaskResponse(
            async () => {
                if (sleeps.length === 0) {
                    return {
                        data: {
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'large-fallback-delay-task'
                        } as unknown as OpenAI.Images.ImagesResponse,
                        response: new Response('')
                    };
                }
                return {
                    data: {
                        data: [{ b64_json: 'final-base64' }],
                        created: 123
                    } as OpenAI.Images.ImagesResponse,
                    response: new Response('')
                };
            },
            {
                retryDelayMs: 60_000,
                sleep: async (ms) => {
                    sleeps.push(ms);
                }
            }
        );

        assert.deepEqual(sleeps, [15_000]);
        assert.equal(result.data[0]?.b64_json, 'final-base64');
    });

    it('respects whole-second Retry-After values above the fallback cap', async () => {
        const sleeps: number[] = [];
        const result = await resolveAcceptedImageTaskResponse(
            async () => {
                if (sleeps.length === 0) {
                    return {
                        data: {
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'long-retry-after-task'
                        } as unknown as OpenAI.Images.ImagesResponse,
                        response: new Response('', { headers: { 'retry-after': '30' } })
                    };
                }
                return {
                    data: {
                        data: [{ b64_json: 'final-base64' }],
                        created: 123
                    } as OpenAI.Images.ImagesResponse,
                    response: new Response('')
                };
            },
            {
                sleep: async (ms) => {
                    sleeps.push(ms);
                }
            }
        );

        assert.deepEqual(sleeps, [30_000]);
        assert.equal(result.data[0]?.b64_json, 'final-base64');
    });

    it('caps excessive Retry-After values for accepted task responses', async () => {
        const sleeps: number[] = [];
        const result = await resolveAcceptedImageTaskResponse(
            async () => {
                if (sleeps.length === 0) {
                    return {
                        data: {
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'excessive-retry-after-task'
                        } as unknown as OpenAI.Images.ImagesResponse,
                        response: new Response('', { headers: { 'retry-after': '999' } })
                    };
                }
                return {
                    data: {
                        data: [{ b64_json: 'final-base64' }],
                        created: 123
                    } as OpenAI.Images.ImagesResponse,
                    response: new Response('')
                };
            },
            {
                sleep: async (ms) => {
                    sleeps.push(ms);
                }
            }
        );

        assert.deepEqual(sleeps, [300_000]);
        assert.equal(result.data[0]?.b64_json, 'final-base64');
    });

    it('stops accepted-task backoff when the caller aborts', async () => {
        const controller = new AbortController();
        let sleepSawSignal = false;

        await assert.rejects(
            () =>
                resolveAcceptedImageTaskResponse(
                    async () => ({
                        data: {
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'abortable-task'
                        } as unknown as OpenAI.Images.ImagesResponse,
                        response: new Response('')
                    }),
                    {
                        abortSignal: controller.signal,
                        sleep: async (_ms, abortSignal) => {
                            sleepSawSignal = abortSignal === controller.signal;
                            controller.abort(new Error('caller aborted'));
                            if (abortSignal?.aborted) {
                                throw abortSignal.reason;
                            }
                        }
                    }
                ),
            /caller aborted/
        );

        assert.equal(sleepSawSignal, true);
    });

    it('preserves string abort reasons before retrying accepted tasks', async () => {
        const controller = new AbortController();
        let operationCalled = false;
        controller.abort('caller stopped');

        await assert.rejects(
            () =>
                resolveAcceptedImageTaskResponse(
                    async () => {
                        operationCalled = true;
                        return {
                            data: {
                                object: 'image.task',
                                status: 'pending',
                                task_id: 'abort-string-reason-task'
                            } as unknown as OpenAI.Images.ImagesResponse,
                            response: new Response('')
                        };
                    },
                    { abortSignal: controller.signal }
                ),
            /caller stopped/
        );
        assert.equal(operationCalled, false);
    });
});

describe('readRetryAfterSecondsHeader', () => {
    it('accepts positive whole seconds only', () => {
        assert.equal(readRetryAfterSecondsHeader('1'), 1);
        assert.equal(readRetryAfterSecondsHeader(' 3 '), 3);
        assert.equal(readRetryAfterSecondsHeader('15'), 15);
        assert.equal(readRetryAfterSecondsHeader('0'), undefined);
        assert.equal(readRetryAfterSecondsHeader('0.5'), undefined);
        assert.equal(readRetryAfterSecondsHeader('2.4'), undefined);
        assert.equal(readRetryAfterSecondsHeader('abc'), undefined);
        assert.equal(readRetryAfterSecondsHeader('999999999999999999999'), undefined);
        assert.equal(readRetryAfterSecondsHeader('Wed, 21 Oct 2015 07:28:00 GMT'), undefined);
        assert.equal(readRetryAfterSecondsHeader(3), undefined);
    });
});
