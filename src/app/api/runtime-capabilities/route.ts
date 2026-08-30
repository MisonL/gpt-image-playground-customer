import { assertAgentAuthorized } from '@/lib/agent-auth';
import { CHANNEL_REQUEST_MODES, CHANNEL_REQUEST_MODE_ADMIN_CONTROL } from '@/lib/channel-request-mode';
import { getChannelPoolSummary, toPublicChannelFailure } from '@/lib/channel-router';
import { resolveDefaultImageModel } from '@/lib/image-request-utils';
import {
    getImageBackendCompatibility,
    getImageCountRangeCompatibilityForBackend,
    getPartialImagesRangeCompatibilityForBackend,
    summarizeImageUpstreamProfile
} from '@/lib/image-upstream-profile';
import {
    readImageGenerationBackend,
    readImageStreamMode,
    readImageStreamingStrategy
} from '@/lib/image-upstream-strategy';
import { summarizeOpenAIImageTransport } from '@/lib/openai-image-transport';
import { getServerChannelState } from '@/lib/server-channel-router';
import { readBooleanEnv, readPositiveIntegerEnv, verifyAccessToken } from '@/lib/server-runtime';
import { computeStreamingBatchRecommendation } from '@/lib/streaming-batch';
import { getWebuiImageCleanupSummary } from '@/lib/webui-image-cleanup-runtime';
import { NextRequest, NextResponse } from 'next/server';

const RESPONSES_IMAGE_BACKEND_REQUIRED_ENV = ['ENABLE_RESPONSES_IMAGE_BACKEND'] as const;
const RESPONSES_IMAGE_BACKEND_OPTIONAL_ENV = ['OPENAI_RESPONSES_API_MODEL'] as const;

