export type WebuiImageRetentionAction = 'preserve' | 'release';

export type WebuiImageFileOperationResult = {
    filename: string;
    success: boolean;
    fileDeleted?: boolean;
    fileAbsent?: boolean;
    markerRemoved?: boolean;
    error?: string;
};

export function readWebuiImageRetentionFilenames(value: unknown): string[] {
    if (!isRecord(value) || !Array.isArray(value.filenames)) {
        throw new Error('自动清理保护状态响应格式无效。');
    }
    if (!value.filenames.every((filename): filename is string => typeof filename === 'string')) {
        throw new Error('自动清理保护状态响应格式无效。');
    }
    return [...new Set(value.filenames)];
}

export function readWebuiImageFileOperationResults(value: unknown): WebuiImageFileOperationResult[] {
    if (!isRecord(value) || !Array.isArray(value.results)) {
        throw new Error('图片文件操作响应格式无效。');
    }
    return value.results.map((result) => {
        if (!isRecord(result) || typeof result.filename !== 'string' || typeof result.success !== 'boolean') {
            throw new Error('图片文件操作响应格式无效。');
        }
        return {
            filename: result.filename,
            success: result.success,
            ...(typeof result.fileDeleted === 'boolean' ? { fileDeleted: result.fileDeleted } : {}),
            ...(typeof result.fileAbsent === 'boolean' ? { fileAbsent: result.fileAbsent } : {}),
            ...(typeof result.markerRemoved === 'boolean' ? { markerRemoved: result.markerRemoved } : {}),
            ...(typeof result.error === 'string' ? { error: result.error } : {})
        };
    });
}

export function mergeWebuiImageRetentionResults(
    current: ReadonlySet<string>,
    action: WebuiImageRetentionAction,
    results: WebuiImageFileOperationResult[]
): Set<string> {
    const next = new Set(current);
    for (const result of results) {
        if (!result.success && !(action === 'release' && result.markerRemoved === true)) continue;
        if (action === 'preserve') {
            next.add(result.filename);
        } else {
            next.delete(result.filename);
        }
    }
    return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
