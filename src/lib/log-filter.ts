export type FilterableLogEntry = {
    clientRequestId?: string;
    context?: string;
    filenames?: string[];
    message?: string;
};

export type LogScopeDiagnostics = {
    requestIds: string[];
    filenames: string[];
    filenameMatchedRequestIds: string[];
    copyText: string;
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
    if (!Array.isArray(value)) {
        throw new TypeError(`日志上下文字段类型无效：期望数组，实际为 ${typeof value}。`);
    }
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readParsedFilenames(context: string | undefined): string[] {
    const parsed = parseContext(context);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
    const filenames = (parsed as Record<string, unknown>).filenames;
    if (!Array.isArray(filenames)) return [];
    return readContextArray(filenames);
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
            const entryFilenames = entry.filenames ?? readParsedFilenames(entry.context);
            if (entryFilenames.some((filename) => filenames.has(filename))) {
                requestIds.add(entry.clientRequestId);
            }
        });
    }

    return uniqueStrings(Array.from(requestIds));
}

export function filterLogsByScope<T extends FilterableLogEntry>(input: {
    logs: T[];
    clientRequestIds: string[];
    filenames: string[];
}): T[] {
    const resolvedIds = new Set(resolveLogClientRequestIds(input));
    if (resolvedIds.size === 0) return [];
    return input.logs.filter((entry): entry is T => {
        if (!entry.clientRequestId) return false;
        return resolvedIds.has(entry.clientRequestId);
    });
}

export function buildLogScopeDiagnostics(input: {
    clientRequestIds: string[];
    filenames: string[];
    resolvedClientRequestIds: string[];
}): LogScopeDiagnostics {
    const requestIds = uniqueStrings(input.clientRequestIds);
    const filenames = uniqueStrings(input.filenames);
    const directRequestIds = new Set(requestIds);
    const filenameMatchedRequestIds = uniqueStrings(input.resolvedClientRequestIds).filter(
        (requestId) => !directRequestIds.has(requestId)
    );
    return {
        requestIds,
        filenames,
        filenameMatchedRequestIds,
        copyText: [
            `requestIds=${formatDiagnosticValues(requestIds)}`,
            `filenames=${formatDiagnosticValues(filenames)}`,
            `filenameMatchedRequestIds=${formatDiagnosticValues(filenameMatchedRequestIds)}`
        ].join('\n')
    };
}

function formatDiagnosticValues(values: string[]): string {
    return values.length > 0 ? values.join(',') : '-';
}
