import { isValidImageFilename } from './image-request-utils';
import { readPositiveIntegerFromEnv } from './positive-integer-config.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const ENABLED_ENV = 'WEBUI_IMAGE_AUTO_CLEANUP_ENABLED';
const RETENTION_DAYS_ENV = 'WEBUI_IMAGE_RETENTION_DAYS';
const DAY_MS = 24 * 60 * 60 * 1000;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export const WEBUI_IMAGE_DEFAULT_RETENTION_DAYS = 30;
export const WEBUI_IMAGE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type WebuiImageCleanupConfig = {
    enabled: boolean;
    retentionDays: number;
    intervalMs: number;
};

type CleanupDirEntry = {
    name: string;
};

type CleanupFileStats = {
    mtimeMs: number;
    isFile(): boolean;
    isSymbolicLink(): boolean;
};

export type WebuiImageCleanupFileOperations = {
    mkdir(directory: string): Promise<void>;
    readdir(directory: string): Promise<CleanupDirEntry[]>;
    lstat(filepath: string): Promise<CleanupFileStats>;
    realpath(filepath: string): Promise<string>;
    unlink(filepath: string): Promise<void>;
};

export type WebuiImageCleanupFilenameLock = <T>(filename: string, operation: () => Promise<T>) => Promise<T>;

export type WebuiImageCleanupRun = {
    status: 'succeeded' | 'failed';
    startedAt: string;
    completedAt: string;
    cutoffAt: string;
    scannedCount: number;
    protectedCount: number;
    deletedCount: number;
    failedCount: number;
    failures: Array<{ filename: string; message: string }>;
};

type CleanupInput = {
    outputDir: string;
    retentionDays: number;
    protectedArtifactFilepaths: readonly string[];
    now?: Date;
    fileOperations?: Partial<WebuiImageCleanupFileOperations>;
    isFilenameProtected?: (filename: string) => Promise<boolean>;
    withFilenameLock?: WebuiImageCleanupFilenameLock;
};

const defaultFileOperations: WebuiImageCleanupFileOperations = {
    async mkdir(directory) {
        await fs.mkdir(directory, { recursive: true });
    },
    async readdir(directory) {
        return await fs.readdir(directory, { withFileTypes: true });
    },
    async lstat(filepath) {
        return await fs.lstat(filepath);
    },
    async realpath(filepath) {
        return await fs.realpath(filepath);
    },
    async unlink(filepath) {
        await fs.unlink(filepath);
    }
};

export function readWebuiImageCleanupConfig(
    env: Record<string, string | undefined> = process.env
): WebuiImageCleanupConfig {
    const enabled = readStrictBoolean(env[ENABLED_ENV], ENABLED_ENV);
    const retentionDays = enabled
        ? readPositiveIntegerFromEnv(env, RETENTION_DAYS_ENV, WEBUI_IMAGE_DEFAULT_RETENTION_DAYS)
        : WEBUI_IMAGE_DEFAULT_RETENTION_DAYS;
    return {
        enabled,
        retentionDays,
        intervalMs: WEBUI_IMAGE_CLEANUP_INTERVAL_MS
    };
}

export async function cleanupExpiredWebuiImages(input: CleanupInput): Promise<WebuiImageCleanupRun> {
    assertRetentionDays(input.retentionDays);
    const now = input.now ?? new Date();
    const cutoff = new Date(now.getTime() - input.retentionDays * DAY_MS);
    if (!Number.isFinite(cutoff.getTime())) {
        throw new Error(RETENTION_DAYS_ENV + ' 超出支持范围。');
    }

    const operations = {
        ...defaultFileOperations,
        ...input.fileOperations
    };
    const outputDir = path.resolve(input.outputDir);
    const failures: Array<{ filename: string; message: string }> = [];
    let scannedCount = 0;
    let protectedCount = 0;
    let deletedCount = 0;

    await operations.mkdir(outputDir);
    const canonicalOutputDir = path.resolve(await operations.realpath(outputDir));
    const protectedPaths = new Set(
        await Promise.all(
            input.protectedArtifactFilepaths.map((filepath) => canonicalizeProtectedPath(filepath, operations.realpath))
        )
    );
    const entries = (await operations.readdir(canonicalOutputDir)).sort((left, right) =>
        left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
        if (!isValidImageFilename(entry.name)) continue;
        const filepath = path.resolve(canonicalOutputDir, entry.name);
        if (path.dirname(filepath) !== canonicalOutputDir) continue;

        let stats: CleanupFileStats;
        try {
            stats = await operations.lstat(filepath);
        } catch (error) {
            failures.push({ filename: entry.name, message: readErrorMessage(error) });
            continue;
        }
        if (!stats.isFile() || stats.isSymbolicLink()) continue;

        scannedCount += 1;
        if (protectedPaths.has(filepath)) {
            protectedCount += 1;
            continue;
        }
        if (stats.mtimeMs >= cutoff.getTime()) continue;

        const deleteCandidate = async (): Promise<'deleted' | 'protected'> => {
            if (input.isFilenameProtected && (await input.isFilenameProtected(entry.name))) {
                return 'protected';
            }
            await operations.unlink(filepath);
            return 'deleted';
        };

        try {
            const outcome = input.withFilenameLock
                ? await input.withFilenameLock(entry.name, deleteCandidate)
                : await deleteCandidate();
            if (outcome === 'protected') {
                protectedCount += 1;
            } else {
                deletedCount += 1;
            }
        } catch (error) {
            failures.push({ filename: entry.name, message: readErrorMessage(error) });
        }
    }

    return {
        status: failures.length > 0 ? 'failed' : 'succeeded',
        startedAt: now.toISOString(),
        completedAt: (input.now ?? new Date()).toISOString(),
        cutoffAt: cutoff.toISOString(),
        scannedCount,
        protectedCount,
        deletedCount,
        failedCount: failures.length,
        failures
    };
}

async function canonicalizeProtectedPath(
    filepath: string,
    resolveRealPath: WebuiImageCleanupFileOperations['realpath']
): Promise<string> {
    const resolvedPath = path.resolve(filepath);
    try {
        return path.resolve(await resolveRealPath(resolvedPath));
    } catch (error) {
        if (isMissingPathError(error)) return resolvedPath;
        throw error;
    }
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function readStrictBoolean(value: string | undefined, fieldName: string): boolean {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return false;
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    throw new Error(fieldName + ' 必须是 true 或 false。');
}

function assertRetentionDays(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(RETENTION_DAYS_ENV + ' 必须是正整数。');
    }
}

function readErrorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : '未知文件系统错误。';
}
