import {
    buildOpenAIImageRequestOptions,
    closeOpenAIImageTransportResources,
    createDnsValidatedDispatcher,
    createPinnedDnsDispatcher,
    createOpenAIImageClientOptions,
    fetchOpenAIUpstream,
    readImageStreamDataIntervalTimeoutMs,
    readImageUpstreamMaxRetries,
    readImageUpstreamTimeoutMs,
    readOpenAIUpstreamProxyUrl,
    resolveUpstreamDnsPolicy,
    summarizeOpenAIUpstreamProxy,
    summarizeOpenAIImageTransport,
    UpstreamResponseFormatError
} from './openai-image-transport';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, describe, it } from 'node:test';
import OpenAI from 'openai';

after(async () => {
    await closeOpenAIImageTransportResources();
});

describe('openai image transport settings', () => {
    it('uses long image defaults and disables automatic SDK retries', () => {
        assert.equal(readImageUpstreamTimeoutMs({}), 900_000);
        assert.equal(readImageStreamDataIntervalTimeoutMs({}), 900_000);
        assert.equal(readImageUpstreamMaxRetries({}), 0);
        assert.deepEqual(summarizeOpenAIImageTransport({}), {
            upstream_timeout_ms: 900_000,
            stream_data_interval_timeout_ms: 900_000,
            upstream_max_retries: 0,
            upstream_proxy: { configured: false }
        });

        const clientOptions = createOpenAIImageClientOptions({ apiKey: 'key', baseURL: 'https://api.example/v1' });
        assert.equal(clientOptions.apiKey, 'key');
        assert.equal(clientOptions.baseURL, 'https://api.example/v1');
        assert.equal(clientOptions.defaultHeaders, undefined);
        assert.equal(typeof clientOptions.fetch, 'function');
        assert.equal(clientOptions.timeout, 900_000);
        assert.equal(clientOptions.maxRetries, 0);
    });

    it('lets operators override timeout and retry policy explicitly', () => {
        const env = {
            IMAGE_UPSTREAM_TIMEOUT_MS: '1200000',
            IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS: '600000',
            IMAGE_UPSTREAM_MAX_RETRIES: '1'
        };

        assert.equal(readImageUpstreamTimeoutMs(env), 1_200_000);
        assert.equal(readImageStreamDataIntervalTimeoutMs(env), 600_000);
        assert.equal(readImageUpstreamMaxRetries(env), 1);
        assert.equal(buildOpenAIImageRequestOptions({ env }).timeout, 1_200_000);
        assert.equal(buildOpenAIImageRequestOptions({ env }).maxRetries, 1);
    });

    it('sends the idempotency key as an explicit upstream header', () => {
        const options = buildOpenAIImageRequestOptions({
            headers: { 'Idempotency-Key': 'configured-wrong-key', 'X-App-ID': 'app-id' },
            idempotencyKey: 'business-operation-key'
        });
        const headers = new Headers(options.headers as HeadersInit);

        assert.equal(options.idempotencyKey, 'business-operation-key');
        assert.equal(headers.get('idempotency-key'), 'business-operation-key');
        assert.equal(headers.get('x-app-id'), 'app-id');
    });

    it('rejects invalid transport env values explicitly', () => {
        assert.throws(() => readImageUpstreamTimeoutMs({ IMAGE_UPSTREAM_TIMEOUT_MS: '15s' }), /非负整数/);
        assert.throws(() => readImageUpstreamTimeoutMs({ IMAGE_UPSTREAM_TIMEOUT_MS: '0' }), /正整数/);
        assert.equal(readImageStreamDataIntervalTimeoutMs({ IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS: '0' }), 0);
        assert.throws(() => readImageUpstreamMaxRetries({ IMAGE_UPSTREAM_MAX_RETRIES: '-1' }), /非负整数/);
    });

    it('accepts only bare HTTP(S) proxy URLs and redacts the configured endpoint', () => {
        const proxyUrl = readOpenAIUpstreamProxyUrl({
            OPENAI_UPSTREAM_PROXY_URL: 'https://proxy.internal.example:9443'
        });

        assert.equal(proxyUrl, 'https://proxy.internal.example:9443/');
        assert.deepEqual(summarizeOpenAIUpstreamProxy(proxyUrl), { configured: true, protocol: 'https' });
        assert.equal(JSON.stringify(summarizeOpenAIUpstreamProxy(proxyUrl)).includes('proxy.internal.example'), false);
        assert.equal(JSON.stringify(summarizeOpenAIUpstreamProxy(proxyUrl)).includes('9443'), false);
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'socks5://127.0.0.1:1080' }),
            /不支持 SOCKS/
        );
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'http://proxy-user:secret@proxy.example' }),
            /不能包含代理用户名或密码/
        );
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'https://proxy.example/path' }),
            /不能包含路径/
        );
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'https://proxy.example?token=secret' }),
            /不能包含查询参数/
        );
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'https://proxy.example/?' }),
            /不能包含查询参数/
        );
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'https://proxy.example/#' }),
            /不能包含查询参数/
        );
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'https://proxy.example/%2e' }),
            /不能包含路径/
        );
        assert.throws(
            () => readOpenAIUpstreamProxyUrl({ OPENAI_UPSTREAM_PROXY_URL: 'https://proxy.example\\path' }),
            /不能包含路径/
        );
    });

    it('routes SDK and native upstream fetches through an HTTP proxy', async () => {
        const upstreamRequests: string[] = [];
        const upstream = await startHttpServer((request, response) => {
            upstreamRequests.push(request.url || '');
            if (request.url === '/v1/models') {
                response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
                response.end(JSON.stringify({ object: 'list', data: [] }));
                return;
            }
            if (request.url === '/native') {
                response.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' });
                response.end('native-through-proxy');
                return;
            }
            response.writeHead(404, { 'Content-Type': 'application/json', Connection: 'close' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
        });
        const proxy = await startHttpConnectProxy();

        try {
            const nativeResponse = await fetchOpenAIUpstream(
                `${upstream.baseUrl}/native`,
                { headers: { Connection: 'close' } },
                proxy.url
            );
            assert.equal(await nativeResponse.text(), 'native-through-proxy');

            const client = new OpenAI(
                createOpenAIImageClientOptions({
                    apiKey: 'sk-proxy-test',
                    baseURL: `${upstream.baseUrl}/v1`,
                    upstreamProxyUrl: proxy.url,
                    defaultHeaders: { Connection: 'close' }
                })
            );
            const models = await client.models.list();

            assert.deepEqual(models.data, []);
            assert.deepEqual(upstreamRequests, ['/native', '/v1/models']);
            assert.equal(proxy.connectTargets.length, 2);
            assert.ok(proxy.connectTargets.every((target) => target === upstream.origin));
        } finally {
            await proxy.close();
            await upstream.close();
        }
    });

    it('rejects combining a proxy dispatcher with a pinned dispatcher', async () => {
        const dispatcher = createPinnedDnsDispatcher([{ address: '127.0.0.1', family: 4 }]);
        try {
            assert.throws(
                () => fetchOpenAIUpstream('https://example.com/models', undefined, 'http://proxy.example', dispatcher),
                /不能同时指定 upstreamProxyUrl 和 pinned dispatcher/
            );
        } finally {
            await dispatcher.close();
        }
    });

    it('routes SDK image edits with multipart uploads through an HTTP proxy', async () => {
        let receivedContentType = '';
        let receivedBody = '';
        const upstream = await startHttpServer(async (request, response) => {
            receivedContentType = String(request.headers['content-type'] || '');
            receivedBody = await readRequestBody(request);
            response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
            response.end(JSON.stringify({ created: 0, data: [{ b64_json: 'aGVsbG8=' }] }));
        });
        const proxy = await startHttpConnectProxy();

        try {
            const client = new OpenAI(
                createOpenAIImageClientOptions({
                    apiKey: 'sk-proxy-test',
                    baseURL: `${upstream.baseUrl}/v1`,
                    upstreamProxyUrl: proxy.url,
                    defaultHeaders: { Connection: 'close' }
                })
            );
            const image = new File([Buffer.from('image')], 'input.png', { type: 'image/png' });

            await client.images.edit({
                image,
                model: 'gpt-image-2',
                prompt: 'proxy multipart regression test'
            });

            assert.match(receivedContentType, /^multipart\/form-data; boundary=/);
            assert.match(receivedBody, /name="image"; filename="input\.png"/);
            assert.match(receivedBody, /name="prompt"/);
            assert.equal(proxy.connectTargets.length, 1);
            assert.equal(proxy.connectTargets[0], upstream.origin);
        } finally {
            await proxy.close();
            await upstream.close();
        }
    });

    it('supports pinned DNS dispatchers when undici requests all lookup records', async () => {
        const upstream = await startHttpServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' });
            response.end(request.headers.host);
        });
        const dispatcher = createPinnedDnsDispatcher([{ address: '127.0.0.1', family: 4 }]);

        try {
            const pinnedHostUrl = upstream.baseUrl.replace('127.0.0.1', 'pinned.example.invalid');
            const response = await fetch(`${pinnedHostUrl}/pinned`, {
                dispatcher,
                headers: { Connection: 'close' }
            } as RequestInit & { dispatcher: typeof dispatcher });
            assert.equal(response.status, 200);
            assert.match(await response.text(), /^pinned\.example\.invalid:/);
        } finally {
            await dispatcher.close();
            await upstream.close();
        }
    });

    it('blocks private DNS answers before an upstream connection is opened', async () => {
        let connectionOpened = false;
        const upstream = await startHttpServer((_request, response) => {
            connectionOpened = true;
            response.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' });
            response.end('unexpected');
        });
        const dispatcher = createDnsValidatedDispatcher({
            lookup: (async () => [
                { address: '127.0.0.1', family: 4 }
            ]) as unknown as typeof import('node:dns/promises').lookup
        });

        try {
            await assert.rejects(
                () =>
                    fetch(`${upstream.baseUrl.replace('127.0.0.1', 'private.example.invalid')}/blocked`, {
                        dispatcher,
                        headers: { Connection: 'close' }
                    } as RequestInit & { dispatcher: typeof dispatcher }),
                (error: unknown) => {
                    assert.match(String(error), /fetch failed/);
                    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
                    assert.match(String(cause), /禁止的本地或内网地址/);
                    return true;
                }
            );
            assert.equal(connectionOpened, false);
        } finally {
            await dispatcher.close();
            await upstream.close();
        }
    });

    it('keeps synthetic DNS opt-in separate from ordinary private-address access', () => {
        assert.deepEqual(resolveUpstreamDnsPolicy('https://mhapi.net/v1', undefined), {
            allowPrivate: false,
            allowSyntheticDns: false
        });
        assert.deepEqual(resolveUpstreamDnsPolicy('https://mhapi.net/v1', undefined, true), {
            allowPrivate: false,
            allowSyntheticDns: true
        });
        assert.deepEqual(resolveUpstreamDnsPolicy('http://127.0.0.1:4783/v1', undefined, true), {
            allowPrivate: true,
            allowSyntheticDns: true,
            allowedPrivateHostnames: ['127.0.0.1']
        });
    });

    it('classifies successful HTML upstream responses before SDK parsing', async () => {
        const upstream = await startHttpServer((_request, response) => {
            response.writeHead(200, {
                'Content-Type': 'text/html',
                'Retry-After': '19',
                'X-Request-Id': 'html-upstream-1',
                Connection: 'close'
            });
            response.end('<!doctype html><html><body>gateway page</body></html>');
        });

        try {
            await assert.rejects(
                () =>
                    fetchOpenAIUpstream(
                        `${upstream.baseUrl}/v1/images/generations`,
                        { headers: { Connection: 'close' } },
                        undefined,
                        undefined,
                        {
                            baseURL: upstream.baseUrl,
                            allowedPlainHttpBaseUrls: [upstream.baseUrl]
                        }
                    ),
                (error: unknown) => {
                    assert.ok(error instanceof UpstreamResponseFormatError);
                    assert.equal(error.code, 'upstream_response_format');
                    assert.equal(error.status, 502);
                    assert.equal(error.upstreamStatus, 200);
                    assert.equal(error.contentType, 'text/html');
                    assert.equal(error.headers.get('retry-after'), '19');
                    assert.equal(error.headers.get('x-request-id'), 'html-upstream-1');
                    return true;
                }
            );
        } finally {
            await upstream.close();
        }
    });
});

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}

async function startHttpServer(
    handler: (request: http.IncomingMessage, response: http.ServerResponse) => void
): Promise<{ baseUrl: string; origin: string; close: () => Promise<void> }> {
    const sockets = new Set<net.Socket>();
    const server = http.createServer(handler);
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await listen(server);
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `127.0.0.1:${address.port}`;
    return {
        baseUrl: `http://${origin}`,
        origin,
        close: () => closeServer(server, sockets)
    };
}

async function startHttpConnectProxy(): Promise<{
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
        const target = readConnectTarget(request.url);
        if (!target) {
            clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            return;
        }
        connectTargets.push(`${target.hostname}:${target.port}`);
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
    await listen(server);
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        url: `http://127.0.0.1:${address.port}`,
        connectTargets,
        close: () => closeServer(server, sockets)
    };
}

function readConnectTarget(rawTarget: string | undefined): URL | undefined {
    if (!rawTarget) return undefined;
    try {
        return new URL(`http://${rawTarget}`);
    } catch {
        return undefined;
    }
}

async function listen(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function closeServer(server: http.Server, sockets: Set<net.Socket>): Promise<void> {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}
