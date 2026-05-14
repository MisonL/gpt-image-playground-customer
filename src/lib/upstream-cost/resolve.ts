import { NewApiCostResolver } from './new-api';
import type { ActualCostDetails, ResolveActualCostInput, UpstreamCostProvider } from './types';

export type { ActualCostDetails, ActualCostConfidence, ActualCostSource, UpstreamCostProvider } from './types';

function unavailable(reason: string, upstreamProvider: UpstreamCostProvider = 'unknown'): ActualCostDetails {
    return {
        currency: 'usd-equivalent',
        source: 'unavailable',
        confidence: 'none',
        upstreamProvider,
        reason
    };
}

function detectKnownProvider(apiBaseUrl: string): UpstreamCostProvider {
    try {
        const parsed = new URL(apiBaseUrl);
        if (parsed.hostname === 'api.openai.com') return 'openai';
    } catch {
        return 'unknown';
    }
    return 'unknown';
}

export async function resolveActualCost(input: ResolveActualCostInput): Promise<ActualCostDetails> {
    if (!input.apiBaseUrl || !input.apiKey) {
        return unavailable('缺少上游 API URL 或 API key。');
    }

    const knownProvider = detectKnownProvider(input.apiBaseUrl);
    if (knownProvider === 'openai') {
        return unavailable('OpenAI 官方接口不提供 new-api 扣费日志。', 'openai');
    }

    return new NewApiCostResolver().resolve(input);
}
