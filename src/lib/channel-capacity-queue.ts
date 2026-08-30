export type ChannelCapacityQueueOptions = {
    enabled: boolean;
    capacityPerKey: number;
    maxWaitMs: number;
    maxSize: number;
    now?: () => number;
};

export type ChannelCapacityAcquireOptions = {
    signal?: AbortSignal;
};

export type ChannelCapacityLease = {
    key: string;
    queued: boolean;
    position: number;
    waitMs: number;
    capacity: number;
    activeCount: number;
    queuedCount: number;
    release: () => void;
};

export type ChannelCapacityQueueSummary = {
    enabled: boolean;
    capacityPerKey: number;
    maxWaitMs: number;
    maxSize: number;
    active: number;
    queued: number;
    keys: Array<{
        key: string;
        active: number;
        queued: number;
    }>;
};

type Waiter = {
    key: string;
    queuedAtMs: number;
    resolve: (lease: ChannelCapacityLease) => void;
    reject: (error: ChannelCapacityQueueError) => void;
    signal?: AbortSignal;
    timer?: ReturnType<typeof setTimeout>;
    abortListener?: () => void;
};

export class ChannelCapacityQueueError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;
    readonly details: Record<string, unknown>;

    constructor(input: {
        code: string;
        message: string;
        status: number;
        retryable: boolean;
        details: Record<string, unknown>;
    }) {
        super(input.message);
        this.name = 'ChannelCapacityQueueError';
        this.code = input.code;
        this.status = input.status;
        this.retryable = input.retryable;
        this.details = input.details;
    }
}

export type ChannelCapacityQueue = ReturnType<typeof createChannelCapacityQueue>;

