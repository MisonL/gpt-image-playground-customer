export function readBatchPromptLines(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

export function formatBatchPromptHistory(prompts: string[]): string {
    return prompts.join('\n');
}
