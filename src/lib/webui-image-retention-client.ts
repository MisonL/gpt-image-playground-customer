export type WebuiImageRetentionAction = 'preserve' | 'release';

export type WebuiImageFileOperationResult = {
    filename: string;
    success: boolean;
    fileAbsent?: boolean;
    error?: string;
};

export function readWebuiImageRetentionFilenames(value: unknown): string[] {
    if (!isRecord(value) || !Array.isArray(value.filenames)) {
        throw new Error('永久保存状态响应格式无效。');
    }
    if (!value.filenames.every((filename): filename is string => typeof filename === 'string')) {
        throw new Error('永久保存状态响应格式无效。');
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
            ...(typeof result.fileAbsent === 'boolean' ? { fileAbsent: result.fileAbsent } : {}),
            ...(typeof result.error === 'string' ? { error: result.error } : {})
        };
    });
}

export function readApiErrorMessage(value: unknown): string | undefined {
    return isRecord(value) && typeof value.error === 'string' ? value.error : undefined;
}

export function mergeWebuiImageRetentionResults(
    current: ReadonlySet<string>,
    action: WebuiImageRetentionAction,
    results: WebuiImageFileOperationResult[]
): Set<string> {
    const next = new Set(current);
    for (const result of results) {
        if (!result.success && !(action === 'release' && result.fileAbsent === true)) continue;
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
