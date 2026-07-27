export type ImageStreamingRecommendationStrategy =
    'off' | 'auto' | 'openai-sse' | 'newapi-keepalive-sse' | 'responses-sse' | 'force-sse';

type ImageStreamingRecommendationInput = {
    streamingStrategy: ImageStreamingRecommendationStrategy;
    quality: 'low' | 'medium' | 'high' | 'auto';
    width: number;
    height: number;
    streamEnabled: boolean;
};

export function shouldRecommendImageStreaming(input: ImageStreamingRecommendationInput): boolean {
    if (input.streamEnabled || input.streamingStrategy !== 'auto' || input.quality !== 'high') {
        return false;
    }
    return Math.max(input.width, input.height) > 2048;
}
