import {
    createChannelRouter,
    describeChannelFailure,
    getChannelPoolSummary,
    isChannelFailure,
    isCredentialFailure,
    parseChannelPoolConfig,
    resolveEffectiveCredential,
    toPublicChannelFailure
} from './channel-router';
import { ChannelCapacityQueueError } from './channel-capacity-queue';
import { IMAGE_UPSTREAM_PROFILES } from './image-upstream-profile';
import { RequestValidationError } from './image-request-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const DEFAULT_HEADER_SUMMARY = {
    user_agent_effective: 'gpt-image-playground/2.1.0',
    has_extra_headers: false,
    allowed_header_names: ['user-agent', 'x-app-id', 'x-app-secret'],
    configured_header_names: []
};

describe('parseChannelPoolConfig', () => {
    it('parses multiple channels with multiple keys from numbered env vars', () => {
        const config = parseChannelPoolConfig({
            OPENAI_ROUTING_STRATEGY: 'round_robin',
            OPENAI_CHANNEL_1_ID: 'official',
            OPENAI_CHANNEL_1_BASE_URL: 'https://api.openai.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one, sk-two',
            OPENAI_CHANNEL_2_ID: 'backup',
            OPENAI_CHANNEL_2_BASE_URL: 'https://backup.example.com/v1',
            OPENAI_CHANNEL_2_API_KEYS: 'sk-three'
        });

        assert.equal(config.strategy, 'round_robin');
        assert.deepEqual(
            config.credentials.map((credential) => ({
                id: credential.id,
                channelId: credential.channelId,
                apiKey: credential.apiKey,
                baseUrl: credential.baseUrl
            })),
            [
                {
                    id: 'official#0',
                    channelId: 'official',
                    apiKey: 'sk-one',
                    baseUrl: 'https://api.openai.com/v1'
                },
                {
                    id: 'official#1',
                    channelId: 'official',
                    apiKey: 'sk-two',
                    baseUrl: 'https://api.openai.com/v1'
                },
                {
                    id: 'backup#0',
                    channelId: 'backup',
                    apiKey: 'sk-three',
                    baseUrl: 'https://backup.example.com/v1'
                }
            ]
        );
    });

    it('falls back to legacy single key env when numbered channels are not configured', () => {
        const config = parseChannelPoolConfig({
            OPENAI_API_KEY: 'sk-legacy',
            OPENAI_API_BASE_URL: 'https://legacy.example.com/v1'
        });

        assert.equal(config.strategy, 'sticky');
        assert.deepEqual(config.credentials, [
            {
                id: 'default#0',
                channelId: 'default',
                apiKey: 'sk-legacy',
                baseUrl: 'https://legacy.example.com/v1',
                upstreamProfile: 'openai-compatible'
            }
        ]);
    });

    it('rejects invalid legacy upstream profile values instead of silently using the default profile', () => {
        assert.throws(
            () =>
                parseChannelPoolConfig({
                    OPENAI_API_KEY: 'sk-legacy',
                    OPENAI_API_BASE_URL: 'https://legacy.example.com/v1',
                    OPENAI_UPSTREAM_PROFILE: 'unknown'
                }),
            /OPENAI_UPSTREAM_PROFILE/
        );
    });

    it('uses channel index as the default channel id', () => {
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_BASE_URL: 'https://default-id.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one'
        });

        assert.deepEqual(config.credentials, [
            {
                id: 'channel-1#0',
                channelId: 'channel-1',
                apiKey: 'sk-one',
                baseUrl: 'https://default-id.example.com/v1',
                upstreamProfile: 'openai-compatible'
            }
        ]);
    });

    it('rejects remote HTTP-compatible upstream base URLs unless they are allowlisted', () => {
        assert.throws(
            () =>
                parseChannelPoolConfig({
                    OPENAI_CHANNEL_1_ID: 'j3gb',
                    OPENAI_CHANNEL_1_BASE_URL: 'http://api.j3gb.com/v1',
                    OPENAI_CHANNEL_1_API_KEYS: 'sk-one'
                }),
            /HTTPS/
        );
    });

    it('accepts allowlisted HTTP-compatible upstream base URLs in server channels', () => {
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'j3gb',
            OPENAI_CHANNEL_1_BASE_URL: 'http://api.j3gb.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one',
            OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS: 'http://api.j3gb.com/v1'
        });

        assert.equal(config.credentials[0]?.baseUrl, 'http://api.j3gb.com/v1');
    });

    it('rejects a channel with missing API keys instead of silently falling back', () => {
        assert.throws(
            () =>
                parseChannelPoolConfig({
                    OPENAI_CHANNEL_1_ID: 'empty',
                    OPENAI_CHANNEL_1_BASE_URL: 'https://empty.example.com/v1'
                }),
            /OPENAI_CHANNEL_1_API_KEYS/
        );
    });

    it('rejects removed JSON config with a migration hint', () => {
        assert.throws(
            () =>
                parseChannelPoolConfig({
                    OPENAI_CHANNELS_JSON: '{"channels":[]}'
                }),
            /OPENAI_CHANNEL_N/
        );
    });
});

