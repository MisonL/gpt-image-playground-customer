import { createChannelRouter, parseChannelPoolConfig } from './channel-router';
import { readPositiveIntegerEnv } from './server-runtime';
import { createStreamingAvailabilityRegistry } from './streaming-availability';

const DEFAULT_CHANNEL_FAILURE_COOLDOWN_MS = 60_000;

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
    cachedServerChannelState = undefined;
}

function createServerChannelState() {
    const config = parseChannelPoolConfig(process.env);
    const router =
        config.credentials.length > 0
            ? createChannelRouter({
                  ...config,
                  failureCooldownMs: readPositiveIntegerEnv(
                      process.env,
                      'OPENAI_CHANNEL_FAILURE_COOLDOWN_MS',
                      DEFAULT_CHANNEL_FAILURE_COOLDOWN_MS
                  )
              })
            : undefined;

    return { config, router, streamingAvailability: createStreamingAvailabilityRegistry() };
}
