import {
    getExistingServerChannelState,
    getServerChannelState,
    resetServerChannelStateForTests
} from '@/lib/server-channel-router';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.npm_lifecycle_event = 'test';
    process.env.AGENT_API_TOKEN = 'health-diagnostics-token';
    process.env.OPENAI_CHANNEL_FAILURE_COOLDOWN_ENABLED = 'true';
    process.env.OPENAI_CHANNEL_1_ID = 'primary';
    process.env.OPENAI_CHANNEL_1_BASE_URL = 'https://images.example.test/v1';
    process.env.OPENAI_CHANNEL_1_API_KEYS = 'health-channel-secret,secondary-secret';
    process.env.OPENAI_CHANNEL_1_REQUEST_MODES = 'images-non-stream,images-sse';
    delete process.env.OPENAI_UPSTREAM_PROXY_URL;
    delete process.env.OPENAI_CHANNEL_1_PROXY_URL;
    resetServerChannelStateForTests();
});

afterEach(() => {
    resetServerChannelStateForTests();
    restoreProcessEnv(originalEnv);
});

describe('GET /api/agent/diagnostics/channel-health', () => {
    it('rejects unauthenticated requests before reading channel state', async () => {
        const { GET } = await import('./route');

        const response = await GET(new NextRequest('http://localhost/api/agent/diagnostics/channel-health'));
        const body = (await response.json()) as { error: { code: string } };

        assert.equal(response.status, 401);
        assert.equal(body.error.code, 'unauthorized');
        assert.ok(response.headers.get('X-Request-Id'));
        assert.equal(getExistingServerChannelState(), undefined);
    });

    it('does not initialize channel state for an authorized read', async () => {
        const { GET } = await import('./route');

        const response = await GET(
            new NextRequest('http://localhost/api/agent/diagnostics/channel-health', {
                headers: { Authorization: 'Bearer health-diagnostics-token' }
            })
        );
        const body = (await response.json()) as Record<string, unknown>;

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(body.state_initialized, false);
        const snapshot = body.snapshot as { observed_at: unknown; channels: unknown };
        assert.equal(typeof snapshot.observed_at, 'number');
        assert.deepEqual(snapshot.channels, []);
        assert.equal(getExistingServerChannelState(), undefined);
    });

    it('returns a sanitized live channel health snapshot for an authorized Agent', async () => {
        const state = getServerChannelState();
        state.router?.reportFailure(state.config.credentials[0], {
            reason: {
                at: 1_000,
                scope: 'credential',
                status: 429,
                code: 'rate_limited',
                message: 'upstream secret detail'
            }
        });
        const { GET } = await import('./route');

        const response = await GET(
            new NextRequest('http://localhost/api/agent/diagnostics/channel-health', {
                headers: { Authorization: 'Bearer health-diagnostics-token' }
            })
        );
        const body = (await response.json()) as Record<string, unknown>;

        assert.equal(response.status, 200);
        assert.ok(response.headers.get('X-Request-Id'));
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(body.ok, true);
        assert.equal(body.billable, false);
        assert.equal(body.source, 'in_process_channel_router');
        assert.equal(body.state_scope, 'process_local');
        assert.equal(body.state_initialized, true);
        assert.equal(JSON.stringify(body).includes('health-channel-secret'), false);
        assert.equal(JSON.stringify(body).includes('upstream secret detail'), false);
        const snapshot = body.snapshot as {
            observed_at: number;
            channels: Array<{
                credentials: Array<{ cooldown_until?: number; request_modes: Array<{ cooldown_until?: number }> }>;
            }>;
        };
        assert.equal(typeof snapshot.observed_at, 'number');
        assert.equal(typeof snapshot.channels[0].credentials[0].cooldown_until, 'number');
        assert.ok((snapshot.channels[0].credentials[0].cooldown_until || 0) > snapshot.observed_at);
        assert.equal(typeof snapshot.channels[0].credentials[0].request_modes[0].cooldown_until, 'number');
        assert.equal(typeof snapshot.channels[0].credentials[0].request_modes[1].cooldown_until, 'number');
        assert.deepEqual(stripCooldownFields(snapshot), {
            channels: [
                {
                    channel_id: 'primary',
                    upstream_proxy: { configured: false },
                    credential_count: 2,
                    healthy_credential_count: 1,
                    unhealthy_credential_count: 1,
                    state: 'healthy',
                    probe_required: true,
                    credentials: [
                        {
                            credential_id: 'primary#0',
                            state: 'probe_pending',
                            probe_required: true,
                            last_failure: {
                                at: 1_000,
                                scope: 'credential',
                                status: 429,
                                code: 'rate_limited'
                            },
                            request_modes: [
                                {
                                    mode: 'images-non-stream',
                                    state: 'probe_pending',
                                    probe_required: true
                                },
                                {
                                    mode: 'images-sse',
                                    state: 'probe_pending',
                                    probe_required: true
                                }
                            ]
                        },
                        {
                            credential_id: 'primary#1',
                            state: 'healthy',
                            probe_required: false,
                            request_modes: [
                                {
                                    mode: 'images-non-stream',
                                    state: 'healthy',
                                    probe_required: false
                                },
                                {
                                    mode: 'images-sse',
                                    state: 'healthy',
                                    probe_required: false
                                }
                            ]
                        }
                    ]
                }
            ]
        });
    });
});

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv) {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(snapshot)) {
        process.env[key] = value;
    }
}

function stripCooldownFields(snapshot: {
    observed_at: number;
    channels: Array<{
        credentials: Array<{ cooldown_until?: number; request_modes: Array<{ cooldown_until?: number }> }>;
    }>;
}) {
    return {
        channels: snapshot.channels.map((channel) => ({
            ...channel,
            credentials: channel.credentials.map((credential) => {
                const withoutCredentialCooldown = omitCooldownUntil(credential);
                return {
                    ...withoutCredentialCooldown,
                    request_modes: withoutCredentialCooldown.request_modes.map(omitCooldownUntil)
                };
            })
        }))
    };
}

function omitCooldownUntil<T extends { cooldown_until?: number }>(value: T): Omit<T, 'cooldown_until'> {
    const copy = { ...value };
    delete copy.cooldown_until;
    return copy;
}
