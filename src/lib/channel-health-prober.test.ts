import { createChannelHealthProber, probeChannelModelsEndpoint } from './channel-health-prober';
import { createChannelRouter, parseChannelPoolConfig } from './channel-router';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';

describe('probeChannelModelsEndpoint', () => {
    it('checks the non-billable models endpoint with the selected credential', async () => {
        const calls: Array<{
            method?: string;
            url?: string;
            authorization?: string;
            accept?: string | string[];
            appId?: string | string[];
            appSecret?: string | string[];
        }> = [];
        const upstream = await startModelsUpstream((request, response) => {
            calls.push({
                method: request.method,
                url: request.url,
                authorization: request.headers.authorization,
                accept: request.headers.accept,
                appId: request.headers['x-app-id'],
                appSecret: request.headers['x-app-secret']
            });
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }));
        });

        try {
            const result = await probeChannelModelsEndpoint({
                credential: {
                    id: 'official#0',
                    channelId: 'official',
                    apiKey: 'sk-test',
                    baseUrl: upstream.baseUrl,
                    upstreamProfile: 'matsca',
                    upstreamHeaders: {
                        Authorization: 'Bearer wrong-key',
                        Accept: 'text/plain',
                        'X-App-ID': 'app-id',
                        'X-App-Secret': 'app-secret'
                    }
                },
                timeoutMs: 5000
            });

            assert.deepEqual(result, { ok: true, status: 200 });
            assert.deepEqual(calls, [
                {
                    method: 'GET',
                    url: '/v1/models',
                    authorization: 'Bearer sk-test',
                    accept: 'application/json',
                    appId: 'app-id',
                    appSecret: 'app-secret'
                }
            ]);
        } finally {
            await upstream.close();
        }
    });

    it('rejects malformed models responses instead of recovering silently', async () => {
        const upstream = await startModelsUpstream((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ object: 'list' }));
        });

        try {
            const result = await probeChannelModelsEndpoint({
                credential: {
                    id: 'official#0',
                    channelId: 'official',
                    apiKey: 'sk-test',
                    baseUrl: upstream.baseUrl,
                    upstreamProfile: 'openai-compatible'
                },
                timeoutMs: 5000
            });

            assert.deepEqual(result, { ok: false, status: 200, code: 'invalid_models_response' });
        } finally {
            await upstream.close();
        }
    });
});

