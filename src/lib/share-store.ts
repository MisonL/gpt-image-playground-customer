import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mimeTypeForOutputFormat, writeFileAtomic } from './agent-file-utils';

const SHARE_TOKEN_BYTES = 12;

export type ImageShareRecord = {
    token: string;
    sourceFilename: string;
    contentFilename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    accessCodeRequired: boolean;
    expiresAt?: string;
    accessCodeSalt?: string;
    accessCodeHash?: string;
};

export type CreateImageShareInput = {
    imageBuffer: Buffer;
    sourceFilename: string;
    mimeType: string;
    accessCode?: string;
    expiresInMinutes: number | null;
    now?: Date;
};

export type ImageShareContent = {
    buffer: Buffer;
    mimeType: string;
};

function shareDir(): string {
    return path.join(/* turbopackIgnore: true */ process.cwd(), 'generated-images', '.shares');
}

function shareMetadataPath(token: string): string {
    return path.join(shareDir(), `${token}.json`);
}

function shareContentPath(contentFilename: string): string {
    return path.join(shareDir(), contentFilename);
}

function isShareToken(value: string): boolean {
    return /^[a-f0-9]{24}$/i.test(value);
}

function shareContentFilename(token: string, sourceFilename: string): string {
    const ext = path.extname(sourceFilename);
    if (ext) return `${token}${ext}`;
    const mimeExtension = mimeTypeToExtension(mimeTypeForOutputFormat(sourceFilename));
    return `${token}${mimeExtension}`;
}

function mimeTypeToExtension(mimeType: string): string {
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/webp') return '.webp';
    return '.png';
}

function normalizeAccessCode(accessCode: string | undefined): string | undefined {
    const normalized = accessCode?.trim();
    return normalized ? normalized : undefined;
}

function hashAccessCode(accessCode: string, salt: string): string {
    return crypto.createHash('sha256').update(`${salt}:${accessCode}`).digest('hex');
}

function readShareFilepath(token: string): string {
    return shareMetadataPath(token);
}

function readShareTokenPath(token: string): string | undefined {
    if (!isShareToken(token)) return undefined;
    return readShareFilepath(token);
}

function isExpired(expiresAt: string | undefined, now: Date): boolean {
    if (!expiresAt) return false;
    return now.getTime() >= new Date(expiresAt).getTime();
}

export async function createImageShare(input: CreateImageShareInput): Promise<ImageShareRecord> {
    await fs.mkdir(shareDir(), { recursive: true });
    const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString('hex');
    const contentFilename = shareContentFilename(token, input.sourceFilename);
    const createdAt = (input.now || new Date()).toISOString();
    const expiresAt =
        typeof input.expiresInMinutes === 'number'
            ? new Date((input.now || new Date()).getTime() + input.expiresInMinutes * 60_000).toISOString()
            : undefined;
    const accessCode = normalizeAccessCode(input.accessCode);
    const accessCodeSalt = accessCode ? crypto.randomBytes(16).toString('hex') : undefined;
    const accessCodeHash = accessCode && accessCodeSalt ? hashAccessCode(accessCode, accessCodeSalt) : undefined;
    const record: ImageShareRecord = {
        token,
        sourceFilename: input.sourceFilename,
        contentFilename,
        mimeType: input.mimeType,
        sizeBytes: input.imageBuffer.byteLength,
        createdAt,
        accessCodeRequired: Boolean(accessCodeHash && accessCodeSalt),
        ...(expiresAt ? { expiresAt } : {}),
        ...(accessCodeSalt ? { accessCodeSalt } : {}),
        ...(accessCodeHash ? { accessCodeHash } : {})
    };

    await writeFileAtomic(shareContentPath(contentFilename), input.imageBuffer);
    await writeFileAtomic(readShareFilepath(token), Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'));

    return record;
}

export async function readImageShare(token: string): Promise<ImageShareRecord | undefined> {
    const metadataPath = readShareTokenPath(token);
    if (!metadataPath) return undefined;
    try {
        const raw = await fs.readFile(metadataPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ImageShareRecord>;
        if (
            typeof parsed.token !== 'string' ||
            parsed.token !== token ||
            typeof parsed.sourceFilename !== 'string' ||
            typeof parsed.contentFilename !== 'string' ||
            typeof parsed.mimeType !== 'string' ||
            typeof parsed.sizeBytes !== 'number' ||
            typeof parsed.createdAt !== 'string'
        ) {
            return undefined;
        }
        return {
            token: parsed.token,
            sourceFilename: parsed.sourceFilename,
            contentFilename: parsed.contentFilename,
            mimeType: parsed.mimeType,
            sizeBytes: parsed.sizeBytes,
            createdAt: parsed.createdAt,
            accessCodeRequired: Boolean(parsed.accessCodeHash && parsed.accessCodeSalt),
            ...(typeof parsed.expiresAt === 'string' ? { expiresAt: parsed.expiresAt } : {}),
            ...(typeof parsed.accessCodeSalt === 'string' ? { accessCodeSalt: parsed.accessCodeSalt } : {}),
            ...(typeof parsed.accessCodeHash === 'string' ? { accessCodeHash: parsed.accessCodeHash } : {})
        };
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        return undefined;
    }
}

export async function readImageShareContent(record: ImageShareRecord): Promise<ImageShareContent> {
    const buffer = await fs.readFile(shareContentPath(record.contentFilename));
    return { buffer, mimeType: record.mimeType };
}

export function verifyImageShareAccess(record: ImageShareRecord, accessCode?: string): boolean {
    const normalizedAccessCode = normalizeAccessCode(accessCode);
    if (!record.accessCodeHash || !record.accessCodeSalt) {
        return true;
    }
    if (!normalizedAccessCode) return false;
    const candidateHash = hashAccessCode(normalizedAccessCode, record.accessCodeSalt);
    const actual = Buffer.from(record.accessCodeHash, 'hex');
    const candidate = Buffer.from(candidateHash, 'hex');
    return actual.length === candidate.length && crypto.timingSafeEqual(actual, candidate);
}

export function isImageShareExpired(record: ImageShareRecord, now = new Date()): boolean {
    return isExpired(record.expiresAt, now);
}

export function getShareMetadataPathForTest(token: string): string {
    return readShareFilepath(token);
}
