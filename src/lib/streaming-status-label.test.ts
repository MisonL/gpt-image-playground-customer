import { getStreamingStatusLabel } from './streaming-status-label';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const labels: Record<string, string> = {
    'streaming.modeAuto': '自动',
    'streaming.modeStream': '强制流式',
    'streaming.modeNonStream': '非流式'
};

const t = (key: string): string => labels[key] ?? key;

describe('getStreamingStatusLabel', () => {
    it('describes the selected automatic mode without claiming streaming availability', () => {
        assert.equal(getStreamingStatusLabel('auto', t), '自动');
    });

    it('distinguishes forced streaming from non-streaming mode', () => {
        assert.equal(getStreamingStatusLabel('stream', t), '强制流式');
        assert.equal(getStreamingStatusLabel('non_stream', t), '非流式');
    });
});
