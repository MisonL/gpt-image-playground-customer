import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

let originalEnv: NodeJS.ProcessEnv;

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

beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.npm_lifecycle_event = 'test';
    delete process.env.ENABLE_RESPONSES_IMAGE_BACKEND;
    delete process.env.OPENAI_RESPONSES_API_MODEL;
    delete process.env.IMAGE_STREAMING_STRATEGY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.OPENAI_CHANNEL_1_ID;
    delete process.env.OPENAI_CHANNEL_1_API_KEYS;
    delete process.env.OPENAI_CHANNEL_1_BASE_URL;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_INTERVAL_MS;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_TIMEOUT_MS;
    delete process.env.OPENAI_CHANNEL_RECOVERY_PROBE_MAX_PER_TICK;
    delete process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY;
    delete process.env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS;
});

afterEach(async () => {
    const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
    resetServerChannelStateForTests();
    restoreProcessEnv(originalEnv);
});

describe('GET /api/runtime-capabilities', { concurrency: false }, () => {
    it('exposes streaming batch capability by default without the removed env gate', async () => {
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as Record<string, { enabled: boolean; recommendedConcurrency?: number }>;

        assert.equal(body.streamingBatch.enabled, true);
        assert.equal(typeof body.streamingBatch.recommendedConcurrency, 'number');
    });

    it('exposes the runtime default streaming strategy for client-side fanout decisions', async () => {
        process.env.IMAGE_STREAMING_STRATEGY = 'off';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as Record<string, { defaultMode?: string; defaultStrategy?: string }>;

        assert.equal(body.streaming.defaultMode, 'non_stream');
        assert.equal(body.streaming.defaultStrategy, 'off');
    });

    it('exposes recovery probe settings without API keys', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'official';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-secret';
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_INTERVAL_MS = '120000';
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_TIMEOUT_MS = '3000';
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_MAX_PER_TICK = '1';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            channelRecovery: {
                requireProbeForRecovery: boolean;
                pendingProbeCredentialCount: number;
                pendingProbeChannelCount: number;
                probe: {
                    enabled: boolean;
                    intervalMs: number;
                    timeoutMs: number;
                    maxPerTick: number;
                    running: boolean;
                };
            };
        };

        assert.deepEqual(body.channelRecovery, {
            requireProbeForRecovery: true,
            pendingProbeCredentialCount: 0,
            pendingProbeChannelCount: 0,
            probe: {
                enabled: true,
                intervalMs: 120000,
                timeoutMs: 3000,
                maxPerTick: 1,
                running: false,
                pendingProbeCount: 0,
                dueCandidateCount: 0,
                estimatedMinimumDrainTickCount: 0,
                estimatedMinimumDrainMs: 0,
                lastCheckedCount: 0,
                lastRecoveredCount: 0,
                lastFailedCount: 0
            }
        });
        assert.equal(JSON.stringify(body).includes('sk-secret'), false);
    });

    it('rejects requiring recovery probes when the prober is disabled', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'official';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-secret';
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
        process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'true';
        const { GET } = await import('./route');

        const response = await GET();
        const body = (await response.json()) as { error?: string };

        assert.equal(response.status, 500);
        assert.match(body.error || '', /OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY/);
        assert.equal(JSON.stringify(body).includes('sk-secret'), false);
    });

    it('exposes the experimental Responses image backend when the backend flag is enabled', async () => {
        const { GET } = await import('./route');

        const disabled = (await (await GET()).json()) as Record<
            string,
            {
                enabled: boolean;
                mode?: string;
                requiredEnv?: string[];
                optionalEnv?: string[];
                hasDefaultModel?: boolean;
                missingEnv?: string[];
            }
        >;
        assert.equal(disabled.responsesImageBackend.enabled, false);
        assert.equal(disabled.responsesImageBackend.mode, 'experimental');
        assert.deepEqual(disabled.responsesImageBackend.requiredEnv, ['ENABLE_RESPONSES_IMAGE_BACKEND']);
        assert.deepEqual(disabled.responsesImageBackend.optionalEnv, ['OPENAI_RESPONSES_API_MODEL']);
        assert.equal(disabled.responsesImageBackend.hasDefaultModel, false);
        assert.deepEqual(disabled.responsesImageBackend.missingEnv, ['ENABLE_RESPONSES_IMAGE_BACKEND']);

        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        const requestModelAllowed = (await (await GET()).json()) as Record<
            string,
            { enabled: boolean; mode?: string; hasDefaultModel?: boolean; missingEnv?: string[] }
        >;
        assert.equal(requestModelAllowed.responsesImageBackend.enabled, true);
        assert.equal(requestModelAllowed.responsesImageBackend.hasDefaultModel, false);
        assert.deepEqual(requestModelAllowed.responsesImageBackend.missingEnv, []);

        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const enabled = (await (await GET()).json()) as Record<
            string,
            { enabled: boolean; mode?: string; hasDefaultModel?: boolean; missingEnv?: string[] }
        >;
        assert.equal(enabled.responsesImageBackend.enabled, true);
        assert.equal(enabled.responsesImageBackend.mode, 'experimental');
        assert.equal(enabled.responsesImageBackend.hasDefaultModel, true);
        assert.deepEqual(enabled.responsesImageBackend.missingEnv, []);
    });
});
