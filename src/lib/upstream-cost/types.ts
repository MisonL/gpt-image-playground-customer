export type ActualCostSource = 'estimate' | 'new-api-log-token' | 'pending' | 'unavailable';

export type ActualCostConfidence = 'exact' | 'high' | 'low' | 'none';

export type UpstreamCostProvider = 'new-api' | 'openai' | 'sub2api' | 'unknown';

export type ActualCostDetails = {
    estimatedUsd?: number;
    actualAmount?: number;
    actualQuota?: number;
    currency: 'usd-equivalent' | 'quota-unit';
    source: ActualCostSource;
    confidence: ActualCostConfidence;
    upstreamProvider: UpstreamCostProvider;
    matchedLogId?: number;
    matchedRequestId?: string;
    reason?: string;
};

type UpstreamCostCredentials = { apiBaseUrl: string; apiKey: string } | { apiBaseUrl?: undefined; apiKey?: undefined };

export type ResolveActualCostInput = UpstreamCostCredentials & {
    model: string;
    startedAtMs: number;
    finishedAtMs: number;
    expectedImageCount: number;
};

export type ActualCostResolver = {
    provider: UpstreamCostProvider;
    resolve(input: ResolveActualCostInput): Promise<ActualCostDetails>;
};
