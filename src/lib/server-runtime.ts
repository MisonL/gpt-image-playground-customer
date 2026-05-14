import crypto from 'crypto';
import path from 'path';
import type { ValidOutputFormat } from './image-request-utils';

export type FilenameClock = () => number;

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_OUTPUT_DIR = ['generated', 'images'].join('-');
const SAFE_OUTPUT_DIR_PATTERN = /^[a-zA-Z0-9._/-]+$/;

export function readOutputDirEnv(env: Record<string, string | undefined>, fieldName = 'IMAGE_OUTPUT_DIR'): string {
    const value = env[fieldName]?.trim();
    if (!value) return DEFAULT_OUTPUT_DIR;
    const cwd = path.resolve(/* turbopackIgnore: true */ process.cwd());
    const resolvedValue = path.resolve(/* turbopackIgnore: true */ process.cwd(), value);
    const insideCwd = resolvedValue === cwd || resolvedValue.startsWith(`${cwd}${path.sep}`);
    if (
        value.startsWith('/') ||
        value.startsWith('\\') ||
        path.isAbsolute(value) ||
        value.split(/[\\/]+/).includes('..') ||
        !SAFE_OUTPUT_DIR_PATTERN.test(value) ||
        !insideCwd
    ) {
        throw new Error(`${fieldName} 必须是安全的相对路径，且不能包含路径穿越片段。`);
    }
    return value;
}

export const outputDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), readOutputDirEnv(process.env));

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

export function readBooleanEnv(env: Record<string, string | undefined>, fieldName: string): boolean {
    const value = env[fieldName]?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function readPositiveIntegerEnv(
    env: Record<string, string | undefined>,
    fieldName: string,
    fallback: number
): number {
    const value = env[fieldName];
    if (!value || !/^\d+$/.test(value.trim())) {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        return fallback;
    }
    return parsed;
}
