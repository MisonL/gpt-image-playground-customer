import { buildLogScopeDiagnostics, filterLogsByScope, resolveLogClientRequestIds } from './log-filter';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('log-filter', () => {
    it('resolves request ids from structured filenames when history lacks a request id', () => {
        const ids = resolveLogClientRequestIds({
            clientRequestIds: [],
            filenames: ['image-a.png'],
            logs: [
                { clientRequestId: 'request-a', filenames: ['image-a.png'] },
                { clientRequestId: 'request-b', filenames: ['image-b.png'] }
            ]
        });

        assert.deepEqual(ids, ['request-a']);
    });

    it('resolves request ids from persisted context filenames', () => {
        const ids = resolveLogClientRequestIds({
            clientRequestIds: [],
            filenames: ['persisted.png'],
            logs: [
                {
                    clientRequestId: 'request-persisted',
                    context: JSON.stringify({ filenames: ['persisted.png'] })
                }
            ]
        });

        assert.deepEqual(ids, ['request-persisted']);
    });

    it('does not print malformed persisted context while resolving filenames', () => {
        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => {
            warnings.push(args);
        };

        try {
            const ids = resolveLogClientRequestIds({
                clientRequestIds: [],
                filenames: ['secret.png'],
                logs: [
                    {
                        clientRequestId: 'request-secret',
                        context: '{"filenames":["secret.png"],"apiKey":"sk-secret"'
                    }
                ]
            });

            assert.deepEqual(ids, []);
            assert.deepEqual(warnings, []);
        } finally {
            console.warn = originalWarn;
        }
    });

    it('filters all entries for a request id resolved by filename', () => {
        const logs = [
            { clientRequestId: 'request-a', message: 'start' },
            { clientRequestId: 'request-a', message: 'saved', filenames: ['image-a.png'] },
            { clientRequestId: 'request-b', message: 'other', filenames: ['image-b.png'] }
        ];

        const filtered = filterLogsByScope({
            clientRequestIds: [],
            filenames: ['image-a.png'],
            logs
        });

        assert.deepEqual(
            filtered.map((entry) => entry.message),
            ['start', 'saved']
        );
    });

    it('builds copyable diagnostics that separate direct and filename-matched request ids', () => {
        const diagnostics = buildLogScopeDiagnostics({
            clientRequestIds: ['request-direct', 'request-direct'],
            filenames: ['image-a.png', 'image-a.png', 'image-b.png'],
            resolvedClientRequestIds: ['request-direct', 'request-by-filename']
        });

        assert.deepEqual(diagnostics, {
            requestIds: ['request-direct'],
            filenames: ['image-a.png', 'image-b.png'],
            filenameMatchedRequestIds: ['request-by-filename'],
            copyText: [
                'requestIds=request-direct',
                'filenames=image-a.png,image-b.png',
                'filenameMatchedRequestIds=request-by-filename'
            ].join('\n')
        });
    });
});
