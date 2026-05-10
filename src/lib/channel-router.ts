import { RequestValidationError, validateApiBaseUrl } from './image-request-utils';

export type RoutingStrategy = 'sticky' | 'round_robin' | 'random';

export type ChannelCredential = {
    id: string;
    channelId: string;
    apiKey: string;
    baseUrl?: string;
};

export type ChannelPoolConfig = {
    strategy: RoutingStrategy;
    credentials: ChannelCredential[];
};

export type ChannelRouter = {
    select(options?: { affinityKey?: string }): ChannelCredential;
};

export type EffectiveCredential = {
    apiKey?: string;
    baseUrl?: string;
    selectedCredential?: ChannelCredential;
};

type ChannelRouterOptions = ChannelPoolConfig & {
    random?: () => number;
};

const DEFAULT_STRATEGY: RoutingStrategy = 'sticky';
const VALID_STRATEGIES = new Set<RoutingStrategy>(['sticky', 'round_robin', 'random']);
const CHANNEL_KEY_PATTERN = /^OPENAI_CHANNEL_(\d+)_(ID|BASE_URL|API_KEYS)$/;

export function parseChannelPoolConfig(env: NodeJS.ProcessEnv): ChannelPoolConfig {
    if (env.OPENAI_CHANNELS_JSON?.trim()) {
        throw new RequestValidationError(
            'OPENAI_CHANNELS_JSON has been removed. Use OPENAI_ROUTING_STRATEGY and OPENAI_CHANNEL_N_* variables instead.',
            500
        );
    }

    const channelIndexes = readConfiguredChannelIndexes(env);
    if (channelIndexes.length === 0) {
        return parseLegacyConfig(env);
    }

    const strategy = readStrategy(env.OPENAI_ROUTING_STRATEGY, 'OPENAI_ROUTING_STRATEGY');
    const credentials = channelIndexes.flatMap((channelIndex) => parseNumberedChannel(env, channelIndex));

    if (credentials.length === 0) {
        throw new RequestValidationError('At least one OPENAI_CHANNEL_N_API_KEYS value is required.', 500);
    }

    return { strategy, credentials };
}

export function createChannelRouter(options: ChannelRouterOptions): ChannelRouter {
    if (options.credentials.length === 0) {
        throw new RequestValidationError('At least one channel credential is required.', 500);
    }

    let nextIndex = 0;
    const random = options.random || Math.random;

    return {
        select(selectOptions = {}) {
            if (options.strategy === 'round_robin') {
                const credential = options.credentials[nextIndex % options.credentials.length];
                nextIndex += 1;
                return credential;
            }

            if (options.strategy === 'random') {
                const index = Math.min(
                    Math.floor(random() * options.credentials.length),
                    options.credentials.length - 1
                );
                return options.credentials[index];
            }

            const affinityKey = selectOptions.affinityKey || 'default';
            return options.credentials[stableHash(affinityKey) % options.credentials.length];
        }
    };
}

export function resolveEffectiveCredential(options: {
    requestApiKey: string;
    requestApiBaseUrl: string;
    legacyBaseUrl?: string;
    selectedCredential?: ChannelCredential;
}): EffectiveCredential {
    if (options.requestApiKey) {
        return {
            apiKey: options.requestApiKey,
            baseUrl: options.requestApiBaseUrl || normalizeOptionalString(options.legacyBaseUrl)
        };
    }

    return {
        apiKey: options.selectedCredential?.apiKey,
        baseUrl: options.requestApiBaseUrl || options.selectedCredential?.baseUrl,
        selectedCredential: options.selectedCredential
    };
}

function parseLegacyConfig(env: NodeJS.ProcessEnv): ChannelPoolConfig {
    const apiKey = env.OPENAI_API_KEY?.trim();
    const baseUrl = normalizeOptionalString(env.OPENAI_API_BASE_URL);

    if (!apiKey) {
        return { strategy: DEFAULT_STRATEGY, credentials: [] };
    }

    if (baseUrl) {
        validateApiBaseUrl(baseUrl);
    }

    return {
        strategy: DEFAULT_STRATEGY,
        credentials: [
            {
                id: 'default#0',
                channelId: 'default',
                apiKey,
                baseUrl
            }
        ]
    };
}

function parseNumberedChannel(env: NodeJS.ProcessEnv, channelIndex: number): ChannelCredential[] {
    const channelId = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_ID`) || `channel-${channelIndex}`;
    const rawApiKeys = readRequiredEnv(env, `OPENAI_CHANNEL_${channelIndex}_API_KEYS`);
    const baseUrl = normalizeOptionalString(env[`OPENAI_CHANNEL_${channelIndex}_BASE_URL`]);
    if (baseUrl) {
        validateApiBaseUrl(baseUrl);
    }

    const apiKeys = rawApiKeys
        .split(',')
        .map((apiKey) => apiKey.trim())
        .filter(Boolean);
    if (apiKeys.length === 0) {
        throw new RequestValidationError(`OPENAI_CHANNEL_${channelIndex}_API_KEYS must contain at least one key.`, 500);
    }

    return apiKeys.map((apiKey, keyIndex) => ({
        id: `${channelId}#${keyIndex}`,
        channelId,
        apiKey,
        baseUrl
    }));
}

function readStrategy(value: unknown, fieldName: string): RoutingStrategy {
    if (value === undefined || value === null || value === '') {
        return DEFAULT_STRATEGY;
    }
    if (typeof value !== 'string' || !VALID_STRATEGIES.has(value as RoutingStrategy)) {
        throw new RequestValidationError(`${fieldName} must be sticky, round_robin, or random.`, 500);
    }
    return value as RoutingStrategy;
}

function readConfiguredChannelIndexes(env: NodeJS.ProcessEnv): number[] {
    const indexes = new Set<number>();
    Object.keys(env).forEach((key) => {
        const match = key.match(CHANNEL_KEY_PATTERN);
        if (!match) return;
        indexes.add(Number(match[1]));
    });
    return Array.from(indexes).sort((left, right) => left - right);
}

function readRequiredEnv(env: NodeJS.ProcessEnv, fieldName: string): string {
    const value = env[fieldName];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(`${fieldName} is required.`, 500);
    }
    return value.trim();
}

function readOptionalEnv(env: NodeJS.ProcessEnv, fieldName: string): string | undefined {
    const value = env[fieldName];
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new RequestValidationError('Channel baseUrl must be a string.', 500);
    }
    const normalized = value.trim();
    return normalized || undefined;
}

function stableHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
