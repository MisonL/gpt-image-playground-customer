import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deleteFileIfExists, writeFileAtomic } from './agent-file-utils';
import { ensureAgentStateStoreReady } from './agent-state-runtime';

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

export type ImageShareStateStore = {
    createImageShareRecord(record: ImageShareRecord): Promise<void>;
    readImageShareRecord(token: string): Promise<ImageShareRecord | undefined>;
    deleteExpiredImageShareRecords(nowIso: string): Promise<ImageShareRecord[]>;
    listImageShareRecords(): Promise<ImageShareRecord[]>;
};

function shareDir(): string {
    return path.join(/* turbopackIgnore: true */ process.cwd(), 'generated-images', '.shares');
}

function shareContentPath(contentFilename: string): string {
    return path.join(shareDir(), contentFilename);
}

function isShareToken(value: string): boolean {
    return /^[a-f0-9]{24}$/i.test(value);
}

function shareContentFilename(token: string, sourceFilename: string, mimeType: string): string {
    const ext = path.extname(sourceFilename);
    if (ext) return `${token}${ext}`;
    const mimeExtension = mimeTypeToExtension(mimeType);
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

function isExpired(expiresAt: string | undefined, now: Date): boolean {
    if (!expiresAt) return false;
    const expiresAtMs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) return true;
    return now.getTime() >= expiresAtMs;
}

function assertShareContentPathAllowed(contentFilename: string): string {
    const resolvedShareDir = path.resolve(shareDir());
    const resolvedContentPath = path.resolve(shareContentPath(contentFilename));
    if (resolvedContentPath === resolvedShareDir || resolvedContentPath.startsWith(`${resolvedShareDir}${path.sep}`)) {
        return resolvedContentPath;
    }
    throw new Error('分享内容文件路径位于分享目录之外。');
}

export async function createImageShare(input: CreateImageShareInput): Promise<ImageShareRecord> {
    await fs.mkdir(shareDir(), { recursive: true });
    const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString('hex');
    const contentFilename = shareContentFilename(token, input.sourceFilename, input.mimeType);
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

    const contentPath = shareContentPath(contentFilename);
    await writeFileAtomic(contentPath, input.imageBuffer);
    try {
        await getImageShareStore().then((store) => store.createImageShareRecord(record));
    } catch (error) {
        await deleteFileIfExists(contentPath).catch(() => {});
        throw error;
    }

    return record;
}

export async function readImageShare(token: string): Promise<ImageShareRecord | undefined> {
    if (!isShareToken(token)) return undefined;
    return getImageShareStore().then((store) => store.readImageShareRecord(token));
}

export async function readImageShareContent(record: ImageShareRecord): Promise<ImageShareContent> {
    const buffer = await fs.readFile(assertShareContentPathAllowed(record.contentFilename));
    return { buffer, mimeType: record.mimeType };
}

export async function purgeExpiredImageShares(now = new Date()): Promise<number> {
    return purgeExpiredImageSharesForStore(await getImageShareStore(), now);
}

export async function purgeExpiredImageSharesForStore(
    store: unknown,
    now = new Date(),
    options: { purgeOrphanFiles?: boolean } = {}
): Promise<number> {
    if (!isImageShareCleanupStore(store)) return 0;
    await fs.mkdir(shareDir(), { recursive: true });
    const expiredRecords = await store.deleteExpiredImageShareRecords(now.toISOString());
    await Promise.allSettled(expiredRecords.map((record) => deleteFileIfExists(assertShareContentPathAllowed(record.contentFilename))));
    if (options.purgeOrphanFiles ?? true) {
        await purgeOrphanedShareFiles(await store.listImageShareRecords());
    }
    return expiredRecords.length;
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

async function getImageShareStore(): Promise<ImageShareStateStore> {
    const store = await ensureAgentStateStoreReady();
    if (isImageShareStateStore(store)) {
        return store;
    }
    throw new Error('当前状态后端不支持图片分享元数据。');
}

function isImageShareStateStore(value: unknown): value is ImageShareStateStore {
    return (
        typeof value === 'object' &&
        value !== null &&
        'createImageShareRecord' in value &&
        'readImageShareRecord' in value &&
        'deleteExpiredImageShareRecords' in value &&
        'listImageShareRecords' in value &&
        typeof value.createImageShareRecord === 'function' &&
        typeof value.readImageShareRecord === 'function' &&
        typeof value.deleteExpiredImageShareRecords === 'function' &&
        typeof value.listImageShareRecords === 'function'
    );
}

function isImageShareCleanupStore(
    value: unknown
): value is Pick<ImageShareStateStore, 'deleteExpiredImageShareRecords' | 'listImageShareRecords'> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'deleteExpiredImageShareRecords' in value &&
        'listImageShareRecords' in value &&
        typeof value.deleteExpiredImageShareRecords === 'function' &&
        typeof value.listImageShareRecords === 'function'
    );
}

async function purgeOrphanedShareFiles(records: ImageShareRecord[]): Promise<void> {
    const activeFilenames = new Set(records.map((record) => record.contentFilename));
    const entries = await fs.readdir(shareDir(), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    await Promise.allSettled(
        entries
            .filter((entry) => entry.isFile() && !activeFilenames.has(entry.name))
            .map((entry) => deleteFileIfExists(assertShareContentPathAllowed(entry.name)))
    );
}
