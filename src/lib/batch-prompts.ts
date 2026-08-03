export function readBatchPromptLines(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

export function findBatchPromptOverLimitIndex(prompts: readonly string[], maxLength: number): number | null {
    const index = prompts.findIndex((prompt) => prompt.length > maxLength);
    return index === -1 ? null : index;
}

export function formatBatchPromptHistory(prompts: string[]): string {
    return prompts.join('\n');
}
