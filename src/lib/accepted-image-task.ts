export type AcceptedImageTaskDetails = {
    taskId?: string;
    pollUrl?: string;
};

export function readAcceptedImageTaskDetails(result: unknown): AcceptedImageTaskDetails | undefined {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
    const record = result as Record<string, unknown>;
    if (readTrimmedString(record.object) !== 'image.task' || readTrimmedString(record.status) !== 'pending') {
        return undefined;
    }

    const taskId = readTrimmedString(record.task_id);
    const pollUrl = readTrimmedString(record.poll_url);
    return {
        ...(taskId ? { taskId } : {}),
        ...(pollUrl ? { pollUrl } : {})
    };
}

function readTrimmedString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
