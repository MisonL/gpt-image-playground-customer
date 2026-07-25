import { createChannelRouter, parseChannelPoolConfig } from './channel-router';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('channel health snapshot', () => {
    it('reports a credential cooldown and pending probe without exposing the failure message', () => {
        const now = 1_000;
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'primary',
            OPENAI_CHANNEL_1_BASE_URL: 'https://images.example.test/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'first,second',
            OPENAI_CHANNEL_1_REQUEST_MODES: 'images-non-stream,images-sse'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        router.reportFailure(config.credentials[0], {
            reason: {
                at: now,
                scope: 'credential',
                status: 429,
                code: 'rate_limited',
                message: 'upstream secret detail'
            }
        });

        const snapshot = router.getHealthSnapshot();

        assert.deepEqual(snapshot, {
            at: 1_000,
            channels: [
                {
                    channelId: 'primary',
                    upstreamProxy: { configured: false },
                    credentialCount: 2,
                    healthyCredentialCount: 1,
                    unhealthyCredentialCount: 1,
                    state: 'healthy',
                    probeRequired: true,
                    credentials: [
                        {
                            credentialId: 'primary#0',
                            state: 'probe_pending',
                            cooldownUntil: 1_100,
                            probeRequired: true,
                            lastFailure: {
                                at: 1_000,
                                scope: 'credential',
                                status: 429,
                                code: 'rate_limited'
                            },
                            requestModes: [
                                {
                                    mode: 'images-non-stream',
                                    state: 'probe_pending',
                                    cooldownUntil: 1_100,
                                    probeRequired: true
                                },
                                {
                                    mode: 'images-sse',
                                    state: 'probe_pending',
                                    cooldownUntil: 1_100,
                                    probeRequired: true
                                }
                            ]
                        },
                        {
                            credentialId: 'primary#1',
                            state: 'healthy',
                            probeRequired: false,
                            requestModes: [
                                {
                                    mode: 'images-non-stream',
                                    state: 'healthy',
                                    probeRequired: false
                                },
                                {
                                    mode: 'images-sse',
                                    state: 'healthy',
                                    probeRequired: false
                                }
                            ]
                        }
                    ]
                }
            ]
        });
        assert.equal(JSON.stringify(snapshot).includes('upstream secret detail'), false);
    });

    it('keeps a credential healthy when only one request mode is awaiting recovery', () => {
        let now = 1_000;
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'primary',
            OPENAI_CHANNEL_1_BASE_URL: 'https://images.example.test/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'first',
            OPENAI_CHANNEL_1_REQUEST_MODES: 'images-non-stream,images-sse'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        router.reportFailure(config.credentials[0], {
            scope: 'channel',
            requestMode: 'images-sse',
            reason: {
                at: now,
                scope: 'channel',
                status: 524,
                code: 'upstream_timeout',
                message: 'upstream secret detail'
            }
        });

        const credential = router.getHealthSnapshot().channels[0].credentials[0];
        assert.equal(credential.state, 'healthy');
        assert.equal(credential.probeRequired, true);
        assert.deepEqual(credential.lastFailure, {
            at: 1_000,
            scope: 'channel',
            status: 524,
            code: 'upstream_timeout',
            requestMode: 'images-sse'
        });
        assert.deepEqual(credential.requestModes, [
            {
                mode: 'images-non-stream',
                state: 'healthy',
                probeRequired: false
            },
            {
                mode: 'images-sse',
                state: 'probe_pending',
                cooldownUntil: 1_100,
                probeRequired: true
            }
        ]);

        now = 1_100;
        assert.equal(router.getHealthSnapshot().channels[0].credentials[0].requestModes[1].state, 'probe_pending');
    });

    it('marks a credential unavailable when every effective request mode is awaiting recovery', () => {
        const now = 1_000;
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'primary',
            OPENAI_CHANNEL_1_BASE_URL: 'https://images.example.test/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'first',
            OPENAI_CHANNEL_1_REQUEST_MODES: 'images-non-stream,images-sse'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        for (const requestMode of ['images-non-stream', 'images-sse'] as const) {
            router.reportFailure(config.credentials[0], {
                scope: 'channel',
                requestMode,
                reason: {
                    at: now,
                    scope: 'channel',
                    status: 524,
                    code: 'upstream_timeout',
                    message: 'upstream secret detail'
                }
            });
        }

        const channel = router.getHealthSnapshot().channels[0];
        const credential = channel.credentials[0];

        assert.equal(channel.state, 'probe_pending');
        assert.equal(channel.healthyCredentialCount, 0);
        assert.equal(channel.unhealthyCredentialCount, 1);
        assert.equal(credential.state, 'probe_pending');
        assert.equal(credential.cooldownUntil, 1_100);
        assert.deepEqual(
            credential.requestModes.map((requestMode) => requestMode.state),
            ['probe_pending', 'probe_pending']
        );
    });
});
