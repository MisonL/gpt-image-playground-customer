import { ensureAgentStateStoreReady } from './agent-state-runtime';
import { appLogger } from './app-logger';
import { resolveImageOutputDir } from './server-runtime';
import {
    getWebuiImageRetentionStore,
    resolveWebuiImageRetentionDatabasePath,
    WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE
} from './webui-image-retention-store';
import {
    cleanupExpiredWebuiImages,
    readWebuiImageCleanupConfig,
    type WebuiImageCleanupRun
} from './webui-image-cleanup';
import path from 'node:path';

type CleanupLogger = {
    info(message: string, context?: unknown): void;
    error(message: string, context?: unknown): void;
};

type CleanupTimerHandle = {
    unref?(): void;
};

export type WebuiImageCleanupSchedulerOptions = {
    env?: Record<string, string | undefined>;
    runCleanup?: () => Promise<WebuiImageCleanupRun | undefined>;
    setInterval?: (callback: () => void, intervalMs: number) => CleanupTimerHandle;
    clearInterval?: (handle: CleanupTimerHandle) => void;
    logger?: CleanupLogger;
};

export type PublicWebuiImageCleanupRun = Omit<WebuiImageCleanupRun, 'failures'>;

export type WebuiImageCleanupSummary = {
    enabled: boolean;
    retentionDays: number;
    intervalMs: number;
    running: boolean;
    lastRun?: PublicWebuiImageCleanupRun;
    lastError?: string;
};

type TimerRegistration = {
    handle: CleanupTimerHandle;
    clearInterval: (handle: CleanupTimerHandle) => void;
};

let timerRegistration: TimerRegistration | undefined;
let startPromise: Promise<WebuiImageCleanupSummary> | undefined;
let running = false;
let lastRun: PublicWebuiImageCleanupRun | undefined;
let lastError: string | undefined;
let runtimeStatusDatabasePath: string | undefined;

export async function runWebuiImageCleanupNow(
    env: Record<string, string | undefined> = process.env,
    now = new Date()
): Promise<WebuiImageCleanupRun | undefined> {
    const config = readWebuiImageCleanupConfig(env);
    if (!config.enabled) return undefined;
    return await executeCleanup(() => performWebuiImageCleanup(env, config.retentionDays, now), appLogger, env);
}

export async function startWebuiImageCleanupScheduler(
    options: WebuiImageCleanupSchedulerOptions = {}
): Promise<WebuiImageCleanupSummary> {
    const env = options.env ?? process.env;
    const config = readWebuiImageCleanupConfig(env);
    if (!config.enabled) return await getWebuiImageCleanupSummary(env);
    if (timerRegistration) return await getWebuiImageCleanupSummary(env);
    if (startPromise) return await startPromise;

    const logger = options.logger ?? appLogger;
    const runCleanup = options.runCleanup ?? (() => performWebuiImageCleanup(env, config.retentionDays, new Date()));
    const registerInterval = options.setInterval ?? defaultSetInterval;
    const clearRegisteredInterval = options.clearInterval ?? defaultClearInterval;

    startPromise = (async () => {
        await executeCleanup(runCleanup, logger, env);
        try {
            const handle = registerInterval(() => {
                void executeCleanup(runCleanup, logger, env).catch(() => {});
            }, config.intervalMs);
            handle.unref?.();
            timerRegistration = {
                handle,
                clearInterval: clearRegisteredInterval
            };
        } catch (error) {
            logger.error('WebUI 图片自动清理调度启动失败。', error);
            await persistCleanupFailure(env, logger);
            throw error;
        }
        logger.info('WebUI 图片自动清理调度已启动。', {
            retentionDays: config.retentionDays,
            intervalMs: config.intervalMs
        });
        return await getWebuiImageCleanupSummary(env);
    })();

    try {
        return await startPromise;
    } finally {
        startPromise = undefined;
    }
}

export async function getWebuiImageCleanupSummary(
    env: Record<string, string | undefined> = process.env
): Promise<WebuiImageCleanupSummary> {
    const config = readWebuiImageCleanupConfig(env);
    const summary: WebuiImageCleanupSummary = {
        enabled: config.enabled,
        retentionDays: config.retentionDays,
        intervalMs: config.intervalMs,
        running
    };
    if (!config.enabled) return summary;
    const databasePath = resolveWebuiImageRetentionDatabasePath(env);
    const persistedStatus = await (await getWebuiImageRetentionStore(env)).readCleanupStatus();
    const runtimeStatus = runtimeStatusDatabasePath === databasePath ? { lastRun, lastError } : {};
    const summaryLastRun = runtimeStatus.lastRun ?? persistedStatus.lastRun;
    const summaryLastError = runtimeStatus.lastError ?? persistedStatus.lastError;
    return {
        ...summary,
        ...(summaryLastRun ? { lastRun: summaryLastRun } : {}),
        ...(summaryLastError ? { lastError: summaryLastError } : {})
    };
}

