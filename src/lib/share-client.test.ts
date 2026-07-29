import { createImageShareFromBlob } from './share-client';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('createImageShareFromBlob', () => {
    it('refreshes image access before posting the share form', async () => {
        const steps: string[] = [];
        const response = await createImageShareFromBlob({
            filename: 'result.png',
            blob: new Blob([Buffer.from('image-bytes')], { type: 'image/png' }),
            values: { accessCode: ' 12345678 ', expiresInMinutes: 60 },
            accessRefreshErrorMessage: 'refresh failed',
            createFailedMessage: 'create failed',
            refreshImageAccessCookie: async () => {
                steps.push('refresh');
                return true;
            },
            fetchImpl: async (input, init) => {
                steps.push('fetch');
                assert.equal(input, '/api/shares');
                assert.equal(init?.method, 'POST');
                assert.ok(init?.body instanceof FormData);
                const form = init.body;
                assert.equal(form.get('sourceFilename'), 'result.png');
                assert.equal(form.get('accessCode'), '12345678');
                assert.equal(form.get('expiresInMinutes'), '60');
                assert.ok(form.get('image') instanceof File);
                return Response.json({ url: '/share/token' }, { status: 201 });
            }
        });

        assert.equal(response.url, '/share/token');
        assert.deepEqual(steps, ['refresh', 'fetch']);
    });

    it('resolves a relative share path against the active page origin', async () => {
        const response = await createImageShareFromBlob({
            filename: 'result.png',
            blob: new Blob([Buffer.from('image-bytes')], { type: 'image/png' }),
            values: { accessCode: '', expiresInMinutes: null },
            accessRefreshErrorMessage: 'refresh failed',
            createFailedMessage: 'create failed',
            refreshImageAccessCookie: async () => true,
            pageUrl: 'https://images.example.test/workbench',
            fetchImpl: async () => Response.json({ url: '/playground/share/token' }, { status: 201 })
        });

        assert.equal(response.url, 'https://images.example.test/playground/share/token');
    });

    it('rejects a share URL outside the current page origin', async () => {
        await assert.rejects(
            () =>
                createImageShareFromBlob({
                    filename: 'result.png',
                    blob: new Blob([Buffer.from('image-bytes')], { type: 'image/png' }),
                    values: { accessCode: '', expiresInMinutes: null },
                    accessRefreshErrorMessage: 'refresh failed',
                    createFailedMessage: 'create failed',
                    refreshImageAccessCookie: async () => true,
                    pageUrl: 'https://images.example.test/workbench',
                    fetchImpl: async () =>
                        Response.json({ url: 'https://other.example.test/share/token' }, { status: 201 })
                }),
            /create failed/
        );
    });

    it('does not post a share when access refresh fails', async () => {
        await assert.rejects(
            () =>
                createImageShareFromBlob({
                    filename: 'result.png',
                    blob: new Blob([Buffer.from('image-bytes')], { type: 'image/png' }),
                    values: { accessCode: '', expiresInMinutes: null },
                    accessRefreshErrorMessage: 'refresh failed',
                    createFailedMessage: 'create failed',
                    refreshImageAccessCookie: async () => false,
                    fetchImpl: async () => {
                        throw new Error('fetch should not be called');
                    }
                }),
            /refresh failed/
        );
    });

    it('uses the localized failure message instead of exposing an API error response', async () => {
        await assert.rejects(
            () =>
                createImageShareFromBlob({
                    filename: 'result.png',
                    blob: new Blob([Buffer.from('image-bytes')], { type: 'image/png' }),
                    values: { accessCode: '', expiresInMinutes: null },
                    accessRefreshErrorMessage: 'refresh failed',
                    createFailedMessage: 'create failed',
                    refreshImageAccessCookie: async () => true,
                    fetchImpl: async () => Response.json({ error: 'raw API error' }, { status: 400 })
                }),
            /create failed/
        );
    });
});
