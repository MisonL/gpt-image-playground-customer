export type HistoryCompareImage = {
    path: string;
    filename: string;
};

type HistoryCompareItem = {
    images: Array<{
        filename: string;
    }>;
    storageModeUsed?: 'fs' | 'indexeddb';
};

type ResolveHistoryCompareImageInput = {
    history: HistoryCompareItem[];
    currentFilenames: string[];
    getIndexedDbImageSrc: (filename: string) => string | undefined;
};

export function resolveHistoryCompareImage({
    history,
    currentFilenames,
    getIndexedDbImageSrc
}: ResolveHistoryCompareImageInput): HistoryCompareImage | null {
    if (currentFilenames.length === 0) return null;

    const currentFilenameSet = new Set(currentFilenames);
    for (const item of history) {
        for (const image of item.images) {
            if (currentFilenameSet.has(image.filename)) continue;

            if ((item.storageModeUsed || 'fs') === 'indexeddb') {
                const path = getIndexedDbImageSrc(image.filename);
                if (path) return { path, filename: image.filename };
                continue;
            }

            return {
                path: `/api/image/${image.filename}`,
                filename: image.filename
            };
        }
    }

    return null;
}
