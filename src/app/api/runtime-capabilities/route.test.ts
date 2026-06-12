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
    delete process.env.IMAGE_UPSTREAM_TIMEOUT_MS;
    delete process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS;
    delete process.env.IMAGE_UPSTREAM_MAX_RETRIES;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.OPENAI_CHANNEL_1_ID;
    delete process.env.OPENAI_CHANNEL_1_API_KEYS;
    delete process.env.OPENAI_CHANNEL_1_BASE_URL;
    delete process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE;
    delete process.env.OPENAI_CHANNEL_1_PROVIDER_MANIFEST;
    delete process.env.OPENAI_CHANNEL_2_ID;
    delete process.env.OPENAI_CHANNEL_2_API_KEYS;
    delete process.env.OPENAI_CHANNEL_2_BASE_URL;
    delete process.env.OPENAI_CHANNEL_2_UPSTREAM_PROFILE;
    delete process.env.OPENAI_CHANNEL_2_PROVIDER_MANIFEST;
    delete process.env.OPENAI_CHANNEL_FAILURE_COOLDOWN_ENABLED;
    delete process.env.OPENAI_CHANNEL_QUEUE_ENABLED;
    delete process.env.OPENAI_CHANNEL_QUEUE_MAX_WAIT_MS;
    delete process.env.OPENAI_CHANNEL_QUEUE_MAX_SIZE;
    delete process.env.OPENAI_MAX_STREAMS_PER_CREDENTIAL;
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
        process.env.IMAGE_UPSTREAM_TIMEOUT_MS = '1200000';
        process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = '600000';
        process.env.IMAGE_UPSTREAM_MAX_RETRIES = '1';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as Record<
            string,
            {
                defaultMode?: string;
                defaultStrategy?: string;
                upstream_timeout_ms?: number;
                stream_data_interval_timeout_ms?: number;
                upstream_max_retries?: number;
            }
        >;

        assert.equal(body.streaming.defaultMode, 'non_stream');
        assert.equal(body.streaming.defaultStrategy, 'off');
        assert.deepEqual(body.imageTransport, {
            upstream_timeout_ms: 1_200_000,
            stream_data_interval_timeout_ms: 600_000,
            upstream_max_retries: 1
        });
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
                failureCooldownEnabled: boolean;
                failureCooldownMs: number;
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
            failureCooldownEnabled: true,
            failureCooldownMs: 30000,
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

    it('exposes when channel failure cooldown is disabled', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'official';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-secret';
        process.env.OPENAI_CHANNEL_FAILURE_COOLDOWN_ENABLED = 'false';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            channelRecovery: {
                failureCooldownEnabled: boolean;
                failureCooldownMs: number;
            };
        };

        assert.equal(body.channelRecovery.failureCooldownEnabled, false);
        assert.equal(body.channelRecovery.failureCooldownMs, 30000);
        assert.equal(JSON.stringify(body).includes('sk-secret'), false);
    });

    it('exposes channel queue settings and state without exposing secrets', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'official';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-secret';
        process.env.OPENAI_MAX_STREAMS_PER_CREDENTIAL = '2';
        process.env.OPENAI_CHANNEL_QUEUE_MAX_WAIT_MS = '12345';
        process.env.OPENAI_CHANNEL_QUEUE_MAX_SIZE = '7';
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
        process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            channelQueue: {
                enabled: boolean;
                capacityPerCredential: number;
                maxWaitMs: number;
                maxSize: number;
                active: number;
                queued: number;
                credentials: Array<Record<string, unknown>>;
            };
        };

        assert.deepEqual(body.channelQueue, {
            enabled: true,
            capacityPerCredential: 2,
            maxWaitMs: 12345,
            maxSize: 7,
            active: 0,
            queued: 0,
            credentials: []
        });
        assert.equal(JSON.stringify(body).includes('sk-secret'), false);
    });

    it('exposes a non-secret upstream profile summary for client-side form constraints', async () => {
        const { GET } = await import('./route');

        const defaultBody = (await (await GET()).json()) as { upstreamProfile: Record<string, unknown> };
        assert.equal(defaultBody.upstreamProfile.activeProfile, 'openai-compatible');
        assert.equal(defaultBody.upstreamProfile.serverProfile, 'openai-compatible');
        assert.equal(defaultBody.upstreamProfile.serverProfileMixed, false);
        assert.equal(defaultBody.upstreamProfile.requestProfile, 'openai-compatible');
        assert.equal((defaultBody.upstreamProfile.activeConstraints as { upload: { maxImages: number } }).upload.maxImages, 10);

        process.env.OPENAI_CHANNEL_1_ID = 'matsca';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-matsca';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://img.matsca.com/v1';
        process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE = 'matsca';
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
        process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
        const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
        resetServerChannelStateForTests();
        const matscaBody = (await (await GET()).json()) as { upstreamProfile: Record<string, unknown> };
        assert.equal(matscaBody.upstreamProfile.activeProfile, 'matsca');
        assert.equal(matscaBody.upstreamProfile.serverProfile, 'matsca');
        assert.equal(matscaBody.upstreamProfile.serverProfileMixed, false);
        assert.equal(matscaBody.upstreamProfile.requestProfile, 'openai-compatible');
        assert.equal(
            (matscaBody.upstreamProfile.activeConstraints as { generateCount: { max: number } }).generateCount.max,
            4
        );
        assert.equal((matscaBody.upstreamProfile.activeConstraints as { upload: { maxImages: number } }).upload.maxImages, 8);
        assert.equal(JSON.stringify(matscaBody).includes('sk-matsca'), false);

        process.env.OPENAI_CHANNEL_2_ID = 'official';
        process.env.OPENAI_CHANNEL_2_API_KEYS = 'sk-official';
        process.env.OPENAI_CHANNEL_2_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_CHANNEL_2_UPSTREAM_PROFILE = 'openai-compatible';
        resetServerChannelStateForTests();
        const mixedBody = (await (await GET()).json()) as { upstreamProfile: Record<string, unknown> };
        assert.equal(mixedBody.upstreamProfile.activeProfile, 'openai-compatible');
        assert.equal(mixedBody.upstreamProfile.serverProfile, 'openai-compatible');
        assert.equal(mixedBody.upstreamProfile.serverProfileMixed, true);
        assert.equal(mixedBody.upstreamProfile.requestProfile, 'openai-compatible');
        assert.equal(
            (mixedBody.upstreamProfile.activeConstraints as { generateCount: { max: number } }).generateCount.max,
            4
        );
        assert.equal((mixedBody.upstreamProfile.activeConstraints as { upload: { maxImages: number } }).upload.maxImages, 8);
        assert.deepEqual(
            (mixedBody.upstreamProfile.activeConstraints as { partialImages: { min: number; max: number } })
                .partialImages,
            { min: 1, max: 3 }
        );
        assert.equal(JSON.stringify(mixedBody).includes('sk-official'), false);
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

    it('exposes provider manifest diagnostics without exposing channel secrets', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'custom';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://custom.example.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-custom';
        process.env.OPENAI_CHANNEL_1_PROVIDER_MANIFEST = JSON.stringify({
            id: 'custom_provider',
            name: 'Custom Provider',
            base_profile: 'openai-compatible',
            base_url: 'https://provider.internal.example/v1',
            modes: {
                generate: {
                    submit: {
                        path: '/images/generations',
                        response_format: 'custom-json'
                    },
                    poll: {
                        path: '/jobs/{id}',
                        status_path: 'status'
                    }
                }
            },
            constraints: {
                generate_count: { min: 1, max: 2 },
                edit_count: { min: 1, max: 1 },
                upload: { max_images: 3, max_single_bytes: 10485760 }
            }
        });
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
        process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
        const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
        resetServerChannelStateForTests();
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            upstreamProfile: {
                activeConstraints: {
                    generateCount: { max: number };
                    editCount: { max: number };
                    upload: { maxImages: number; maxSingleBytes: number };
                };
            };
            providerManifests: Array<Record<string, unknown>>;
        };

        assert.equal(body.upstreamProfile.activeConstraints.generateCount.max, 2);
        assert.equal(body.upstreamProfile.activeConstraints.editCount.max, 1);
        assert.equal(body.upstreamProfile.activeConstraints.upload.maxImages, 3);
        assert.equal(body.upstreamProfile.activeConstraints.upload.maxSingleBytes, 10485760);
        assert.equal(JSON.stringify(body).includes('provider.internal.example'), false);
        assert.deepEqual(body.providerManifests, [
            {
                channelId: 'custom',
                manifest: {
                    id: 'custom_provider',
                    name: 'Custom Provider',
                    baseProfile: 'openai-compatible',
                    modes: { generate: 'async-poll' },
                    requestTypes: { generate: 'application/json' },
                    responseFormats: { generate: 'custom-json' },
                    asyncPolling: { generate: true, edit: false }
                }
            }
        ]);
        assert.equal(JSON.stringify(body).includes('sk-custom'), false);
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
