import fs from 'fs/promises';
import { RequestValidationError, isValidImageFilename } from '@/lib/image-request-utils';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { outputDir, verifyAccessToken } from '@/lib/server-runtime';
import { lookup } from 'mime-types';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
    const { filename } = await params;
    const appPassword = process.env.APP_PASSWORD;
    const accessToken = request.cookies.get('gptImageAccess')?.value;
    if (!verifyAccessToken(accessToken, appPassword)) {
        return NextResponse.json(
            {
                error: 'Unauthorized: Invalid access token.',
                code: accessToken ? PAGE_PASSWORD_AUTH_ERROR_CODES.invalid : PAGE_PASSWORD_AUTH_ERROR_CODES.missing
            },
            { status: 401 }
        );
    }

    if (!filename) {
        return NextResponse.json({ error: '文件名必填' }, { status: 400 });
    }

    if (!isValidImageFilename(filename)) {
        return NextResponse.json({ error: '文件名无效' }, { status: 400 });
    }

    const filepath = path.join(outputDir, filename);

    try {
        await fs.access(filepath);

        const fileBuffer = await fs.readFile(filepath);

        const contentType = lookup(filename) || 'application/octet-stream';

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileBuffer.length.toString()
            }
        });
    } catch (error: unknown) {
        console.error(`读取图片失败 ${filename}：`, error);
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return NextResponse.json({ error: '图片不存在' }, { status: 404 });
        }
        if (error instanceof RequestValidationError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
    }
}
