import type { WebuiImageCleanupRun } from './webui-image-cleanup';
import {
    getWebuiImageCleanupSummary,
    resetWebuiImageCleanupRuntimeForTests,
    startWebuiImageCleanupScheduler,
    type WebuiImageCleanupSchedulerOptions
} from './webui-image-cleanup-runtime';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

afterEach(() => {
    resetWebuiImageCleanupRuntimeForTests();
});

describe('webui image cleanup runtime', () => {
    it('does not run or register a timer while cleanup is disabled', async () => {
        let cleanupCalls = 0;
        let intervalCalls = 0;
        const options = createSchedulerOptions({
            env: {},
            runCleanup: async () => {
                cleanupCalls += 1;
                return createCleanupRun();
            },
            setInterval: () => {
                intervalCalls += 1;
                return createTimerHandle();
            }
        });

        const summary = await startWebuiImageCleanupScheduler(options);

        assert.deepEqual(summary, {
            enabled: false,
            retentionDays: 30,
            intervalMs: 21_600_000,
            running: false
        });
        assert.equal(cleanupCalls, 0);
        assert.equal(intervalCalls, 0);
    });

    it('runs immediately and registers one unreferenced six hour timer', async () => {
        let cleanupCalls = 0;
        let intervalCalls = 0;
        let unrefCalls = 0;
        let registeredIntervalMs = 0;
        const options = createSchedulerOptions({
            env: {
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true'
            },
            runCleanup: async () => {
                cleanupCalls += 1;
                return createCleanupRun();
            },
            setInterval: (_callback, intervalMs) => {
                intervalCalls += 1;
                registeredIntervalMs = intervalMs;
                return createTimerHandle(() => {
                    unrefCalls += 1;
                });
            }
        });

        const first = await startWebuiImageCleanupScheduler(options);
        const second = await startWebuiImageCleanupScheduler(options);

        assert.equal(cleanupCalls, 1);
        assert.equal(intervalCalls, 1);
        assert.equal(unrefCalls, 1);
        assert.equal(registeredIntervalMs, 21_600_000);
        assert.deepEqual(first, second);
        assert.deepEqual(first.lastRun, {
            status: 'succeeded',
            startedAt: '2026-07-16T00:00:00.000Z',
            completedAt: '2026-07-16T00:00:01.000Z',
            cutoffAt: '2026-06-16T00:00:00.000Z',
            scannedCount: 4,
            protectedCount: 1,
            deletedCount: 2,
            failedCount: 0
        });
    });

    it('runs scheduled cleanup and logs failed file deletions', async () => {
        let scheduledCallback: (() => void) | undefined;
        const errorLogs: Array<{ message: string; context?: unknown }> = [];
        let cleanupCalls = 0;
        const options = createSchedulerOptions({
            env: {
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true'
            },
            runCleanup: async () => {
                cleanupCalls += 1;
                return cleanupCalls === 1
                    ? createCleanupRun()
                    : {
                          ...createCleanupRun(),
                          status: 'failed',
                          failedCount: 1,
                          failures: [{ filename: 'old.png', message: 'permission denied' }]
                      };
            },
            setInterval: (callback) => {
                scheduledCallback = callback;
                return createTimerHandle();
            },
            logger: {
                info() {},
                error(message, context) {
                    errorLogs.push({ message, context });
                }
            }
        });

        await startWebuiImageCleanupScheduler(options);
        assert.ok(scheduledCallback);
        scheduledCallback();
        await waitFor(() => cleanupCalls === 2);

        assert.equal(errorLogs.length, 1);
        assert.match(errorLogs[0].message, /失败/);
        assert.deepEqual(getWebuiImageCleanupSummary(options.env).lastRun?.failedCount, 1);
    });

    it('rethrows startup failures without exposing filesystem paths in the summary', async () => {
        const errorLogs: Array<{ message: string; context?: unknown }> = [];
        const options = createSchedulerOptions({
            env: {
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true'
            },
            runCleanup: async () => {
                throw new Error('state store unavailable at /private/agent.sqlite');
            },
            logger: {
                info() {},
                error(message, context) {
                    errorLogs.push({ message, context });
                }
            }
        });

        await assert.rejects(() => startWebuiImageCleanupScheduler(options), /state store unavailable/);

        assert.equal(errorLogs.length, 1);
        assert.ok(errorLogs[0].context instanceof Error);
        assert.match(errorLogs[0].context.message, /\/private\/agent\.sqlite/);
        assert.deepEqual(getWebuiImageCleanupSummary(options.env), {
            enabled: true,
            retentionDays: 30,
            intervalMs: 21_600_000,
            running: false,
            lastError: 'WebUI 图片自动清理执行失败。'
        });
    });

    it('rejects timer registration failures after the initial cleanup', async () => {
        const errorLogs: Array<{ message: string; context?: unknown }> = [];
        const options = createSchedulerOptions({
            env: {
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true'
            },
            setInterval: () => {
                throw new Error('timer registration failed');
            },
            logger: {
                info() {},
                error(message, context) {
                    errorLogs.push({ message, context });
                }
            }
        });

        await assert.rejects(() => startWebuiImageCleanupScheduler(options), /timer registration failed/);

        assert.equal(errorLogs.at(-1)?.message, 'WebUI 图片自动清理调度启动失败。');
        assert.equal(getWebuiImageCleanupSummary(options.env).lastError, 'WebUI 图片自动清理执行失败。');
    });
});

function createSchedulerOptions(
    overrides: Partial<WebuiImageCleanupSchedulerOptions>
): WebuiImageCleanupSchedulerOptions {
    return {
        env: {},
        runCleanup: async () => createCleanupRun(),
        setInterval: () => createTimerHandle(),
        clearInterval() {},
        logger: {
            info() {},
            error() {}
        },
        ...overrides
    };
}

function createTimerHandle(onUnref: () => void = () => {}): { unref(): void } {
    return {
        unref: onUnref
    };
}

function createCleanupRun(): WebuiImageCleanupRun {
    return {
        status: 'succeeded',
        startedAt: '2026-07-16T00:00:00.000Z',
        completedAt: '2026-07-16T00:00:01.000Z',
        cutoffAt: '2026-06-16T00:00:00.000Z',
        scannedCount: 4,
        protectedCount: 1,
        deletedCount: 2,
        failedCount: 0,
        failures: []
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('condition not met before timeout');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
