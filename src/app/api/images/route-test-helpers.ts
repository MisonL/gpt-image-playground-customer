import type { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import http from 'node:http';

export { readSseEvents } from '@/lib/sse-test-utils';

export const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

export function imageFormRequest(input: {
    apiBaseUrl: string;
    apiKey: string;
    stream?: boolean;
    mode?: 'generate' | 'edit';
    imageBackend?: 'images' | 'responses' | 'images-api' | 'responses-image-generation';
    imageStreamingStrategy?: 'off' | 'auto' | 'openai-sse' | 'newapi-keepalive-sse' | 'responses-sse' | 'force-sse';
    streamMode?: 'auto' | 'stream' | 'non_stream';
    size?: string;
    n?: string;
    responsesModel?: string;
    clientRequestId?: string;
    signal?: AbortSignal;
}): NextRequest {
    const formData = new FormData();
    formData.append('mode', input.mode || 'generate');
    formData.append('prompt', 'route stream contract');
    formData.append('model', 'gpt-image-2');
    formData.append('n', input.n || '1');
    formData.append('size', input.size || '1024x1024');
    formData.append('output_format', 'png');
    formData.append('apiBaseUrl', input.apiBaseUrl);
    formData.append('apiKey', input.apiKey);
    formData.append('clientRequestId', input.clientRequestId ?? 'client-route-stream');
    if (input.imageBackend) {
        formData.append('imageBackend', input.imageBackend);
    }
    if (input.imageStreamingStrategy) {
        formData.append('imageStreamingStrategy', input.imageStreamingStrategy);
    }
    if (input.streamMode) {
        formData.append('stream_mode', input.streamMode);
    }
    if (input.responsesModel) {
        formData.append('responsesModel', input.responsesModel);
    }
    if (input.stream) {
        formData.append('stream', 'true');
        formData.append('partial_images', '2');
    }
    if (input.mode === 'edit') {
        formData.append('image_0', new File([Buffer.from(PNG_BASE64, 'base64')], 'input.png', { type: 'image/png' }));
    }
    return new Request('http://localhost/api/images', {
        method: 'POST',
        body: formData,
        signal: input.signal
    }) as NextRequest;
}

export async function startStreamingImageUpstream(
    handler: (body: string, url: string) => Promise<Array<{ event?: string; data: unknown; abortAfter?: boolean }>>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        const isImageStreamPath =
            request.url?.endsWith('/images/generations') || request.url?.endsWith('/images/edits');
        if (request.method !== 'POST' || !isImageStreamPath) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const events = await handler(Buffer.concat(chunks).toString('utf8'), request.url || '');
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const event of events) {
            if (event.event) {
                response.write(`event: ${event.event}\n`);
            }
            response.write(`data: ${JSON.stringify(event.data)}\n\n`);
            if (event.abortAfter) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                response.destroy();
                return;
            }
        }
        response.write('data: [DONE]\n\n');
        response.end();
    });
    return listen(server);
}

export async function startImagesJsonUpstream(
    handler: (body: string, url: string) => Promise<unknown>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        const isImagePath = request.url?.endsWith('/images/generations') || request.url?.endsWith('/images/edits');
        if (request.method !== 'POST' || !isImagePath) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const payload = await handler(Buffer.concat(chunks).toString('utf8'), request.url || '');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
    });
    return listen(server);
}

export async function startImagesStreamFallbackUpstream(): Promise<{
    baseUrl: string;
    calls: Array<{ stream?: boolean; partial_images?: number }>;
    close: () => Promise<void>;
}> {
    const calls: Array<{ stream?: boolean; partial_images?: number }> = [];
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/images/generations')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            stream?: boolean;
            partial_images?: number;
        };
        calls.push({ stream: payload.stream, partial_images: payload.partial_images });
        if (payload.stream) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write(
                `event: image_generation.partial_image\ndata: ${JSON.stringify({
                    type: 'image_generation.partial_image',
                    b64_json: 'partial-before-fallback'
                })}\n\n`
            );
            response.write('data: [DONE]\n\n');
            response.end();
            return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }));
    });
    const result = await listen(server);
    return { ...result, calls };
}

export async function startHangingImagesStreamUpstream(): Promise<{
    baseUrl: string;
    calls: Array<{ stream?: boolean; partial_images?: number }>;
    waitForStreamRequest: () => Promise<void>;
    close: () => Promise<void>;
}> {
    const calls: Array<{ stream?: boolean; partial_images?: number }> = [];
    const activeResponses = new Set<http.ServerResponse>();
    let resolveStreamRequest: () => void = () => {};
    const streamRequest = new Promise<void>((resolve) => {
        resolveStreamRequest = resolve;
    });
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/images/generations')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            stream?: boolean;
            partial_images?: number;
        };
        calls.push({ stream: payload.stream, partial_images: payload.partial_images });
        if (!payload.stream) {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }));
            return;
        }
        activeResponses.add(response);
        response.on('close', () => activeResponses.delete(response));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
            `event: image_generation.partial_image\ndata: ${JSON.stringify({
                type: 'image_generation.partial_image',
                b64_json: 'partial-before-abort'
            })}\n\n`
        );
        resolveStreamRequest();
    });
    const result = await listen(server);
    return {
        ...result,
        calls,
        waitForStreamRequest: () => streamRequest,
        close: async () => {
            for (const response of activeResponses) {
                response.destroy();
            }
            await result.close();
        }
    };
}

export async function startResponsesImageUpstream(
    handler: (body: string) => Promise<unknown>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const payload = await handler(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
    });
    return listen(server);
}

export async function startStreamingResponsesImageUpstream(
    handler: (body: string) => Promise<Array<{ event?: string; data: unknown }>>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const events = await handler(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const event of events) {
            if (event.event) {
                response.write(`event: ${event.event}\n`);
            }
            response.write(`data: ${JSON.stringify(event.data)}\n\n`);
        }
        response.write('data: [DONE]\n\n');
        response.end();
    });
    return listen(server);
}

async function listen(server: http.Server): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}
