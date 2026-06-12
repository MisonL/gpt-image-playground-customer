import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelCapacityQueueError, createChannelCapacityQueue } from './channel-capacity-queue';

describe('createChannelCapacityQueue', () => {
    it('queues requests per key and releases them in FIFO order', async () => {
        let currentTime = 1000;
        const queue = createChannelCapacityQueue({
            enabled: true,
            capacityPerKey: 1,
            maxWaitMs: 1000,
            maxSize: 10,
            now: () => currentTime
        });

        const first = await queue.acquire('credential-1');
        const secondPromise = queue.acquire('credential-1');
        const thirdPromise = queue.acquire('credential-1');

        assert.deepEqual(queue.summary().keys, [{ key: 'credential-1', active: 1, queued: 2 }]);

        currentTime = 1250;
        first.release();
        const second = await secondPromise;
        assert.equal(second.queued, true);
        assert.equal(second.waitMs, 250);

        currentTime = 1400;
        second.release();
        const third = await thirdPromise;
        assert.equal(third.queued, true);
        assert.equal(third.waitMs, 400);

        third.release();
        assert.equal(queue.summary().active, 0);
        assert.equal(queue.summary().queued, 0);
    });

    it('does not block different keys', async () => {
        const queue = createChannelCapacityQueue({
            enabled: true,
            capacityPerKey: 1,
            maxWaitMs: 1000,
            maxSize: 10
        });

        const first = await queue.acquire('credential-1');
        const second = await queue.acquire('credential-2');

        assert.equal(first.queued, false);
        assert.equal(second.queued, false);
        assert.equal(queue.summary().active, 2);

        first.release();
        second.release();
    });

    it('rejects when the per-key queue is full', async () => {
        const queue = createChannelCapacityQueue({
            enabled: true,
            capacityPerKey: 1,
            maxWaitMs: 1000,
            maxSize: 1
        });

        const first = await queue.acquire('credential-1');
        const secondPromise = queue.acquire('credential-1');
        await assert.rejects(
            queue.acquire('credential-1'),
            (error) => error instanceof ChannelCapacityQueueError && error.code === 'channel_capacity_queue_full'
        );

        first.release();
        const second = await secondPromise;
        second.release();
    });

    it('times out queued requests and removes them from the queue', async () => {
        const queue = createChannelCapacityQueue({
            enabled: true,
            capacityPerKey: 1,
            maxWaitMs: 5,
            maxSize: 10
        });

        const first = await queue.acquire('credential-1');
        await assert.rejects(
            queue.acquire('credential-1'),
            (error) => error instanceof ChannelCapacityQueueError && error.code === 'channel_capacity_queue_timeout'
        );
        assert.equal(queue.summary().queued, 0);

        first.release();
    });

    it('aborts queued requests and keeps release idempotent', async () => {
        const queue = createChannelCapacityQueue({
            enabled: true,
            capacityPerKey: 1,
            maxWaitMs: 1000,
            maxSize: 10
        });
        const abortController = new AbortController();
        const first = await queue.acquire('credential-1');
        const secondPromise = queue.acquire('credential-1', { signal: abortController.signal });

        abortController.abort();
        await assert.rejects(
            secondPromise,
            (error) => error instanceof ChannelCapacityQueueError && error.code === 'channel_capacity_queue_aborted'
        );
        first.release();
        first.release();

        assert.equal(queue.summary().active, 0);
        assert.equal(queue.summary().queued, 0);
    });
});
