import crypto from 'crypto';
import path from 'path';
import type { ValidOutputFormat } from './image-request-utils';

export type FilenameClock = () => number;

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export const outputDir = path.resolve(process.cwd(), 'generated-images');

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

export function verifyPasswordHash(clientPasswordHash: string, serverPassword: string): boolean {
    if (!SHA256_HEX_PATTERN.test(clientPasswordHash)) {
        return false;
    }
    const serverPasswordHash = sha256(serverPassword);
    const clientBuffer = Buffer.from(clientPasswordHash, 'hex');
    const serverBuffer = Buffer.from(serverPasswordHash, 'hex');
    return clientBuffer.length === serverBuffer.length && crypto.timingSafeEqual(clientBuffer, serverBuffer);
}

export function createBatchId(): string {
    return crypto.randomBytes(8).toString('hex');
}

export function createImageFilename(
    batchId: string,
    index: number,
    extension: ValidOutputFormat,
    clock: FilenameClock = Date.now
): string {
    return `${clock()}-${batchId}-${index}.${extension}`;
}

export function readAffinityKey(headers: Headers): string {
    return (
        headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        headers.get('x-real-ip')?.trim() ||
        headers.get('user-agent')?.trim() ||
        'default'
    );
}
