import { readImageDimensions, writeFileAtomic } from './agent-file-utils';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('readImageDimensions', () => {
    it('reads PNG dimensions without external image libraries', () => {
        const buffer = Buffer.alloc(24);
        buffer[0] = 0x89;
        buffer.write('PNG', 1, 'ascii');
        buffer.write('IHDR', 12, 'ascii');
        buffer.writeUInt32BE(64, 16);
        buffer.writeUInt32BE(32, 20);

        assert.deepEqual(readImageDimensions(buffer), { width: 64, height: 32 });
    });

    it('returns null dimensions for unknown formats', () => {
        assert.deepEqual(readImageDimensions(Buffer.from('not an image')), { width: null, height: null });
    });
});

describe('writeFileAtomic', () => {
    it('removes temporary files when the final rename fails', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-atomic-'));
        const targetPath = path.join(tempDir, 'target.png');
        await mkdir(targetPath);

        try {
            await assert.rejects(() => writeFileAtomic(targetPath, Buffer.from('image')));

            const entries = await readdir(tempDir);
            assert.deepEqual(
                entries.filter((entry) => entry.includes('.tmp-')),
                []
            );
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });
});
