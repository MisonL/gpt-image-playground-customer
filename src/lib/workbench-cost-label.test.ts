import { formatEstimatedCredits } from './workbench-cost-label';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('formatEstimatedCredits', () => {
    it('scales the visible estimate by the current task count', () => {
        assert.equal(formatEstimatedCredits(1), '0.12');
        assert.equal(formatEstimatedCredits(2), '0.24');
        assert.equal(formatEstimatedCredits(4), '0.48');
    });

    it('shows zero credits for empty task counts and one task for invalid counts', () => {
        assert.equal(formatEstimatedCredits(0), '0.00');
        assert.equal(formatEstimatedCredits(Number.NaN), '0.12');
    });
});
