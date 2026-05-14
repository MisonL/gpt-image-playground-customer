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
    streaming: boolean;
    imageCount: number;
};

export type StreamingBatchResult<T> = T | Error;

export type RuntimeStreamingBatchOptions = {
    clientFeatureFlag?: string;
    serverEnabled?: boolean;
};

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

export type ApiImageResponseItem = {
    filename: string;
    b64_json?: string;
    output_format: string;
    path?: string;
    clientRequestId?: string;
};

export type StreamingClientEvent = {
    type?: string;
    index?: number;
    b64_json?: string;
    filename?: string;
    path?: string;
    output_format?: string;
    images?: ApiImageResponseItem[];
    usage?: unknown;
    actual_cost?: unknown;
    client_request_id?: string;
};

export type StreamingClientState = {
    completedImages: ApiImageResponseItem[];
    usage?: unknown;
    actualCost?: unknown;
};

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

export function isRuntimeStreamingBatchEnabled(options: RuntimeStreamingBatchOptions): boolean {
    return options.serverEnabled === true;
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
    return options.enabled && options.streaming && options.imageCount > 1;
}

export function applyStreamingClientEvent(
    state: StreamingClientState,
    event: StreamingClientEvent
): StreamingClientState {
    if (event.type === 'completed' && event.filename) {
        const clientRequestId = typeof event.client_request_id === 'string' ? event.client_request_id : undefined;
        return {
            ...state,
            completedImages: [
                ...state.completedImages,
                {
                    filename: event.filename,
                    b64_json: event.b64_json,
                    path: event.path,
                    output_format: event.output_format || 'png',
                    ...(clientRequestId ? { clientRequestId } : {})
                }
            ]
        };
    }

    if (event.type === 'done') {
        const clientRequestId = typeof event.client_request_id === 'string' ? event.client_request_id : undefined;
        const eventImages = event.images && event.images.length > 0 ? event.images : state.completedImages;
        return {
            completedImages: eventImages.map((image) => ({
                ...image,
                ...(image.clientRequestId || !clientRequestId ? {} : { clientRequestId })
            })),
            usage: event.usage,
            actualCost: event.actual_cost
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
    concurrency: number,
    runJob: (job: StreamingBatchJob) => Promise<T>
): Promise<Array<StreamingBatchResult<T>>> {
    const safeConcurrency = Math.max(1, Math.floor(concurrency));
    const results: Array<StreamingBatchResult<T>> = new Array(jobs.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < jobs.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            try {
                results[currentIndex] = await runJob(jobs[currentIndex]);
            } catch (error) {
                results[currentIndex] = error instanceof Error ? error : new Error(String(error));
            }
        }
    }

    const workerCount = Math.min(safeConcurrency, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
