export type ZipFileInput = {
    name: string;
    blob: Blob;
    modifiedAt?: Date;
};

type PreparedZipFile = {
    name: string;
    data: Uint8Array;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    dosTime: number;
    dosDate: number;
    localHeaderOffset: number;
};

const TEXT_ENCODER = new TextEncoder();
const ZIP_VERSION_NEEDED = 20;
const ZIP_VERSION_MADE_BY = 20;
const ZIP_STORED_METHOD = 0;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;

let crcTable: Uint32Array | undefined;

export async function createZipBlob(files: ZipFileInput[]): Promise<Blob> {
    if (files.length === 0) {
        throw new Error('zip export requires at least one file.');
    }

    const prepared: PreparedZipFile[] = [];
    const usedNames = new Set<string>();
    let offset = 0;
    for (const file of files) {
        const data = new Uint8Array(await file.blob.arrayBuffer());
        const name = uniqueZipFilename(sanitizeZipFilename(file.name), usedNames);
        const timestamp = toDosTimestamp(file.modifiedAt || new Date());
        const localHeaderOffset = offset;
        const compressedSize = data.byteLength;
        const uncompressedSize = data.byteLength;
        const nameBytes = TEXT_ENCODER.encode(name);
        offset += 30 + nameBytes.byteLength + compressedSize;
        prepared.push({
            name,
            data,
            crc32: crc32(data),
            compressedSize,
            uncompressedSize,
            dosTime: timestamp.time,
            dosDate: timestamp.date,
            localHeaderOffset
        });
    }

    const centralDirectoryOffset = offset;
    const centralDirectorySize = prepared.reduce(
        (sum, file) => sum + 46 + TEXT_ENCODER.encode(file.name).byteLength,
        0
    );
    const totalSize = centralDirectoryOffset + centralDirectorySize + 22;
    const buffer = new Uint8Array(totalSize);
    let cursor = 0;

    prepared.forEach((file) => {
        cursor = writeLocalFile(buffer, cursor, file);
        buffer.set(file.data, cursor);
        cursor += file.data.byteLength;
    });

    prepared.forEach((file) => {
        cursor = writeCentralDirectory(buffer, cursor, file);
    });

    writeEndRecord(buffer, cursor, {
        fileCount: prepared.length,
        centralDirectorySize,
        centralDirectoryOffset
    });

    return new Blob([buffer], { type: 'application/zip' });
}

function uniqueZipFilename(name: string, usedNames: Set<string>): string {
    if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
    }
    const extensionIndex = name.lastIndexOf('.');
    const hasExtension = extensionIndex > 0;
    const baseName = hasExtension ? name.slice(0, extensionIndex) : name;
    const extension = hasExtension ? name.slice(extensionIndex) : '';
    for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
        const candidate = `${baseName}_${index}${extension}`;
        if (!usedNames.has(candidate)) {
            usedNames.add(candidate);
            return candidate;
        }
    }
    throw new Error('zip export cannot allocate a unique filename.');
}

export function sanitizeZipFilename(name: string): string {
    const normalized = name
        .replace(/\\/g, '/')
        .split('/')
        .filter((part) => part && part !== '..' && part !== '.')
        .join('_')
        .replace(/[^\w.-]+/g, '_')
        .replace(/\.\.+/g, '.')
        .replace(/^_+|_+$/g, '');
    return normalized || 'image';
}

function writeLocalFile(buffer: Uint8Array, offset: number, file: PreparedZipFile): number {
    const view = new DataView(buffer.buffer);
    const nameBytes = TEXT_ENCODER.encode(file.name);
    view.setUint32(offset, ZIP_LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, ZIP_VERSION_NEEDED, true);
    view.setUint16(offset + 6, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 8, ZIP_STORED_METHOD, true);
    view.setUint16(offset + 10, file.dosTime, true);
    view.setUint16(offset + 12, file.dosDate, true);
    view.setUint32(offset + 14, file.crc32, true);
    view.setUint32(offset + 18, file.compressedSize, true);
    view.setUint32(offset + 22, file.uncompressedSize, true);
    view.setUint16(offset + 26, nameBytes.byteLength, true);
    view.setUint16(offset + 28, 0, true);
    buffer.set(nameBytes, offset + 30);
    return offset + 30 + nameBytes.byteLength;
}

function writeCentralDirectory(buffer: Uint8Array, offset: number, file: PreparedZipFile): number {
    const view = new DataView(buffer.buffer);
    const nameBytes = TEXT_ENCODER.encode(file.name);
    view.setUint32(offset, ZIP_CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, ZIP_VERSION_MADE_BY, true);
    view.setUint16(offset + 6, ZIP_VERSION_NEEDED, true);
    view.setUint16(offset + 8, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 10, ZIP_STORED_METHOD, true);
    view.setUint16(offset + 12, file.dosTime, true);
    view.setUint16(offset + 14, file.dosDate, true);
    view.setUint32(offset + 16, file.crc32, true);
    view.setUint32(offset + 20, file.compressedSize, true);
    view.setUint32(offset + 24, file.uncompressedSize, true);
    view.setUint16(offset + 28, nameBytes.byteLength, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, file.localHeaderOffset, true);
    buffer.set(nameBytes, offset + 46);
    return offset + 46 + nameBytes.byteLength;
}

function writeEndRecord(
    buffer: Uint8Array,
    offset: number,
    input: {
        fileCount: number;
        centralDirectorySize: number;
        centralDirectoryOffset: number;
    }
): void {
    const view = new DataView(buffer.buffer);
    view.setUint32(offset, ZIP_END_SIGNATURE, true);
    view.setUint16(offset + 4, 0, true);
    view.setUint16(offset + 6, 0, true);
    view.setUint16(offset + 8, input.fileCount, true);
    view.setUint16(offset + 10, input.fileCount, true);
    view.setUint32(offset + 12, input.centralDirectorySize, true);
    view.setUint32(offset + 16, input.centralDirectoryOffset, true);
    view.setUint16(offset + 20, 0, true);
}

function toDosTimestamp(date: Date): { time: number; date: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

function crc32(data: Uint8Array): number {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable(): Uint32Array {
    if (crcTable) return crcTable;
    const table = new Uint32Array(256);
    for (let index = 0; index < table.length; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    crcTable = table;
    return table;
}
