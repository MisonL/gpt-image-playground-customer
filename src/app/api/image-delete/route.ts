import { appLogger } from '@/lib/app-logger';
import { isValidImageFilename } from '@/lib/image-request-utils';
import { resolveImageOutputDir, verifyPasswordHash } from '@/lib/server-runtime';
import { withWebuiImageFilenameLock } from '@/lib/webui-image-retention-lock';
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
    fileDeleted?: boolean;
    fileAbsent?: boolean;
    markerRemoved?: boolean;
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

    const outputDir = resolveImageOutputDir();
    const deletionResults: FileDeletionResult[] = [];

    for (const filename of filenames) {
        if (!isValidImageFilename(filename)) {
            appLogger.warn(`删除操作收到无效文件名：${filename}`);
            deletionResults.push({ filename, success: false, error: '文件名格式无效。' });
            continue;
        }
        deletionResults.push(
            await withWebuiImageFilenameLock(
                filename,
                async () => await deleteImageAndRetentionMarker(filename, outputDir)
            )
        );
    }

    const allSucceeded = deletionResults.every((r) => r.success);

    return NextResponse.json(
        {
            message: allSucceeded ? '所有文件已删除。' : '部分文件未能完整删除或清理自动清理保护。',
            results: deletionResults
        },
        { status: allSucceeded ? 200 : 207 } // 部分失败时返回 207 Multi-Status。
    );
}

async function deleteImageAndRetentionMarker(filename: string, outputDir: string): Promise<FileDeletionResult> {
    const filepath = path.join(outputDir, filename);
    let fileDeleted = false;

    try {
        await fs.unlink(filepath);
        fileDeleted = true;
    } catch (error) {
        if (!isMissingFileError(error)) {
            appLogger.error(`删除图片失败 ${filepath}：`, error);
            return { filename, success: false, error: '删除文件失败。' };
        }
    }

    try {
        await (await getWebuiImageRetentionStore()).remove([filename]);
    } catch (error) {
        appLogger.error('删除图片后清理自动清理保护失败。', error);
        return {
            filename,
            success: false,
            ...(fileDeleted ? { fileDeleted: true } : { fileAbsent: true }),
            markerRemoved: false,
            error: fileDeleted ? '图片已删除，但自动清理保护未能清理。' : '图片已不存在，但自动清理保护未能清理。'
        };
    }

    if (fileDeleted) return { filename, success: true };
    return { filename, success: false, fileAbsent: true, markerRemoved: true, error: '文件不存在。' };
}

function isMissingFileError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
