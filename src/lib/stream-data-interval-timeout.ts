export class ImageStreamDataIntervalTimeoutError extends Error {
    readonly status = 502;

    constructor(timeoutMs: number) {
        super(`图片流式上游超过 ${timeoutMs}ms 未返回数据。`);
        this.name = 'ImageStreamDataIntervalTimeoutError';
    }
}

export async function* withStreamDataIntervalTimeout<T>(stream: AsyncIterable<T>, timeoutMs: number): AsyncIterable<T> {
    if (timeoutMs <= 0) {
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
            const result = await readNextWithTimeout(iterator.next(), timeoutMs, closeIterator);
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
    closeIterator: () => Promise<IteratorResult<T> | undefined>
): Promise<IteratorResult<T>> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    void closeIterator();
                    reject(new ImageStreamDataIntervalTimeoutError(timeoutMs));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}
