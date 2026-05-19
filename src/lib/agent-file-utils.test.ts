import {
    discardArtifactFiles,
    discardMovedFile,
    moveArtifactFilesForDeletion,
    moveFileIfExists,
    readImageDimensions,
    restoreArtifactFiles,
    restoreMovedFile,
    writeFileAtomic
} from './agent-file-utils';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

describe('moveFileIfExists', () => {
    it('moves a file and can restore it afterward', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-move-'));
        const sourcePath = path.join(tempDir, 'artifact.png');
        await writeFile(sourcePath, 'image-data');

        try {
            const moved = await moveFileIfExists(sourcePath);
            assert.ok(moved);
            if (!moved) throw new Error('expected moved file');

            await assert.rejects(() => readFile(sourcePath));
            await restoreMovedFile(moved);
            assert.equal(await readFile(sourcePath, 'utf8'), 'image-data');
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('discards moved directories without leaving purge paths behind', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-move-dir-'));
        const sourcePath = path.join(tempDir, 'artifact-dir');
        await mkdir(sourcePath);
        await writeFile(path.join(sourcePath, 'content.txt'), 'image-data');

        try {
            const moved = await moveFileIfExists(sourcePath);
            assert.ok(moved);
            if (!moved) throw new Error('expected moved directory');

            await discardMovedFile(moved);
            const entries = await readdir(tempDir);
            assert.deepEqual(entries, []);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });
});

describe('moveArtifactFilesForDeletion', () => {
    it('moves and restores multiple artifact files through shared helpers', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-artifact-move-'));
        const firstPath = path.join(tempDir, 'first.png');
        const secondPath = path.join(tempDir, 'second.png');
        await writeFile(firstPath, 'first');
        await writeFile(secondPath, 'second');

        try {
            const moved = await moveArtifactFilesForDeletion([firstPath, secondPath]);
            assert.equal(moved.length, 2);
            await assert.rejects(() => readFile(firstPath));
            await assert.rejects(() => readFile(secondPath));

            await restoreArtifactFiles(moved);
            assert.equal(await readFile(firstPath, 'utf8'), 'first');
            assert.equal(await readFile(secondPath, 'utf8'), 'second');
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('discards moved artifact files through the shared helper', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-artifact-discard-'));
        const sourcePath = path.join(tempDir, 'artifact.png');
        await writeFile(sourcePath, 'image-data');

        try {
            const moved = await moveArtifactFilesForDeletion([sourcePath]);
            await discardArtifactFiles(moved);
            assert.deepEqual(await readdir(tempDir), []);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });
});
