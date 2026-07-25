import type { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

export { readSseEvents } from '@/lib/sse-test-utils';

export const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

export function imageFormRequest(input: {
    apiBaseUrl?: string;
    apiKey?: string;
    stream?: boolean;
    mode?: 'generate' | 'edit';
    imageBackend?: 'images' | 'responses' | 'images-api' | 'responses-image-generation';
    imageBackendField?: 'imageBackend' | 'image_backend';
    imageStreamingStrategy?: 'off' | 'auto' | 'openai-sse' | 'newapi-keepalive-sse' | 'responses-sse' | 'force-sse';
    imageStreamingStrategyField?: 'imageStreamingStrategy' | 'image_streaming_strategy';
    streamMode?: 'auto' | 'stream' | 'non_stream';
    size?: string;
    n?: string;
    responsesModel?: string;
    outputFormat?: 'png' | 'jpeg' | 'webp';
    outputCompression?: string;
    partialImages?: string;
    background?: string;
    promptOptimization?: string;
    gptModel?: string;
    thinking?: string;
    forceWeb?: string;
    forceRequest?: string;
    mask?: File;
    clientRequestId?: string;
    signal?: AbortSignal;
}): NextRequest {
    const formData = new FormData();
    formData.append('mode', input.mode || 'generate');
    formData.append('prompt', 'route stream contract');
    formData.append('model', 'gpt-image-2');
    formData.append('n', input.n || '1');
    formData.append('size', input.size || '1024x1024');
    formData.append('output_format', input.outputFormat || 'png');
    if (input.apiBaseUrl) {
        formData.append('apiBaseUrl', input.apiBaseUrl);
    }
    if (input.apiKey) {
        formData.append('apiKey', input.apiKey);
    }
    formData.append('clientRequestId', input.clientRequestId ?? 'client-route-stream');
    if (input.outputCompression) {
        formData.append('output_compression', input.outputCompression);
    }
    if (input.background) {
        formData.append('background', input.background);
    }
    if (input.promptOptimization) {
        formData.append('promptOptimization', input.promptOptimization);
    }
    if (input.gptModel) {
        formData.append('gptModel', input.gptModel);
    }
    if (input.thinking) {
        formData.append('thinking', input.thinking);
    }
    if (input.forceWeb) {
        formData.append('forceWeb', input.forceWeb);
    }
    if (input.forceRequest) {
        formData.append('force_request', input.forceRequest);
    }
    if (input.imageBackend) {
        formData.append(input.imageBackendField || 'imageBackend', input.imageBackend);
    }
    if (input.imageStreamingStrategy) {
        formData.append(input.imageStreamingStrategyField || 'imageStreamingStrategy', input.imageStreamingStrategy);
    }
    if (input.streamMode) {
        formData.append('stream_mode', input.streamMode);
    }
    if (input.responsesModel) {
        formData.append('responsesModel', input.responsesModel);
    }
    if (input.stream) {
        formData.append('stream', 'true');
        formData.append('partial_images', input.partialImages ?? '2');
    }
    if (input.mode === 'edit') {
        formData.append('image_0', new File([Buffer.from(PNG_BASE64, 'base64')], 'input.png', { type: 'image/png' }));
        if (input.mask) {
            formData.append('mask', input.mask);
        }
    }
    return new Request('http://localhost/api/images', {
        method: 'POST',
        body: formData,
        signal: input.signal
    }) as NextRequest;
}

export async function startStreamingImageUpstream(
    handler: (
        body: string,
        url: string,
        request: http.IncomingMessage
    ) => Promise<Array<{ event?: string; data: unknown; abortAfter?: boolean }>>
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
        const events = await handler(Buffer.concat(chunks).toString('utf8'), request.url || '', request);
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
    handler: (body: string, url: string, request: http.IncomingMessage) => Promise<unknown | Buffer>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        const isImagePath = request.url?.endsWith('/images/generations') || request.url?.endsWith('/images/edits');
        if (request.method === 'GET') {
            const payload = await handler('', request.url || '', request);
            if (Buffer.isBuffer(payload)) {
                response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(payload.byteLength) });
                response.end(payload);
                return;
            }
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        if (request.method !== 'POST' || !isImagePath) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const payload = await handler(Buffer.concat(chunks).toString('utf8'), request.url || '', request);
        if (Buffer.isBuffer(payload)) {
            response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(payload.byteLength) });
            response.end(payload);
            return;
        }
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

export async function startImagesAcceptedTaskStreamFallbackUpstream(): Promise<{
    baseUrl: string;
    calls: Array<{ stream?: boolean; partial_images?: number; idempotencyKey?: string | string[] }>;
    close: () => Promise<void>;
}> {
    const calls: Array<{ stream?: boolean; partial_images?: number; idempotencyKey?: string | string[] }> = [];
    let nonStreamAttempts = 0;
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
        calls.push({
            stream: payload.stream,
            partial_images: payload.partial_images,
            idempotencyKey: request.headers['idempotency-key']
        });
        if (payload.stream) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write(
                `event: image_generation.partial_image\ndata: ${JSON.stringify({
                    type: 'image_generation.partial_image',
                    b64_json: 'partial-before-accepted-task-fallback'
                })}\n\n`
            );
            response.write('data: [DONE]\n\n');
            response.end();
            return;
        }
        nonStreamAttempts += 1;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        if (nonStreamAttempts === 1) {
            response.end(
                JSON.stringify({
                    object: 'image.task',
                    status: 'pending',
                    task_id: 'fallback-task',
                    poll_url: '/api/image-tasks?ids=fallback-task'
                })
            );
            return;
        }
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

export async function startResponsesStreamFailureThenJsonUpstream(): Promise<{
    baseUrl: string;
    calls: Array<{ stream?: boolean }>;
    close: () => Promise<void>;
}> {
    const calls: Array<{ stream?: boolean }> = [];
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean };
        calls.push({ stream: payload.stream });
        if (payload.stream) {
            response.writeHead(500, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'stream setup failed' } }));
            return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
            JSON.stringify({
                output: [
                    {
                        type: 'image_generation_call',
                        status: 'completed',
                        result: PNG_BASE64
                    }
                ]
            })
        );
    });
    const result = await listen(server);
    return { ...result, calls };
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

export async function startHttpConnectProxy(): Promise<{
    url: string;
    connectTargets: string[];
    close: () => Promise<void>;
}> {
    const sockets = new Set<net.Socket>();
    const connectTargets: string[] = [];
    const server = http.createServer((_request, response) => {
        response.writeHead(405, { Connection: 'close' });
        response.end();
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    server.on('connect', (request, clientSocket, head) => {
        const target = parseConnectTarget(request.url);
        if (!target) {
            clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            return;
        }
        connectTargets.push(target.host);
        const targetSocket = net.connect({ host: target.hostname, port: Number(target.port) });
        sockets.add(targetSocket);
        targetSocket.on('close', () => sockets.delete(targetSocket));
        targetSocket.once('connect', () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length > 0) targetSocket.write(head);
            clientSocket.pipe(targetSocket);
            targetSocket.pipe(clientSocket);
        });
        targetSocket.once('error', () => {
            if (!clientSocket.destroyed) {
                clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
            }
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        url: `http://127.0.0.1:${address.port}`,
        connectTargets,
        close: () => closeServerWithSockets(server, sockets)
    };
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

function parseConnectTarget(rawTarget: string | undefined): URL | undefined {
    if (!rawTarget) return undefined;
    try {
        return new URL(`http://${rawTarget}`);
    } catch {
        return undefined;
    }
}

async function closeServerWithSockets(server: http.Server, sockets: Set<net.Socket>): Promise<void> {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}
