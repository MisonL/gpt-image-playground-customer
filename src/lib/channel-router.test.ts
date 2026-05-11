import { createChannelRouter, parseChannelPoolConfig, resolveEffectiveCredential } from './channel-router';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
                baseUrl: 'https://legacy.example.com/v1'
            }
        ]);
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
                baseUrl: 'https://default-id.example.com/v1'
            }
        ]);
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
});

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
                baseUrl: 'https://server.example.com/v1'
            }
        });

        assert.deepEqual(credential, {
            apiKey: 'sk-browser',
            baseUrl: 'https://legacy.example.com/v1'
        });
    });

    it('uses selected server credential when request API key is blank', () => {
        const selectedCredential = {
            id: 'server#0',
            channelId: 'server',
            apiKey: 'sk-server',
            baseUrl: 'https://server.example.com/v1'
        };

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
                selectedCredential
            }
        );
    });
});
