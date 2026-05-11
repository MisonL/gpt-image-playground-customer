import { RequestValidationError, validateApiBaseUrl } from './image-request-utils';

export type RoutingStrategy = 'sticky' | 'round_robin' | 'random';

export type ChannelCredential = {
    id: string;
    channelId: string;
    apiKey: string;
    baseUrl?: string;
    failureCooldownMs?: number;
};

export type ChannelPoolConfig = {
    strategy: RoutingStrategy;
    credentials: ChannelCredential[];
};

export type ChannelPoolSummary = {
    credentialCount: number;
    channelCount: number;
    strategy: RoutingStrategy;
    channels: Array<{
        id: string;
        baseUrl?: string;
        credentialCount: number;
    }>;
};

export type ChannelRouter = {
    select(options?: { affinityKey?: string }): ChannelCredential;
    reportFailure(credential: ChannelCredential, options?: ChannelFailureReportOptions): void;
    getHealthSummary(): ChannelPoolHealthSummary;
};

export type ChannelFailureReportOptions = {
    scope?: 'credential' | 'channel';
    reason?: ChannelFailureReason;
};

export type ChannelFailureReason = {
    at: number;
    scope: 'credential' | 'channel';
    status?: number;
    code?: string;
    requestId?: string;
    message?: string;
};

export type PublicChannelFailureReason = Omit<ChannelFailureReason, 'message'>;

export type ChannelPoolHealthSummary = {
    credentialCount: number;
    healthyCredentialCount: number;
    unhealthyCredentialCount: number;
    channelCount: number;
    healthyChannelCount: number;
    unhealthyChannelCount: number;
    lastFailure?: ChannelFailureReason;
};

export type EffectiveCredential = {
    apiKey?: string;
    baseUrl?: string;
    selectedCredential?: ChannelCredential;
};

type ChannelRouterOptions = ChannelPoolConfig & {
    random?: () => number;
    failureCooldownMs?: number;
    now?: () => number;
};

const DEFAULT_STRATEGY: RoutingStrategy = 'sticky';
const DEFAULT_FAILURE_COOLDOWN_MS = 60_000;
const VALID_STRATEGIES = new Set<RoutingStrategy>(['sticky', 'round_robin', 'random']);
const CHANNEL_KEY_PATTERN = /^OPENAI_CHANNEL_(\d+)_(ID|BASE_URL|API_KEYS|FAILURE_COOLDOWN_MS)$/;

export function parseChannelPoolConfig(env: Record<string, string | undefined>): ChannelPoolConfig {
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
    const now = options.now || Date.now;
    const failureCooldownMs = Math.max(1, Math.floor(options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS));
    const unhealthyUntilByCredentialId = new Map<string, number>();
    const unhealthyUntilByChannelId = new Map<string, number>();
    const channelIds = Array.from(new Set(options.credentials.map((credential) => credential.channelId)));
    let lastFailure: ChannelFailureReason | undefined;

    const isHealthy = (credential: ChannelCredential) => {
        const currentTime = now();
        return (
            (unhealthyUntilByCredentialId.get(credential.id) ?? 0) <= currentTime &&
            (unhealthyUntilByChannelId.get(credential.channelId) ?? 0) <= currentTime
        );
    };

    const healthyCredentials = () => options.credentials.filter(isHealthy);

    return {
        select(selectOptions = {}) {
            const candidates = healthyCredentials();
            if (candidates.length === 0) {
                throw new RequestValidationError('No healthy channel credential is currently available.', 503);
            }

            if (options.strategy === 'round_robin') {
                const credential = selectRoundRobinHealthy(options.credentials, nextIndex, isHealthy);
                nextIndex = credential.nextIndex;
                return credential.value;
            }

            if (options.strategy === 'random') {
                const index = Math.min(Math.floor(random() * candidates.length), candidates.length - 1);
                return candidates[index];
            }

            const affinityKey = selectOptions.affinityKey || 'default';
            const startIndex = stableHash(affinityKey) % options.credentials.length;
            for (let offset = 0; offset < options.credentials.length; offset += 1) {
                const credential = options.credentials[(startIndex + offset) % options.credentials.length];
                if (isHealthy(credential)) {
                    return credential;
                }
            }

            throw new RequestValidationError('No healthy channel credential is currently available.', 503);
        },
        reportFailure(credential: ChannelCredential, reportOptions = {}) {
            const cooldownMs = credential.failureCooldownMs ?? failureCooldownMs;
            const currentTime = now();
            const unhealthyUntil = currentTime + cooldownMs;
            const scope = reportOptions.scope === 'channel' ? 'channel' : 'credential';
            lastFailure = reportOptions.reason ?? { at: currentTime, scope };
            if (reportOptions.scope === 'channel') {
                unhealthyUntilByChannelId.set(credential.channelId, unhealthyUntil);
                return;
            }
            unhealthyUntilByCredentialId.set(credential.id, unhealthyUntil);
        },
        getHealthSummary() {
            const healthyCredentialCount = healthyCredentials().length;
            const healthyChannelCount = channelIds.filter((channelId) =>
                options.credentials.some((credential) => credential.channelId === channelId && isHealthy(credential))
            ).length;
            return {
                credentialCount: options.credentials.length,
                healthyCredentialCount,
                unhealthyCredentialCount: options.credentials.length - healthyCredentialCount,
                channelCount: channelIds.length,
                healthyChannelCount,
                unhealthyChannelCount: channelIds.length - healthyChannelCount,
                ...(lastFailure ? { lastFailure } : {})
            };
        }
    };
}

