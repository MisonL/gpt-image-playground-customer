import { createStreamingAvailabilityRegistry } from './streaming-availability';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('streaming availability registry', () => {
    it('marks streaming unavailable by channel, backend, strategy, and operation', () => {
        let now = new Date('2026-05-26T10:00:00');
        const registry = createStreamingAvailabilityRegistry({ now: () => now });
        const key = {
            channelId: 'channel-a',
            imageBackend: 'images-api' as const,
            streamingStrategy: 'auto' as const,
            operation: 'generate' as const
        };

        assert.equal(registry.isUnavailable(key), false);
        registry.markUnavailable({ ...key, reason: 'json_final_fallback', status: 200 });
        assert.equal(registry.isUnavailable(key), true);
        assert.equal(registry.isUnavailable({ ...key, operation: 'edit' }), false);
        assert.equal(registry.isUnavailable({ ...key, streamingStrategy: 'newapi-keepalive-sse' }), false);

        now = new Date('2026-05-27T00:01:00');
        assert.equal(registry.isUnavailable(key), false);
    });

    it('separates marks by source id when no server channel is selected', () => {
        const registry = createStreamingAvailabilityRegistry({
            now: () => new Date('2026-05-26T10:00:00')
        });
        const key = {
            sourceId: 'upstream-a',
            imageBackend: 'images-api' as const,
            streamingStrategy: 'auto' as const,
            operation: 'generate' as const
        };

        registry.markUnavailable({ ...key, reason: 'stream_error_without_final_image' });

        assert.equal(registry.isUnavailable(key), true);
        assert.equal(registry.isUnavailable({ ...key, sourceId: 'upstream-b' }), false);
    });

    it('returns a sanitized active mark summary', () => {
        const registry = createStreamingAvailabilityRegistry({
            now: () => new Date('2026-05-26T10:00:00')
        });

        registry.markUnavailable({
            sourceId: 'upstream-a',
            imageBackend: 'responses-image-generation',
            streamingStrategy: 'responses-sse',
            operation: 'generate',
            reason: 'stream_error_without_final_image',
            code: 'upstream_unavailable'
        });

        assert.deepEqual(registry.summary(), {
            reset_date: '2026-05-26',
            mark_count: 1,
            active_marks: [
                    {
                        channel_id: 'request-override',
                        source_id: 'upstream-a',
                        image_backend: 'responses-image-generation',
                        streaming_strategy: 'responses-sse',
                        operation: 'generate',
                    reason: 'stream_error_without_final_image',
                    at: new Date('2026-05-26T10:00:00').getTime(),
                    code: 'upstream_unavailable'
                }
            ]
        });
    });
});
