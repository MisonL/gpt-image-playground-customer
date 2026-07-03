export class ImageStreamDataIntervalTimeoutError extends Error {
    readonly status = 502;

    constructor(timeoutMs: number) {
        super(`图片流式上游超过 ${timeoutMs}ms 未返回数据。`);
        this.name = 'ImageStreamDataIntervalTimeoutError';
    }
}

export async function* withStreamDataIntervalTimeout<T>(
    stream: AsyncIterable<T>,
    timeoutMs: number,
    abortSignal?: AbortSignal
): AsyncIterable<T> {
    if (timeoutMs <= 0 && !abortSignal) {
        yield* stream;
        return;
    }
    const iterator = stream[Symbol.asyncIterator]();
    let closePromise: Promise<IteratorResult<T> | undefined> | undefined;
    const closeIterator = () => {
        if (!closePromise) {
            try {
                closePromise = Promise.resolve(iterator.return?.()).catch(() => undefined);
            } catch {
                closePromise = Promise.resolve(undefined);
            }
        }
        return closePromise;
    };
    let completed = false;
    try {
        while (true) {
            if (abortSignal?.aborted) {
                void closeIterator();
                throw createAbortError(abortSignal.reason);
            }
            const result = await readNextWithTimeout(iterator.next(), timeoutMs, closeIterator, abortSignal);
            if (result.done) {
                completed = true;
                break;
            }
            yield result.value;
        }
    } finally {
        if (!completed) {
            void closeIterator();
        }
    }
}

async function readNextWithTimeout<T>(
    promise: Promise<IteratorResult<T>>,
    timeoutMs: number,
    closeIterator: () => Promise<IteratorResult<T> | undefined>,
    abortSignal?: AbortSignal
): Promise<IteratorResult<T>> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    try {
        const races: Array<Promise<IteratorResult<T>>> = [promise];
        if (timeoutMs > 0) {
            races.push(
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => {
                        void closeIterator();
                        reject(new ImageStreamDataIntervalTimeoutError(timeoutMs));
                    }, timeoutMs);
                })
            );
        }
        if (abortSignal) {
            races.push(
                new Promise<never>((_, reject) => {
                    abortListener = () => {
                        void closeIterator();
                        reject(createAbortError(abortSignal.reason));
                    };
                    abortSignal.addEventListener('abort', abortListener, { once: true });
                })
            );
        }
        return await Promise.race(races);
    } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener) abortSignal?.removeEventListener('abort', abortListener);
    }
}

function createAbortError(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    const error = new Error('图片流式响应已取消。');
    error.name = 'AbortError';
    return error;
}
