import { appLogger } from '@/lib/app-logger';
import { isValidImageFilename } from '@/lib/image-request-utils';
import { resolveImageOutputDir, verifyPasswordHash } from '@/lib/server-runtime';
import { getWebuiImageRetentionStore } from '@/lib/webui-image-retention-store';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

type DeleteRequestBody = {
    filenames: string[];
    passwordHash?: string;
};

type FileDeletionResult = {
    filename: string;
    success: boolean;
    error?: string;
};

export async function POST(request: NextRequest) {
    let requestBody: DeleteRequestBody;
    try {
        requestBody = await request.json();

        const appPassword = process.env.APP_PASSWORD?.trim();
        if (appPassword) {
            const clientPasswordHash = requestBody.passwordHash;

            if (!clientPasswordHash) {
                appLogger.error('删除操作缺少访问码哈希。');
                return NextResponse.json({ error: '未授权：缺少访问码哈希。' }, { status: 401 });
            }
            if (!verifyPasswordHash(clientPasswordHash, appPassword)) {
                appLogger.error('删除操作的访问码哈希无效。');
                return NextResponse.json({ error: '未授权：访问码无效。' }, { status: 401 });
            }
        }
    } catch (e) {
        appLogger.error('解析 /api/image-delete 请求正文失败：', e);
        return NextResponse.json({ error: '请求正文无效：必须是 JSON。' }, { status: 400 });
    }

    const { filenames } = requestBody;

    if (!Array.isArray(filenames) || filenames.some((fn) => typeof fn !== 'string')) {
        return NextResponse.json({ error: 'filenames 无效：必须是字符串数组。' }, { status: 400 });
    }

    if (filenames.length === 0) {
        return NextResponse.json({ message: '未提供要删除的文件名。', results: [] }, { status: 200 });
    }

    const deletionResults: FileDeletionResult[] = [];
    const deletedFilenames: string[] = [];

    for (const filename of filenames) {
        if (!isValidImageFilename(filename)) {
            appLogger.warn(`删除操作收到无效文件名：${filename}`);
            deletionResults.push({ filename, success: false, error: '文件名格式无效。' });
            continue;
        }

        const filepath = path.join(resolveImageOutputDir(), filename);

        try {
            await fs.unlink(filepath);
            deletedFilenames.push(filename);
            deletionResults.push({ filename, success: true });
        } catch (error: unknown) {
            appLogger.error(`删除图片失败 ${filepath}：`, error);
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                deletionResults.push({ filename, success: false, error: '文件不存在。' });
            } else {
                deletionResults.push({ filename, success: false, error: '删除文件失败。' });
            }
        }
    }

    if (deletedFilenames.length > 0) {
        try {
            const retentionStore = await getWebuiImageRetentionStore();
            await retentionStore.remove(deletedFilenames);
        } catch (error) {
            appLogger.error('删除图片后清理永久保存标记失败。', error);
            const deletedFilenameSet = new Set(deletedFilenames);
            for (const result of deletionResults) {
                if (result.success && deletedFilenameSet.has(result.filename)) {
                    result.success = false;
                    result.error = '图片已删除，但永久保存状态清理失败。';
                }
            }
        }
    }

    const allSucceeded = deletionResults.every((r) => r.success);

    return NextResponse.json(
        {
            message: allSucceeded ? '所有文件已删除。' : '部分文件未能删除。',
            results: deletionResults
        },
        { status: allSucceeded ? 200 : 207 } // 部分失败时返回 207 Multi-Status。
    );
}
