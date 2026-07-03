import { withStreamDataIntervalTimeout } from './stream-data-interval-timeout';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('withStreamDataIntervalTimeout', () => {
    it('closes the upstream iterator when the consumer stops early', async () => {
        let returnCalled = false;
        const stream: AsyncIterable<string> = {
            [Symbol.asyncIterator]() {
                let yielded = false;
                return {
                    next: async () => {
                        if (yielded) return new Promise<IteratorResult<string>>(() => undefined);
                        yielded = true;
                        return { done: false, value: 'first' };
                    },
                    return: async () => {
                        returnCalled = true;
                        return { done: true, value: undefined };
                    }
                };
            }
        };

        for await (const event of withStreamDataIntervalTimeout(stream, 1000)) {
            assert.equal(event, 'first');
            break;
        }

        assert.equal(returnCalled, true);
    });

    it('does not wait for a hanging upstream return after an interval timeout', async () => {
        let returnCalled = false;
        const stream: AsyncIterable<string> = {
            [Symbol.asyncIterator]() {
                return {
                    next: () => new Promise<IteratorResult<string>>(() => undefined),
                    return: () => {
                        returnCalled = true;
                        return new Promise<IteratorResult<string>>(() => undefined);
                    }
                };
            }
        };

        const iterator = withStreamDataIntervalTimeout(stream, 1)[Symbol.asyncIterator]();

        await assert.rejects(
            () =>
                Promise.race([
                    iterator.next(),
                    new Promise<never>((_, reject) => {
                        setTimeout(() => reject(new Error('timeout assertion did not settle')), 50);
                    })
                ]),
            /图片流式上游超过 1ms 未返回数据/
        );
        assert.equal(returnCalled, true);
    });

    it('closes the upstream iterator when the caller aborts while waiting for data', async () => {
        let returnCalled = false;
        const abortController = new AbortController();
        const stream: AsyncIterable<string> = {
            [Symbol.asyncIterator]() {
                return {
                    next: () => new Promise<IteratorResult<string>>(() => undefined),
                    return: () => {
                        returnCalled = true;
                        return new Promise<IteratorResult<string>>(() => undefined);
                    }
                };
            }
        };

        const iterator = withStreamDataIntervalTimeout(stream, 1000, abortController.signal)[Symbol.asyncIterator]();
        const nextPromise = iterator.next();
        abortController.abort(new Error('caller stopped'));

        await assert.rejects(
            () =>
                Promise.race([
                    nextPromise,
                    new Promise<never>((_, reject) => {
                        setTimeout(() => reject(new Error('abort assertion did not settle')), 50);
                    })
                ]),
            /caller stopped/
        );
        assert.equal(returnCalled, true);
    });
});
