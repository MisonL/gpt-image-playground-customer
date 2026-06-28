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
    let upstreamProvider: UpstreamCostProvider = 'unknown';
    try {
        const parsed = new URL(apiBaseUrl);
        const pathIsOpenAiApiRoot =
            parsed.pathname === '/' || parsed.pathname === '/v1' || parsed.pathname.startsWith('/v1/');
        if (parsed.protocol === 'https:' && parsed.hostname === 'api.openai.com' && pathIsOpenAiApiRoot) {
            upstreamProvider = 'openai';
        }
    } catch (error) {
        console.debug('解析上游 API URL 失败。', { apiBaseUrl, error });
        if (!(error instanceof TypeError)) {
            throw error;
        }
    }
    return upstreamProvider;
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
