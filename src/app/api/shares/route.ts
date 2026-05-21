import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { createImageShare } from '@/lib/share-store';
import { verifyAccessToken } from '@/lib/server-runtime';
import { NextRequest, NextResponse } from 'next/server';

const MAX_SHARE_IMAGE_BYTES = 30 * 1024 * 1024;
const MIN_ACCESS_CODE_LENGTH = 8;
const MAX_ACCESS_CODE_LENGTH = 128;
const MAX_SOURCE_FILENAME_LENGTH = 200;
const SOURCE_FILENAME_PATTERN = /^[^\x00-\x1f\x7f\\/]+$/u;

function detectImageMimeType(buffer: Buffer): string | undefined {
    if (
        buffer.length >= 24 &&
        buffer[0] === 0x89 &&
        buffer.toString('ascii', 1, 4) === 'PNG' &&
        buffer.toString('ascii', 12, 16) === 'IHDR'
    ) {
        return 'image/png';
    }
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        return 'image/jpeg';
    }
    if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    return undefined;
}

function jsonError(code: string, message: string, status: number) {
    return NextResponse.json({ error: message, code }, { status });
}

function parseExpiry(value: FormDataEntryValue | null): number | null | undefined {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const minutes = Number(value);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60 * 24 * 30) return undefined;
    return minutes;
}

function resolveShareUrl(request: Request, token: string): string {
    const url = new URL(request.url);
    return `${url.origin}/share/${token}`;
}

function isUploadedImage(value: FormDataEntryValue | null): value is File {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Blob).arrayBuffer === 'function' &&
        typeof (value as Blob).size === 'number'
    );
}

function parseAccessCode(value: FormDataEntryValue | null): string | undefined | null {
    if (value === null) return undefined;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length < MIN_ACCESS_CODE_LENGTH || trimmed.length > MAX_ACCESS_CODE_LENGTH) return null;
    return trimmed;
}

function parseSourceFilename(value: FormDataEntryValue | null, fallback: string): string | null {
    if (value !== null && typeof value !== 'string') return null;
    const candidate = value?.trim() || fallback.trim();
    if (!candidate || candidate.length > MAX_SOURCE_FILENAME_LENGTH || !SOURCE_FILENAME_PATTERN.test(candidate)) {
        return null;
    }
    return candidate;
}

function verifyShareCreator(request: NextRequest) {
    if (!process.env.APP_PASSWORD) return undefined;
    const accessToken = request.cookies.get('gptImageAccess')?.value;
    if (verifyAccessToken(accessToken, process.env.APP_PASSWORD)) return undefined;
    const code = accessToken ? PAGE_PASSWORD_AUTH_ERROR_CODES.invalid : PAGE_PASSWORD_AUTH_ERROR_CODES.missing;
    return jsonError(code, '未授权：无效的访问令牌。', 401);
}

export async function POST(request: NextRequest) {
    const authError = verifyShareCreator(request);
    if (authError) return authError;

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return jsonError('invalid_form_data', '分享请求格式无效。', 400);
    }

    const image = form.get('image');
    if (!isUploadedImage(image)) {
        return jsonError('image_required', '分享图片必填。', 400);
    }
    if (image.size <= 0 || image.size > MAX_SHARE_IMAGE_BYTES) {
        return jsonError('invalid_image_size', '分享图片大小无效。', 400);
    }

    const sourceFilenameValue = form.get('sourceFilename');
    const fallbackFilename = typeof image.name === 'string' && image.name.trim() ? image.name : 'shared-image.png';
    const sourceFilename = parseSourceFilename(sourceFilenameValue, fallbackFilename);
    if (sourceFilename === null) {
        return jsonError('invalid_source_filename', '分享文件名无效。', 400);
    }
    const expiresInMinutes = parseExpiry(form.get('expiresInMinutes'));
    if (expiresInMinutes === undefined) {
        return jsonError('invalid_expiry', '分享有效期无效。', 400);
    }

    const accessCode = parseAccessCode(form.get('accessCode'));
    if (accessCode === null) {
        return jsonError('invalid_access_code', '访问码长度无效。', 400);
    }

    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const detectedMimeType = detectImageMimeType(imageBuffer);
    if (!detectedMimeType) {
        return jsonError('invalid_image_content', '分享图片内容不是有效的 PNG、JPEG 或 WebP 文件。', 400);
    }

    const record = await createImageShare({
        imageBuffer,
        sourceFilename,
        mimeType: detectedMimeType,
        accessCode,
        expiresInMinutes
    });

    return NextResponse.json(
        {
            token: record.token,
            url: resolveShareUrl(request, record.token),
            expiresAt: record.expiresAt ?? null,
            accessCodeRequired: record.accessCodeRequired
        },
        { status: 201 }
    );
}
