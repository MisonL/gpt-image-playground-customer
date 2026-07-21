import { clearAppLogEntriesForTest } from '@/lib/app-logger';
import { afterEach, beforeEach } from 'node:test';

export function registerRouteTestLifecycle() {
    let originalEnv: NodeJS.ProcessEnv;
    const originalConsoleError = console.error;

    beforeEach(() => {
        originalEnv = { ...process.env };
        console.error = () => {};
        for (const key of Object.keys(process.env)) {
            if (/^OPENAI_CHANNEL_\d+_/.test(key)) {
                delete process.env[key];
            }
        }
        delete process.env.APP_PASSWORD;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_BASE_URL;
        delete process.env.OPENAI_CHANNEL_1_ID;
        delete process.env.OPENAI_CHANNEL_1_API_KEYS;
        delete process.env.OPENAI_CHANNEL_1_BASE_URL;
        delete process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE;
        delete process.env.OPENAI_CHANNEL_1_REQUEST_MODES;
        delete process.env.OPENAI_CHANNEL_1_REQUEST_MODE_PRIORITY;
        delete process.env.OPENAI_CHANNEL_1_MATSCA_APP_ID;
        delete process.env.OPENAI_CHANNEL_1_MATSCA_APP_SECRET;
        delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED;
        delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_INTERVAL_MS;
        delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_TIMEOUT_MS;
        delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_MAX_PER_TICK;
        delete process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY;
        delete process.env.OPENAI_CHANNEL_QUEUE_ENABLED;
        delete process.env.OPENAI_CHANNEL_QUEUE_MAX_WAIT_MS;
        delete process.env.OPENAI_CHANNEL_QUEUE_MAX_SIZE;
        delete process.env.OPENAI_MAX_STREAMS_PER_CREDENTIAL;
        delete process.env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS;
        delete process.env.ENABLE_RESPONSES_IMAGE_BACKEND;
        delete process.env.IMAGE_GENERATION_BACKEND;
        delete process.env.OPENAI_RESPONSES_API_MODEL;
        delete process.env.IMAGE_STREAMING_STRATEGY;
        process.env.APP_LOG_LEVEL = 'warn';
        process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE = 'indexeddb';
        clearAppLogEntriesForTest();
    });

    afterEach(async () => {
        const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
        resetServerChannelStateForTests();
        clearAppLogEntriesForTest();
        restoreProcessEnv(originalEnv);
        console.error = originalConsoleError;
    });
}

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv) {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) {
            delete process.env[key];
        }
    }

    for (const [key, value] of Object.entries(snapshot)) {
        process.env[key] = value;
    }
}