describe('createChannelHealthProber', () => {
    it('runs a limited recovery tick and restores credentials only after successful probes', async () => {
        let now = 1000;
        const upstream = await startModelsUpstream((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }));
        });
        const config = parseChannelPoolConfig({
            OPENAI_ROUTING_STRATEGY: 'round_robin',
            OPENAI_CHANNEL_1_ID: 'a',
            OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
            OPENAI_CHANNEL_1_API_KEYS: 'a1,a2',
            OPENAI_CHANNEL_2_ID: 'b',
            OPENAI_CHANNEL_2_BASE_URL: upstream.baseUrl,
            OPENAI_CHANNEL_2_API_KEYS: 'b1'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        try {
            router.reportFailure(config.credentials[0]);
            router.reportFailure(config.credentials[1]);
            now = 1100;

            const prober = createChannelHealthProber({
                router,
                enabled: true,
                intervalMs: 1000,
                timeoutMs: 5000,
                maxPerTick: 1,
                now: () => now
            });

            assert.deepEqual(await prober.runDueTick(), {
                checked: 1,
                recovered: 1,
                failed: 0
            });
            assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 1);
            assert.equal(router.select().id, 'a#0');
            assert.equal(router.select().id, 'b#0');

            now = 2100;
            assert.deepEqual(await prober.runDueTick(), {
                checked: 1,
                recovered: 1,
                failed: 0
            });
            assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 0);
        } finally {
            await upstream.close();
        }
    });

    it('keeps failed probes isolated without exposing API keys in the summary', async () => {
        let now = 1000;
        const upstream = await startModelsUpstream((_request, response) => {
            response.writeHead(401, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { code: 'invalid_api_key', message: 'bad key' } }));
        });
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'a',
            OPENAI_CHANNEL_1_BASE_URL: upstream.baseUrl,
            OPENAI_CHANNEL_1_API_KEYS: 'a1'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        try {
            router.reportFailure(config.credentials[0], { scope: 'channel' });
            now = 1100;

            const prober = createChannelHealthProber({
                router,
                enabled: true,
                intervalMs: 1000,
                timeoutMs: 5000,
                maxPerTick: 1,
                now: () => now
            });

            assert.deepEqual(await prober.runDueTick(), {
                checked: 1,
                recovered: 0,
                failed: 1
            });
            assert.deepEqual(prober.summary(), {
                enabled: true,
                intervalMs: 1000,
                timeoutMs: 5000,
                maxPerTick: 1,
                running: false,
                pendingProbeCount: 2,
                dueCandidateCount: 0,
                estimatedMinimumDrainTickCount: 2,
                estimatedMinimumDrainMs: 2000,
                lastTickAt: 1100,
                lastCheckedCount: 1,
                lastRecoveredCount: 0,
                lastFailedCount: 1,
                lastProbe: {
                    at: 1100,
                    scope: 'channel',
                    channelId: 'a',
                    credentialId: 'a#0',
                    ok: false,
                    status: 401,
                    code: 'invalid_api_key'
                }
            });
            assert.equal(JSON.stringify(prober.summary()).includes('a1'), false);
            assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 1);
            assert.equal(router.getHealthSummary().pendingRecoveryProbeChannelCount, 1);
            assert.deepEqual(router.getRecoveryProbeCandidates(), []);

            now = 1200;
            assert.deepEqual(
                router.getRecoveryProbeCandidates().map((candidate) => ({
                    scope: candidate.scope,
                    credentialId: candidate.credential.id
                })),
                [{ scope: 'credential', credentialId: 'a#0' }]
            );
        } finally {
            await upstream.close();
        }
    });

    it('does not report a stale successful probe as recovered after a newer failure', async () => {
        let now = 1000;
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'a',
            OPENAI_CHANNEL_1_BASE_URL: 'https://a.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'a1'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });

        router.reportFailure(config.credentials[0]);
        now = 1100;

        const prober = createChannelHealthProber({
            router,
            enabled: true,
            intervalMs: 1000,
            timeoutMs: 5000,
            maxPerTick: 1,
            now: () => now,
            probe: async (candidate) => {
                now = 1110;
                router.reportFailure(candidate.credential);
                return { ok: true, status: 200 };
            }
        });

        assert.deepEqual(await prober.runDueTick(), {
            checked: 1,
            recovered: 0,
            failed: 0
        });
        assert.deepEqual(prober.summary(), {
            enabled: true,
            intervalMs: 1000,
            timeoutMs: 5000,
            maxPerTick: 1,
            running: false,
            pendingProbeCount: 1,
            dueCandidateCount: 0,
            estimatedMinimumDrainTickCount: 1,
            estimatedMinimumDrainMs: 1000,
            lastTickAt: 1100,
            lastCheckedCount: 1,
            lastRecoveredCount: 0,
            lastFailedCount: 0,
            lastProbe: {
                at: 1100,
                scope: 'credential',
                channelId: 'a',
                credentialId: 'a#0',
                ok: true,
                status: 200
            }
        });
        assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 1);
    });

    it('continues with newly eligible credential probes in the same tick when budget remains', async () => {
        let now = 1000;
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'a',
            OPENAI_CHANNEL_1_BASE_URL: 'https://a.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'a1,a2'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });
        router.reportFailure(config.credentials[0], { scope: 'channel' });
        router.reportFailure(config.credentials[1]);
        now = 1100;
        const probedCredentialIds: string[] = [];

        const prober = createChannelHealthProber({
            router,
            enabled: true,
            intervalMs: 1000,
            timeoutMs: 5000,
            maxPerTick: 2,
            now: () => now,
            probe: async (candidate) => {
                probedCredentialIds.push(candidate.credential.id);
                return { ok: true, status: 200 };
            }
        });

        assert.deepEqual(await prober.runDueTick(), {
            checked: 2,
            recovered: 2,
            failed: 0
        });
        assert.deepEqual(probedCredentialIds, ['a#0', 'a#1']);
        assert.equal(router.getHealthSummary().pendingRecoveryProbeChannelCount, 0);
        assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 0);
    });

    it('summarizes pending recovery probe backlog and estimated drain time', () => {
        let now = 1000;
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'a',
            OPENAI_CHANNEL_1_BASE_URL: 'https://a.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'a1,a2,a3'
        });
        const router = createChannelRouter({
            ...config,
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });
        config.credentials.forEach((credential) => router.reportFailure(credential));
        now = 1100;

        const prober = createChannelHealthProber({
            router,
            enabled: true,
            intervalMs: 1000,
            timeoutMs: 5000,
            maxPerTick: 2,
            now: () => now,
            probe: async () => ({ ok: true, status: 200 })
        });

        assert.equal(prober.summary().pendingProbeCount, 3);
        assert.equal(prober.summary().dueCandidateCount, 3);
        assert.equal(prober.summary().estimatedMinimumDrainTickCount, 2);
        assert.equal(prober.summary().estimatedMinimumDrainMs, 2000);
    });

    it('keeps a channel recoverable through sibling credentials after a credential-specific probe failure', async () => {
        let now = 1000;
        const config = parseChannelPoolConfig({
            OPENAI_CHANNEL_1_ID: 'a',
            OPENAI_CHANNEL_1_BASE_URL: 'https://a.example.com/v1',
            OPENAI_CHANNEL_1_API_KEYS: 'bad,good'
        });
        const router = createChannelRouter({
            ...config,
            strategy: 'round_robin',
            failureCooldownMs: 100,
            now: () => now,
            requireProbeForRecovery: true
        });
        router.reportFailure(config.credentials[0], { scope: 'channel' });
        now = 1100;
        const probedCredentialIds: string[] = [];

        const prober = createChannelHealthProber({
            router,
            enabled: true,
            intervalMs: 1000,
            timeoutMs: 5000,
            maxPerTick: 2,
            now: () => now,
            probe: async (candidate) => {
                probedCredentialIds.push(candidate.credential.id);
                if (candidate.credential.id === 'a#0') {
                    return { ok: false, status: 401, code: 'invalid_api_key' };
                }
                return { ok: true, status: 200 };
            }
        });

        assert.deepEqual(await prober.runDueTick(), {
            checked: 2,
            recovered: 1,
            failed: 1
        });
        assert.deepEqual(probedCredentialIds, ['a#0', 'a#1']);
        assert.equal(router.getHealthSummary().pendingRecoveryProbeChannelCount, 0);
        assert.equal(router.getHealthSummary().pendingRecoveryProbeCredentialCount, 1);
        assert.equal(router.select().id, 'a#1');
        assert.throws(() => selectOnlyCredential(router, 'a#0'), /没有可用的健康渠道凭证/);
    });
});

async function startModelsUpstream(
    handler: (request: http.IncomingMessage, response: http.ServerResponse) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer((request, response) => {
        if (request.method !== 'GET' || request.url !== '/v1/models') {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        handler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

function selectOnlyCredential(router: ReturnType<typeof createChannelRouter>, credentialId: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const credential = router.select();
        if (credential.id === credentialId) return credential;
    }
    throw new Error('当前没有可用的健康渠道凭证。');
}
