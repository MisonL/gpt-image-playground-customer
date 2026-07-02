import { resolveHistoryCompareImage } from './history-compare';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('resolveHistoryCompareImage', () => {
    it('uses the previous file-system history image when the latest entry is the current image', () => {
        const image = resolveHistoryCompareImage({
            history: [
                { images: [{ filename: 'current.png' }], storageModeUsed: 'fs' },
                { images: [{ filename: 'previous.png' }], storageModeUsed: 'fs' }
            ],
            currentFilenames: ['current.png'],
            getIndexedDbImageSrc: () => undefined
        });

        assert.deepEqual(image, {
            path: '/api/image/previous.png',
            filename: 'previous.png'
        });
    });

    it('resolves indexeddb history images through the provided source lookup', () => {
        const image = resolveHistoryCompareImage({
            history: [
                { images: [{ filename: 'current.png' }, { filename: 'stored.png' }], storageModeUsed: 'indexeddb' }
            ],
            currentFilenames: ['current.png'],
            getIndexedDbImageSrc: (filename) => (filename === 'stored.png' ? 'blob:stored' : undefined)
        });

        assert.deepEqual(image, {
            path: 'blob:stored',
            filename: 'stored.png'
        });
    });

    it('continues to later history items when an indexeddb comparison source is unavailable', () => {
        const image = resolveHistoryCompareImage({
            history: [
                { images: [{ filename: 'current.png' }, { filename: 'missing.png' }], storageModeUsed: 'indexeddb' },
                { images: [{ filename: 'fallback.png' }], storageModeUsed: 'fs' }
            ],
            currentFilenames: ['current.png'],
            getIndexedDbImageSrc: () => undefined
        });

        assert.deepEqual(image, {
            path: '/api/image/fallback.png',
            filename: 'fallback.png'
        });
    });

    it('returns null when there is no current image to compare from', () => {
        const image = resolveHistoryCompareImage({
            history: [{ images: [{ filename: 'previous.png' }], storageModeUsed: 'fs' }],
            currentFilenames: [],
            getIndexedDbImageSrc: () => undefined
        });

        assert.equal(image, null);
    });
});
