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
import { RequestValidationError } from './image-request-utils';
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

    it('accepts HTTP-compatible upstream base URLs in server channels', () => {
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'j3gb',
            OPENAI_CHANNEL_1_BASE_URL: 'http://api.j3gb.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'sk-one'
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
                    credentialCount: 2
                },
                {
                    id: 'backup',
                    baseUrl: 'https://backup.example.com/v1',
                    credentialCount: 1
                }
            ]
        });
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
            unhealthyChannelCount: 0
        });

        router.reportFailure(failed);
        assert.deepEqual(router.getHealthSummary(), {
            credentialCount: 3,
            healthyCredentialCount: 2,
            unhealthyCredentialCount: 1,
            channelCount: 2,
            healthyChannelCount: 2,
            unhealthyChannelCount: 0,
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
            unhealthyChannelCount: 0
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
            lastFailure: {
                at: 1000,
                scope: 'channel'
            }
        });
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
