import { MAX_UPLOAD_BYTES, RequestValidationError } from './image-request-utils';
import {
    createResponsesImageEditStream,
    createResponsesImageStream,
    editImageWithResponsesBackend,
    generateImageWithResponsesBackend,
    type ResponsesImageGenerateInput
} from './responses-image-backend';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type OpenAI from 'openai';

type ResponsesClient = ResponsesImageGenerateInput['responses'];
type ResponsesPayload = {
    output?: unknown[];
    usage?: unknown;
};

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function createSizedImageFile(size: number, name: string): File {
    return { size, name, type: 'image/png' } as File;
}

function createResponsesClient(
    handler: (
        params: OpenAI.Responses.ResponseCreateParamsNonStreaming | OpenAI.Responses.ResponseCreateParamsStreaming,
        options?: OpenAI.RequestOptions
    ) => Promise<ResponsesPayload | AsyncIterable<unknown>>
): ResponsesClient {
    const create = (async (
        params: OpenAI.Responses.ResponseCreateParamsNonStreaming | OpenAI.Responses.ResponseCreateParamsStreaming,
        options?: OpenAI.RequestOptions
    ): Promise<ResponsesPayload | AsyncIterable<unknown>> => {
        return handler(params, options);
    }) as ResponsesClient['create'];
    return { create };
}

