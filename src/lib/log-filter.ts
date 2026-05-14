export type FilterableLogEntry = {
    clientRequestId?: string;
    context?: string;
    filenames?: string[];
};

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function parseContext(context: string | undefined): unknown {
    if (!context) return undefined;
    try {
        return JSON.parse(context);
    } catch {
        return undefined;
    }
}

function readContextArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function resolveLogClientRequestIds(input: {
    logs: FilterableLogEntry[];
    clientRequestIds: string[];
    filenames: string[];
}): string[] {
    const requestIds = new Set(input.clientRequestIds.filter((value) => value.length > 0));
    const filenames = new Set(input.filenames.filter((value) => value.length > 0));

    if (filenames.size > 0) {
        input.logs.forEach((entry) => {
            if (!entry.clientRequestId) return;
            const entryFilenames = entry.filenames ?? readContextArray((parseContext(entry.context) as Record<string, unknown> | undefined)?.filenames);
            if (entryFilenames.some((filename) => filenames.has(filename))) {
                requestIds.add(entry.clientRequestId);
            }
        });
    }

    return uniqueStrings(Array.from(requestIds));
}

export function filterLogsByScope(input: {
    logs: FilterableLogEntry[];
    clientRequestIds: string[];
    filenames: string[];
}): FilterableLogEntry[] {
    const resolvedIds = new Set(resolveLogClientRequestIds(input));
    if (resolvedIds.size === 0) return [];
    return input.logs.filter((entry) => entry.clientRequestId && resolvedIds.has(entry.clientRequestId));
}