function selectRoundRobinHealthy(
    credentials: ChannelCredential[],
    startIndex: number,
    isHealthy: (credential: ChannelCredential) => boolean
): { value: ChannelCredential; nextIndex: number } {
    for (let offset = 0; offset < credentials.length; offset += 1) {
        const index = (startIndex + offset) % credentials.length;
        const credential = credentials[index];
        if (isHealthy(credential)) {
            return {
                value: credential,
                nextIndex: (index + 1) % credentials.length
            };
        }
    }

    throw new RequestValidationError('No healthy channel credential is currently available.', 503);
}

export function getChannelPoolSummary(config: ChannelPoolConfig): ChannelPoolSummary {
    const channels = new Map<string, { id: string; baseUrl?: string; credentialCount: number }>();

    config.credentials.forEach((credential) => {
        const existing = channels.get(credential.channelId);
        if (existing) {
            existing.credentialCount += 1;
            return;
        }
        channels.set(credential.channelId, {
            id: credential.channelId,
            baseUrl: credential.baseUrl,
            credentialCount: 1
        });
    });

    return {
        credentialCount: config.credentials.length,
        channelCount: channels.size,
        strategy: config.strategy,
        channels: Array.from(channels.values())
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

export function isCredentialFailure(error: unknown): boolean {
    const status = readErrorNumber(error, 'status') ?? readNestedErrorNumber(error, 'status');
    if (status === 401 || status === 403 || status === 429) {
        return true;
    }

    const code = readErrorString(error, 'code') || readNestedErrorString(error, 'code');
    return (
        code === 'invalid_api_key' ||
        code === 'insufficient_quota' ||
        code === 'rate_limit_exceeded' ||
        code === 'account_deactivated'
    );
}

export function isChannelFailure(error: unknown): boolean {
    if (error instanceof RequestValidationError || isCredentialFailure(error)) {
        return false;
    }
    if (isConnectionFailure(error)) {
        return true;
    }
    const status = readErrorNumber(error, 'status') ?? readNestedErrorNumber(error, 'status');
    return status === 500 || status === 502 || status === 503 || status === 504 || status === 520 || status === 522 || status === 523 || status === 524;
}

export function describeChannelFailure(error: unknown, scope: 'credential' | 'channel', at = Date.now()): ChannelFailureReason {
    return {
        at,
        scope,
        ...readStatusField(error),
        ...readErrorStringField(error, 'code'),
        ...readRequestIdField(error),
        ...readErrorStringField(error, 'message')
    };
}

export function toPublicChannelFailure(reason: ChannelFailureReason | undefined): PublicChannelFailureReason | undefined {
    if (!reason) {
        return undefined;
    }
    return {
        at: reason.at,
        scope: reason.scope,
        ...(reason.status === undefined ? {} : { status: reason.status }),
        ...(reason.code === undefined ? {} : { code: reason.code }),
        ...(reason.requestId === undefined ? {} : { requestId: reason.requestId })
    };
}

function parseLegacyConfig(env: Record<string, string | undefined>): ChannelPoolConfig {
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

function parseNumberedChannel(env: Record<string, string | undefined>, channelIndex: number): ChannelCredential[] {
    const channelId = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_ID`) || `channel-${channelIndex}`;
    const rawApiKeys = readRequiredEnv(env, `OPENAI_CHANNEL_${channelIndex}_API_KEYS`);
    const baseUrl = normalizeOptionalString(env[`OPENAI_CHANNEL_${channelIndex}_BASE_URL`]);
    const failureCooldownMs = readOptionalPositiveIntegerEnv(env, `OPENAI_CHANNEL_${channelIndex}_FAILURE_COOLDOWN_MS`);
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
        baseUrl,
        ...(failureCooldownMs ? { failureCooldownMs } : {})
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

function readConfiguredChannelIndexes(env: Record<string, string | undefined>): number[] {
    const indexes = new Set<number>();
    Object.keys(env).forEach((key) => {
        const match = key.match(CHANNEL_KEY_PATTERN);
        if (!match) return;
        indexes.add(Number(match[1]));
    });
    return Array.from(indexes).sort((left, right) => left - right);
}

function readRequiredEnv(env: Record<string, string | undefined>, fieldName: string): string {
    const value = env[fieldName];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(`${fieldName} is required.`, 500);
    }
    return value.trim();
}

function readOptionalEnv(env: Record<string, string | undefined>, fieldName: string): string | undefined {
    const value = env[fieldName];
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
}

function readOptionalPositiveIntegerEnv(env: Record<string, string | undefined>, fieldName: string): number | undefined {
    const value = readOptionalEnv(env, fieldName);
    if (!value || !/^\d+$/.test(value)) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
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

function readErrorNumber(error: unknown, fieldName: string): number | undefined {
    if (typeof error !== 'object' || error === null || !(fieldName in error)) {
        return undefined;
    }
    const value = (error as Record<string, unknown>)[fieldName];
    return typeof value === 'number' ? value : undefined;
}

function readStatusField(error: unknown): { status?: number } {
    const value = readErrorNumber(error, 'status') ?? readNestedErrorNumber(error, 'status');
    return value === undefined ? {} : { status: value };
}

function readRequestIdField(error: unknown): { requestId?: string } {
    const value =
        readErrorString(error, 'requestID') ||
        readNestedErrorString(error, 'requestID') ||
        readErrorString(error, 'requestId') ||
        readNestedErrorString(error, 'requestId');
    return value ? { requestId: value } : {};
}

function readErrorStringField(
    error: unknown,
    fieldName: 'code' | 'message'
): { code?: string; message?: string } {
    const value = readErrorString(error, fieldName) || readNestedErrorString(error, fieldName);
    if (!value) {
        return {};
    }
    return { [fieldName]: value };
}

function readErrorString(error: unknown, fieldName: string): string | undefined {
    if (typeof error !== 'object' || error === null || !(fieldName in error)) {
        return undefined;
    }
    const value = (error as Record<string, unknown>)[fieldName];
    return typeof value === 'string' ? value : undefined;
}

function readNestedErrorString(error: unknown, fieldName: string): string | undefined {
    if (typeof error !== 'object' || error === null || !('error' in error)) {
        return undefined;
    }
    return readErrorString((error as { error?: unknown }).error, fieldName);
}

function readNestedErrorNumber(error: unknown, fieldName: string): number | undefined {
    if (typeof error !== 'object' || error === null || !('error' in error)) {
        return undefined;
    }
    return readErrorNumber((error as { error?: unknown }).error, fieldName);
}

function isConnectionFailure(error: unknown): boolean {
    const name = readErrorString(error, 'name') || readConstructorName(error);
    if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') {
        return true;
    }

    const code = readErrorString(error, 'code') || readCauseChainString(error, 'code');
    return (
        code === 'ENOTFOUND' ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'EAI_AGAIN'
    );
}

function readConstructorName(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const constructorValue = (error as { constructor?: unknown }).constructor;
    if (typeof constructorValue !== 'function') {
        return undefined;
    }
    return constructorValue.name;
}

function readCauseChainString(error: unknown, fieldName: string, depth = 0): string | undefined {
    if (depth > 4 || typeof error !== 'object' || error === null || !('cause' in error)) {
        return undefined;
    }
    const cause = (error as { cause?: unknown }).cause;
    return readErrorString(cause, fieldName) || readCauseChainString(cause, fieldName, depth + 1);
}