describe('getChannelPoolSummary', () => {
    it('returns sanitized capacity metadata without exposing API keys', () => {
        const config = parseChannelPoolConfig({
            OPENAI_ROUTING_STRATEGY: 'round_robin',
            OPENAI_CHANNEL_1_ID: 'official',
            OPENAI_CHANNEL_1_BASE_URL: 'https://api.openai.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one, sk-two',
            OPENAI_CHANNEL_2_ID: 'backup',
            OPENAI_CHANNEL_2_BASE_URL: 'https://backup.example.com/v1',
            OPENAI_CHANNEL_2_API_KEYS: 'sk-three'
        });

        assert.deepEqual(getChannelPoolSummary(config), {
            credentialCount: 3,
            channelCount: 2,
            strategy: 'round_robin',
            channels: [
                {
                    id: 'official',
                    baseUrl: 'https://api.openai.com/v1',
                    upstreamProfile: 'openai-compatible',
                    effectiveProfile: IMAGE_UPSTREAM_PROFILES['openai-compatible'],
                    hasExtraHeaders: false,
                    requestHeaders: DEFAULT_HEADER_SUMMARY,
                    credentialCount: 2
                },
                {
                    id: 'backup',
                    baseUrl: 'https://backup.example.com/v1',
                    upstreamProfile: 'openai-compatible',
                    effectiveProfile: IMAGE_UPSTREAM_PROFILES['openai-compatible'],
                    hasExtraHeaders: false,
                    requestHeaders: DEFAULT_HEADER_SUMMARY,
                    credentialCount: 1
                }
            ]
        });
    });

    it('reports channel upstream profile and extra header availability without exposing header values', () => {
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'matsca',
            OPENAI_CHANNEL_1_BASE_URL: 'https://matsca.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one',
            OPENAI_CHANNEL_1_UPSTREAM_PROFILE: 'matsca',
            OPENAI_CHANNEL_1_MATSCA_APP_ID: 'app-id',
            OPENAI_CHANNEL_1_MATSCA_APP_SECRET: 'app-secret'
        });

        assert.deepEqual(getChannelPoolSummary(config), {
            credentialCount: 1,
            channelCount: 1,
            strategy: 'sticky',
            channels: [
                {
                    id: 'matsca',
                    baseUrl: 'https://matsca.example.com/v1',
                    upstreamProfile: 'matsca',
                    effectiveProfile: IMAGE_UPSTREAM_PROFILES.matsca,
                    hasExtraHeaders: true,
                    requestHeaders: {
                        ...DEFAULT_HEADER_SUMMARY,
                        has_extra_headers: true,
                        configured_header_names: ['x-app-id', 'x-app-secret']
                    },
                    credentialCount: 1
                }
            ]
        });
    });

    it('supports safe per-channel User-Agent overrides without exposing header values', () => {
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'jisuanyun',
            OPENAI_CHANNEL_1_BASE_URL: 'https://xkj.jisuanyun.vip/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one',
            OPENAI_CHANNEL_1_USER_AGENT: 'gpt-image-playground/customer-node'
        });

        assert.equal(config.credentials[0]?.upstreamHeaders?.['User-Agent'], 'gpt-image-playground/customer-node');
        assert.deepEqual(getChannelPoolSummary(config).channels[0]?.requestHeaders, {
            ...DEFAULT_HEADER_SUMMARY,
            user_agent_effective: 'gpt-image-playground/customer-node',
            configured_header_names: ['user-agent']
        });
        assert.equal(JSON.stringify(getChannelPoolSummary(config)).includes('sk-one'), false);
    });

    it('rejects unsafe per-channel JSON headers that would override protocol headers', () => {
        assert.throws(
            () =>
                parseChannelPoolConfig({
                    OPENAI_CHANNEL_1_ID: 'bad',
                    OPENAI_CHANNEL_1_BASE_URL: 'https://bad.example.com/v1',
                    OPENAI_CHANNEL_1_API_KEYS: 'sk-one',
                    OPENAI_CHANNEL_1_UPSTREAM_HEADERS_JSON: '{"Authorization":"Bearer wrong"}'
                }),
            /不能配置 Authorization/
        );
    });

    it('rejects half-configured Matsca app headers', () => {
        assert.throws(
            () =>
                parseChannelPoolConfig({
                    OPENAI_CHANNEL_1_ID: 'matsca',
                    OPENAI_CHANNEL_1_BASE_URL: 'https://matsca.example.com/v1',
                    OPENAI_CHANNEL_1_API_KEYS: 'sk-one',
                    OPENAI_CHANNEL_1_UPSTREAM_PROFILE: 'matsca',
                    OPENAI_CHANNEL_1_MATSCA_APP_ID: 'app-id'
                }),
            /必须成对配置/
        );
    });

    it('parses provider manifest summaries and derived profile constraints without exposing secrets', () => {
        const manifest = JSON.stringify({
            schema_version: 1,
            id: 'custom_provider',
            name: 'Custom Provider',
            base_profile: 'matsca',
            modes: {
                generate: {
                    submit: {
                        path: '/images/generations',
                        content_type: 'application/json',
                        response_format: 'custom-json'
                    },
                    poll: {
                        path: '/jobs/{id}',
                        status_path: 'status',
                        success_values: ['succeeded'],
                        failure_values: ['failed']
                    }
                },
                edit: {
                    submit: {
                        path: '/images/edits',
                        content_type: 'multipart/form-data'
                    }
                }
            },
            constraints: {
                generate_count: { min: 1, max: 2 },
                edit_count: { min: 1, max: 1 },
                partial_images: { min: 0, max: 2 },
                upload: { max_images: 4, max_single_bytes: 10485760, max_total_bytes: 41943040 }
            }
        });
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'custom',
            OPENAI_CHANNEL_1_BASE_URL: 'https://custom.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one',
            OPENAI_CHANNEL_1_UPSTREAM_PROFILE: 'matsca',
            OPENAI_CHANNEL_1_PROVIDER_MANIFEST: manifest
        });

        assert.equal(config.credentials[0]?.providerProfile?.generateCount.max, 2);
        assert.equal(config.credentials[0]?.providerProfile?.editCount.max, 1);
        assert.equal(config.credentials[0]?.providerProfile?.upload.maxImages, 4);
        assert.deepEqual(getChannelPoolSummary(config), {
            credentialCount: 1,
            channelCount: 1,
            strategy: 'sticky',
            channels: [
                {
                    id: 'custom',
                    baseUrl: 'https://custom.example.com/v1',
                    upstreamProfile: 'matsca',
                    effectiveProfile: config.credentials[0]?.providerProfile,
                    hasExtraHeaders: false,
                    requestHeaders: DEFAULT_HEADER_SUMMARY,
                    providerManifest: {
                        id: 'custom_provider',
                        name: 'Custom Provider',
                        baseProfile: 'matsca',
                        modes: {
                            generate: 'async-poll',
                            edit: 'multipart'
                        },
                        requestTypes: {
                            generate: 'application/json',
                            edit: 'multipart/form-data'
                        },
                        responseFormats: {
                            generate: 'custom-json',
                            edit: 'openai-images'
                        },
                        asyncPolling: {
                            generate: true,
                            edit: false
                        }
                    },
                    credentialCount: 1
                }
            ]
        });
        assert.equal(JSON.stringify(getChannelPoolSummary(config)).includes('sk-one'), false);
    });

    it('rejects provider manifests whose base profile conflicts with the channel profile', () => {
        assert.throws(
            () =>
                parseChannelPoolConfig({
                    OPENAI_CHANNEL_1_ID: 'custom',
                    OPENAI_CHANNEL_1_BASE_URL: 'https://custom.example.com/v1',
                    OPENAI_CHANNEL_1_API_KEYS: 'sk-one',
                    OPENAI_CHANNEL_1_UPSTREAM_PROFILE: 'openai-compatible',
                    OPENAI_CHANNEL_1_PROVIDER_MANIFEST: JSON.stringify({
                        id: 'custom_provider',
                        base_profile: 'matsca',
                        modes: { generate: { submit: { path: '/images/generations' } } }
                    })
                }),
            /base_profile 必须和该渠道 upstream profile 一致/
        );
    });
});

