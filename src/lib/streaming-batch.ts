import type { ActualCostDetails } from './upstream-cost/types';

export type StreamingBatchJob = {
    id: string;
    outputIndex: number;
};

export type StreamingConcurrencyOptions = {
    credentialCount: number;
    maxStreamsPerCredential?: number;
};

export type StreamingBatchRecommendationOptions = StreamingConcurrencyOptions & {
    strategy: 'sticky' | 'round_robin' | 'random';
};

export type StreamingBatchDecision = {
    enabled: boolean;
    userEnabled?: boolean;
    streaming: boolean;
    imageCount: number;
};

export type StreamingBatchResult<T> = T | Error;
export type StreamingBatchScheduleOptions<T> = {
    concurrency: number;
    runJob: (job: StreamingBatchJob) => Promise<T>;
    shouldPause?: () => boolean;
};

export class BatchPausedError extends Error {
    constructor() {
        super('批量生成已暂停，任务尚未开始。');
        this.name = 'BatchPausedError';
    }
}

export type StreamingBatchCapacityOptions = {
    featureEnabled: boolean;
    hasRequestApiKey: boolean;
    requestCredentialConcurrency: number;
    serverRecommendedConcurrency: number;
};

export type StreamingBatchCapacity = {
    enabled: boolean;
    concurrency: number;
};

export type StreamingBatchTransportDecision = {
    streamMode: string;
    streamingStrategy: string;
};

export type StreamingBatchUnavailableReasonKey =
    | 'streaming.parallelBatchUnavailableCapacity'
    | 'streaming.parallelBatchUnavailable'
    | 'streaming.parallelBatchUnavailableSingle';

export type StreamingBatchToggleOptions = StreamingBatchTransportDecision & {
    allowStreamingBatch: boolean;
    userEnabled: boolean;
    targetCount: number;
};

export type StreamingBatchToggleState = {
    canEnable: boolean;
    checked: boolean;
    transportEnabled: boolean;
    unavailableReasonKey: StreamingBatchUnavailableReasonKey;
};

export type ApiImageResponseItem = {
    filename: string;
    b64_json?: string;
    output_format: string;
    path?: string;
    clientRequestId?: string;
};

export type StreamingClientEvent = {
    type?: string;
    status?: number;
    index?: number;
    b64_json?: string;
    filename?: string;
    path?: string;
    output_format?: string;
    outputFormat?: string;
    images?: ApiImageResponseItem[];
    usage?: unknown;
    actual_cost?: ActualCostDetails | null;
    actualCost?: ActualCostDetails | null;
    client_request_id?: string;
    clientRequestId?: string;
};

export type StreamingClientState = {
    completedImages: ApiImageResponseItem[];
    usage?: unknown;
    actualCost?: ActualCostDetails | null;
};

function isActualCostDetails(value: unknown): value is ActualCostDetails {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    const validCurrency = record.currency === 'usd-equivalent' || record.currency === 'quota-unit';
    const validSource =
        record.source === 'estimate' ||
        record.source === 'new-api-log-token' ||
        record.source === 'pending' ||
        record.source === 'unavailable';
    const validConfidence =
        record.confidence === 'exact' ||
        record.confidence === 'high' ||
        record.confidence === 'low' ||
        record.confidence === 'none';
    const validProvider =
        record.upstreamProvider === 'new-api' ||
        record.upstreamProvider === 'openai' ||
        record.upstreamProvider === 'sub2api' ||
        record.upstreamProvider === 'unknown';
    const validOptionalNumbers =
        (record.estimatedUsd === undefined || typeof record.estimatedUsd === 'number') &&
        (record.actualAmount === undefined || typeof record.actualAmount === 'number') &&
        (record.actualQuota === undefined || typeof record.actualQuota === 'number') &&
        (record.matchedLogId === undefined || typeof record.matchedLogId === 'number');
    const validOptionalStrings =
        (record.matchedRequestId === undefined || typeof record.matchedRequestId === 'string') &&
        (record.reason === undefined || typeof record.reason === 'string');
    return (
        validCurrency && validSource && validConfidence && validProvider && validOptionalNumbers && validOptionalStrings
    );
}

function readStreamingEventClientRequestId(event: StreamingClientEvent): string | undefined {
    if (typeof event.clientRequestId === 'string') return event.clientRequestId;
    if (typeof event.client_request_id === 'string') return event.client_request_id;
    return undefined;
}

function readStreamingEventActualCost(event: StreamingClientEvent): ActualCostDetails | null {
    if (event.actualCost !== undefined && event.actualCost !== null) return event.actualCost;
    if (event.actual_cost !== undefined && event.actual_cost !== null) return event.actual_cost;
    return null;
}

export function computeStreamingConcurrency(options: StreamingConcurrencyOptions): number {
    const credentialCount = Math.max(1, Math.floor(options.credentialCount));
    const perCredential = Math.max(1, Math.floor(options.maxStreamsPerCredential ?? 1));
    return credentialCount * perCredential;
}

