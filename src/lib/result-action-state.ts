type ResultActionSource = {
    mode: 'generate' | 'edit';
    prompt: string;
} | null;

type ResolveResultActionStateInput = {
    isBusy: boolean;
    hasResultImages: boolean;
    currentMode: 'generate' | 'edit';
    currentPrompt: string;
    activeResultSource: ResultActionSource;
};

export function resolveResultActionState(input: ResolveResultActionStateInput): {
    canCreateVariant: boolean;
    canReusePrompt: boolean;
} {
    const sourcePrompt = input.activeResultSource?.prompt ?? input.currentPrompt;
    const hasReusablePrompt = sourcePrompt.trim().length > 0;
    const isGenerationResult = input.activeResultSource
        ? input.activeResultSource.mode === 'generate'
        : input.currentMode === 'generate';

    return {
        canCreateVariant: !input.isBusy && input.hasResultImages && isGenerationResult && hasReusablePrompt,
        canReusePrompt: !input.isBusy && hasReusablePrompt
    };
}