describe('createChannelRouter', () => {
    const config = parseChannelPoolConfig({
        OPENAI_CHANNEL_1_ID: 'a',
        OPENAI_CHANNEL_1_BASE_URL: 'https://a.example.com/v1',
        OPENAI_CHANNEL_1_API_KEYS: 'a1,a2',
        OPENAI_CHANNEL_2_ID: 'b',
        OPENAI_CHANNEL_2_BASE_URL: 'https://b.example.com/v1',
        OPENAI_CHANNEL_2_API_KEYS: 'b1'
    });

    it('keeps sticky selection stable for the same affinity key', () => {
        const router = createChannelRouter({ ...config, strategy: 'sticky' });

        const first = router.select({ affinityKey: 'client-a' });
        const second = router.select({ affinityKey: 'client-a' });

        assert.equal(first.id, second.id);
        assert.ok(config.credentials.some((credential) => credential.id === first.id));
    });

    it('cycles through credentials with round robin', () => {
        const router = createChannelRouter({ ...config, strategy: 'round_robin' });

        assert.deepEqual(
            [router.select().id, router.select().id, router.select().id, router.select().id],
            ['a#0', 'a#1', 'b#0', 'a#0']
        );
    });

    it('uses injected random source for random routing', () => {
        const router = createChannelRouter({
            ...config,
            strategy: 'random',
            random: () => 0.75
        });

        assert.equal(router.select().id, 'b#0');
    });

    it('skips a failed credential until the cooldown expires', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now
        });

        const failed = router.select();
        assert.equal(failed.id, 'a#0');

        router.reportFailure(failed);
        assert.equal(router.select().id, 'a#1');
        assert.equal(router.select().id, 'b#0');
        assert.equal(router.select().id, 'a#1');

        now = 1100;
        assert.equal(router.select().id, 'b#0');
        assert.equal(router.select().id, 'a#0');
    });

    it('fails explicitly when every credential is cooling down', () => {
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => 1000
        });

        config.credentials.forEach((credential) => router.reportFailure(credential));

        assert.throws(() => router.select({ affinityKey: 'client-a' }), /没有可用的健康渠道凭证/);
    });

    it('keeps credentials routable when failure cooldown is disabled', () => {
        const router = createChannelRouter({
            ...config,
            failureCooldownEnabled: false,
            failureCooldownMs: 100,
            now: () => 1000,
            requireProbeForRecovery: true
        });

        const report = router.reportFailure(config.credentials[0], { scope: 'channel' });

        assert.equal(report.cooldownApplied, false);
        assert.deepEqual(router.getRecoveryProbeCandidates(), []);
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 3,
            unhealthyCredentialCount: 0,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'channel'
            }
        });
        const selected = router.select({ affinityKey: 'client-a' });
        assert.ok(config.credentials.some((credential) => credential.id === selected.id));
    });

    it('uses a 30 second default failure cooldown', () => {
        const router = createChannelRouter({
            ...config,
            now: () => 1000
        });

        const report = router.reportFailure(config.credentials[0]);

        assert.equal(report.cooldownApplied, true);
        assert.equal(report.retryAfterMs, 30_000);
        assert.equal(report.cooldownUntil, 31_000);
    });

    it('reports healthy capacity after credentials enter and leave cooldown', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now
        });
        const failed = config.credentials[0];

        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 3,
            unhealthyCredentialCount: 0,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0
        });

        router.reportFailure(failed);
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 2,
            unhealthyCredentialCount: 1,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'credential'
            }
        });

        now = 1100;
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 3,
            unhealthyCredentialCount: 0,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'credential'
            }
        });
    });

    it('reports healthy channel capacity when some credentials or whole channels are cooling down', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now
        });

        router.reportFailure(config.credentials[0]);
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 2,
            unhealthyCredentialCount: 1,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'credential'
            }
        });

        router.reportFailure(config.credentials[2], { scope: 'channel' });
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 1,
            unhealthyCredentialCount: 2,
            channelCount: 2,
            healthyChannelCount: 1,
            unhealthyChannelCount: 1,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'channel'
            }
        });

        now = 1100;
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 3,
            unhealthyCredentialCount: 0,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'channel'
            }
        });
    });

    it('uses per-channel cooldown when a channel defines a longer window', () => {
        let now = 1000;
        const channelConfig = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'a',
            OPENAI_CHANNEL_1_BASE_URL: 'https://a.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'a1,a2',
            OPENAI_CHANNEL_1_FAILURE_COOLDOWN_MS: '250',
            OPENAI_CHANNEL_2_ID: 'b',
            OPENAI_CHANNEL_2_BASE_URL: 'https://b.example.com/v1',
            OPENAI_CHANNEL_2_API_KEYS: 'b1'
        });
        const router = createChannelRouter({
            ...channelConfig,
            failureCooldownMs: 100,
            now: () => now
        });

        router.reportFailure(channelConfig.credentials[0], { scope: 'channel' });
        now = 1100;
        assert.equal(router.select({ affinityKey: 'client-a' }).channelId, 'b');

        now = 1250;
        assert.ok(router.getHealthSummary().healthyCredentialCount >= 2);
    });

    it('falls forward from a cooled sticky credential to the next healthy credential', () => {
        const router = createChannelRouter({
            ...config,
            strategy: 'sticky',
            failureCooldownMs: 100,
            now: () => 1000
        });
        const sticky = router.select({ affinityKey: 'client-a' });

        router.reportFailure(sticky);
        const replacement = router.select({ affinityKey: 'client-a' });

        assert.notEqual(replacement.id, sticky.id);
        assert.ok(config.credentials.some((credential) => credential.id === replacement.id));
    });

    it('does not change health when a non-credential error is ignored by the caller', () => {
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => 1000
        });

        assert.equal(isCredentialFailure({ status: 400, code: 'invalid_request_error' }), false);
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 3,
            unhealthyCredentialCount: 0,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0
        });
    });

    it('cools every credential in the failed channel while preserving other channels', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now
        });

        const failed = router.select();
        assert.equal(failed.id, 'a#0');

        router.reportFailure(failed, { scope: 'channel' });
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 1,
            unhealthyCredentialCount: 2,
            channelCount: 2,
            healthyChannelCount: 1,
            unhealthyChannelCount: 1,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'channel'
            }
        });
        assert.equal(router.select().id, 'b#0');
        assert.equal(router.select().id, 'b#0');

        now = 1100;
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 3,
            unhealthyCredentialCount: 0,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'channel'
            }
        });
    });

    it('requires a successful recovery probe before a cooled credential returns to user traffic', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        const failed = router.select();
        assert.equal(failed.id, 'a#0');
        router.reportFailure(failed);

        now = 1100;
        assert.deepEqual(
            [router.select().id, router.select().id, router.select().id],
            ['a#1', 'b#0', 'a#1']
        );

        const candidates = router.getRecoveryProbeCandidates();
        assert.deepEqual(
            candidates.map((candidate) => ({
                scope: candidate.scope,
                credentialId: candidate.credential.id
            })),
            [{ scope: 'credential', credentialId: 'a#0' }]
        );

        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 2,
            unhealthyCredentialCount: 1,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 1,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1000,
                scope: 'credential'
            }
        });

        router.reportRecoveryProbeSuccess(candidates[0]);
        assert.equal(router.select().id, 'b#0');
        assert.equal(router.select().id, 'a#0');
    });

    it('requires channel recovery probes and re-cools the channel after a failed probe', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        router.reportFailure(config.credentials[0], { scope: 'channel' });

        now = 1100;
        assert.equal(router.select().id, 'b#0');
        assert.equal(router.select().id, 'b#0');
        assert.deepEqual(
            router.getRecoveryProbeCandidates().map((candidate) => ({
                scope: candidate.scope,
                credentialId: candidate.credential.id
            })),
            [{ scope: 'channel', credentialId: 'a#0' }]
        );

        router.reportRecoveryProbeFailure(router.getRecoveryProbeCandidates()[0], {
            at: now,
            scope: 'channel',
            status: 503,
            code: 'probe_failed'
        });
        assert.deepEqual(router.getRecoveryProbeCandidates(), []);
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 1,
            unhealthyCredentialCount: 2,
            channelCount: 2,
            healthyChannelCount: 1,
            unhealthyChannelCount: 1,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 1,
            lastFailure: {
                at: 1100,
                scope: 'channel',
                status: 503,
                code: 'probe_failed'
            }
        });

        now = 1200;
        const retryCandidate = router.getRecoveryProbeCandidates()[0];
        assert.equal(retryCandidate.scope, 'channel');
        assert.equal(retryCandidate.credential.id, 'a#0');

        router.reportRecoveryProbeSuccess(retryCandidate);
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 3,
            unhealthyCredentialCount: 0,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
            pendingRecoveryProbeCredentialCount: 0,
            pendingRecoveryProbeChannelCount: 0,
            lastFailure: {
                at: 1100,
                scope: 'channel',
                status: 503,
                code: 'probe_failed'
            }
        });
    });

    it('ignores stale recovery probe success after the credential fails again', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        const failed = config.credentials[0];
        router.reportFailure(failed);
        now = 1100;
        const staleCandidate = router.getRecoveryProbeCandidates()[0];

        now = 1110;
        router.reportFailure(failed);
        router.reportRecoveryProbeSuccess(staleCandidate);

        assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 1);
        assert.throws(() => selectOnlyCredential(router, failed.id), /没有可用的健康渠道凭证/);

        now = 1210;
        const freshCandidate = router.getRecoveryProbeCandidates()[0];
        assert.equal(freshCandidate.credential.id, failed.id);
        router.reportRecoveryProbeSuccess(freshCandidate);
        assert.equal(selectOnlyCredential(router, failed.id).id, failed.id);
    });

    it('ignores stale recovery probe success after the channel fails again', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        const failed = config.credentials[0];
        router.reportFailure(failed, { scope: 'channel' });
        now = 1100;
        const staleCandidate = router.getRecoveryProbeCandidates()[0];

        now = 1110;
        router.reportFailure(failed, { scope: 'channel' });
        router.reportRecoveryProbeSuccess(staleCandidate);

        assert.equal(router.getHealthSummary().pendingRecoveryProbeChannelCount, 1);
        assert.deepEqual(config.credentials.filter((credential) => credential.channelId === 'a').filter(canSelect(router)), []);

        now = 1210;
        const freshCandidate = router.getRecoveryProbeCandidates()[0];
        assert.equal(freshCandidate.scope, 'channel');
        router.reportRecoveryProbeSuccess(freshCandidate);
        assert.deepEqual(
            config.credentials.filter((credential) => credential.channelId === 'a').filter(canSelect(router)).map((credential) => credential.id),
            ['a#0', 'a#1']
        );
    });

    it('clears the selected credential probe when its channel probe proves the same credential recovered', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        const failed = config.credentials[0];
        router.reportFailure(failed);
        now = 1010;
        router.reportFailure(failed, { scope: 'channel' });
        now = 1110;

        const candidate = router.getRecoveryProbeCandidates()[0];
        assert.equal(candidate.scope, 'channel');
        assert.equal(candidate.credential.id, failed.id);
        assert.equal(router.reportRecoveryProbeSuccess(candidate), true);

        assert.equal(router.getHealthSummary().pendingRecoveryProbeChannelCount, 0);
        assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 0);
        assert.equal(selectOnlyCredential(router, failed.id).id, failed.id);
    });

    it('keeps a selected credential pending when its failure is newer than the channel probe', () => {
        let now = 1000;
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        const failed = config.credentials[0];
        router.reportFailure(failed, { scope: 'channel' });
        now = 1100;
        const candidate = router.getRecoveryProbeCandidates()[0];

        now = 1110;
        router.reportFailure(failed);
        assert.equal(router.reportRecoveryProbeSuccess(candidate), true);

        assert.equal(router.getHealthSummary().pendingRecoveryProbeChannelCount, 0);
        assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 1);
        assert.throws(() => selectOnlyCredential(router, failed.id), /没有可用的健康渠道凭证/);
    });

    it('stores sanitized failure diagnostics without exposing API keys', () => {
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => 1000
        });

        router.reportFailure(config.credentials[0], {
            scope: 'channel',
            reason: {
                at: 1000,
                scope: 'channel',
                status: 524,
                code: 'cf_timeout',
                requestId: 'req_123',
                message: 'A timeout occurred'
            }
        });

        const summary = router.getHealthSummary();
        assert.deepEqual(summary.lastFailure, {
            at: 1000,
            scope: 'channel',
            status: 524,
            code: 'cf_timeout',
            requestId: 'req_123',
            message: 'A timeout occurred'
        });
        assert.equal(JSON.stringify(summary).includes('a1'), false);
    });

    it('returns a public failure summary without upstream message text', () => {
        const reason = describeChannelFailure(
            {
                status: 524,
                code: 'cf_timeout',
                requestID: 'req_123',
                message: 'upstream message with private details'
            },
            'channel',
            1000
        );

        assert.deepEqual(toPublicChannelFailure(reason), {
            at: 1000,
            scope: 'channel',
            status: 524,
            code: 'cf_timeout',
            requestId: 'req_123'
        });
    });

    it('captures requestId from non-OpenAI error casing', () => {
        const reason = describeChannelFailure(
            {
                status: 500,
                requestId: 'req_lowercase'
            },
            'channel',
            1000
        );

        assert.equal(reason.requestId, 'req_lowercase');
    });
});

