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

export type ApiImageResponseItem = {
    filename: string;
    b64_json?: string;
    output_format: string;
    path?: string;
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
};

export type StreamingClientState = {
    completedImages: ApiImageResponseItem[];
    usage?: unknown;
};

export function computeStreamingConcurrency(options: StreamingConcurrencyOptions): number {
    const credentialCount = Math.max(1, Math.floor(options.credentialCount));
    const perCredential = Math.max(1, Math.floor(options.maxStreamsPerCredential ?? 1));
    return credentialCount * perCredential;
}

export function computeStreamingBatchRecommendation(options: StreamingBatchRecommendationOptions): number {
    const perCredential = Math.max(1, Math.floor(options.maxStreamsPerCredential ?? 1));
    if (options.strategy === 'sticky') {
        return perCredential;
    }
    return computeStreamingConcurrency(options);
}

export function isRuntimeStreamingBatchEnabled(options: RuntimeStreamingBatchOptions): boolean {
    return options.serverEnabled === true;
}

export function shouldUseStreamingBatch(options: StreamingBatchDecision): boolean {
    return options.enabled && options.streaming && options.imageCount > 1;
}

export function applyStreamingClientEvent(
    state: StreamingClientState,
    event: StreamingClientEvent
): StreamingClientState {
    if (event.type === 'completed' && event.filename) {
        return {
            ...state,
            completedImages: [
                ...state.completedImages,
                {
                    filename: event.filename,
                    b64_json: event.b64_json,
                    path: event.path,
                    output_format: event.output_format || 'png'
                }
            ]
        };
    }

    if (event.type === 'done') {
        return {
            completedImages: event.images && event.images.length > 0 ? event.images : state.completedImages,
            usage: event.usage
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
