export type MobileCreationSheetGesture = 'open' | 'close' | null;

const minVerticalSwipeDistance = 44;
const maxHorizontalDrift = 72;

type ResolveMobileCreationSheetGestureInput = {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
};

export function resolveMobileCreationSheetGesture({
    startX,
    startY,
    currentX,
    currentY
}: ResolveMobileCreationSheetGestureInput): MobileCreationSheetGesture {
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const absDeltaY = Math.abs(deltaY);

    if (absDeltaY < minVerticalSwipeDistance) return null;
    if (Math.abs(deltaX) > maxHorizontalDrift && Math.abs(deltaX) > absDeltaY) return null;

    return deltaY < 0 ? 'open' : 'close';
}