function canSelect(router: ReturnType<typeof createChannelRouter>) {
    return (credential: { id: string }) => {
        try {
            selectOnlyCredential(router, credential.id);
            return true;
        } catch {
            return false;
        }
    };
}

function selectOnlyCredential(router: ReturnType<typeof createChannelRouter>, credentialId: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const credential = router.select();
        if (credential.id === credentialId) return credential;
    }
    throw new RequestValidationError('当前没有可用的健康渠道凭证。', 503);
}

describe('resolveEffectiveCredential', () => {
    it('uses request API key while preserving legacy server base URL when request URL is blank', () => {
        const credential = resolveEffectiveCredential({
            requestApiKey: 'sk-browser',
            requestApiBaseUrl: '',
            legacyBaseUrl: 'https://legacy.example.com/v1',
            selectedCredential: {
                id: 'server#0',
                channelId: 'server',
                apiKey: 'sk-server',
                baseUrl: 'https://server.example.com/v1',
                upstreamProfile: 'openai-compatible'
            }
        });

        assert.deepEqual(credential, {
            apiKey: 'sk-browser',
            baseUrl: 'https://legacy.example.com/v1',
            upstreamProfile: 'openai-compatible'
        });
    });

    it('uses selected server credential when request API key is blank', () => {
        const selectedCredential = {
            id: 'server#0',
            channelId: 'server',
            apiKey: 'sk-server',
            baseUrl: 'https://server.example.com/v1',
            upstreamProfile: 'openai-compatible'
        } as const;

        assert.deepEqual(
            resolveEffectiveCredential({
                requestApiKey: '',
                requestApiBaseUrl: '',
                legacyBaseUrl: 'https://legacy.example.com/v1',
                selectedCredential
            }),
            {
                apiKey: 'sk-server',
                baseUrl: 'https://server.example.com/v1',
                upstreamProfile: 'openai-compatible',
                upstreamHeaders: undefined,
                selectedCredential
            }
        );
    });

    it('does not send a selected server credential to a request-supplied base URL without a request key', () => {
        const selectedCredential = {
            id: 'server#0',
            channelId: 'server',
            apiKey: 'sk-server',
            baseUrl: 'https://server.example.com/v1',
            upstreamProfile: 'openai-compatible',
            upstreamHeaders: { 'X-App-ID': 'server-app' }
        } as const;

        assert.deepEqual(
            resolveEffectiveCredential({
                requestApiKey: '',
                requestApiBaseUrl: 'https://attacker.example.com/v1',
                selectedCredential
            }),
            {
                apiKey: 'sk-server',
                baseUrl: 'https://server.example.com/v1',
                upstreamProfile: 'openai-compatible',
                upstreamHeaders: { 'X-App-ID': 'server-app' },
                selectedCredential
            }
        );
    });
});

