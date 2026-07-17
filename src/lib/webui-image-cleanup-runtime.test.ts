import type { WebuiImageCleanupRun } from './webui-image-cleanup';
import {
    getWebuiImageCleanupSummary,
    resetWebuiImageCleanupRuntimeForTests,
    runWebuiImageCleanupNow,
    startWebuiImageCleanupScheduler,
    type WebuiImageCleanupSchedulerOptions
} from './webui-image-cleanup-runtime';
import { resetAgentStateStoreForTests } from './agent-state-runtime';
import {
    resetWebuiImageRetentionStoresForTests,
    resolveWebuiImageRetentionDatabasePath,
    SqliteWebuiImageRetentionStore
} from './webui-image-retention-store';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const originalCwd = process.cwd();
let testCwd = '';

beforeEach(async () => {
    testCwd = await mkdtemp(path.join(os.tmpdir(), 'webui-image-cleanup-runtime-'));
    process.chdir(testCwd);
});

afterEach(async () => {
    resetAgentStateStoreForTests();
    resetWebuiImageCleanupRuntimeForTests();
    resetWebuiImageRetentionStoresForTests();
    process.chdir(originalCwd);
    await rm(testCwd, { recursive: true, force: true });
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
        await waitFor(() => errorLogs.length === 1);

        assert.equal(errorLogs.length, 1);
        assert.match(errorLogs[0].message, /失败/);
        assert.deepEqual((await getWebuiImageCleanupSummary(options.env)).lastRun?.failedCount, 1);
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
        assert.deepEqual(await getWebuiImageCleanupSummary(options.env), {
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
            runCleanup: async () => createCleanupRun(),
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
        assert.equal((await getWebuiImageCleanupSummary(options.env)).lastError, 'WebUI 图片自动清理执行失败。');

        resetWebuiImageCleanupRuntimeForTests();
        resetWebuiImageRetentionStoresForTests();
        const persistedSummary = await getWebuiImageCleanupSummary(options.env);
        assert.deepEqual(persistedSummary.lastRun, createPublicCleanupRun());
        assert.equal(persistedSummary.lastError, 'WebUI 图片自动清理执行失败。');
    });

    it('reads a persisted cleanup summary after runtime memory is reset', async () => {
        const cwd = await mkdtemp(path.join(os.tmpdir(), 'webui-cleanup-summary-'));
        try {
            process.chdir(cwd);
            const env = {
                WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true'
            };
            const store = new SqliteWebuiImageRetentionStore(resolveWebuiImageRetentionDatabasePath(env));
            await store.init();
            await store.writeCleanupStatus({
                lastRun: createPublicCleanupRun()
            });

            const summary = await getWebuiImageCleanupSummary(env);

            assert.deepEqual(summary.lastRun, createPublicCleanupRun());
        } finally {
            process.chdir(originalCwd);
            await rm(cwd, { recursive: true, force: true });
        }
    });

    it('keeps permanently saved files in the cleanup protection set', async () => {
        const cwd = await mkdtemp(path.join(os.tmpdir(), 'webui-cleanup-permanent-'));
        const now = new Date('2026-07-17T00:00:00.000Z');
        const filename = '1781567999000-aaaaaaaaaaaaaaaa-0.png';
        const env = {
            AGENT_STATE_BACKEND: 'memory',
            WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true'
        };
        try {
            process.chdir(cwd);
            const outputDir = path.join(cwd, 'generated-images');
            const filepath = path.join(outputDir, filename);
            await mkdir(outputDir, { recursive: true });
            await writeFile(filepath, 'image');
            await utimes(filepath, new Date('2026-06-15T00:00:00.000Z'), new Date('2026-06-15T00:00:00.000Z'));

            const store = new SqliteWebuiImageRetentionStore(resolveWebuiImageRetentionDatabasePath(env));
            await store.init();
            await store.preserve([filename]);

            const result = await runWebuiImageCleanupNow(env, now);

            assert.equal(result?.protectedCount, 1);
            await access(filepath);
        } finally {
            process.chdir(originalCwd);
            await rm(cwd, { recursive: true, force: true });
        }
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

function createPublicCleanupRun() {
    const { failures: _failures, ...publicRun } = createCleanupRun();
    return publicRun;
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
