import { downloadSameOriginImageAsBase64 } from './image-url-result';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('downloadSameOriginImageAsBase64', () => {
    it('passes authorization and upstream headers to same-origin image downloads', async () => {
        let observedAuthorization: string | null = null;
        let observedUserAgent: string | null = null;
        let observedAppId: string | null = null;
        let observedAppSecret: string | null = null;
        globalThis.fetch = async (_url, init) => {
            const headers = new Headers(init?.headers);
            observedAuthorization = headers.get('authorization');
            observedUserAgent = headers.get('user-agent');
            observedAppId = headers.get('x-app-id');
            observedAppSecret = headers.get('x-app-secret');
            return new Response(Buffer.from('png'), {
                status: 200,
                headers: { 'content-type': 'image/png' }
            });
        };

        const result = await downloadSameOriginImageAsBase64({
            imageUrl: '/generated/final.png',
            apiBaseUrl: 'https://api.example.test/v1',
            apiKey: 'test-key',
            upstreamHeaders: {
                Authorization: 'Bearer wrong-key',
                'X-App-ID': 'app-id',
                'X-App-Secret': 'app-secret'
            }
        });

        assert.equal(result, Buffer.from('png').toString('base64'));
        assert.equal(observedAuthorization, 'Bearer test-key');
        assert.equal(observedUserAgent, 'gpt-image-playground/2.1.0');
        assert.equal(observedAppId, 'app-id');
        assert.equal(observedAppSecret, 'app-secret');
    });

    it('uses the shared header policy when the image download has no API key', async () => {
        let observedProxyAuthorization: string | null = null;
        let observedUserAgent: string | null = null;
        let observedAppId: string | null = null;
        globalThis.fetch = async (_url, init) => {
            const headers = new Headers(init?.headers);
            observedProxyAuthorization = headers.get('proxy-authorization');
            observedUserAgent = headers.get('user-agent');
            observedAppId = headers.get('x-app-id');
            return new Response(Buffer.from('png'), {
                status: 200,
                headers: { 'content-type': 'image/png' }
            });
        };

        await downloadSameOriginImageAsBase64({
            imageUrl: '/generated/final.png',
            apiBaseUrl: 'https://api.example.test/v1',
            upstreamHeaders: {
                'Proxy-Authorization': 'Basic c2VjcmV0',
                'X-App-ID': 'app-id'
            }
        });

        assert.equal(observedProxyAuthorization, null);
        assert.equal(observedUserAgent, 'gpt-image-playground/2.1.0');
        assert.equal(observedAppId, 'app-id');
    });

    it('enforces the remote image size limit when fetch returns no stream body', async () => {
        let arrayBufferRead = false;
        globalThis.fetch = async () =>
            ({
                ok: true,
                headers: new Headers({ 'content-type': 'image/png' }),
                body: null,
                arrayBuffer: async () => {
                    arrayBufferRead = true;
                    return new Uint8Array(25 * 1024 * 1024 + 1).buffer;
                }
            }) as Response;

        await assert.rejects(
            () =>
                downloadSameOriginImageAsBase64({
                    imageUrl: '/generated/final.png',
                    apiBaseUrl: 'https://api.example.test/v1',
                    apiKey: 'test-key'
                }),
            /25 MB/
        );
        assert.equal(arrayBufferRead, true);
    });

    it('rejects oversized non-streaming downloads from content-length before buffering', async () => {
        let arrayBufferRead = false;
        globalThis.fetch = async () =>
            ({
                ok: true,
                headers: new Headers({
                    'content-type': 'image/png',
                    'content-length': String(25 * 1024 * 1024 + 1)
                }),
                body: null,
                arrayBuffer: async () => {
                    arrayBufferRead = true;
                    return new Uint8Array(1).buffer;
                }
            }) as Response;

        await assert.rejects(
            () =>
                downloadSameOriginImageAsBase64({
                    imageUrl: '/generated/final.png',
                    apiBaseUrl: 'https://api.example.test/v1',
                    apiKey: 'test-key'
                }),
            /25 MB/
        );
        assert.equal(arrayBufferRead, false);
    });
});
