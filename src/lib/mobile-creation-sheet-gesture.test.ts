import { resolveMobileCreationSheetGesture } from './mobile-creation-sheet-gesture';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('resolveMobileCreationSheetGesture', () => {
    it('opens the mobile creation sheet on a vertical upward swipe', () => {
        assert.equal(
            resolveMobileCreationSheetGesture({
                startX: 180,
                startY: 760,
                currentX: 178,
                currentY: 690
            }),
            'open'
        );
    });

    it('closes the mobile creation sheet on a vertical downward swipe', () => {
        assert.equal(
            resolveMobileCreationSheetGesture({
                startX: 180,
                startY: 230,
                currentX: 184,
                currentY: 300
            }),
            'close'
        );
    });

    it('ignores short drags that should remain normal taps', () => {
        assert.equal(
            resolveMobileCreationSheetGesture({
                startX: 180,
                startY: 760,
                currentX: 178,
                currentY: 730
            }),
            null
        );
    });

    it('ignores mostly horizontal drags so album swipes are not captured', () => {
        assert.equal(
            resolveMobileCreationSheetGesture({
                startX: 80,
                startY: 720,
                currentX: 180,
                currentY: 672
            }),
            null
        );
    });
});
