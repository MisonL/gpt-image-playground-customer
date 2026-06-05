import { createChannelHealthProber, type ChannelHealthProber } from './channel-health-prober';
import { createChannelRouter, parseChannelPoolConfig } from './channel-router';
import { readBooleanEnv, readPositiveIntegerEnv } from './server-runtime';
import { createStreamingAvailabilityRegistry } from './streaming-availability';

const DEFAULT_CHANNEL_FAILURE_COOLDOWN_MS = 60_000;
const DEFAULT_CHANNEL_RECOVERY_PROBE_INTERVAL_MS = 60_000;
const DEFAULT_CHANNEL_RECOVERY_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_CHANNEL_RECOVERY_PROBE_MAX_PER_TICK = 1;

let cachedServerChannelState: ReturnType<typeof createServerChannelState> | undefined;

export function getServerChannelState() {
    cachedServerChannelState ??= createServerChannelState();
    return cachedServerChannelState;
}

export function resetServerChannelStateForTests(): void {
    const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';
    if (!isTestRuntime) {
        throw new Error('resetServerChannelStateForTests 只能在测试环境中调用。');
    }
    cachedServerChannelState?.stopChannelRecoveryProbeScheduler?.();
    cachedServerChannelState = undefined;
}

function createServerChannelState() {
    const config = parseChannelPoolConfig(process.env);
    const recoveryProbeEnabled =
        config.credentials.length > 0 &&
        readBooleanEnvDefault(process.env, 'OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED', true);
    const requireProbeForRecovery =
        readOptionalBooleanEnv(process.env, 'OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY') ?? recoveryProbeEnabled;
    if (requireProbeForRecovery && !recoveryProbeEnabled) {
        throw new Error(
            'OPENAI_CHANNEL_REQUIRE_PROBE_FOR_RECOVERY=true 需要同时启用 OPENAI_CHANNEL_RECOVERY_PROBE_ENABLED。'
        );
    }
    const router =
        config.credentials.length > 0
            ? createChannelRouter({
                  ...config,
                  failureCooldownMs: readPositiveIntegerEnv(
                      process.env,
                      'OPENAI_CHANNEL_FAILURE_COOLDOWN_MS',
                      DEFAULT_CHANNEL_FAILURE_COOLDOWN_MS
                  ),
                  requireProbeForRecovery
              })
            : undefined;
    const channelRecoveryProber = createRecoveryProber(router, recoveryProbeEnabled);
    const stopChannelRecoveryProbeScheduler = startChannelRecoveryProbeScheduler(channelRecoveryProber);

    return {
        config,
        router,
        channelRecovery: { requireProbeForRecovery },
        channelRecoveryProber,
        stopChannelRecoveryProbeScheduler,
        streamingAvailability: createStreamingAvailabilityRegistry()
    };
}

function createRecoveryProber(router: ReturnType<typeof createChannelRouter> | undefined, enabled: boolean) {
    if (!router) {
        return undefined;
    }
    return createChannelHealthProber({
        router,
        enabled,
        intervalMs: readPositiveIntegerEnv(
            process.env,
            'OPENAI_CHANNEL_RECOVERY_PROBE_INTERVAL_MS',
            DEFAULT_CHANNEL_RECOVERY_PROBE_INTERVAL_MS
        ),
        timeoutMs: readPositiveIntegerEnv(
            process.env,
            'OPENAI_CHANNEL_RECOVERY_PROBE_TIMEOUT_MS',
            DEFAULT_CHANNEL_RECOVERY_PROBE_TIMEOUT_MS
        ),
        maxPerTick: readPositiveIntegerEnv(
            process.env,
            'OPENAI_CHANNEL_RECOVERY_PROBE_MAX_PER_TICK',
            DEFAULT_CHANNEL_RECOVERY_PROBE_MAX_PER_TICK
        )
    });
}

function startChannelRecoveryProbeScheduler(prober: ChannelHealthProber | undefined): (() => void) | undefined {
    if (!prober) {
        return undefined;
    }
    const summary = prober.summary();
    if (!summary.enabled) {
        return undefined;
    }
    const timer = setInterval(() => {
        void prober.runDueTick().catch((error: unknown) => {
            console.warn('channel recovery probe tick failed', error instanceof Error ? error.message : error);
        });
    }, summary.intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

function readBooleanEnvDefault(env: Record<string, string | undefined>, fieldName: string, fallback: boolean): boolean {
    return readOptionalBooleanEnv(env, fieldName) ?? fallback;
}

function readOptionalBooleanEnv(env: Record<string, string | undefined>, fieldName: string): boolean | undefined {
    if (env[fieldName] === undefined) {
        return undefined;
    }
    return readBooleanEnv(env, fieldName);
}
