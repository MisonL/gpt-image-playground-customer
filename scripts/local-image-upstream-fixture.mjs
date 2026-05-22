#!/usr/bin/env node

import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const FIXTURE_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let raw = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            raw += chunk;
        });
        request.on('end', () => {
            if (!raw.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(error);
            }
        });
        request.on('error', reject);
    });
}

function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

function writeSse(response, event, payload) {
    if (event) response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendImagesStream(response) {
    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });
    response.write(': keepalive\n\n');
    writeSse(response, 'image_generation.partial_image', {
        type: 'image_generation.partial_image',
        partial_image_index: 0,
        b64_json: FIXTURE_IMAGE_BASE64
    });
    writeSse(response, 'image_generation.completed', {
        type: 'image_generation.completed',
        b64_json: FIXTURE_IMAGE_BASE64,
        output_format: 'png',
        size: '1024x1024',
        quality: 'low'
    });
    response.end('data: [DONE]\n\n');
}

function sendResponsesStream(response) {
    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });
    writeSse(response, 'response.image_generation_call.partial_image', {
        type: 'response.image_generation_call.partial_image',
        partial_image_b64: FIXTURE_IMAGE_BASE64,
        partial_image_index: 0
    });
    writeSse(response, 'response.output_item.done', {
        type: 'response.output_item.done',
        item: {
            id: 'ig_fixture',
            type: 'image_generation_call',
            status: 'completed',
            result: FIXTURE_IMAGE_BASE64
        }
    });
    writeSse(response, 'response.completed', {
        type: 'response.completed',
        response: {
            output: [{ id: 'ig_fixture', type: 'image_generation_call', status: 'completed', result: FIXTURE_IMAGE_BASE64 }]
        }
    });
    response.end('data: [DONE]\n\n');
}

function imagesResponse(body) {
    const created = Math.floor(Date.now() / 1000);
    return {
        created,
        data: [{ b64_json: FIXTURE_IMAGE_BASE64 }],
        usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2
        },
        fixture_request: {
            model: typeof body.model === 'string' ? body.model : undefined,
            stream: body.stream === true
        }
    };
}

function responsesJsonResponse(body) {
    return {
        id: 'resp_fixture',
        object: 'response',
        model: typeof body.model === 'string' ? body.model : 'gpt-5.4',
        output: [{ id: 'ig_fixture', type: 'image_generation_call', status: 'completed', result: FIXTURE_IMAGE_BASE64 }],
        usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2
        }
    };
}

function modelsResponse() {
    return {
        object: 'list',
        data: [
            { id: 'gpt-image-2', object: 'model', owned_by: 'fixture' },
            { id: 'gpt-5.4', object: 'model', owned_by: 'fixture' }
        ]
    };
}

async function handleRequest(request, response) {
    const url = new URL(request.url || '/', 'http://fixture.local');
    if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(response, 200, modelsResponse());
        return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
        const body = await readJsonBody(request);
        if (body.stream === true) {
            sendImagesStream(response);
            return;
        }
        sendJson(response, 200, imagesResponse(body));
        return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/responses') {
        const body = await readJsonBody(request);
        if (body.stream === true) {
            sendResponsesStream(response);
            return;
        }
        sendJson(response, 200, responsesJsonResponse(body));
        return;
    }
    sendJson(response, 404, { error: { message: `No fixture route for ${request.method} ${url.pathname}` } });
}

export function createFixtureServer() {
    return http.createServer((request, response) => {
        handleRequest(request, response).catch((error) => {
            sendJson(response, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
        });
    });
}

export function startFixtureServer(port = Number(process.env.PORT || 19080), host = process.env.HOST || '127.0.0.1') {
    const server = createFixtureServer();
    server.listen(port, host, () => {
        const address = server.address();
        const resolvedPort = typeof address === 'object' && address ? address.port : port;
        console.log(`local image upstream fixture listening on http://${host}:${resolvedPort}`);
    });
    return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    startFixtureServer();
}
