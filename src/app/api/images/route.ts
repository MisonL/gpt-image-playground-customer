import crypto from 'crypto';
import fs from 'fs/promises';
import {
    RequestValidationError,
    assertSafeApiOverride,
    createImageResult,
    readBackground,
    readCount,
    readEditQuality,
    readGenerateQuality,
    readImageFiles,
    readMaskFile,
    readMode,
    readModel,
    readModeration,
    readOutputCompression,
    readOutputFormat,
    readRequiredText,
    readSize,
    readStorageMode,
    validateApiBaseUrl,
    type GenerateParams,
    type ValidOutputFormat
} from '@/lib/image-request-utils';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import path from 'path';

// Streaming event types
type StreamingEvent = {
    type: 'partial_image' | 'completed' | 'error' | 'done';
    index?: number;
    partial_image_index?: number;
    b64_json?: string;
    filename?: string;
    path?: string;
    output_format?: string;
    usage?: OpenAI.Images.ImagesResponse['usage'];
    images?: Array<{
        filename: string;
        b64_json: string;
        path?: string;
        output_format: string;
    }>;
    error?: string;
};

const outputDir = path.resolve(process.cwd(), 'generated-images');

function describeInvalidImagesResponse(result: unknown): string {
    if (typeof result === 'string') {
        const normalized = result.trim().toLowerCase();
        if (normalized.includes('<!doctype html') || normalized.includes('<html')) {
            return 'API 返回的是 HTML 页面，不是 OpenAI Images JSON 响应。请确认 API URL 填的是兼容接口根地址，通常需要以 /v1 结尾，例如 https://api.openai.com/v1；不要填写管理后台或网页首页地址。';
        }
    }

    return 'API 返回的数据不是 OpenAI Images 格式。请确认 API URL 是 OpenAI 兼容接口，并且该接口支持 Images generate/edit。';
}