export async function GET(request?: NextRequest) {
    try {
        const serverChannelState = getServerChannelState();
        const summary = getChannelPoolSummary(serverChannelState.config);
        const healthSummary = serverChannelState.router?.getHealthSummary();
        const requestModeHealthSummary = serverChannelState.router?.getRequestModeHealthSummary();
        const maxStreamsPerCredential = readPositiveIntegerEnv(process.env, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1);
        const channelQueueSummary = serverChannelState.channelCapacityQueue.summary();
        const responsesImageBackendFeatureEnabled = readBooleanEnv(process.env, 'ENABLE_RESPONSES_IMAGE_BACKEND');
        const responsesImageBackendHasDefaultModel = Boolean(process.env.OPENAI_RESPONSES_API_MODEL?.trim());
        const responsesImageBackendMissingEnv = readResponsesImageBackendMissingEnv(process.env);
        const recommendedStreamingConcurrency = computeStreamingBatchRecommendation({
            credentialCount: healthSummary?.healthyCredentialCount ?? summary.credentialCount,
            maxStreamsPerCredential,
            strategy: summary.strategy
        });
        const upstreamProfile = summarizeImageUpstreamProfile({
            serverProfiles: summary.channels.map((channel) => channel.effectiveProfile)
        });
        const responsesImageBackendIncompatibleConstraints = readResponsesImageBackendIncompatibleConstraints(
            upstreamProfile.activeConstraints
        );
        const responsesImageBackendEnabled =
            responsesImageBackendFeatureEnabled && responsesImageBackendIncompatibleConstraints.length === 0;
        const providerManifests = summary.channels
            .filter((channel) => channel.providerManifest)
            .map((channel) => ({
                channelId: channel.id,
                manifest: channel.providerManifest
            }));

        const responseBody: Record<string, unknown> = {
            imageModel: {
                defaultModel: resolveDefaultImageModel(process.env)
            },
            streaming: {
                defaultBackend: readImageGenerationBackend(new FormData(), process.env),
                defaultMode: readImageStreamMode(new FormData(), process.env),
                defaultStrategy: readImageStreamingStrategy(new FormData(), process.env),
                unavailableMarkScope: 'channel+backend+strategy+operation',
                availability: serverChannelState.streamingAvailability.summary()
            },
            streamingBatch: {
                enabled: true,
                recommendedConcurrency: recommendedStreamingConcurrency,
                requestCredentialConcurrency: maxStreamsPerCredential,
                healthyCredentialCount: healthSummary?.healthyCredentialCount ?? summary.credentialCount,
                unhealthyCredentialCount: healthSummary?.unhealthyCredentialCount ?? 0,
                channelCount: healthSummary?.channelCount ?? summary.channelCount,
                healthyChannelCount: healthSummary?.healthyChannelCount ?? summary.channelCount,
                unhealthyChannelCount: healthSummary?.unhealthyChannelCount ?? 0,
                lastFailure: toPublicChannelFailure(healthSummary?.lastFailure)
            },
            channelQueue: {
                enabled: channelQueueSummary.enabled,
                capacityPerCredential: channelQueueSummary.capacityPerKey,
                maxWaitMs: channelQueueSummary.maxWaitMs,
                maxSize: channelQueueSummary.maxSize,
                active: channelQueueSummary.active,
                queued: channelQueueSummary.queued,
                credentials: channelQueueSummary.keys.map((item) => ({
                    credentialId: item.key,
                    active: item.active,
                    queued: item.queued
                }))
            },
            channelRecovery: {
                failureCooldownEnabled: serverChannelState.channelRecovery.failureCooldownEnabled,
                failureCooldownMs: serverChannelState.channelRecovery.failureCooldownMs,
                requireProbeForRecovery: serverChannelState.channelRecovery.requireProbeForRecovery,
                pendingProbeCredentialCount: healthSummary?.pendingRecoveryProbeCredentialCount ?? 0,
                pendingProbeChannelCount: healthSummary?.pendingRecoveryProbeChannelCount ?? 0,
                probe: serverChannelState.channelRecoveryProber?.summary()
            },
            channelRouting: {
                strategy: summary.strategy,
                credentialCount: summary.credentialCount,
                channelCount: summary.channelCount,
                supportedRequestModes: CHANNEL_REQUEST_MODES,
                configuredRequestModes:
                    requestModeHealthSummary?.configuredRequestModes ??
                    (summary.credentialCount > 0 ? CHANNEL_REQUEST_MODES : []),
                effectiveRequestModes:
                    requestModeHealthSummary?.effectiveRequestModes ??
                    (summary.credentialCount > 0 ? CHANNEL_REQUEST_MODES : []),
                defaultRequestModePriority:
                    requestModeHealthSummary?.defaultRequestModePriority ??
                    CHANNEL_REQUEST_MODE_ADMIN_CONTROL.defaultPriority,
                requestModeControls: CHANNEL_REQUEST_MODE_ADMIN_CONTROL,
                requestModeHealth: requestModeHealthSummary?.modes ?? [],
                upstreamProxyByChannel: summary.channels.map((channel) => ({
                    channelId: channel.id,
                    upstreamProxy: channel.upstreamProxy
                })),
                requestModesByChannel: summary.channels.map((channel) => ({
                    channelId: channel.id,
                    requestModes: channel.requestModes,
                    requestModePriority: channel.requestModePriority
                })),
                effectiveRequestModesByChannel:
                    requestModeHealthSummary?.effectiveRequestModesByChannel ??
                    summary.channels.map((channel) => ({
                        channelId: channel.id,
                        requestModes: channel.requestModes,
                        requestModePriority: channel.requestModePriority
                    }))
            },
            upstreamProfile,
            imageTransport: summarizeOpenAIImageTransport(process.env),
            providerManifests,
            webuiImageCleanup: await getWebuiImageCleanupSummary(process.env),
            responsesImageBackend: {
                enabled: responsesImageBackendEnabled,
                featureEnabled: responsesImageBackendFeatureEnabled,
                mode: 'experimental',
                requiredEnv: [...RESPONSES_IMAGE_BACKEND_REQUIRED_ENV],
                optionalEnv: [...RESPONSES_IMAGE_BACKEND_OPTIONAL_ENV],
                hasDefaultModel: responsesImageBackendHasDefaultModel,
                missingEnv: responsesImageBackendMissingEnv,
                ...(responsesImageBackendIncompatibleConstraints.length > 0
                    ? { incompatibleConstraints: responsesImageBackendIncompatibleConstraints }
                    : {})
            }
        };
        return NextResponse.json(
            isRuntimeCapabilitiesAuthorized(request) ? responseBody : redactRuntimeCapabilities(responseBody)
        );
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : '配置错误' }, { status: 500 });
    }
}

