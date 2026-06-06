const ESTIMATED_CREDITS_PER_IMAGE = 0.12;

export function formatEstimatedCredits(taskCount: number): string {
    const safeTaskCount = Number.isFinite(taskCount) ? Math.max(0, Math.floor(taskCount)) : 1;
    const credits = ESTIMATED_CREDITS_PER_IMAGE * safeTaskCount;
    return credits.toFixed(2);
}
