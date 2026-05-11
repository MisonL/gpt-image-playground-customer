import { getChannelPoolSummary, parseChannelPoolConfig } from '@/lib/channel-router';
import { computeStreamingBatchRecommendation } from '@/lib/streaming-batch';
import { readBooleanEnv, readPositiveIntegerEnv } from '@/lib/server-runtime';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const channelConfig = parseChannelPoolConfig(process.env);
        const summary = getChannelPoolSummary(channelConfig);
        const maxStreamsPerCredential = readPositiveIntegerEnv(process.env, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1);
        const streamingBatchEnabled = readBooleanEnv(process.env, 'ENABLE_STREAMING_BATCH');
        const recommendedStreamingConcurrency = computeStreamingBatchRecommendation({
            credentialCount: summary.credentialCount,
            maxStreamsPerCredential,
            strategy: summary.strategy
        });

        return NextResponse.json({
            streamingBatch: {
                enabled: streamingBatchEnabled,
                recommendedConcurrency: recommendedStreamingConcurrency
            }
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Configuration error' },
            { status: 500 }
        );
    }
}