export function resetWebuiImageCleanupRuntimeForTests(): void {
    if (timerRegistration) {
        timerRegistration.clearInterval(timerRegistration.handle);
    }
    timerRegistration = undefined;
    startPromise = undefined;
    running = false;
    lastRun = undefined;
    lastError = undefined;
    runtimeStatusDatabasePath = undefined;
}

async function performWebuiImageCleanup(
    env: Record<string, string | undefined>,
    retentionDays: number,
    now: Date
): Promise<WebuiImageCleanupRun> {
    const outputDir = resolveImageOutputDir(env);
    const [agentStore, retentionStore] = await Promise.all([
        ensureAgentStateStoreReady(env, now),
        getWebuiImageRetentionStore(env)
    ]);
    const [agentArtifactFilepaths, permanentFilenames] = await Promise.all([
        agentStore.listArtifactFilepaths(),
        retentionStore.listPermanentFilenames()
    ]);
    const permanentFilepaths = permanentFilenames.map((filename) => path.join(outputDir, filename));
    return await cleanupExpiredWebuiImages({
        outputDir,
        retentionDays,
        protectedArtifactFilepaths: [...agentArtifactFilepaths, ...permanentFilepaths],
        now
    });
}

async function executeCleanup(
    runCleanup: () => Promise<WebuiImageCleanupRun | undefined>,
    logger: CleanupLogger,
    env: Record<string, string | undefined>
): Promise<WebuiImageCleanupRun | undefined> {
    const databasePath = resolveWebuiImageRetentionDatabasePath(env);
    running = true;
    try {
        const result = await runCleanup();
        if (!result) return undefined;
        const publicRun = toPublicRun(result);
        await (await getWebuiImageRetentionStore(env)).writeCleanupStatus({ lastRun: publicRun });
        setRuntimeStatus(databasePath, { lastRun: publicRun });
        if (result.status === 'failed') {
            logger.error('WebUI 图片自动清理存在文件删除失败。', {
                scannedCount: result.scannedCount,
                deletedCount: result.deletedCount,
                failedCount: result.failedCount
            });
        } else {
            logger.info('WebUI 图片自动清理完成。', {
                scannedCount: result.scannedCount,
                protectedCount: result.protectedCount,
                deletedCount: result.deletedCount
            });
        }
        return result;
    } catch (error) {
        logger.error(WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE, error);
        await persistCleanupFailure(env, logger);
        throw error;
    } finally {
        running = false;
    }
}

async function persistCleanupFailure(
    env: Record<string, string | undefined>,
    logger: CleanupLogger
): Promise<void> {
    const databasePath = resolveWebuiImageRetentionDatabasePath(env);
    const currentRun = runtimeStatusDatabasePath === databasePath ? lastRun : undefined;
    setRuntimeStatus(databasePath, {
        ...(currentRun ? { lastRun: currentRun } : {}),
        lastError: WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE
    });
    try {
        const store = await getWebuiImageRetentionStore(env);
        const persistedStatus = await store.readCleanupStatus();
        await store.writeCleanupStatus({
            lastRun: currentRun ?? persistedStatus.lastRun,
            lastError: WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE
        });
    } catch (error) {
        logger.error(WEBUI_IMAGE_CLEANUP_FAILURE_MESSAGE, error);
        throw error;
    }
}

function setRuntimeStatus(
    databasePath: string,
    status: Pick<WebuiImageCleanupSummary, 'lastRun' | 'lastError'>
): void {
    runtimeStatusDatabasePath = databasePath;
    lastRun = status.lastRun;
    lastError = status.lastError;
}

function toPublicRun(result: WebuiImageCleanupRun): PublicWebuiImageCleanupRun {
    return {
        status: result.status,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        cutoffAt: result.cutoffAt,
        scannedCount: result.scannedCount,
        protectedCount: result.protectedCount,
        deletedCount: result.deletedCount,
        failedCount: result.failedCount
    };
}

function defaultSetInterval(callback: () => void, intervalMs: number): CleanupTimerHandle {
    return globalThis.setInterval(callback, intervalMs);
}

function defaultClearInterval(handle: CleanupTimerHandle): void {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
}
