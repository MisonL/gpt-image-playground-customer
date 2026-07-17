import { appLogger } from '@/lib/app-logger';
import { isValidImageFilename } from '@/lib/image-request-utils';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { resolveImageOutputDir, verifyAccessToken, verifyPasswordHash } from '@/lib/server-runtime';
import { withWebuiImageFilenameLocks } from '@/lib/webui-image-retention-lock';
import { getWebuiImageRetentionStore, type WebuiImageRetentionAction } from '@/lib/webui-image-retention-store';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_RETENTION_BATCH_SIZE = 100;

type RetentionRequestBody = {
    action: WebuiImageRetentionAction;
    filenames: string[];
    passwordHash?: string;
};

type RetentionResult = {
    filename: string;
    success: boolean;
    error?: string;
};

export async function GET(request: NextRequest) {
    const authorizationError = verifyRetentionReader(request);
    if (authorizationError) return authorizationError;

    try {
        const store = await getWebuiImageRetentionStore();
        return NextResponse.json({ filenames: await store.listPermanentFilenames() });
    } catch (error) {
        appLogger.error('读取永久保存图片状态失败。', error);
        return NextResponse.json({ error: '读取永久保存图片状态失败。' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    let body: RetentionRequestBody;
    try {
        body = readRetentionRequest(await request.json());
    } catch (error) {
        const message = error instanceof Error ? error.message : '保留请求无效。';
        return NextResponse.json({ error: message }, { status: 400 });
    }

    const authorizationError = verifyRetentionWriter(body.passwordHash);
    if (authorizationError) return authorizationError;

    try {
        const results = await applyRetentionRequest(body);
        return NextResponse.json({ results }, { status: results.every((result) => result.success) ? 200 : 207 });
    } catch (error) {
        appLogger.error('更新永久保存图片状态失败。', error);
        return NextResponse.json({ error: '更新永久保存图片状态失败。' }, { status: 500 });
    }
}

function verifyRetentionReader(request: NextRequest): NextResponse | undefined {
    const appPassword = process.env.APP_PASSWORD?.trim();
    if (!appPassword) return undefined;
    const accessToken = request.cookies.get('gptImageAccess')?.value;
    if (verifyAccessToken(accessToken, appPassword)) return undefined;
    return NextResponse.json(
        {
            error: '未授权：访问令牌无效。',
            code: accessToken ? PAGE_PASSWORD_AUTH_ERROR_CODES.invalid : PAGE_PASSWORD_AUTH_ERROR_CODES.missing
        },
        { status: 401 }
    );
}

function verifyRetentionWriter(passwordHash: string | undefined): NextResponse | undefined {
    const appPassword = process.env.APP_PASSWORD?.trim();
    if (!appPassword) return undefined;
    if (!passwordHash) {
        return NextResponse.json({ error: '未授权：缺少访问码哈希。' }, { status: 401 });
    }
    if (!verifyPasswordHash(passwordHash, appPassword)) {
        return NextResponse.json({ error: '未授权：访问码无效。' }, { status: 401 });
    }
    return undefined;
}

function readRetentionRequest(value: unknown): RetentionRequestBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('保留请求无效：必须是 JSON 对象。');
    }
    const body = value as Record<string, unknown>;
    if (body.action !== 'preserve' && body.action !== 'release') {
        throw new Error('保留请求无效：action 必须是 preserve 或 release。');
    }
    if (!Array.isArray(body.filenames) || body.filenames.some((filename) => typeof filename !== 'string')) {
        throw new Error('保留请求无效：filenames 必须是字符串数组。');
    }
    if (body.filenames.length > MAX_RETENTION_BATCH_SIZE) {
        throw new Error(`保留请求无效：单次最多处理 ${MAX_RETENTION_BATCH_SIZE} 张图片。`);
    }
    if (body.passwordHash !== undefined && typeof body.passwordHash !== 'string') {
        throw new Error('保留请求无效：passwordHash 必须是字符串。');
    }
    return {
        action: body.action,
        filenames: [...new Set(body.filenames)],
        ...(typeof body.passwordHash === 'string' ? { passwordHash: body.passwordHash } : {})
    };
}

async function applyRetentionRequest(body: RetentionRequestBody): Promise<RetentionResult[]> {
    const outputDir = resolveImageOutputDir();
    if (body.action === 'preserve') {
        return await withWebuiImageFilenameLocks(body.filenames, async () => {
            const successfulFilenames: string[] = [];
            const results: RetentionResult[] = [];

            for (const filename of body.filenames) {
                const validationError = await validatePreservedFile(filename, outputDir);
                if (validationError) {
                    results.push({ filename, success: false, error: validationError });
                    continue;
                }
                successfulFilenames.push(filename);
                results.push({ filename, success: true });
            }

            if (successfulFilenames.length > 0) {
                await (await getWebuiImageRetentionStore()).preserve(successfulFilenames);
            }
            return results;
        });
    }

    const successfulFilenames: string[] = [];
    const results: RetentionResult[] = [];
    for (const filename of body.filenames) {
        const validationError = validateReleaseFilename(filename);
        if (validationError) {
            results.push({ filename, success: false, error: validationError });
            continue;
        }
        successfulFilenames.push(filename);
        results.push({ filename, success: true });
    }

    if (successfulFilenames.length > 0) {
        await (await getWebuiImageRetentionStore()).release(successfulFilenames);
    }
    return results;
}

async function validatePreservedFile(filename: string, outputDir: string): Promise<string | undefined> {
    if (!isValidImageFilename(filename)) return '文件名格式无效。';
    const filepath = path.resolve(outputDir, filename);
    if (path.dirname(filepath) !== outputDir) return '文件名格式无效。';
    try {
        const stats = await fs.lstat(filepath);
        if (!stats.isFile() || stats.isSymbolicLink()) return '文件必须是常规文件。';
        return undefined;
    } catch (error) {
        if (isMissingFileError(error)) return '文件不存在。';
        appLogger.error('校验永久保存图片文件失败。', error);
        return '读取文件失败。';
    }
}

function validateReleaseFilename(filename: string): string | undefined {
    return isValidImageFilename(filename) ? undefined : '文件名格式无效。';
}

function isMissingFileError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
