export function hasReachedEditSourceImageLimit(input: { currentCount: number; maxImages: number }): boolean {
    return input.currentCount >= input.maxImages;
}
