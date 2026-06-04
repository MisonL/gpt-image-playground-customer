import { getChannelPoolSummary, toPublicChannelFailure } from '@/lib/channel-router';
import { readImageStreamMode, readImageStreamingStrategy } from '@/lib/image-upstream-strategy';
import { getServerChannelState } from '@/lib/server-channel-router';
import { computeStreamingBatchRecommendation } from '@/lib/streaming-batch';
import { readBooleanEnv, readPositiveIntegerEnv } from '@/lib/server-runtime';
import { NextResponse } from 'next/server';

const RESPONSES_IMAGE_BACKEND_REQUIRED_ENV = ['ENABLE_RESPONSES_IMAGE_BACKEND'] as const;
const RESPONSES_IMAGE_BACKEND_OPTIONAL_ENV = ['OPENAI_RESPONSES_API_MODEL'] as const;

export async function GET() {
    try {
        const serverChannelState = getServerChannelState();
        const summary = getChannelPoolSummary(serverChannelState.config);
        const healthSummary = serverChannelState.router?.getHealthSummary();
        const maxStreamsPerCredential = readPositiveIntegerEnv(process.env, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1);
        const responsesImageBackendEnabled = readBooleanEnv(process.env, 'ENABLE_RESPONSES_IMAGE_BACKEND');
        const responsesImageBackendHasDefaultModel = Boolean(process.env.OPENAI_RESPONSES_API_MODEL?.trim());
        const responsesImageBackendMissingEnv = readResponsesImageBackendMissingEnv(process.env);
        const recommendedStreamingConcurrency = computeStreamingBatchRecommendation({
            credentialCount: healthSummary?.healthyCredentialCount ?? summary.credentialCount,
            maxStreamsPerCredential,
            strategy: summary.strategy
        });

        return NextResponse.json({
            streaming: {
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
        return NextResponse.json(
            { error: error instanceof Error ? error.message : '配置错误' },
            { status: 500 }
        );
    }
}

function readResponsesImageBackendMissingEnv(env: Record<string, string | undefined>): string[] {
    const missing: string[] = [];
    if (!readBooleanEnv(env, 'ENABLE_RESPONSES_IMAGE_BACKEND')) {
        missing.push('ENABLE_RESPONSES_IMAGE_BACKEND');
    }
    return missing;
}
