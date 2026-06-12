import {
    IMAGE_UPSTREAM_PROFILES,
    buildMatscaAppHeaders,
    isValidImageUpstreamProfileId,
    mergeUpstreamHeaders,
    normalizeConfiguredUpstreamHeaders,
    readImageUpstreamProfile,
    summarizeUpstreamRequestHeaders,
    type ImageUpstreamProfile,
    type ImageUpstreamProfileId,
    type UpstreamRequestHeaders
} from './image-upstream-profile';
import {
    createProviderManifestSummary,
    createProviderManifestProfile,
    parseImageProviderManifest,
    type ImageProviderManifest,
    type ImageProviderManifestSummary
} from './image-upstream-provider-manifest';
import { ChannelCapacityQueueError } from './channel-capacity-queue';
import { RequestValidationError, readPlainHttpApiBaseUrlAllowlist, validateApiBaseUrl } from './image-request-utils';

export type RoutingStrategy = 'sticky' | 'round_robin' | 'random';

export type ChannelCredential = {
    id: string;
    channelId: string;
    apiKey: string;
    baseUrl?: string;
    upstreamProfile: ImageUpstreamProfileId;
    upstreamHeaders?: UpstreamRequestHeaders;
    providerManifest?: ImageProviderManifestSummary;
    providerProfile?: ImageUpstreamProfile;
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
        upstreamProfile: ImageUpstreamProfileId;
        effectiveProfile: ImageUpstreamProfile;
        hasExtraHeaders: boolean;
        requestHeaders: ReturnType<typeof summarizeUpstreamRequestHeaders>;
        providerManifest?: ImageProviderManifestSummary;
        credentialCount: number;
    }>;
};

export type ChannelRouter = {
    select(options?: { affinityKey?: string }): ChannelCredential;
    reportFailure(credential: ChannelCredential, options?: ChannelFailureReportOptions): ChannelFailureReport;
    getRecoveryProbeCandidates(): ChannelRecoveryProbeCandidate[];
    reportRecoveryProbeSuccess(candidate: ChannelRecoveryProbeCandidate): boolean;
    reportRecoveryProbeFailure(candidate: ChannelRecoveryProbeCandidate, reason?: ChannelFailureReason): void;
    getHealthSummary(): ChannelPoolHealthSummary;
};

export type ChannelFailureReportOptions = {
    scope?: 'credential' | 'channel';
    reason?: ChannelFailureReason;
};

export type ChannelFailureReport = {
    scope: 'credential' | 'channel';
    cooldownApplied: boolean;
    cooldownUntil: number;
    retryAfterMs: number;
    target: {
        channelId: string;
        credentialId?: string;
    };
    reason: ChannelFailureReason;
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
    pendingRecoveryProbeCredentialCount: number;
    pendingRecoveryProbeChannelCount: number;
    lastFailure?: ChannelFailureReason;
};

export type ChannelRecoveryProbeCandidate = {
    scope: 'credential' | 'channel';
    credential: ChannelCredential;
    unhealthyUntil: number;
};

export type EffectiveCredential = {
    apiKey?: string;
    baseUrl?: string;
    upstreamProfile: ImageUpstreamProfileId;
    providerProfile?: ImageUpstreamProfile;
    upstreamHeaders?: UpstreamRequestHeaders;
    selectedCredential?: ChannelCredential;
};

type ChannelRouterOptions = ChannelPoolConfig & {
    random?: () => number;
    failureCooldownEnabled?: boolean;
    failureCooldownMs?: number;
    now?: () => number;
    requireProbeForRecovery?: boolean;
};

const DEFAULT_STRATEGY: RoutingStrategy = 'sticky';
const DEFAULT_FAILURE_COOLDOWN_MS = 30_000;
const VALID_STRATEGIES = new Set<RoutingStrategy>(['sticky', 'round_robin', 'random']);
const CHANNEL_KEY_PATTERN =
    /^OPENAI_CHANNEL_(\d+)_(ID|BASE_URL|API_KEYS|UPSTREAM_PROFILE|PROVIDER_MANIFEST|MATSCA_APP_ID|MATSCA_APP_SECRET|USER_AGENT|UPSTREAM_HEADERS_JSON|FAILURE_COOLDOWN_MS)$/;

