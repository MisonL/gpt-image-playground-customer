import {
    AcceptedImageTaskStreamResultError,
    collectOpenAiImagesFromStream,
    MissingFinalImageStreamResultError
} from './image-stream-collector';
import { upstreamEvents } from './sse-test-utils';
import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

describe('collectOpenAiImagesFromStream', () => {
    it('deduplicates repeated final image payloads from Responses streams', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 }
                },
                {
                    type: 'response.completed',
                    response: {
                        output: [{ id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 }]
                    }
                }
            ])
        );

        assert.equal(result.data?.length, 1);
        assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
    });

    it('deduplicates repeated Responses final payloads when the upstream omits image call ids', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
                {
                    type: 'response.output_item.done',
                    item: { type: 'image_generation_call', status: 'completed', result: PNG_BASE64 }
                },
                {
                    type: 'response.completed',
                    response: {
                        output: [{ type: 'image_generation_call', status: 'completed', result: PNG_BASE64 }]
                    }
                }
            ])
        );

        assert.equal(result.data?.length, 1);
        assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
    });

    it('keeps distinct same-length Responses final payloads when ids are omitted', async () => {
        const first = 'A'.repeat(1000);
        const second = `${first.slice(0, 100)}B${first.slice(101)}`;
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
                {
                    type: 'response.output_item.done',
                    item: { type: 'image_generation_call', status: 'completed', result: first }
                },
                {
                    type: 'response.output_item.done',
                    item: { type: 'image_generation_call', status: 'completed', result: second }
                }
            ])
        );

        assert.deepEqual(
            result.data?.map((item) => item.b64_json),
            [first, second]
        );
    });

    it('keeps separate Responses final items when their base64 payloads match', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_same_payload_a', type: 'image_generation_call', result: PNG_BASE64 }
                },
                {
                    type: 'response.output_item.done',
                    item: { id: 'ig_same_payload_b', type: 'image_generation_call', result: PNG_BASE64 }
                }
            ])
        );

        assert.equal(result.data?.length, 2);
        assert.deepEqual(
            result.data?.map((item) => item.b64_json),
            [PNG_BASE64, PNG_BASE64]
        );
    });

    it('deduplicates repeated final image payloads within a single Responses event', async () => {
        const result = await collectOpenAiImagesFromStream(
            upstreamEvents([
                {
                    type: 'response.completed',
                    data: [],
                    response: {
                        output: [
                            { id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 },
                            { id: 'ig_repeat', type: 'image_generation_call', result: PNG_BASE64 }
                        ]
                    }
                }
            ])
        );

        assert.equal(result.data?.length, 1);
        assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
    });

    it('downloads same-origin GPT2Image URL final images from Responses streams', async () => {
        let imageDownloadCount = 0;
        let observedAuthorization: string | string[] | undefined;
        let observedAppId: string | string[] | undefined;
        let observedAppSecret: string | string[] | undefined;
        const server = http.createServer((request, response) => {
            if (request.url === '/api/storage/generations/final.png') {
                imageDownloadCount += 1;
                observedAuthorization = request.headers.authorization;
                observedAppId = request.headers['x-app-id'];
                observedAppSecret = request.headers['x-app-secret'];
                response.writeHead(200, { 'Content-Type': 'image/png' });
                response.end(Buffer.from(PNG_BASE64, 'base64'));
                return;
            }
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const apiBaseUrl = `http://127.0.0.1:${address.port}/v1`;
        try {
            const result = await collectOpenAiImagesFromStream(
                upstreamEvents([
                    {
                        type: 'response.output_item.done',
                        item: {
                            id: 'ig_url',
                            type: 'image_generation_call',
                            status: 'completed',
                            result: '/api/storage/generations/final.png'
                        }
                    },
                    {
                        type: 'response.completed',
                        response: {
                            output: [
                                {
                                    id: 'ig_url',
                                    type: 'image_generation_call',
                                    status: 'completed',
                                    result: '/api/storage/generations/final.png'
                                }
                            ]
                        }
                    }
                ]),
                {
                    apiBaseUrl,
                    apiKey: 'test-key',
                    upstreamHeaders: {
                        'X-App-ID': 'app-id',
                        'X-App-Secret': 'app-secret'
                    }
                }
            );

            assert.equal(result.data?.length, 1);
            assert.equal(result.data?.[0]?.b64_json, PNG_BASE64);
            assert.equal(imageDownloadCount, 1);
            assert.equal(observedAuthorization, 'Bearer test-key');
            assert.equal(observedAppId, 'app-id');
            assert.equal(observedAppSecret, 'app-secret');
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it('reports missing-final stream diagnostics without exposing partial image data', async () => {
        await assert.rejects(
            () =>
                collectOpenAiImagesFromStream(
                    upstreamEvents([
                        {
                            type: 'image_generation.partial_image',
                            partial_image_index: 0,
                            b64_json: 'partial-one'
                        },
                        {
                            type: 'image_generation.partial_image',
                            partial_image_index: 1,
                            b64_json: 'partial-two'
                        }
                    ])
                ),
            (error) => {
                assert.ok(error instanceof MissingFinalImageStreamResultError);
                assert.equal(error.upstreamEventType, 'image_generation.partial_image');
                assert.equal(error.partialImageCount, 2);
                assert.equal(JSON.stringify(error).includes('partial-one'), false);
                return true;
            }
        );
    });

    it('reports accepted image tasks explicitly when the upstream only returns task metadata', async () => {
        await assert.rejects(
            () =>
                collectOpenAiImagesFromStream(
                    upstreamEvents([
                        {
                            id: 'sync-gen-task',
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'sync-gen-task',
                            poll_url: '/api/image-tasks?ids=sync-gen-task',
                            message: 'Image task accepted. Poll poll_url with the same Authorization header.'
                        }
                    ])
                ),
            (error) => {
                assert.ok(error instanceof AcceptedImageTaskStreamResultError);
                assert.equal(error.taskId, 'sync-gen-task');
                assert.equal(error.pollUrl, '/api/image-tasks?ids=sync-gen-task');
                return true;
            }
        );
    });

    it('does not return partial image data after an accepted task event', async () => {
        await assert.rejects(
            () =>
                collectOpenAiImagesFromStream(
                    upstreamEvents([
                        {
                            type: 'image_generation.partial_image',
                            partial_image_index: 0,
                            b64_json: 'partial-before-task'
                        },
                        {
                            id: 'partial-before-task-id',
                            object: 'image.task',
                            status: 'pending',
                            task_id: 'partial-before-task-id',
                            poll_url: '/api/image-tasks?ids=partial-before-task-id'
                        }
                    ])
                ),
            (error) => {
                assert.ok(error instanceof AcceptedImageTaskStreamResultError);
                assert.equal(error.taskId, 'partial-before-task-id');
                assert.equal(error.pollUrl, '/api/image-tasks?ids=partial-before-task-id');
                return true;
            }
        );
    });

    it('fails explicitly when upstream stream stays idle past the configured interval', async () => {
        let returnCalled = false;
        const stream: AsyncIterable<unknown> = {
            [Symbol.asyncIterator]() {
                return {
                    next: () => new Promise<IteratorResult<unknown>>(() => {}),
                    return: async () => {
                        returnCalled = true;
                        return { done: true, value: undefined };
                    }
                };
            }
        };

        await assert.rejects(
            () => collectOpenAiImagesFromStream(stream, { streamDataIntervalTimeoutMs: 1 }),
            /图片流式上游超过 1ms 未返回数据/
        );
        assert.equal(returnCalled, true);
    });
});
