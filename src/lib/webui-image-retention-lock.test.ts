import {
    resetWebuiImageRetentionLocksForTests,
    withWebuiImageFilenameLock,
    withWebuiImageFilenameLocks
} from './webui-image-retention-lock';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

afterEach(() => {
    resetWebuiImageRetentionLocksForTests();
});

describe('WebUI image retention filename locks', () => {
    it('serializes concurrent operations for the same filename', async () => {
        const events: string[] = [];
        let releaseFirst: (() => void) | undefined;
        const firstCanFinish = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = withWebuiImageFilenameLock('one.png', async () => {
            events.push('first-start');
            await firstCanFinish;
            events.push('first-end');
        });
        await Promise.resolve();
        const second = withWebuiImageFilenameLock('one.png', async () => {
            events.push('second-start');
            events.push('second-end');
        });

        await Promise.resolve();
        assert.deepEqual(events, ['first-start']);

        releaseFirst?.();
        await Promise.all([first, second]);

        assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
    });

    it('acquires multiple filename locks in a stable order', async () => {
        const events: string[] = [];
        let releaseFirst: (() => void) | undefined;
        const firstCanFinish = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = withWebuiImageFilenameLock('a.png', async () => {
            events.push('first-start');
            await firstCanFinish;
            events.push('first-end');
        });
        await Promise.resolve();
        const batch = withWebuiImageFilenameLocks(['b.png', 'a.png', 'b.png'], async () => {
            events.push('batch');
        });

        await Promise.resolve();
        assert.deepEqual(events, ['first-start']);

        releaseFirst?.();
        await Promise.all([first, batch]);

        assert.deepEqual(events, ['first-start', 'first-end', 'batch']);
    });
});
