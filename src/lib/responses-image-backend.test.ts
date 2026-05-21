import {
    createResponsesImageStream,
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

function createResponsesClient(
    handler: (
        params: OpenAI.Responses.ResponseCreateParamsNonStreaming | OpenAI.Responses.ResponseCreateParamsStreaming
    ) => Promise<ResponsesPayload | AsyncIterable<unknown>>
): ResponsesClient {
    async function create(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<ResponsesPayload>;
    async function create(params: OpenAI.Responses.ResponseCreateParamsStreaming): Promise<AsyncIterable<unknown>>;
    async function create(
        params: OpenAI.Responses.ResponseCreateParamsNonStreaming | OpenAI.Responses.ResponseCreateParamsStreaming
    ): Promise<ResponsesPayload | AsyncIterable<unknown>> {
        return handler(params);
    }
    return { create };
}

describe('generateImageWithResponsesBackend', () => {
    it('calls the Responses API image_generation tool and reads image_generation_call.result', async () => {
        let capturedParams: unknown;
        const result = await generateImageWithResponsesBackend({
            responses: createResponsesClient(async (params) => {
                capturedParams = params;
                return {
                    output: [
                        {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: 'responses-final-base64'
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

        assert.deepEqual(result.data, [{ b64_json: 'responses-final-base64' }]);
        assert.deepEqual(result.usage, { input_tokens: 1, output_tokens: 2, total_tokens: 3 });
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

    it('fails explicitly when the Responses API returns no completed image result', async () => {
        await assert.rejects(
            () =>
                generateImageWithResponsesBackend({
                    responses: createResponsesClient(async () => ({
                        output: [
                            {
                                type: 'image_generation_call',
                                status: 'failed',
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

    it('calls the Responses API image_generation tool in streaming mode with partial images enabled', async () => {
        let capturedParams: unknown;
        async function* streamEvents() {
            yield {
                type: 'response.output_item.done',
                item: { type: 'image_generation_call', result: 'stream-final-base64' }
            };
        }

        const stream = await createResponsesImageStream({
            responses: createResponsesClient(async (params) => {
                capturedParams = params;
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
});
