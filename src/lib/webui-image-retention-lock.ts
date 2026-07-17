const pendingLocks = new Map<string, Promise<void>>();

export type WebuiImageRetentionFilenameLock = <T>(filename: string, operation: () => Promise<T>) => Promise<T>;

export const withWebuiImageFilenameLock: WebuiImageRetentionFilenameLock = async (filename, operation) => {
    const previous = pendingLocks.get(filename) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current);
    pendingLocks.set(filename, tail);

    await previous;
    try {
        return await operation();
    } finally {
        release?.();
        if (pendingLocks.get(filename) === tail) {
            pendingLocks.delete(filename);
        }
    }
};

export async function withWebuiImageFilenameLocks<T>(
    filenames: readonly string[],
    operation: () => Promise<T>
): Promise<T> {
    const orderedFilenames = [...new Set(filenames)].sort();

    const acquireNext = async (index: number): Promise<T> => {
        if (index >= orderedFilenames.length) return await operation();
        return await withWebuiImageFilenameLock(orderedFilenames[index], () => acquireNext(index + 1));
    };

    return await acquireNext(0);
}

export function resetWebuiImageRetentionLocksForTests(): void {
    pendingLocks.clear();
}
