import { db, type ThumbnailRecord } from './db';

export type ThumbnailCacheInput = {
    filename: string;
    blob: Blob;
    maxEdge?: number;
    now?: () => number;
};

const DEFAULT_THUMBNAIL_MAX_EDGE = 320;

export async function putImageThumbnail(input: ThumbnailCacheInput): Promise<ThumbnailRecord> {
    assertBrowserThumbnailRuntime();
    const maxEdge = input.maxEdge ?? DEFAULT_THUMBNAIL_MAX_EDGE;
    if (!Number.isSafeInteger(maxEdge) || maxEdge <= 0) {
        throw new Error('thumbnail maxEdge must be a positive integer.');
    }
    const resized = await resizeImageBlob(input.blob, maxEdge);
    const record: ThumbnailRecord = {
        filename: input.filename,
        blob: resized.blob,
        width: resized.width,
        height: resized.height,
        updatedAt: input.now?.() ?? Date.now()
    };
    await db.thumbnails.put(record);
    return record;
}

export async function getImageThumbnail(filename: string): Promise<ThumbnailRecord | undefined> {
    return db.thumbnails.get(filename);
}

function assertBrowserThumbnailRuntime(): void {
    if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
        throw new Error('thumbnail cache can only run in a browser runtime.');
    }
}

async function resizeImageBlob(blob: Blob, maxEdge: number): Promise<{ blob: Blob; width: number; height: number }> {
    const bitmap = await createImageBitmap(blob);
    try {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Cannot create thumbnail canvas context.');
        }
        context.drawImage(bitmap, 0, 0, width, height);
        return {
            blob: await canvasToBlob(canvas, blob.type === 'image/png' ? 'image/png' : 'image/webp'),
            width,
            height
        };
    } finally {
        bitmap.close();
    }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Cannot encode thumbnail blob.'));
                return;
            }
            resolve(blob);
        }, type);
    });
}
