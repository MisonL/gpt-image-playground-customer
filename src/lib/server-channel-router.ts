import { createChannelRouter, parseChannelPoolConfig } from './channel-router';
import { readPositiveIntegerEnv } from './server-runtime';

const DEFAULT_CHANNEL_FAILURE_COOLDOWN_MS = 60_000;

let cachedServerChannelState: ReturnType<typeof createServerChannelState> | undefined;

export function getServerChannelState() {
    cachedServerChannelState ??= createServerChannelState();
    return cachedServerChannelState;
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

    return { config, router };
}
