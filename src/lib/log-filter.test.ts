import { filterLogsByScope, resolveLogClientRequestIds } from './log-filter';
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
});