export function computeStreamingBatchRecommendation(options: StreamingBatchRecommendationOptions): number {
    const credentialCount = Math.floor(options.credentialCount);
    if (credentialCount < 1) {
        return 0;
    }
    const perCredential = Math.max(1, Math.floor(options.maxStreamsPerCredential ?? 1));
    if (options.strategy === 'sticky') {
        return perCredential;
    }
    return computeStreamingConcurrency(options);
}

export function resolveStreamingBatchCapacity(options: StreamingBatchCapacityOptions): StreamingBatchCapacity {
    if (!options.featureEnabled) {
        return { enabled: false, concurrency: 1 };
    }

    const selectedConcurrency = options.hasRequestApiKey
        ? options.requestCredentialConcurrency
        : options.serverRecommendedConcurrency;
    const concurrency = Math.floor(selectedConcurrency);
    if (concurrency < 1) {
        return { enabled: false, concurrency: 1 };
    }

    return { enabled: true, concurrency };
}

export function shouldUseStreamingBatch(options: StreamingBatchDecision): boolean {
    return options.enabled && options.userEnabled === true && options.streaming && options.imageCount > 1;
}

export function canUseStreamingBatchTransport(options: StreamingBatchTransportDecision): boolean {
    return options.streamMode !== 'non_stream' && options.streamingStrategy !== 'off';
}

export function resolveStreamingBatchToggleState(options: StreamingBatchToggleOptions): StreamingBatchToggleState {
    const transportEnabled = canUseStreamingBatchTransport(options);
    const canEnable = options.allowStreamingBatch && transportEnabled && options.targetCount > 1;
    const unavailableReasonKey = !options.allowStreamingBatch
        ? 'streaming.parallelBatchUnavailableCapacity'
        : !transportEnabled
          ? 'streaming.parallelBatchUnavailable'
          : 'streaming.parallelBatchUnavailableSingle';

    return {
        canEnable,
        checked: options.userEnabled && canEnable,
        transportEnabled,
        unavailableReasonKey
    };
}

export function applyStreamingClientEvent(
    state: StreamingClientState,
    event: StreamingClientEvent
): StreamingClientState {
    if (event.type === 'completed' && event.filename) {
        const outputFormat = typeof event.outputFormat === 'string' ? event.outputFormat : event.output_format;
        if (typeof outputFormat !== 'string' || outputFormat.length === 0) {
            throw new Error(`流式完成事件缺少有效 output_format：${String(outputFormat)}`);
        }
        const clientRequestId = readStreamingEventClientRequestId(event);
        return {
            ...state,
            completedImages: [
                ...state.completedImages,
                {
                    filename: event.filename,
                    b64_json: event.b64_json,
                    path: event.path,
                    output_format: outputFormat,
                    ...(clientRequestId ? { clientRequestId } : {})
                }
            ]
        };
    }

    if (event.type === 'done') {
        const clientRequestId = readStreamingEventClientRequestId(event);
        const eventImages = event.images && event.images.length > 0 ? event.images : state.completedImages;
        const actualCost = readStreamingEventActualCost(event);
        if (actualCost !== null && !isActualCostDetails(actualCost)) {
            throw new Error(
                `流式完成事件包含无效 actual_cost：${JSON.stringify(event.actualCost ?? event.actual_cost)}`
            );
        }
        return {
            completedImages: eventImages.map((image) => ({
                ...image,
                ...(image.clientRequestId || !clientRequestId ? {} : { clientRequestId })
            })),
            usage: event.usage,
            actualCost
        };
    }

    return state;
}

export function buildStreamingBatchJobs(imageCount: number): StreamingBatchJob[] {
    const safeCount = Math.max(0, Math.floor(imageCount));
    return Array.from({ length: safeCount }, (_, outputIndex) => ({
        id: `job-${outputIndex}`,
        outputIndex
    }));
}

export async function scheduleStreamingBatch<T>(
    jobs: StreamingBatchJob[],
    options: StreamingBatchScheduleOptions<T>
): Promise<Array<StreamingBatchResult<T>>> {
    const safeConcurrency = Math.max(1, Math.floor(options.concurrency));
    const results: Array<StreamingBatchResult<T>> = new Array(jobs.length);
    const assigned: boolean[] = new Array(jobs.length).fill(false);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < jobs.length) {
            if (options.shouldPause?.()) {
                return;
            }
            const currentIndex = nextIndex;
            nextIndex += 1;
            try {
                results[currentIndex] = await options.runJob(jobs[currentIndex]);
            } catch (error) {
                results[currentIndex] = error instanceof Error ? error : new Error(String(error));
            } finally {
                assigned[currentIndex] = true;
            }
        }
    }

    const workerCount = Math.min(safeConcurrency, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    for (let index = 0; index < results.length; index += 1) {
        if (!assigned[index]) {
            results[index] = new BatchPausedError();
        }
    }
    return results;
}
