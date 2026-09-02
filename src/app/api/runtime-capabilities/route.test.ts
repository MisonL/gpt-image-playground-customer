import { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let originalEnv: NodeJS.ProcessEnv;
let originalCwd = '';
let testCwd = '';

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

beforeEach(async () => {
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    testCwd = await mkdtemp(path.join(os.tmpdir(), 'runtime-capabilities-'));
    process.chdir(testCwd);
    process.env.npm_lifecycle_event = 'test';
    delete process.env.AGENT_API_TOKEN;
    delete process.env.APP_PASSWORD;
    delete process.env.ENABLE_RESPONSES_IMAGE_BACKEND;
    delete process.env.OPENAI_RESPONSES_API_MODEL;
    delete process.env.IMAGE_GENERATION_BACKEND;
    delete process.env.IMAGE_STREAMING_STRATEGY;
    delete process.env.IMAGE_UPSTREAM_TIMEOUT_MS;
    delete process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS;
    delete process.env.IMAGE_UPSTREAM_MAX_RETRIES;
    delete process.env.OPENAI_UPSTREAM_PROXY_URL;
    delete process.env.OPENAI_TUN_MODE;
    delete process.env.OPENAI_ALLOW_SYNTHETIC_DNS_IPS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.OPENAI_ROUTING_STRATEGY;
    delete process.env.OPENAI_CHANNEL_1_ID;
    delete process.env.OPENAI_CHANNEL_1_API_KEYS;
    delete process.env.OPENAI_CHANNEL_1_BASE_URL;
    delete process.env.OPENAI_CHANNEL_1_UPSTREAM_PROFILE;
    delete process.env.OPENAI_CHANNEL_1_PROVIDER_MANIFEST;
    delete process.env.OPENAI_CHANNEL_1_REQUEST_MODES;
    delete process.env.OPENAI_CHANNEL_1_REQUEST_MODE_PRIORITY;
    delete process.env.OPENAI_CHANNEL_1_PROXY_URL;
    delete process.env.OPENAI_CHANNEL_2_ID;
    delete process.env.OPENAI_CHANNEL_2_API_KEYS;
    delete process.env.OPENAI_CHANNEL_2_BASE_URL;
    delete process.env.OPENAI_CHANNEL_2_UPSTREAM_PROFILE;
    delete process.env.OPENAI_CHANNEL_2_PROVIDER_MANIFEST;
    delete process.env.OPENAI_CHANNEL_2_REQUEST_MODES;
    delete process.env.OPENAI_CHANNEL_2_REQUEST_MODE_PRIORITY;
    delete process.env.OPENAI_CHANNEL_2_PROXY_URL;
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
    delete process.env.WEBUI_IMAGE_AUTO_CLEANUP_ENABLED;
    delete process.env.WEBUI_IMAGE_RETENTION_DAYS;
});

afterEach(async () => {
    const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
    const { resetWebuiImageCleanupRuntimeForTests } = await import('@/lib/webui-image-cleanup-runtime');
    const { resetWebuiImageRetentionStoresForTests } = await import('@/lib/webui-image-retention-store');
    resetServerChannelStateForTests();
    resetWebuiImageCleanupRuntimeForTests();
    resetWebuiImageRetentionStoresForTests();
    process.chdir(originalCwd);
    await rm(testCwd, { recursive: true, force: true });
    restoreProcessEnv(originalEnv);
});

describe('GET /api/runtime-capabilities', { concurrency: false }, () => {
    it('redacts routing internals for unauthenticated requests when Agent auth is configured', async () => {
        process.env.AGENT_API_TOKEN = 'runtime-capabilities-token';
        process.env.OPENAI_CHANNEL_1_ID = 'private-channel';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://private.example/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'private-key';
        process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream';
        const { GET } = await import('./route');

        const response = await GET(new NextRequest('http://localhost/api/runtime-capabilities'));
        const body = (await response.json()) as {
            channelQueue: { credentials: unknown[] };
            channelRouting: {
                upstreamProxyByChannel: unknown[];
                requestModesByChannel: Array<{ channelId: string }>;
            };
            providerManifests: unknown[];
        };

        assert.equal(response.status, 200);
        assert.deepEqual(body.channelQueue.credentials, []);
        assert.deepEqual(body.channelRouting.upstreamProxyByChannel, []);
        assert.equal(body.channelRouting.requestModesByChannel[0]?.channelId, 'channel-1');
        assert.deepEqual(body.providerManifests, []);
        const serialized = JSON.stringify(body);
        assert.equal(serialized.includes('private-channel'), false);
        assert.equal(serialized.includes('private-key'), false);

        const authorizedResponse = await GET(
            new NextRequest('http://localhost/api/runtime-capabilities', {
                headers: { Authorization: 'Bearer runtime-capabilities-token' }
            })
        );
        const authorizedBody = (await authorizedResponse.json()) as {
            channelRouting: { requestModesByChannel: Array<{ channelId: string }> };
        };
        assert.equal(authorizedResponse.status, 200);
        assert.equal(authorizedBody.channelRouting.requestModesByChannel[0]?.channelId, 'private-channel');
    });

    it('exposes streaming batch capability by default without the removed env gate', async () => {
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as Record<
            string,
            { enabled: boolean; recommendedConcurrency?: number }
        >;

        assert.equal(body.streamingBatch.enabled, true);
        assert.equal(typeof body.streamingBatch.recommendedConcurrency, 'number');
    });

    it('redacts direct internal calls when deployment authentication is configured', async () => {
        process.env.AGENT_API_TOKEN = 'runtime-capabilities-token';
        process.env.OPENAI_CHANNEL_1_ID = 'private-channel';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://private.example/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'private-key';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            channelRouting: { requestModesByChannel: Array<{ channelId: string }> };
        };
        assert.equal(body.channelRouting.requestModesByChannel[0]?.channelId, 'channel-1');
    });

    it('exposes the configured default image model without credentials', async () => {
        process.env.OPENAI_IMAGE_MODEL = 'custom-image-model';
        const { GET } = await import('./route');

        const response = await GET();
        const body = (await response.json()) as { imageModel: { defaultModel: string } };

        assert.equal(response.status, 200);
        assert.deepEqual(body.imageModel, { defaultModel: 'custom-image-model' });
    });

    it('exposes WebUI image cleanup as disabled with a 30 day default', async () => {
        const { GET } = await import('./route');

        const response = await GET();
        const body = (await response.json()) as {
            webuiImageCleanup: {
                enabled: boolean;
                retentionDays: number;
                intervalMs: number;
                running: boolean;
            };
        };

        assert.equal(response.status, 200);
        assert.deepEqual(body.webuiImageCleanup, {
            enabled: false,
            retentionDays: 30,
            intervalMs: 21_600_000,
            running: false
        });
    });

    it('exposes explicitly enabled WebUI image cleanup settings', async () => {
        process.env.WEBUI_IMAGE_AUTO_CLEANUP_ENABLED = 'true';
        process.env.WEBUI_IMAGE_RETENTION_DAYS = '45';
        const { GET } = await import('./route');

        const response = await GET();
        const body = (await response.json()) as {
            webuiImageCleanup: {
                enabled: boolean;
                retentionDays: number;
                intervalMs: number;
                running: boolean;
            };
        };

        assert.equal(response.status, 200);
        assert.deepEqual(body.webuiImageCleanup, {
            enabled: true,
            retentionDays: 45,
            intervalMs: 21_600_000,
            running: false
        });
    });

    it('rejects invalid enabled WebUI image cleanup configuration', async () => {
        process.env.WEBUI_IMAGE_AUTO_CLEANUP_ENABLED = 'true';
        process.env.WEBUI_IMAGE_RETENTION_DAYS = '0';
        const { GET } = await import('./route');

        const response = await GET();
        const body = (await response.json()) as { error: string };

        assert.equal(response.status, 500);
        assert.match(body.error, /WEBUI_IMAGE_RETENTION_DAYS/);
    });

    it('exposes cleanup counts without leaking per-file failure details', async () => {
        process.env.WEBUI_IMAGE_AUTO_CLEANUP_ENABLED = 'true';
        const { startWebuiImageCleanupScheduler } = await import('@/lib/webui-image-cleanup-runtime');
        await startWebuiImageCleanupScheduler({
            env: process.env,
            runCleanup: async () => ({
                status: 'failed',
                startedAt: '2026-07-16T00:00:00.000Z',
                completedAt: '2026-07-16T00:00:01.000Z',
                cutoffAt: '2026-06-16T00:00:00.000Z',
                scannedCount: 4,
                protectedCount: 1,
                deletedCount: 2,
                failedCount: 1,
                failures: [
                    {
                        filename: '1781567999000-aaaaaaaaaaaaaaaa-0.png',
                        message: 'permission denied at /private/generated-images'
                    }
                ]
            }),
            setInterval: () => ({ unref() {} }),
            clearInterval() {},
            logger: {
                info() {},
                error() {}
            }
        });
        const { GET } = await import('./route');

        const response = await GET();
        const body = (await response.json()) as {
            webuiImageCleanup: Record<string, unknown>;
        };

        assert.equal(response.status, 200);
        assert.deepEqual(body.webuiImageCleanup.lastRun, {
            status: 'failed',
            startedAt: '2026-07-16T00:00:00.000Z',
            completedAt: '2026-07-16T00:00:01.000Z',
            cutoffAt: '2026-06-16T00:00:00.000Z',
            scannedCount: 4,
            protectedCount: 1,
            deletedCount: 2,
            failedCount: 1
        });
        assert.equal(JSON.stringify(body).includes('/private/generated-images'), false);
        assert.equal(JSON.stringify(body).includes('1781567999000-aaaaaaaaaaaaaaaa-0.png'), false);
    });

    it('exposes the runtime default streaming settings for client-side fanout decisions', async () => {
        process.env.IMAGE_GENERATION_BACKEND = 'responses-image-generation';
        process.env.IMAGE_STREAMING_STRATEGY = 'off';
        process.env.IMAGE_UPSTREAM_TIMEOUT_MS = '1200000';
        process.env.IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS = '600000';
        process.env.IMAGE_UPSTREAM_MAX_RETRIES = '1';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as Record<
            string,
            {
                defaultBackend?: string;
                defaultMode?: string;
                defaultStrategy?: string;
                upstream_timeout_ms?: number;
                stream_data_interval_timeout_ms?: number;
                upstream_max_retries?: number;
                upstream_proxy?: { configured: boolean; protocol?: string };
                tun_mode?: string;
            }
        >;

        assert.equal(body.streaming.defaultBackend, 'responses-image-generation');
        assert.equal(body.streaming.defaultMode, 'non_stream');
        assert.equal(body.streaming.defaultStrategy, 'off');
        assert.deepEqual(body.imageTransport, {
            upstream_timeout_ms: 1_200_000,
            stream_data_interval_timeout_ms: 600_000,
            upstream_max_retries: 1,
            upstream_proxy: { configured: false },
            tun_mode: 'disabled'
        });
    });

    it('exposes the configured synthetic DNS transport mode', async () => {
        process.env.OPENAI_TUN_MODE = 'synthetic-dns';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as { imageTransport: { tun_mode?: string } };

        assert.equal(body.imageTransport.tun_mode, 'synthetic-dns');
    });

    it('defaults channel failure cooldown to disabled while exposing recovery probe settings', async () => {
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
            failureCooldownEnabled: false,
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

    it('includes request mode on public lastFailure when present', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'official';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-secret';
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
        process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
        const { GET } = await import('./route');
        const { getServerChannelState } = await import('@/lib/server-channel-router');

        const state = getServerChannelState();
        const credential = state.config.credentials[0];
        assert.ok(credential);
        state.router?.reportFailure(credential, {
            scope: 'channel',
            requestMode: 'responses-non-stream',
            reason: {
                at: Date.now(),
                scope: 'channel',
                status: 403,
                code: 'permission_denied',
                message: 'Image generation is not enabled for this group',
                requestMode: 'responses-non-stream'
            }
        });

        const body = (await (await GET()).json()) as {
            streamingBatch: {
                lastFailure?: {
                    scope: string;
                    status?: number;
                    code?: string;
                    requestMode?: string;
                };
            };
        };

        assert.equal(body.streamingBatch.lastFailure?.scope, 'channel');
        assert.equal(body.streamingBatch.lastFailure?.status, 403);
        assert.equal(body.streamingBatch.lastFailure?.code, 'permission_denied');
        assert.equal(body.streamingBatch.lastFailure?.requestMode, 'responses-non-stream');
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

    it('allows channel failure cooldown to be enabled explicitly', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'official';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-secret';
        process.env.OPENAI_CHANNEL_FAILURE_COOLDOWN_ENABLED = 'true';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            channelRecovery: {
                failureCooldownEnabled: boolean;
                failureCooldownMs: number;
            };
        };

        assert.equal(body.channelRecovery.failureCooldownEnabled, true);
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
        assert.equal(
            (defaultBody.upstreamProfile.activeConstraints as { upload: { maxImages: number } }).upload.maxImages,
            10
        );

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
        assert.equal(
            (matscaBody.upstreamProfile.activeConstraints as { upload: { maxImages: number } }).upload.maxImages,
            8
        );
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
        assert.equal(
            (mixedBody.upstreamProfile.activeConstraints as { upload: { maxImages: number } }).upload.maxImages,
            8
        );
        assert.deepEqual(
            (mixedBody.upstreamProfile.activeConstraints as { partialImages: { min: number; max: number } })
                .partialImages,
            { min: 1, max: 3 }
        );
        assert.equal(JSON.stringify(mixedBody).includes('sk-official'), false);
    });

    it('keeps capabilities available when channel image count ranges do not intersect', async () => {
        process.env.OPENAI_CHANNEL_1_ID = 'fixed-one';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-one';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://one.example.com/v1';
        process.env.OPENAI_CHANNEL_1_PROVIDER_MANIFEST = JSON.stringify({
            id: 'fixed_one_provider',
            base_profile: 'openai-compatible',
            modes: { generate: { submit: { path: '/images/generations' } } },
            constraints: { generate_count: { min: 1, max: 1 } }
        });
        process.env.OPENAI_CHANNEL_2_ID = 'fixed-two';
        process.env.OPENAI_CHANNEL_2_API_KEYS = 'sk-two';
        process.env.OPENAI_CHANNEL_2_BASE_URL = 'https://two.example.com/v1';
        process.env.OPENAI_CHANNEL_2_PROVIDER_MANIFEST = JSON.stringify({
            id: 'fixed_two_provider',
            base_profile: 'openai-compatible',
            modes: { generate: { submit: { path: '/images/generations' } } },
            constraints: { generate_count: { min: 2, max: 2 } }
        });
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
        process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
        const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
        resetServerChannelStateForTests();
        const { GET } = await import('./route');

        const response = await GET();
        const body = (await response.json()) as {
            upstreamProfile: {
                serverConstraintsMixed: boolean;
                serverConstraintsByProfile: Array<{ generateCount: { min: number; max: number } }>;
                activeConstraints: { generateCount: { min: number; max: number } };
            };
        };

        assert.equal(response.status, 200);
        assert.equal(body.upstreamProfile.serverConstraintsMixed, true);
        assert.deepEqual(
            body.upstreamProfile.serverConstraintsByProfile.map((profile) => profile.generateCount),
            [
                { min: 1, max: 1 },
                { min: 2, max: 2 }
            ]
        );
        assert.ok(
            body.upstreamProfile.activeConstraints.generateCount.min <=
                body.upstreamProfile.activeConstraints.generateCount.max
        );
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
                    asyncPolling: { generate: true, edit: false },
                    executionSupport: { generate: 'declared_only' }
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

    it('disables Responses when provider image-count constraints have no valid overlap', async () => {
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        process.env.OPENAI_CHANNEL_1_ID = 'fixed-two';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://custom.example.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'configured';
        process.env.OPENAI_CHANNEL_1_PROVIDER_MANIFEST = JSON.stringify({
            id: 'fixed_two_provider',
            base_profile: 'openai-compatible',
            modes: { generate: { submit: { path: '/images/generations' } } },
            constraints: { generate_count: { min: 2, max: 2 } }
        });
        process.env.OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED = 'false';
        process.env.OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY = 'false';
        const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
        resetServerChannelStateForTests();
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            responsesImageBackend: {
                enabled: boolean;
                featureEnabled: boolean;
                incompatibleConstraints?: string[];
            };
        };

        assert.equal(body.responsesImageBackend.featureEnabled, true);
        assert.equal(body.responsesImageBackend.enabled, false);
        assert.deepEqual(body.responsesImageBackend.incompatibleConstraints, ['generate_images']);
    });

    it('exposes sanitized channel request modes for routing diagnostics', async () => {
        process.env.OPENAI_ROUTING_STRATEGY = 'round_robin';
        process.env.OPENAI_CHANNEL_1_ID = 'images';
        process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://images.example.com/v1';
        process.env.OPENAI_CHANNEL_1_API_KEYS = 'sk-secret';
        process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream,images-sse';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            channelRouting: {
                strategy: string;
                credentialCount: number;
                channelCount: number;
                supportedRequestModes: string[];
                configuredRequestModes: string[];
                effectiveRequestModes: string[];
                requestModeControls: {
                    globalEnv: string;
                    channelEnvPattern: string;
                    globalPriorityEnv: string;
                    channelPriorityEnvPattern: string;
                    defaultPriority: string[];
                    defaultPriorityPolicy: string;
                    mutableAtRuntime: boolean;
                    smokeGateCommands: Record<string, string[]>;
                };
                requestModeHealth: Array<{
                    mode: string;
                    configuredCredentialCount: number;
                    healthyCredentialCount: number;
                    configuredChannelCount: number;
                    healthyChannelCount: number;
                }>;
                upstreamProxyByChannel: Array<{
                    channelId: string;
                    upstreamProxy: { configured: boolean; protocol?: string };
                }>;
                requestModesByChannel: Array<{
                    channelId: string;
                    requestModes: string[];
                    requestModePriority: string[];
                }>;
                effectiveRequestModesByChannel: Array<{
                    channelId: string;
                    requestModes: string[];
                    requestModePriority: string[];
                }>;
            };
        };

        assert.deepEqual(body.channelRouting, {
            strategy: 'round_robin',
            credentialCount: 1,
            channelCount: 1,
            supportedRequestModes: ['images-non-stream', 'images-sse', 'responses-non-stream', 'responses-sse'],
            configuredRequestModes: ['images-non-stream', 'images-sse'],
            effectiveRequestModes: ['images-non-stream', 'images-sse'],
            defaultRequestModePriority: ['images-non-stream', 'images-sse', 'responses-non-stream', 'responses-sse'],
            requestModeControls: {
                source: 'admin_env_whitelist',
                globalEnv: 'OPENAI_UPSTREAM_REQUEST_MODES',
                channelEnvPattern: 'OPENAI_CHANNEL_N_REQUEST_MODES',
                globalPriorityEnv: 'OPENAI_UPSTREAM_REQUEST_MODE_PRIORITY',
                channelPriorityEnvPattern: 'OPENAI_CHANNEL_N_REQUEST_MODE_PRIORITY',
                defaultPriority: ['images-non-stream', 'images-sse', 'responses-non-stream', 'responses-sse'],
                defaultPriorityPolicy: 'lowest_cost_first',
                mutableAtRuntime: false,
                finalGateCommand:
                    'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable',
                smokeGateCommands: {
                    'images-non-stream': [
                        'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case original-images-json --allow-billable'
                    ],
                    'images-sse': [
                        'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case sub2api-images-sse --allow-billable'
                    ],
                    'responses-non-stream': [
                        'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case sub2api-responses-json --allow-billable'
                    ],
                    'responses-sse': [
                        'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case gpt2image-responses-sse --allow-billable'
                    ]
                }
            },
            requestModeHealth: [
                {
                    mode: 'images-non-stream',
                    configuredCredentialCount: 1,
                    healthyCredentialCount: 1,
                    configuredChannelCount: 1,
                    healthyChannelCount: 1
                },
                {
                    mode: 'images-sse',
                    configuredCredentialCount: 1,
                    healthyCredentialCount: 1,
                    configuredChannelCount: 1,
                    healthyChannelCount: 1
                },
                {
                    mode: 'responses-non-stream',
                    configuredCredentialCount: 0,
                    healthyCredentialCount: 0,
                    configuredChannelCount: 0,
                    healthyChannelCount: 0
                },
                {
                    mode: 'responses-sse',
                    configuredCredentialCount: 0,
                    healthyCredentialCount: 0,
                    configuredChannelCount: 0,
                    healthyChannelCount: 0
                }
            ],
            upstreamProxyByChannel: [
                {
                    channelId: 'images',
                    upstreamProxy: { configured: false }
                }
            ],
            requestModesByChannel: [
                {
                    channelId: 'images',
                    requestModes: ['images-non-stream', 'images-sse'],
                    requestModePriority: ['images-non-stream', 'images-sse']
                }
            ],
            effectiveRequestModesByChannel: [
                {
                    channelId: 'images',
                    requestModes: ['images-non-stream', 'images-sse'],
                    requestModePriority: ['images-non-stream', 'images-sse']
                }
            ]
        });
        assert.equal(JSON.stringify(body.channelRouting).includes('sk-secret'), false);
    });

    it('exposes the fail-closed default request mode when no whitelist is configured', async () => {
        process.env.OPENAI_API_KEY = 'sk-secret';
        process.env.OPENAI_API_BASE_URL = 'https://images.example.com/v1';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as {
            channelRouting: {
                configuredRequestModes: string[];
                effectiveRequestModes: string[];
                requestModeHealth: Array<{
                    mode: string;
                    configuredCredentialCount: number;
                    healthyCredentialCount: number;
                }>;
                requestModesByChannel: Array<{
                    channelId: string;
                    requestModes: string[];
                    requestModePriority: string[];
                }>;
            };
        };

        assert.deepEqual(body.channelRouting.configuredRequestModes, ['images-non-stream']);
        assert.deepEqual(body.channelRouting.effectiveRequestModes, ['images-non-stream']);
        assert.deepEqual(body.channelRouting.requestModesByChannel, [
            {
                channelId: 'default',
                requestModes: ['images-non-stream'],
                requestModePriority: ['images-non-stream']
            }
        ]);
        assert.deepEqual(
            body.channelRouting.requestModeHealth.map((item) => [
                item.mode,
                item.configuredCredentialCount,
                item.healthyCredentialCount
            ]),
            [
                ['images-non-stream', 1, 1],
                ['images-sse', 0, 0],
                ['responses-non-stream', 0, 0],
                ['responses-sse', 0, 0]
            ]
        );
        assert.equal(JSON.stringify(body.channelRouting).includes('sk-secret'), false);
    });
});