function isRuntimeCapabilitiesAuthorized(request: NextRequest | undefined): boolean {
    const configuredToken = process.env.AGENT_API_TOKEN?.trim();
    const configuredPassword = process.env.APP_PASSWORD?.trim();
    if (!configuredToken && !configuredPassword) return true;
    // Internal callers without a request object cannot prove deployment
    // credentials. Return the same redacted view as an unauthenticated HTTP
    // caller instead of treating the missing request as authorized.
    if (!request) return false;
    try {
        assertAgentAuthorized(request.headers);
        return true;
    } catch {
        if (configuredPassword && verifyAccessToken(request.cookies.get('gptImageAccess')?.value, configuredPassword)) {
            return true;
        }
        return false;
    }
}

function redactRuntimeCapabilities(value: Record<string, unknown>): Record<string, unknown> {
    const redacted = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const channelQueue = asRecord(redacted.channelQueue);
    if (channelQueue) channelQueue.credentials = [];

    const channelRouting = asRecord(redacted.channelRouting);
    if (channelRouting) {
        channelRouting.upstreamProxyByChannel = [];
        channelRouting.requestModesByChannel = redactChannelIds(channelRouting.requestModesByChannel);
        channelRouting.effectiveRequestModesByChannel = redactChannelIds(channelRouting.effectiveRequestModesByChannel);
    }

    const channelRecovery = asRecord(redacted.channelRecovery);
    const recoveryProbe = channelRecovery ? asRecord(channelRecovery.probe) : undefined;
    const lastProbe = recoveryProbe ? asRecord(recoveryProbe.lastProbe) : undefined;
    if (lastProbe) {
        delete lastProbe.channelId;
        delete lastProbe.credentialId;
    }

    const streamingBatch = asRecord(redacted.streamingBatch);
    const lastFailure = streamingBatch ? asRecord(streamingBatch.lastFailure) : undefined;
    if (lastFailure) delete lastFailure.requestId;

    redacted.providerManifests = [];
    return redacted;
}

function redactChannelIds(value: unknown): unknown[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry, index) => {
        const record = asRecord(entry);
        if (!record) return { channelId: `channel-${index + 1}` };
        const rest = { ...record };
        delete rest.channelId;
        return { ...rest, channelId: `channel-${index + 1}` };
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readResponsesImageBackendIncompatibleConstraints(profile: Parameters<typeof getImageBackendCompatibility>[0]) {
    const incompatible: string[] = [];
    if (!getImageCountRangeCompatibilityForBackend(profile, 'generate', 'responses-image-generation').compatible) {
        incompatible.push('generate_images');
    }
    if (!getImageCountRangeCompatibilityForBackend(profile, 'edit', 'responses-image-generation').compatible) {
        incompatible.push('edit_images');
    }
    if (!getPartialImagesRangeCompatibilityForBackend(profile, 'responses-image-generation').compatible) {
        incompatible.push('partial_images');
    }
    return incompatible;
}

function readResponsesImageBackendMissingEnv(env: Record<string, string | undefined>): string[] {
    const missing: string[] = [];
    if (!readBooleanEnv(env, 'ENABLE_RESPONSES_IMAGE_BACKEND')) {
        missing.push('ENABLE_RESPONSES_IMAGE_BACKEND');
    }
    return missing;
}
