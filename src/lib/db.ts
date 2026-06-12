import Dexie, { type EntityTable } from 'dexie';

export interface ImageRecord {
    filename: string;
    blob: Blob;
}

export interface ThumbnailRecord {
    filename: string;
    blob: Blob;
    updatedAt: number;
    width: number;
    height: number;
}

export class ImageDB extends Dexie {
    images!: EntityTable<ImageRecord, 'filename'>;
    thumbnails!: EntityTable<ThumbnailRecord, 'filename'>;

    constructor() {
        super('ImageDB');

        this.version(1).stores({
            images: '&filename'
        });
        this.version(2).stores({
            images: '&filename',
            thumbnails: '&filename, updatedAt'
        });

        this.images = this.table('images');
        this.thumbnails = this.table('thumbnails');
    }
}

export const db = new ImageDB();