export function createChannelCapacityQueue(options: ChannelCapacityQueueOptions) {
    const activeByKey = new Map<string, number>();
    const queueByKey = new Map<string, Waiter[]>();
    const now = options.now || Date.now;
    const capacityPerKey = Math.max(1, Math.floor(options.capacityPerKey));
    const maxWaitMs = Math.max(1, Math.floor(options.maxWaitMs));
    const maxSize = Math.max(0, Math.floor(options.maxSize));

    function acquire(key: string, acquireOptions: ChannelCapacityAcquireOptions = {}): Promise<ChannelCapacityLease> {
        if (!options.enabled) {
            return Promise.resolve(createLease(key, false, 0, now()));
        }
        assertValidKey(key);
        const queuedAtMs = now();
        if (canStartImmediately(key)) {
            return Promise.resolve(createLease(key, false, 0, queuedAtMs));
        }

        const queue = getQueue(key);
        if (queue.length >= maxSize) {
            return Promise.reject(
                createQueueError({
                    code: 'channel_capacity_queue_full',
                    message: '渠道凭证并发队列已满，请稍后重试。',
                    key,
                    queuedAtMs,
                    position: queue.length + 1,
                    status: 429,
                    retryable: true
                })
            );
        }

        return new Promise<ChannelCapacityLease>((resolve, reject) => {
            const waiter: Waiter = {
                key,
                queuedAtMs,
                resolve,
                reject,
                signal: acquireOptions.signal
            };
            waiter.timer = setTimeout(() => {
                removeWaiter(waiter);
                reject(
                    createQueueError({
                        code: 'channel_capacity_queue_timeout',
                        message: '渠道凭证并发队列等待超时，请稍后重试。',
                        key,
                        queuedAtMs,
                        position: getWaiterPosition(waiter),
                        status: 429,
                        retryable: true
                    })
                );
            }, maxWaitMs);
            waiter.timer.unref?.();

            if (acquireOptions.signal) {
                if (acquireOptions.signal.aborted) {
                    clearWaiter(waiter);
                    reject(
                        createQueueError({
                            code: 'channel_capacity_queue_aborted',
                            message: '渠道凭证并发队列等待已取消。',
                            key,
                            queuedAtMs,
                            position: 0,
                            status: 429,
                            retryable: false
                        })
                    );
                    return;
                }
                waiter.abortListener = () => {
                    removeWaiter(waiter);
                    reject(
                        createQueueError({
                            code: 'channel_capacity_queue_aborted',
                            message: '渠道凭证并发队列等待已取消。',
                            key,
                            queuedAtMs,
                            position: getWaiterPosition(waiter),
                            status: 429,
                            retryable: false
                        })
                    );
                };
                acquireOptions.signal.addEventListener('abort', waiter.abortListener, { once: true });
            }

            queue.push(waiter);
        });
    }

    function summary(): ChannelCapacityQueueSummary {
        const keys = Array.from(new Set([...activeByKey.keys(), ...queueByKey.keys()])).sort();
        return {
            enabled: options.enabled,
            capacityPerKey,
            maxWaitMs,
            maxSize,
            active: sumMapValues(activeByKey),
            queued: Array.from(queueByKey.values()).reduce((total, queue) => total + queue.length, 0),
            keys: keys.map((key) => ({
                key,
                active: activeByKey.get(key) ?? 0,
                queued: queueByKey.get(key)?.length ?? 0
            }))
        };
    }

    function canStartImmediately(key: string): boolean {
        return (activeByKey.get(key) ?? 0) < capacityPerKey && (queueByKey.get(key)?.length ?? 0) === 0;
    }

    function getQueue(key: string): Waiter[] {
        const existing = queueByKey.get(key);
        if (existing) return existing;
        const queue: Waiter[] = [];
        queueByKey.set(key, queue);
        return queue;
    }

    function createLease(key: string, queued: boolean, position: number, queuedAtMs: number): ChannelCapacityLease {
        activeByKey.set(key, (activeByKey.get(key) ?? 0) + 1);
        let released = false;
        return {
            key,
            queued,
            position,
            waitMs: Math.max(0, now() - queuedAtMs),
            capacity: capacityPerKey,
            activeCount: activeByKey.get(key) ?? 0,
            queuedCount: queueByKey.get(key)?.length ?? 0,
            release: () => {
                if (released) return;
                released = true;
                activeByKey.set(key, Math.max(0, (activeByKey.get(key) ?? 1) - 1));
                if ((activeByKey.get(key) ?? 0) === 0) {
                    activeByKey.delete(key);
                }
                drainQueue(key);
            }
        };
    }

    function drainQueue(key: string): void {
        const queue = queueByKey.get(key);
        if (!queue) return;
        while ((activeByKey.get(key) ?? 0) < capacityPerKey && queue.length > 0) {
            const waiter = queue.shift();
            if (!waiter) break;
            clearWaiter(waiter);
            waiter.resolve(createLease(key, true, 1, waiter.queuedAtMs));
        }
        if (queue.length === 0) {
            queueByKey.delete(key);
        }
    }

    function removeWaiter(waiter: Waiter): void {
        const queue = queueByKey.get(waiter.key);
        if (!queue) {
            clearWaiter(waiter);
            return;
        }
        const index = queue.indexOf(waiter);
        if (index >= 0) {
            queue.splice(index, 1);
        }
        if (queue.length === 0) {
            queueByKey.delete(waiter.key);
        }
        clearWaiter(waiter);
    }

    function clearWaiter(waiter: Waiter): void {
        if (waiter.timer) {
            clearTimeout(waiter.timer);
            waiter.timer = undefined;
        }
        if (waiter.signal && waiter.abortListener) {
            waiter.signal.removeEventListener('abort', waiter.abortListener);
            waiter.abortListener = undefined;
        }
    }

    function getWaiterPosition(waiter: Waiter): number {
        const queue = queueByKey.get(waiter.key);
        if (!queue) return 0;
        const index = queue.indexOf(waiter);
        return index >= 0 ? index + 1 : 0;
    }

    function createQueueError(input: {
        code: string;
        message: string;
        key: string;
        queuedAtMs: number;
        position: number;
        status: number;
        retryable: boolean;
    }): ChannelCapacityQueueError {
        return new ChannelCapacityQueueError({
            code: input.code,
            message: input.message,
            status: input.status,
            retryable: input.retryable,
            details: {
                credential_id: input.key,
                queue_position: input.position,
                wait_ms: Math.max(0, now() - input.queuedAtMs),
                max_wait_ms: maxWaitMs,
                capacity: capacityPerKey,
                active: activeByKey.get(input.key) ?? 0,
                queued: queueByKey.get(input.key)?.length ?? 0
            }
        });
    }

    return { acquire, summary };
}

function assertValidKey(key: string): void {
    if (!key.trim()) {
        throw new ChannelCapacityQueueError({
            code: 'channel_capacity_queue_invalid_key',
            message: '渠道凭证并发队列 key 不能为空。',
            status: 500,
            retryable: false,
            details: {}
        });
    }
}

function sumMapValues(map: Map<string, number>): number {
    return Array.from(map.values()).reduce((total, value) => total + value, 0);
}