async function ensureOutputDirExists() {
    try {
        await fs.access(outputDir);
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            try {
                await fs.mkdir(outputDir, { recursive: true });
                console.log(`Created output directory: ${outputDir}`);
            } catch (mkdirError) {
                console.error(`Error creating output directory ${outputDir}:`, mkdirError);
                throw new Error('Failed to create image output directory.');
            }
        } else {
            console.error(`Error accessing output directory ${outputDir}:`, error);
            throw new Error(
                `Failed to access or ensure image output directory exists. Original error: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function verifyPasswordHash(clientPasswordHash: string, serverPassword: string): boolean {
    const serverPasswordHash = sha256(serverPassword);
    const clientBuffer = Buffer.from(clientPasswordHash, 'hex');
    const serverBuffer = Buffer.from(serverPasswordHash, 'hex');
    return clientBuffer.length === serverBuffer.length && crypto.timingSafeEqual(clientBuffer, serverBuffer);
}

function createImageFilename(batchId: string, index: number, extension: ValidOutputFormat): string {
    return `${Date.now()}-${batchId}-${index}.${extension}`;
}

export async function POST(request: NextRequest) {
    console.log('Received POST request to /api/images');

    try {
        const formData = await request.formData();
        const requestApiKey = String(formData.get('apiKey') || '').trim();
        const requestApiBaseUrl = String(formData.get('apiBaseUrl') || '').trim();
        assertSafeApiOverride(requestApiKey, requestApiBaseUrl);
        validateApiBaseUrl(requestApiBaseUrl);
        const effectiveApiKey = requestApiKey || process.env.OPENAI_API_KEY;
        const effectiveApiBaseUrl = requestApiBaseUrl || process.env.OPENAI_API_BASE_URL;
        validateApiBaseUrl(effectiveApiBaseUrl || '');

        if (!effectiveApiKey) {
            console.error('OPENAI_API_KEY is not set and no request API key was provided.');
            return NextResponse.json(
                { error: '请在 API 设置中填写 API Key，或配置 OPENAI_API_KEY 环境变量。' },
                { status: 400 }
            );
        }

        const openai = new OpenAI({
            apiKey: effectiveApiKey,
            baseURL: effectiveApiBaseUrl || undefined
        });

        const effectiveStorageMode = readStorageMode(process.env);
        console.log(`Effective Image Storage Mode: ${effectiveStorageMode}`);

        if (effectiveStorageMode === 'fs') {
            await ensureOutputDirExists();
        }

        if (process.env.APP_PASSWORD) {
            const clientPasswordHash = formData.get('passwordHash');
            if (typeof clientPasswordHash !== 'string' || !clientPasswordHash) {
                console.error('Missing password hash.');
                return NextResponse.json({ error: 'Unauthorized: Missing password hash.' }, { status: 401 });
            }
            if (!verifyPasswordHash(clientPasswordHash, process.env.APP_PASSWORD)) {
                console.error('Invalid password hash.');
                return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
            }
        }

        const mode = readMode(formData);
        const prompt = readRequiredText(formData, 'prompt');
        const model = readModel(formData);

        console.log(`Mode: ${mode}, Model: ${model}, Prompt: ${prompt ? prompt.substring(0, 50) + '...' : 'N/A'}`);

        const streamEnabled = formData.get('stream') === 'true';
        const partialImagesCount = readCount(formData, 'partial_images', 2, 1, 3) as 1 | 2 | 3;

        let result: OpenAI.Images.ImagesResponse;
        let responseOutputFormat: ValidOutputFormat = 'png';

        if (mode === 'generate') {
            const n = readCount(formData, 'n', 1, 1, 10);
            const size = readSize(formData, 'size', '1024x1024', model) as OpenAI.Images.ImageGenerateParams['size'];
            const quality = readGenerateQuality(formData) as OpenAI.Images.ImageGenerateParams['quality'];
            const outputFormat = readOutputFormat(formData);
            const outputCompression = readOutputCompression(formData, outputFormat);
            const background = readBackground(formData, model) as OpenAI.Images.ImageGenerateParams['background'];
            const moderation = readModeration(formData) as OpenAI.Images.ImageGenerateParams['moderation'];
            responseOutputFormat = outputFormat;

            const baseParams: GenerateParams = {
                model,
                prompt,
                n,
                size,
                quality,
                output_format: outputFormat,
                background,
                moderation
            };

            if (outputCompression !== undefined) {
                baseParams.output_compression = outputCompression;
            }

            // Handle streaming mode for generation
            if (streamEnabled) {
                const streamParams = {
                    ...baseParams,
                    stream: true as const,
                    partial_images: partialImagesCount
                } satisfies OpenAI.Images.ImageGenerateParamsStreaming;

                const stream = await openai.images.generate(streamParams);

                // Create SSE response
                const encoder = new TextEncoder();
                const batchId = crypto.randomBytes(8).toString('hex');
                const fileExtension = outputFormat;

                const readableStream = new ReadableStream({
                    async start(controller) {
                        try {
                            const completedImages: Array<{
                                filename: string;
                                b64_json: string;
                                path?: string;
                                output_format: string;
                            }> = [];
                            let finalUsage: OpenAI.Images.ImagesResponse['usage'] | undefined;
                            let imageIndex = 0;

                            for await (const event of stream) {
                                if (event.type === 'image_generation.partial_image') {
                                    const partialEvent: StreamingEvent = {
                                        type: 'partial_image',
                                        index: imageIndex,
                                        partial_image_index: event.partial_image_index,
                                        b64_json: event.b64_json
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(partialEvent)}\n\n`));
                                } else if (event.type === 'image_generation.completed') {
                                    const currentIndex = imageIndex;
                                    const filename = createImageFilename(batchId, currentIndex, fileExtension);

                                    // Save to filesystem if in fs mode
                                    if (effectiveStorageMode === 'fs' && event.b64_json) {
                                        const buffer = Buffer.from(event.b64_json, 'base64');
                                        const filepath = path.join(outputDir, filename);
                                        await fs.writeFile(filepath, buffer);
                                        console.log(`Streaming: Saved image ${filename}`);
                                    }

                                    const imageData = createImageResult(
                                        filename,
                                        event.b64_json || '',
                                        fileExtension,
                                        effectiveStorageMode
                                    );
                                    completedImages.push(imageData);

                                    const completedEvent: StreamingEvent = {
                                        type: 'completed',
                                        index: currentIndex,
                                        filename,
                                        b64_json: event.b64_json,
                                        path: effectiveStorageMode === 'fs' ? `/api/image/${filename}` : undefined,
                                        output_format: fileExtension
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(completedEvent)}\n\n`));

                                    imageIndex++;

                                    // Capture usage from completed event if available
                                    if ('usage' in event && event.usage) {
                                        finalUsage = event.usage as OpenAI.Images.ImagesResponse['usage'];
                                    }
                                }
                            }

                            // Send final done event with all images and usage
                            const doneEvent: StreamingEvent = {
                                type: 'done',
                                images: completedImages,
                                usage: finalUsage
                            };
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`));
                            controller.close();
                        } catch (error) {
                            console.error('Streaming error:', error);
                            const errorEvent: StreamingEvent = {
                                type: 'error',
                                error: error instanceof Error ? error.message : 'Streaming error occurred'
                            };
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
                            controller.close();
                        }
                    }
                });

                return new Response(readableStream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive'
                    }
                });
            }

            const params: OpenAI.Images.ImageGenerateParamsNonStreaming = { ...baseParams, stream: false };
            console.log('Calling OpenAI generate with params:', params);
            result = await openai.images.generate(params);
        } else if (mode === 'edit') {
            const n = readCount(formData, 'n', 1, 1, 10);
            const size = readSize(formData, 'size', 'auto', model) as OpenAI.Images.ImageEditParams['size'];
            const quality = readEditQuality(formData) as OpenAI.Images.ImageEditParams['quality'];
            const imageFiles = readImageFiles(formData);
            const maskFile = readMaskFile(formData);

            const baseEditParams = {
                model,
                prompt,
                image: imageFiles,
                n,
                size: size === 'auto' ? undefined : size,
                quality: quality === 'auto' ? undefined : quality
            };

            // Handle streaming mode for editing
            if (streamEnabled) {
                console.log('Calling OpenAI edit with streaming, params:', {
                    ...baseEditParams,
                    stream: true,
                    partial_images: partialImagesCount,
                    image: `[${imageFiles.map((f) => f.name).join(', ')}]`,
                    mask: maskFile ? maskFile.name : 'N/A'
                });

                const streamEditParams = {
                    ...baseEditParams,
                    stream: true as const,
                    partial_images: partialImagesCount,
                    ...(maskFile ? { mask: maskFile } : {})
                };

                const stream = await openai.images.edit(streamEditParams);

                // Create SSE response for edit
                const encoder = new TextEncoder();
                const batchId = crypto.randomBytes(8).toString('hex');
                const fileExtension: ValidOutputFormat = 'png';

                const readableStream = new ReadableStream({
                    async start(controller) {
                        try {
                            const completedImages: Array<{
                                filename: string;
                                b64_json: string;
                                path?: string;
                                output_format: string;
                            }> = [];
                            let finalUsage: OpenAI.Images.ImagesResponse['usage'] | undefined;
                            let imageIndex = 0;

                            for await (const event of stream) {
                                if (event.type === 'image_edit.partial_image') {
                                    const partialEvent: StreamingEvent = {
                                        type: 'partial_image',
                                        index: imageIndex,
                                        partial_image_index: event.partial_image_index,
                                        b64_json: event.b64_json
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(partialEvent)}\n\n`));
                                } else if (event.type === 'image_edit.completed') {
                                    const currentIndex = imageIndex;
                                    const filename = createImageFilename(batchId, currentIndex, fileExtension);

                                    // Save to filesystem if in fs mode
                                    if (effectiveStorageMode === 'fs' && event.b64_json) {
                                        const buffer = Buffer.from(event.b64_json, 'base64');
                                        const filepath = path.join(outputDir, filename);
                                        await fs.writeFile(filepath, buffer);
                                        console.log(`Streaming edit: Saved image ${filename}`);
                                    }

                                    const imageData = createImageResult(
                                        filename,
                                        event.b64_json || '',
                                        fileExtension,
                                        effectiveStorageMode
                                    );
                                    completedImages.push(imageData);

                                    const completedEvent: StreamingEvent = {
                                        type: 'completed',
                                        index: currentIndex,
                                        filename,
                                        b64_json: event.b64_json,
                                        path: effectiveStorageMode === 'fs' ? `/api/image/${filename}` : undefined,
                                        output_format: fileExtension
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(completedEvent)}\n\n`));

                                    imageIndex++;

                                    // Capture usage from completed event if available
                                    if ('usage' in event && event.usage) {
                                        finalUsage = event.usage as OpenAI.Images.ImagesResponse['usage'];
                                    }
                                }
                            }

                            // Send final done event with all images and usage
                            const doneEvent: StreamingEvent = {
                                type: 'done',
                                images: completedImages,
                                usage: finalUsage
                            };
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`));
                            controller.close();
                        } catch (error) {
                            console.error('Streaming edit error:', error);
                            const errorEvent: StreamingEvent = {
                                type: 'error',
                                error: error instanceof Error ? error.message : 'Streaming error occurred'
                            };
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
                            controller.close();
                        }
                    }
                });

                return new Response(readableStream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive'
                    }
                });
            }

            const params: OpenAI.Images.ImageEditParams = {
                ...baseEditParams,
                ...(maskFile ? { mask: maskFile } : {})
            };

            console.log('Calling OpenAI edit with params:', {
                ...params,
                image: `[${imageFiles.map((f) => f.name).join(', ')}]`,
                mask: maskFile ? maskFile.name : 'N/A'
            });
            result = await openai.images.edit(params);
        } else {
            return NextResponse.json({ error: 'Invalid mode specified' }, { status: 400 });
        }

        console.log('OpenAI API call successful.');

        if (!result || !Array.isArray(result.data) || result.data.length === 0) {
            const invalidResult: unknown = result;
            console.error('Invalid or empty data received from OpenAI API:', {
                type: typeof invalidResult,
                preview: typeof invalidResult === 'string' ? invalidResult.slice(0, 300) : invalidResult
            });
            return NextResponse.json({ error: describeInvalidImagesResponse(invalidResult) }, { status: 502 });
        }

        const batchId = crypto.randomBytes(8).toString('hex');
        const savedImagesData = await Promise.all(
            result.data.map(async (imageData, index) => {
                if (!imageData.b64_json) {
                    console.error(`Image data ${index} is missing b64_json.`);
                    throw new Error(`Image data at index ${index} is missing base64 data.`);
                }
                const buffer = Buffer.from(imageData.b64_json, 'base64');
                const fileExtension = responseOutputFormat;
                const filename = createImageFilename(batchId, index, fileExtension);

                if (effectiveStorageMode === 'fs') {
                    const filepath = path.join(outputDir, filename);
                    console.log(`Attempting to save image to: ${filepath}`);
                    await fs.writeFile(filepath, buffer);
                    console.log(`Successfully saved image: ${filename}`);
                }

                return createImageResult(filename, imageData.b64_json, fileExtension, effectiveStorageMode);
            })
        );

        console.log(`All images processed. Mode: ${effectiveStorageMode}`);

        return NextResponse.json({ images: savedImagesData, usage: result.usage });
    } catch (error: unknown) {
        console.error('Error in /api/images:', error);

        let errorMessage = 'An unexpected error occurred.';
        let status = 500;

        if (error instanceof RequestValidationError) {
            errorMessage = error.message;
            status = error.status;
        } else if (error instanceof Error) {
            errorMessage = error.message;
            if (errorMessage.includes('<!DOCTYPE html') || errorMessage.includes('<html')) {
                errorMessage = describeInvalidImagesResponse(errorMessage);
            }
            if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        } else if (typeof error === 'object' && error !== null) {
            if ('message' in error && typeof error.message === 'string') {
                errorMessage = error.message;
            }
            if ('status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
}
