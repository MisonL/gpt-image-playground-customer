import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { AgentApiError } from './api-error-response';
import { outputDir } from './server-runtime';

export type ImageDimensions = {
    width: number | null;
    height: number | null;
};

export function mimeTypeForOutputFormat(outputFormat: string): string {
    if (outputFormat === 'jpeg' || outputFormat === 'jpg') return 'image/jpeg';
    if (outputFormat === 'webp') return 'image/webp';
    return 'image/png';
}

export async function writeFileAtomic(filepath: string, buffer: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const tmpPath = `${filepath}.tmp-${crypto.randomUUID()}`;
    try {
        await fs.writeFile(tmpPath, buffer);
        await fs.rename(tmpPath, filepath);
    } catch (error) {
        try {
            await deleteFileIfExists(tmpPath);
        } catch (cleanupError) {
            console.error('清理临时产物文件失败。', cleanupError);
        }
        throw error;
    }
}

export async function deleteFileIfExists(filepath: string): Promise<boolean> {
    try {
        await fs.unlink(filepath);
        return true;
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

export function assertArtifactFilepathAllowed(filepath: string): void {
    if (isArtifactFilepathAllowed(filepath)) return;
    throw new AgentApiError({
        code: 'artifact_not_found',
        message: '产物文件路径位于已配置图片目录之外。',
        status: 404,
        retryable: false
    });
}

export function isArtifactFilepathAllowed(filepath: string): boolean {
    const resolvedFilepath = path.resolve(filepath);
    const resolvedOutputDir = path.resolve(outputDir);
    return resolvedFilepath === resolvedOutputDir || resolvedFilepath.startsWith(`${resolvedOutputDir}${path.sep}`);
}

export async function deleteArtifactFileIfAllowed(filepath: string): Promise<boolean> {
    assertArtifactFilepathAllowed(filepath);
    return deleteFileIfExists(filepath);
}

export function readImageDimensions(buffer: Buffer): ImageDimensions {
    const png = readPngDimensions(buffer);
    if (png.width !== null) return png;
    const jpeg = readJpegDimensions(buffer);
    if (jpeg.width !== null) return jpeg;
    const webp = readWebpDimensions(buffer);
    return webp;
}

function readPngDimensions(buffer: Buffer): ImageDimensions {
    if (
        buffer.length >= 24 &&
        buffer[0] === 0x89 &&
        buffer.toString('ascii', 1, 4) === 'PNG' &&
        buffer.toString('ascii', 12, 16) === 'IHDR'
    ) {
        return {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20)
        };
    }
    return { width: null, height: null };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return { width: null, height: null };
    }
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2) break;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
            return {
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7)
            };
        }
        offset += 2 + length;
    }
    return { width: null, height: null };
}

function readWebpDimensions(buffer: Buffer): ImageDimensions {
    if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        return { width: null, height: null };
    }
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) {
        return {
            width: 1 + buffer.readUIntLE(24, 3),
            height: 1 + buffer.readUIntLE(27, 3)
        };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30) {
        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff
        };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        return {
            width: 1 + (((b1 & 0x3f) << 8) | b0),
            height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
        };
    }
    return { width: null, height: null };
}
