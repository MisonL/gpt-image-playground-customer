import { downloadSameOriginImageAsBase64 } from './image-url-result';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('downloadSameOriginImageAsBase64', () => {
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
