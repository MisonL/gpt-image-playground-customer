import type { ValidOutputFormat } from './image-request-utils';
import { CHINESE_POSITIVE_INTEGER_MESSAGES, readPositiveIntegerFromEnv } from './positive-integer-config.mjs';
import crypto from 'crypto';
import path from 'path';

export type FilenameClock = () => number;

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const ACCESS_TOKEN_PATTERN = /^v1\.(\d{13})\.([a-f0-9]{64})$/i;
const DEFAULT_OUTPUT_DIR = ['generated', 'images'].join('-');
const SAFE_OUTPUT_DIR_PATTERN = /^[a-zA-Z0-9._/-]+$/;
const ONE_DAY_SECONDS = 24 * 60 * 60;
const ONE_DAY_MS = ONE_DAY_SECONDS * 1000;
const ACCESS_TOKEN_CLOCK_SKEW_MS = 60 * 1000;

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

function signAccessToken(serverPassword: string, issuedAtMs: number): string {
    return crypto.createHmac('sha256', serverPassword).update(`gpt-image-access:${issuedAtMs}`).digest('hex');
}

export function createAccessToken(serverPassword: string, issuedAtMs = Date.now()): string {
    return `v1.${issuedAtMs}.${signAccessToken(serverPassword, issuedAtMs)}`;
}

export function verifyAccessToken(
    clientAccessToken: string | undefined,
    serverPassword: string | undefined,
    nowMs = Date.now()
): boolean {
    if (!serverPassword) {
        return true;
    }
    if (!clientAccessToken) {
        return false;
    }

    const match = ACCESS_TOKEN_PATTERN.exec(clientAccessToken);
    if (!match) return false;
    const issuedAtMs = Number(match[1]);
    if (!Number.isSafeInteger(issuedAtMs)) return false;
    if (issuedAtMs > nowMs + ACCESS_TOKEN_CLOCK_SKEW_MS) return false;
    if (nowMs - issuedAtMs > ONE_DAY_MS) return false;

    const expectedSignature = signAccessToken(serverPassword, issuedAtMs);
    const clientBuffer = Buffer.from(match[2], 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    return clientBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(clientBuffer, expectedBuffer);
}

export function isHttpsRequest(headers: Headers): boolean {
    const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    const forwardedSsl = headers.get('x-forwarded-ssl')?.trim().toLowerCase();
    const forwardedScheme = headers.get('x-forwarded-scheme')?.split(',')[0]?.trim().toLowerCase();

    return forwardedProto === 'https' || forwardedScheme === 'https' || forwardedSsl === 'on';
}

export function buildAccessCookieOptions(headers?: Headers) {
    return {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: headers ? isHttpsRequest(headers) : false,
        path: '/',
        maxAge: ONE_DAY_SECONDS
    };
}

export function buildAccessCookie(serverPassword: string, headers?: Headers) {
    return {
        name: 'gptImageAccess',
        value: createAccessToken(serverPassword),
        options: buildAccessCookieOptions(headers)
    };
}

export function serializeAccessCookie(cookie: ReturnType<typeof buildAccessCookie>): string {
    return [
        `${cookie.name}=${cookie.value}`,
        `Path=${cookie.options.path}`,
        `Max-Age=${cookie.options.maxAge}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(cookie.options.secure ? ['Secure'] : [])
    ].join('; ');
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
    return readPositiveIntegerFromEnv(env, fieldName, fallback, {
        messages: CHINESE_POSITIVE_INTEGER_MESSAGES
    });
}
