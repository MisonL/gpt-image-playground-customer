import { createZipBlob, sanitizeZipFilename } from './zip-export';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('zip export', () => {
    it('sanitizes unsafe filenames without dropping extensions', () => {
        assert.equal(sanitizeZipFilename('../batch/image one.png'), 'batch_image_one.png');
        assert.equal(sanitizeZipFilename(''), 'image');
        assert.equal(sanitizeZipFilename('a/b\\c.webp'), 'a_b_c.webp');
    });

    it('creates a stored ZIP blob with central directory entries', async () => {
        const zip = await createZipBlob([
            {
                name: 'first.png',
                blob: new Blob([new Uint8Array([1, 2, 3])]),
                modifiedAt: new Date('2026-06-11T00:00:00Z')
            },
            {
                name: '../second image.webp',
                blob: new Blob([new Uint8Array([4, 5])]),
                modifiedAt: new Date('2026-06-11T00:00:00Z')
            }
        ]);
        const bytes = new Uint8Array(await zip.arrayBuffer());
        const text = new TextDecoder().decode(bytes);
        const view = new DataView(bytes.buffer);

        assert.equal(zip.type, 'application/zip');
        assert.equal(view.getUint32(0, true), 0x04034b50);
        assert.ok(text.includes('first.png'));
        assert.ok(text.includes('second_image.webp'));
        assert.equal(view.getUint32(bytes.byteLength - 22, true), 0x06054b50);
    });

    it('deduplicates filenames after sanitizing unsafe paths', async () => {
        const zip = await createZipBlob([
            { name: 'a/b.png', blob: new Blob(['first']), modifiedAt: new Date('2026-06-11T00:00:00Z') },
            { name: 'a\\b.png', blob: new Blob(['second']), modifiedAt: new Date('2026-06-11T00:00:00Z') },
            { name: '../a b.png', blob: new Blob(['third']), modifiedAt: new Date('2026-06-11T00:00:00Z') }
        ]);
        const text = new TextDecoder().decode(new Uint8Array(await zip.arrayBuffer()));

        assert.ok(text.includes('a_b.png'));
        assert.ok(text.includes('a_b_2.png'));
        assert.ok(text.includes('a_b_3.png'));
    });

    it('rejects empty exports explicitly', async () => {
        await assert.rejects(() => createZipBlob([]), /at least one file/);
    });
});
