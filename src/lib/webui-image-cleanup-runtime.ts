import { ensureAgentStateStoreReady } from './agent-state-runtime';
import { appLogger } from './app-logger';
import { resolveImageOutputDir } from './server-runtime';
import {
    cleanupExpiredWebuiImages,
    readWebuiImageCleanupConfig,
    type WebuiImageCleanupRun
} from './webui-image-cleanup';

const CLEANUP_FAILURE_MESSAGE = 'WebUI 图片自动清理执行失败。';

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

export async function runWebuiImageCleanupNow(
    env: Record<string, string | undefined> = process.env,
    now = new Date()
): Promise<WebuiImageCleanupRun | undefined> {
    const config = readWebuiImageCleanupConfig(env);
    if (!config.enabled) return undefined;
    return await executeCleanup(() => performWebuiImageCleanup(env, config.retentionDays, now), appLogger);
}

export async function startWebuiImageCleanupScheduler(
    options: WebuiImageCleanupSchedulerOptions = {}
): Promise<WebuiImageCleanupSummary> {
    const env = options.env ?? process.env;
    const config = readWebuiImageCleanupConfig(env);
    if (!config.enabled) return getWebuiImageCleanupSummary(env);
    if (timerRegistration) return getWebuiImageCleanupSummary(env);
    if (startPromise) return await startPromise;

    const logger = options.logger ?? appLogger;
    const runCleanup = options.runCleanup ?? (() => performWebuiImageCleanup(env, config.retentionDays, new Date()));
    const registerInterval = options.setInterval ?? defaultSetInterval;
    const clearRegisteredInterval = options.clearInterval ?? defaultClearInterval;

    startPromise = (async () => {
        await executeCleanup(runCleanup, logger);
        try {
            const handle = registerInterval(() => {
                void executeCleanup(runCleanup, logger).catch(() => {});
            }, config.intervalMs);
            handle.unref?.();
            timerRegistration = {
                handle,
                clearInterval: clearRegisteredInterval
            };
        } catch (error) {
            lastError = CLEANUP_FAILURE_MESSAGE;
            logger.error('WebUI 图片自动清理调度启动失败。', error);
            throw error;
        }
        logger.info('WebUI 图片自动清理调度已启动。', {
            retentionDays: config.retentionDays,
            intervalMs: config.intervalMs
        });
        return getWebuiImageCleanupSummary(env);
    })();

    try {
        return await startPromise;
    } finally {
        startPromise = undefined;
    }
}

export function getWebuiImageCleanupSummary(
    env: Record<string, string | undefined> = process.env
): WebuiImageCleanupSummary {
    const config = readWebuiImageCleanupConfig(env);
    const summary: WebuiImageCleanupSummary = {
        enabled: config.enabled,
        retentionDays: config.retentionDays,
        intervalMs: config.intervalMs,
        running
    };
    if (!config.enabled) return summary;
    return {
        ...summary,
        ...(lastRun ? { lastRun } : {}),
        ...(lastError ? { lastError } : {})
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
}

async function performWebuiImageCleanup(
    env: Record<string, string | undefined>,
    retentionDays: number,
    now: Date
): Promise<WebuiImageCleanupRun> {
    const store = await ensureAgentStateStoreReady(env, now);
    const protectedArtifactFilepaths = await store.listArtifactFilepaths();
    return await cleanupExpiredWebuiImages({
        outputDir: resolveImageOutputDir(env),
        retentionDays,
        protectedArtifactFilepaths,
        now
    });
}

async function executeCleanup(
    runCleanup: () => Promise<WebuiImageCleanupRun | undefined>,
    logger: CleanupLogger
): Promise<WebuiImageCleanupRun | undefined> {
    running = true;
    try {
        const result = await runCleanup();
        if (!result) return undefined;
        lastRun = toPublicRun(result);
        lastError = undefined;
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
        lastError = CLEANUP_FAILURE_MESSAGE;
        logger.error(CLEANUP_FAILURE_MESSAGE, error);
        throw error;
    } finally {
        running = false;
    }
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
