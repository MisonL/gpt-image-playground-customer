type Translate = (key: string, values?: Record<string, string | number>) => string;

export type GenerationActivityItem = {
    id: string;
    label: string;
    detail: string;
    tone: 'progress' | 'success' | 'warning' | 'neutral';
};

type GenerationActivityOptions = {
    isLoading: boolean;
    isSendingToEdit: boolean;
    mode: 'generate' | 'edit';
    streamingPreviewCount: number;
    errorMessage?: string;
    completedGenerationCount: number | null;
    t: Translate;
};

export function buildGenerationActivityItems(options: GenerationActivityOptions): GenerationActivityItem[] {
    const items: GenerationActivityItem[] = [];

    if (options.isLoading) {
        items.push({
            id: 'generating',
            label: options.t('history.activityGenerating'),
            detail:
                options.mode === 'edit'
                    ? options.t('history.activityEditingDetail')
                    : options.t('history.activityGeneratingDetail'),
            tone: 'progress'
        });
    } else if (options.isSendingToEdit) {
        items.push({
            id: 'preparing-edit',
            label: options.t('history.activityPreparingEdit'),
            detail: options.t('history.activityPreparingEditDetail'),
            tone: 'progress'
        });
    }

    if (options.streamingPreviewCount > 0) {
        items.push({
            id: 'streaming-preview',
            label: options.t('history.activityStreaming'),
            detail: options.t('history.activityStreamingDetail', { count: options.streamingPreviewCount }),
            tone: 'progress'
        });
    }

    if (options.errorMessage) {
        items.push({
            id: 'failed',
            label: options.t('history.activityFailed'),
            detail: buildFailureActivityDetail(options.errorMessage, options.t),
            tone: 'warning'
        });
    }

    if (!options.isLoading && !options.isSendingToEdit && options.completedGenerationCount !== null) {
        items.push({
            id: 'saved',
            label: options.t('history.activitySaved'),
            detail: options.t('history.activitySavedDetail', { count: options.completedGenerationCount }),
            tone: 'success'
        });
    }

    return items;
}

export function buildFailureActivityDetail(message: string, t: Translate): string {
    const trimmedMessage = message.trim();
    const effectiveMessage = trimmedMessage || t('error.unexpected');
    if (effectiveMessage.includes('建议：') || effectiveMessage.includes('Recommendation:')) {
        return effectiveMessage;
    }

    return t('history.activityFailedDetail', { message: effectiveMessage });
}