describe('isCredentialFailure', () => {
    it('treats auth, quota, and rate limit responses as credential failures', () => {
        assert.equal(isCredentialFailure({ status: 401 }), true);
        assert.equal(isCredentialFailure({ status: 403 }), true);
        assert.equal(isCredentialFailure({ status: 429 }), true);
        assert.equal(isCredentialFailure({ code: 'insufficient_quota' }), true);
        assert.equal(isCredentialFailure({ error: { code: 'invalid_api_key' } }), true);
    });

    it('does not mark request validation errors as credential failures', () => {
        assert.equal(isCredentialFailure({ status: 400, code: 'invalid_request_error' }), false);
        assert.equal(isCredentialFailure(new Error('prompt is required')), false);
    });

    it('prefers explicit credential error codes even when a gateway wraps them in 5xx status', () => {
        assert.equal(isCredentialFailure({ status: 503, error: { code: 'invalid_api_key' } }), true);
        assert.equal(isCredentialFailure({ status: 500, code: 'insufficient_quota' }), true);
    });

    it('does not treat local channel capacity queue errors as credential failures', () => {
        assert.equal(isCredentialFailure(createCapacityQueueError()), false);
    });
});

describe('isChannelFailure', () => {
    it('treats upstream 5xx and CDN timeout statuses as channel failures', () => {
        [500, 502, 503, 504, 520, 522, 523, 524].forEach((status) => {
            assert.equal(isChannelFailure({ status }), true);
        });
    });

    it('does not treat credential or request errors as channel failures', () => {
        assert.equal(isChannelFailure({ status: 400 }), false);
        assert.equal(isChannelFailure({ status: 401 }), false);
        assert.equal(isChannelFailure({ status: 429 }), false);
        assert.equal(isChannelFailure({ status: 503, error: { code: 'invalid_api_key' } }), false);
        assert.equal(isChannelFailure(new Error('prompt is required')), false);
    });

    it('does not treat local validation errors as channel failures even when they use a 500 response', () => {
        assert.equal(isChannelFailure(new RequestValidationError('local config error', 500)), false);
    });

    it('does not treat local channel capacity queue errors as channel failures', () => {
        assert.equal(isChannelFailure(createCapacityQueueError()), false);
    });

    it('treats upstream connection and timeout failures as channel failures', () => {
        const connectionError = Object.assign(new Error('Connection error.'), {
            name: 'APIConnectionError'
        });
        const timeoutError = Object.assign(new Error('Request timed out.'), {
            name: 'APIConnectionTimeoutError'
        });
        const dnsError = Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), {
            code: 'ENOTFOUND'
        });
        const nestedConnectionError = Object.assign(new Error('Connection error.'), {
            cause: Object.assign(new TypeError('fetch failed'), {
                cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:65535'), {
                    code: 'ECONNREFUSED'
                })
            })
        });
        const messageOnlyConnectionError = new Error('Connection error.');

        assert.equal(isChannelFailure(connectionError), true);
        assert.equal(isChannelFailure(timeoutError), true);
        assert.equal(isChannelFailure(dnsError), true);
        assert.equal(isChannelFailure(nestedConnectionError), true);
        assert.equal(isChannelFailure(messageOnlyConnectionError), true);
    });
});

function createCapacityQueueError(): ChannelCapacityQueueError {
    return new ChannelCapacityQueueError({
        code: 'channel_capacity_queue_timeout',
        message: '渠道凭证并发队列等待超时，请稍后重试。',
        status: 429,
        retryable: true,
        details: {
            credential_id: 'official#0',
            queue_position: 1,
            max_wait_ms: 420000
        }
    });
}