describe('generateImageWithResponsesBackend', () => {
    it('calls the Responses API image_generation tool and reads image_generation_call.result', async () => {
        let capturedParams: unknown;
        let capturedOptions: OpenAI.RequestOptions | undefined;
        const result = await generateImageWithResponsesBackend({
            responses: createResponsesClient(async (params, options) => {
                capturedParams = params;
                capturedOptions = options;
                return {
                    output: [
                        {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    ],
                    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
                };
            }),
            prompt: 'draw a test image',
            responsesModel: 'gpt-4.1',
            imageModel: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto'
        });

        assert.deepEqual(result.data, [{ b64_json: PNG_BASE64 }]);
        assert.deepEqual(result.usage, { input_tokens: 1, output_tokens: 2, total_tokens: 3 });
        assert.equal(capturedOptions?.timeout, 900_000);
        assert.equal(capturedOptions?.maxRetries, 0);
        assert.deepEqual(capturedParams, {
            model: 'gpt-4.1',
            input: 'draw a test image',
            stream: false,
            tool_choice: { type: 'image_generation' },
            tools: [
                {
                    type: 'image_generation',
                    action: 'generate',
                    model: 'gpt-image-2',
                    size: '1024x1024',
                    quality: 'high',
                    output_format: 'png',
                    background: 'auto',
                    moderation: 'auto'
                }
            ]
        });
    });

    it('passes GPT2Image-compatible extended Responses fields through to the image_generation tool', async () => {
        let capturedParams: unknown;
        await generateImageWithResponsesBackend({
            responses: createResponsesClient(async (params) => {
                capturedParams = params;
                return {
                    output: [
                        {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    ]
                };
            }),
            prompt: 'draw a custom ratio poster',
            responsesModel: 'gpt-5.4',
            imageModel: 'gpt-image-2',
            size: '1536x864',
            quality: 'medium',
            outputFormat: 'webp',
            background: 'auto',
            moderation: 'low',
            outputCompression: 85,
            promptOptimization: false,
            thinking: 'high'
        });

        assert.deepEqual(capturedParams, {
            model: 'gpt-5.4',
            input: 'draw a custom ratio poster',
            stream: false,
            tool_choice: { type: 'image_generation' },
            tools: [
                {
                    type: 'image_generation',
                    action: 'generate',
                    model: 'gpt-image-2',
                    size: '1536x864',
                    quality: 'medium',
                    output_format: 'webp',
                    background: 'auto',
                    moderation: 'low',
                    output_compression: 85,
                    prompt_optimization: false,
                    thinking: 'high'
                }
            ]
        });
    });

    it('fails explicitly when the Responses API returns no completed image result', async () => {
        await assert.rejects(
            () =>
                generateImageWithResponsesBackend({
                    responses: createResponsesClient(async () => ({
                        output: [
                            {
                                type: 'image_generation_call',
                                status: 'completed',
                                result: null
                            }
                        ]
                    })),
                    prompt: 'draw a test image',
                    responsesModel: 'gpt-4.1',
                    imageModel: 'gpt-image-2',
                    size: '1024x1024',
                    quality: 'high',
                    outputFormat: 'png',
                    background: 'auto',
                    moderation: 'auto'
                }),
            /Responses API.*image_generation_call.result/
        );
    });

    it('fails explicitly when the Responses API returns a failed image_generation_call', async () => {
        await assert.rejects(
            () =>
                generateImageWithResponsesBackend({
                    responses: createResponsesClient(async () => ({
                        output: [
                            {
                                type: 'image_generation_call',
                                status: 'failed',
                                error: {
                                    code: 'content_policy_violation',
                                    message: 'blocked by upstream policy'
                                }
                            }
                        ]
                    })),
                    prompt: 'draw a test image',
                    responsesModel: 'gpt-4.1',
                    imageModel: 'gpt-image-2',
                    size: '1024x1024',
                    quality: 'high',
                    outputFormat: 'png',
                    background: 'auto',
                    moderation: 'auto'
                }),
            /blocked by upstream policy/
        );
    });

    it('keeps GPT2Image URL results for the shared persistence layer to materialize', async () => {
        const resultFromResultField = await generateImageWithResponsesBackend({
            responses: createResponsesClient(async () => ({
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: 'https://example.test/image.png'
                    }
                ]
            })),
            prompt: 'draw a test image',
            responsesModel: 'gpt-4.1',
            imageModel: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto'
        });
        assert.deepEqual(resultFromResultField.data, [{ url: 'https://example.test/image.png' }]);

        const resultFromUrlField = await generateImageWithResponsesBackend({
            responses: createResponsesClient(async () => ({
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        url: '/api/storage/generations/image.png'
                    }
                ]
            })),
            prompt: 'draw a test image',
            responsesModel: 'gpt-4.1',
            imageModel: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto'
        });
        assert.deepEqual(resultFromUrlField.data, [{ url: '/api/storage/generations/image.png' }]);
    });

    it('extracts base64 payloads from Responses API data URL results', async () => {
        const result = await generateImageWithResponsesBackend({
            responses: createResponsesClient(async () => ({
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: `data:image/png;base64,${PNG_BASE64}`
                    }
                ]
            })),
            prompt: 'draw a test image',
            responsesModel: 'gpt-4.1',
            imageModel: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto'
        });

        assert.deepEqual(result.data, [{ b64_json: PNG_BASE64 }]);
    });

    it('rejects non-image data URLs and non-base64 Responses image results', async () => {
        const makeInput = (result: string) =>
            generateImageWithResponsesBackend({
                responses: createResponsesClient(async () => ({
                    output: [
                        {
                            type: 'image_generation_call',
                            status: 'completed',
                            result
                        }
                    ]
                })),
                prompt: 'draw a test image',
                responsesModel: 'gpt-4.1',
                imageModel: 'gpt-image-2',
                size: '1024x1024',
                quality: 'high',
                outputFormat: 'png',
                background: 'auto',
                moderation: 'auto'
            });

        await assert.rejects(
            () => makeInput('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='),
            /image_generation_call.result/
        );
        await assert.rejects(() => makeInput('<script>alert(1)</script>'), /image_generation_call.result/);
    });

    it('accepts completed Responses image results even when status is omitted', async () => {
        const result = await generateImageWithResponsesBackend({
            responses: createResponsesClient(async () => ({
                output: [
                    {
                        type: 'image_generation_call',
                        result: PNG_BASE64
                    }
                ]
            })),
            prompt: 'draw a test image',
            responsesModel: 'gpt-4.1',
            imageModel: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto'
        });

        assert.deepEqual(result.data, [{ b64_json: PNG_BASE64 }]);
    });

    it('calls the Responses API image_generation tool in streaming mode with partial images enabled', async () => {
        let capturedParams: unknown;
        let capturedOptions: OpenAI.RequestOptions | undefined;
        const streamEvents = async function* () {
            yield {
                type: 'response.output_item.done',
                item: { type: 'image_generation_call', result: 'stream-final-base64' }
            };
        };

        const stream = await createResponsesImageStream({
            responses: createResponsesClient(async (params, options) => {
                capturedParams = params;
                capturedOptions = options;
                return streamEvents();
            }),
            prompt: 'draw a streaming test image',
            responsesModel: 'gpt-4.1',
            imageModel: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto',
            partialImagesCount: 2
        });

        assert.equal(typeof stream[Symbol.asyncIterator], 'function');
        assert.equal(capturedOptions?.timeout, 900_000);
        assert.equal(capturedOptions?.maxRetries, 0);
        assert.deepEqual(capturedParams, {
            model: 'gpt-4.1',
            input: 'draw a streaming test image',
            stream: true,
            tool_choice: { type: 'image_generation' },
            tools: [
                {
                    type: 'image_generation',
                    action: 'generate',
                    model: 'gpt-image-2',
                    size: '1024x1024',
                    quality: 'high',
                    output_format: 'png',
                    background: 'auto',
                    moderation: 'auto',
                    partial_images: 2
                }
            ]
        });
    });

    it('calls the Responses API image_generation tool with edit reference images and mask', async () => {
        let capturedParams: unknown;
        const result = await editImageWithResponsesBackend({
            responses: createResponsesClient(async (params) => {
                capturedParams = params;
                return {
                    output: [
                        {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    ]
                };
            }),
            prompt: 'edit the source image',
            responsesModel: 'gpt-5.4',
            imageModel: 'gpt-image-2',
            imageFiles: [
                new File([Buffer.from(PNG_BASE64, 'base64')], 'source.png', {
                    type: 'image/png'
                })
            ],
            maskFile: new File([Buffer.from(PNG_BASE64, 'base64')], 'mask.png', {
                type: 'image/png'
            }),
            size: '1536x864',
            quality: 'medium',
            outputFormat: 'webp',
            background: 'auto',
            moderation: 'low',
            outputCompression: 85,
            promptOptimization: false,
            thinking: 'high'
        });

        assert.deepEqual(result.data, [{ b64_json: PNG_BASE64 }]);
        const params = capturedParams as Record<string, unknown>;
        assert.equal(params.model, 'gpt-5.4');
        assert.equal(params.stream, false);
        const input = params.input as Array<Record<string, unknown>>;
        const content = input[0].content as Array<Record<string, unknown>>;
        assert.deepEqual(content[0], { type: 'input_text', text: 'edit the source image' });
        assert.equal(content[1].type, 'input_image');
        assert.match(String(content[1].image_url), /^data:image\/png;base64,/);
        const tools = params.tools as Array<Record<string, unknown>>;
        assert.equal(tools[0].type, 'image_generation');
        assert.equal(tools[0].action, 'edit');
        assert.equal(tools[0].size, '1536x864');
        assert.equal(tools[0].output_format, 'webp');
        assert.equal(tools[0].output_compression, 85);
        assert.equal(tools[0].prompt_optimization, false);
        assert.equal(tools[0].thinking, 'high');
        const mask = tools[0].input_image_mask as Record<string, unknown>;
        assert.match(String(mask.image_url), /^data:image\/png;base64,/);
    });

    it('rejects oversized Responses edit inputs before contacting upstream', async () => {
        let upstreamCalled = false;

        await assert.rejects(
            editImageWithResponsesBackend({
                responses: createResponsesClient(async () => {
                    upstreamCalled = true;
                    return { output: [] };
                }),
                prompt: 'edit oversized sources',
                responsesModel: 'gpt-5.4',
                imageModel: 'gpt-image-2',
                imageFiles: [
                    createSizedImageFile(MAX_UPLOAD_BYTES, 'source-a.png'),
                    createSizedImageFile(MAX_UPLOAD_BYTES + 1, 'source-b.png')
                ],
                size: '1024x1024',
                quality: 'high',
                outputFormat: 'png',
                background: 'auto',
                moderation: 'auto'
            }),
            (error: unknown) => {
                assert.ok(error instanceof RequestValidationError);
                assert.equal(error.status, 400);
                assert.match(error.message, /Responses API 图生图参考图和 mask 总大小不能超过 50 MB/);
                return true;
            }
        );
        assert.equal(upstreamCalled, false);
    });

    it('calls the Responses API image_generation tool in edit streaming mode with partial images enabled', async () => {
        let capturedParams: unknown;
        const streamEvents = async function* () {
            yield {
                type: 'response.output_item.done',
                item: { type: 'image_generation_call', result: 'stream-final-base64' }
            };
        };

        const stream = await createResponsesImageEditStream({
            responses: createResponsesClient(async (params) => {
                capturedParams = params;
                return streamEvents();
            }),
            prompt: 'stream edit the source image',
            responsesModel: 'gpt-4.1',
            imageModel: 'gpt-image-2',
            imageFiles: [
                new File([Buffer.from(PNG_BASE64, 'base64')], 'source.png', {
                    type: 'image/png'
                })
            ],
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto',
            partialImagesCount: 2
        });

        assert.equal(typeof stream[Symbol.asyncIterator], 'function');
        const params = capturedParams as Record<string, unknown>;
        assert.equal(params.stream, true);
        const tools = params.tools as Array<Record<string, unknown>>;
        assert.equal(tools[0].action, 'edit');
        assert.equal(tools[0].partial_images, 2);
        const input = params.input as Array<Record<string, unknown>>;
        const content = input[0].content as Array<Record<string, unknown>>;
        assert.equal(content[1].type, 'input_image');
    });

    it('rejects oversized Responses edit streams before contacting upstream', async () => {
        let upstreamCalled = false;

        await assert.rejects(
            createResponsesImageEditStream({
                responses: createResponsesClient(async () => {
                    upstreamCalled = true;
                    return { output: [] };
                }),
                prompt: 'stream edit oversized sources',
                responsesModel: 'gpt-5.4',
                imageModel: 'gpt-image-2',
                imageFiles: [
                    createSizedImageFile(MAX_UPLOAD_BYTES, 'source-a.png'),
                    createSizedImageFile(MAX_UPLOAD_BYTES + 1, 'source-b.png')
                ],
                size: '1024x1024',
                quality: 'high',
                outputFormat: 'png',
                background: 'auto',
                moderation: 'auto',
                partialImagesCount: 2
            }),
            (error: unknown) => {
                assert.ok(error instanceof RequestValidationError);
                assert.equal(error.status, 400);
                assert.match(error.message, /Responses API 图生图参考图和 mask 总大小不能超过 50 MB/);
                return true;
            }
        );
        assert.equal(upstreamCalled, false);
    });
});