export function parseChannelPoolConfig(env: Record<string, string | undefined>): ChannelPoolConfig {
    if (env.OPENAI_CHANNELS_JSON?.trim()) {
        throw new RequestValidationError(
            'OPENAI_CHANNELS_JSON 已移除。请改用 OPENAI_ROUTING_STRATEGY 和 OPENAI_CHANNEL_N_* 变量。',
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
        throw new RequestValidationError('至少需要配置一个 OPENAI_CHANNEL_N_API_KEYS 值。', 500);
    }

    return { strategy, credentials };
}

export function createChannelRouter(options: ChannelRouterOptions): ChannelRouter {
    if (options.credentials.length === 0) {
        throw new RequestValidationError('至少需要一个渠道凭证。', 500);
    }

    let nextIndex = 0;
    const random = options.random || Math.random;
    const now = options.now || Date.now;
    const failureCooldownEnabled = options.failureCooldownEnabled ?? true;
    const failureCooldownMs = Math.max(1, Math.floor(options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS));
    const unhealthyUntilByCredentialId = new Map<string, number>();
    const unhealthyUntilByChannelId = new Map<string, number>();
    const probeRequiredCredentialIds = new Set<string>();
    const probeRequiredChannelIds = new Set<string>();
    const channelIds = Array.from(new Set(options.credentials.map((credential) => credential.channelId)));
    let lastFailure: ChannelFailureReason | undefined;

    const isCoolingDown = (credential: ChannelCredential) => {
        const currentTime = now();
        return (
            (unhealthyUntilByCredentialId.get(credential.id) ?? 0) > currentTime ||
            (unhealthyUntilByChannelId.get(credential.channelId) ?? 0) > currentTime
        );
    };

    const isWaitingForProbe = (credential: ChannelCredential) => {
        if (!options.requireProbeForRecovery) return false;
        return probeRequiredCredentialIds.has(credential.id) || probeRequiredChannelIds.has(credential.channelId);
    };

    const isHealthy = (credential: ChannelCredential) => {
        return !isCoolingDown(credential) && !isWaitingForProbe(credential);
    };

    const healthyCredentials = () => options.credentials.filter(isHealthy);
    const setCooldown = (
        credential: ChannelCredential,
        scope: 'credential' | 'channel'
    ): { cooldownApplied: boolean; cooldownUntil: number; retryAfterMs: number } => {
        if (!failureCooldownEnabled) {
            return { cooldownApplied: false, cooldownUntil: now(), retryAfterMs: 0 };
        }
        const cooldownMs = credential.failureCooldownMs ?? failureCooldownMs;
        const unhealthyUntil = now() + cooldownMs;
        if (scope === 'channel') {
            unhealthyUntilByChannelId.set(credential.channelId, unhealthyUntil);
            if (options.requireProbeForRecovery) probeRequiredChannelIds.add(credential.channelId);
            return { cooldownApplied: true, cooldownUntil: unhealthyUntil, retryAfterMs: cooldownMs };
        }
        unhealthyUntilByCredentialId.set(credential.id, unhealthyUntil);
        if (options.requireProbeForRecovery) probeRequiredCredentialIds.add(credential.id);
        return { cooldownApplied: true, cooldownUntil: unhealthyUntil, retryAfterMs: cooldownMs };
    };

    return {
        select(selectOptions = {}) {
            const candidates = healthyCredentials();
            if (candidates.length === 0) {
                throw new RequestValidationError('当前没有可用的健康渠道凭证。', 503);
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

            throw new RequestValidationError('当前没有可用的健康渠道凭证。', 503);
        },
        reportFailure(credential: ChannelCredential, reportOptions = {}) {
            const currentTime = now();
            const scope = reportOptions.scope === 'channel' ? 'channel' : 'credential';
            lastFailure = reportOptions.reason ?? { at: currentTime, scope };
            const cooldown = setCooldown(credential, scope);
            return {
                scope,
                cooldownApplied: cooldown.cooldownApplied,
                cooldownUntil: cooldown.cooldownUntil,
                retryAfterMs: cooldown.retryAfterMs,
                target: {
                    channelId: credential.channelId,
                    ...(scope === 'credential' ? { credentialId: credential.id } : {})
                },
                reason: lastFailure
            };
        },
        getRecoveryProbeCandidates() {
            if (!options.requireProbeForRecovery) return [];
            const currentTime = now();
            const candidates: ChannelRecoveryProbeCandidate[] = [];
            const queuedChannelIds = new Set<string>();
            const dueChannelIds = new Set<string>();
            for (const credential of options.credentials) {
                const channelUnhealthyUntil = unhealthyUntilByChannelId.get(credential.channelId) ?? 0;
                const credentialUnhealthyUntil = unhealthyUntilByCredentialId.get(credential.id) ?? 0;
                const credentialProbeIsNewer =
                    probeRequiredCredentialIds.has(credential.id) && credentialUnhealthyUntil > channelUnhealthyUntil;
                const channelReady =
                    probeRequiredChannelIds.has(credential.channelId) &&
                    channelUnhealthyUntil <= currentTime;
                if (channelReady) {
                    dueChannelIds.add(credential.channelId);
                }
                if (
                    channelReady &&
                    !credentialProbeIsNewer &&
                    !queuedChannelIds.has(credential.channelId)
                ) {
                    candidates.push({
                        scope: 'channel',
                        credential,
                        unhealthyUntil: channelUnhealthyUntil
                    });
                    queuedChannelIds.add(credential.channelId);
                }
            }

            for (const credential of options.credentials) {
                const credentialUnhealthyUntil = unhealthyUntilByCredentialId.get(credential.id) ?? 0;
                const credentialReady =
                    probeRequiredCredentialIds.has(credential.id) &&
                    credentialUnhealthyUntil <= currentTime &&
                    (!probeRequiredChannelIds.has(credential.channelId) ||
                        (dueChannelIds.has(credential.channelId) && !queuedChannelIds.has(credential.channelId)));
                if (credentialReady) {
                    candidates.push({
                        scope: 'credential',
                        credential,
                        unhealthyUntil: credentialUnhealthyUntil
                    });
                }
            }
            return candidates;
        },
        reportRecoveryProbeSuccess(candidate: ChannelRecoveryProbeCandidate) {
            if (candidate.scope === 'channel') {
                if ((unhealthyUntilByChannelId.get(candidate.credential.channelId) ?? 0) !== candidate.unhealthyUntil) {
                    return false;
                }
                unhealthyUntilByChannelId.delete(candidate.credential.channelId);
                probeRequiredChannelIds.delete(candidate.credential.channelId);
                if ((unhealthyUntilByCredentialId.get(candidate.credential.id) ?? 0) <= candidate.unhealthyUntil) {
                    unhealthyUntilByCredentialId.delete(candidate.credential.id);
                    probeRequiredCredentialIds.delete(candidate.credential.id);
                }
                return true;
            }
            if ((unhealthyUntilByCredentialId.get(candidate.credential.id) ?? 0) !== candidate.unhealthyUntil) {
                return false;
            }
            unhealthyUntilByCredentialId.delete(candidate.credential.id);
            probeRequiredCredentialIds.delete(candidate.credential.id);
            return true;
        },
        reportRecoveryProbeFailure(candidate: ChannelRecoveryProbeCandidate, reason) {
            lastFailure = reason ?? {
                at: now(),
                scope: candidate.scope
            };
            setCooldown(candidate.credential, candidate.scope);
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
                pendingRecoveryProbeCredentialCount: probeRequiredCredentialIds.size,
                pendingRecoveryProbeChannelCount: probeRequiredChannelIds.size,
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

    throw new RequestValidationError('当前没有可用的健康渠道凭证。', 503);
}

export function getChannelPoolSummary(config: ChannelPoolConfig): ChannelPoolSummary {
    const channels = new Map<
        string,
        {
            id: string;
            baseUrl?: string;
            upstreamProfile: ImageUpstreamProfileId;
            effectiveProfile: ImageUpstreamProfile;
            hasExtraHeaders: boolean;
            requestHeaders: ReturnType<typeof summarizeUpstreamRequestHeaders>;
            providerManifest?: ImageProviderManifestSummary;
            credentialCount: number;
        }
    >();

    config.credentials.forEach((credential) => {
        const existing = channels.get(credential.channelId);
        if (existing) {
            existing.credentialCount += 1;
            return;
        }
        channels.set(credential.channelId, {
            id: credential.channelId,
            baseUrl: credential.baseUrl,
            upstreamProfile: credential.upstreamProfile,
            effectiveProfile: credential.providerProfile || IMAGE_UPSTREAM_PROFILES[credential.upstreamProfile],
            hasExtraHeaders: Boolean(credential.upstreamHeaders),
            requestHeaders: summarizeUpstreamRequestHeaders(credential.upstreamHeaders),
            ...(credential.providerManifest ? { providerManifest: credential.providerManifest } : {}),
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
        const requestProfile = readImageUpstreamProfile({ baseUrl: options.requestApiBaseUrl || options.legacyBaseUrl });
        return {
            apiKey: options.requestApiKey,
            baseUrl: options.requestApiBaseUrl || normalizeOptionalString(options.legacyBaseUrl),
            upstreamProfile: requestProfile.id
        };
    }

    return {
        apiKey: options.selectedCredential?.apiKey,
        baseUrl: options.selectedCredential?.baseUrl,
        upstreamProfile: options.selectedCredential?.upstreamProfile || DEFAULT_EFFECTIVE_PROFILE_ID,
        ...(options.selectedCredential?.providerProfile
            ? { providerProfile: options.selectedCredential.providerProfile }
            : {}),
        upstreamHeaders: options.selectedCredential?.upstreamHeaders,
        selectedCredential: options.selectedCredential
    };
}

export function isCredentialFailure(error: unknown): boolean {
    if (error instanceof ChannelCapacityQueueError) {
        return false;
    }
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
    if (error instanceof ChannelCapacityQueueError) {
        return false;
    }
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
        validateApiBaseUrl(baseUrl, {
            allowedPlainHttpBaseUrls: readPlainHttpApiBaseUrlAllowlist(env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS)
        });
    }

    const rawProfile = readOptionalEnv(env, 'OPENAI_UPSTREAM_PROFILE');
    if (rawProfile && !isValidImageUpstreamProfileId(rawProfile)) {
        throw new RequestValidationError('OPENAI_UPSTREAM_PROFILE 必须是 openai-compatible 或 matsca。', 500);
    }

    return {
        strategy: DEFAULT_STRATEGY,
        credentials: [
            {
                id: 'default#0',
                channelId: 'default',
                apiKey,
                baseUrl,
                upstreamProfile: readImageUpstreamProfile({
                    explicitProfile: rawProfile,
                    channelId: 'default',
                    baseUrl
                }).id
            }
        ]
    };
}

function parseNumberedChannel(env: Record<string, string | undefined>, channelIndex: number): ChannelCredential[] {
    const channelId = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_ID`) || `channel-${channelIndex}`;
    const rawApiKeys = readRequiredEnv(env, `OPENAI_CHANNEL_${channelIndex}_API_KEYS`);
    const baseUrl = normalizeOptionalString(env[`OPENAI_CHANNEL_${channelIndex}_BASE_URL`]);
    const upstreamProfile = readChannelProfile(env, channelIndex, channelId, baseUrl);
    const upstreamHeaders = readChannelUpstreamHeaders(env, channelIndex, upstreamProfile);
    const providerManifest = readChannelProviderManifest(env, channelIndex, upstreamProfile);
    const providerProfile = providerManifest ? createProviderManifestProfile(providerManifest) : undefined;
    const failureCooldownMs = readOptionalPositiveIntegerEnv(env, `OPENAI_CHANNEL_${channelIndex}_FAILURE_COOLDOWN_MS`);
    if (baseUrl) {
        validateApiBaseUrl(baseUrl, {
            allowedPlainHttpBaseUrls: readPlainHttpApiBaseUrlAllowlist(env.OPENAI_ALLOWED_PLAIN_HTTP_API_BASE_URLS)
        });
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
        upstreamProfile,
        ...(upstreamHeaders ? { upstreamHeaders } : {}),
        ...(providerManifest ? { providerManifest: createProviderManifestSummary(providerManifest) } : {}),
        ...(providerProfile ? { providerProfile } : {}),
        ...(failureCooldownMs ? { failureCooldownMs } : {})
    }));
}

const DEFAULT_EFFECTIVE_PROFILE_ID: ImageUpstreamProfileId = 'openai-compatible';

function readChannelProfile(
    env: Record<string, string | undefined>,
    channelIndex: number,
    channelId: string,
    baseUrl: string | undefined
): ImageUpstreamProfileId {
    const rawProfile = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_UPSTREAM_PROFILE`);
    if (rawProfile && !isValidImageUpstreamProfileId(rawProfile)) {
        throw new RequestValidationError(
            `OPENAI_CHANNEL_${channelIndex}_UPSTREAM_PROFILE 必须是 openai-compatible 或 matsca。`,
            500
        );
    }
    return readImageUpstreamProfile({ explicitProfile: rawProfile, channelId, baseUrl }).id;
}

function readChannelUpstreamHeaders(
    env: Record<string, string | undefined>,
    channelIndex: number,
    upstreamProfile: ImageUpstreamProfileId
): UpstreamRequestHeaders | undefined {
    const baseHeaders = readChannelConfiguredHeaders(env, channelIndex);
    const appId = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_MATSCA_APP_ID`);
    const appSecret = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_MATSCA_APP_SECRET`);
    if (!appId && !appSecret) return baseHeaders;
    if (upstreamProfile !== 'matsca') {
        throw new RequestValidationError(
            `OPENAI_CHANNEL_${channelIndex}_MATSCA_APP_ID 只能用于 matsca upstream profile。`,
            500
        );
    }
    if (!appId || !appSecret) {
        throw new RequestValidationError(
            `OPENAI_CHANNEL_${channelIndex}_MATSCA_APP_ID 和 OPENAI_CHANNEL_${channelIndex}_MATSCA_APP_SECRET 必须成对配置。`,
            500
        );
    }
    return mergeUpstreamHeaders(baseHeaders, buildMatscaAppHeaders({ appId, appSecret }));
}

function readChannelConfiguredHeaders(
    env: Record<string, string | undefined>,
    channelIndex: number
): UpstreamRequestHeaders | undefined {
    const userAgent = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_USER_AGENT`);
    const jsonHeaders = readChannelJsonHeaders(env, channelIndex);
    return mergeUpstreamHeaders(
        userAgent ? { 'User-Agent': userAgent } : undefined,
        normalizeConfiguredUpstreamHeaders(jsonHeaders, `OPENAI_CHANNEL_${channelIndex}_UPSTREAM_HEADERS_JSON`)
    );
}

function readChannelJsonHeaders(
    env: Record<string, string | undefined>,
    channelIndex: number
): UpstreamRequestHeaders | undefined {
    const rawHeaders = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_UPSTREAM_HEADERS_JSON`);
    if (!rawHeaders) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawHeaders);
    } catch {
        throw new RequestValidationError(`OPENAI_CHANNEL_${channelIndex}_UPSTREAM_HEADERS_JSON 必须是 JSON 对象。`, 500);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new RequestValidationError(`OPENAI_CHANNEL_${channelIndex}_UPSTREAM_HEADERS_JSON 必须是 JSON 对象。`, 500);
    }
    const headers: UpstreamRequestHeaders = {};
    for (const [name, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
            throw new RequestValidationError(`OPENAI_CHANNEL_${channelIndex}_UPSTREAM_HEADERS_JSON 的值必须都是字符串。`, 500);
        }
        headers[name] = value;
    }
    return headers;
}

function readChannelProviderManifest(
    env: Record<string, string | undefined>,
    channelIndex: number,
    upstreamProfile: ImageUpstreamProfileId
): ImageProviderManifest | undefined {
    const rawManifest = readOptionalEnv(env, `OPENAI_CHANNEL_${channelIndex}_PROVIDER_MANIFEST`);
    if (!rawManifest) return undefined;
    const manifest = parseImageProviderManifest(rawManifest);
    if ((manifest.base_profile || DEFAULT_EFFECTIVE_PROFILE_ID) !== upstreamProfile) {
        throw new RequestValidationError(
            `OPENAI_CHANNEL_${channelIndex}_PROVIDER_MANIFEST base_profile 必须和该渠道 upstream profile 一致。`,
            500
        );
    }
    return manifest;
}

function readStrategy(value: unknown, fieldName: string): RoutingStrategy {
    if (value === undefined || value === null || value === '') {
        return DEFAULT_STRATEGY;
    }
    if (typeof value !== 'string' || !VALID_STRATEGIES.has(value as RoutingStrategy)) {
        throw new RequestValidationError(`${fieldName} 必须是 sticky、round_robin 或 random。`, 500);
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
        throw new RequestValidationError(`${fieldName} 必填。`, 500);
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
        throw new RequestValidationError('渠道 baseUrl 必须是字符串。', 500);
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
    if (
        code === 'ENOTFOUND' ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'EAI_AGAIN'
    ) {
        return true;
    }

    const message = (readErrorString(error, 'message') || '')
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/, '');
    return (
        message.includes('connection error') ||
        message.includes('request timed out') ||
        message.includes('fetch failed')
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
