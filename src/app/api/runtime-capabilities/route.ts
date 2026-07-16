import { CHANNEL_REQUEST_MODES, CHANNEL_REQUEST_MODE_ADMIN_CONTROL } from '@/lib/channel-request-mode';
import { getChannelPoolSummary, toPublicChannelFailure } from '@/lib/channel-router';
import { summarizeImageUpstreamProfile } from '@/lib/image-upstream-profile';
import {
    readImageGenerationBackend,
    readImageStreamMode,
    readImageStreamingStrategy
} from '@/lib/image-upstream-strategy';
import { summarizeOpenAIImageTransport } from '@/lib/openai-image-transport';
import { getServerChannelState } from '@/lib/server-channel-router';
import { readBooleanEnv, readPositiveIntegerEnv } from '@/lib/server-runtime';
import { computeStreamingBatchRecommendation } from '@/lib/streaming-batch';
import { getWebuiImageCleanupSummary } from '@/lib/webui-image-cleanup-runtime';
import { NextResponse } from 'next/server';

const RESPONSES_IMAGE_BACKEND_REQUIRED_ENV = ['ENABLE_RESPONSES_IMAGE_BACKEND'] as const;
const RESPONSES_IMAGE_BACKEND_OPTIONAL_ENV = ['OPENAI_RESPONSES_API_MODEL'] as const;

export async function GET() {
    try {
        const serverChannelState = getServerChannelState();
        const summary = getChannelPoolSummary(serverChannelState.config);
        const healthSummary = serverChannelState.router?.getHealthSummary();
        const requestModeHealthSummary = serverChannelState.router?.getRequestModeHealthSummary();
        const maxStreamsPerCredential = readPositiveIntegerEnv(process.env, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1);
        const channelQueueSummary = serverChannelState.channelCapacityQueue.summary();
        const responsesImageBackendEnabled = readBooleanEnv(process.env, 'ENABLE_RESPONSES_IMAGE_BACKEND');
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
        const providerManifests = summary.channels
            .filter((channel) => channel.providerManifest)
            .map((channel) => ({
                channelId: channel.id,
                manifest: channel.providerManifest
            }));

        return NextResponse.json({
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
            webuiImageCleanup: getWebuiImageCleanupSummary(process.env),
            responsesImageBackend: {
                enabled: responsesImageBackendEnabled,
                mode: 'experimental',
                requiredEnv: [...RESPONSES_IMAGE_BACKEND_REQUIRED_ENV],
                optionalEnv: [...RESPONSES_IMAGE_BACKEND_OPTIONAL_ENV],
                hasDefaultModel: responsesImageBackendHasDefaultModel,
                missingEnv: responsesImageBackendMissingEnv
            }
        });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : '配置错误' }, { status: 500 });
    }
}

function readResponsesImageBackendMissingEnv(env: Record<string, string | undefined>): string[] {
    const missing: string[] = [];
    if (!readBooleanEnv(env, 'ENABLE_RESPONSES_IMAGE_BACKEND')) {
        missing.push('ENABLE_RESPONSES_IMAGE_BACKEND');
    }
    return missing;
}
