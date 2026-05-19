import { isImageShareExpired, readImageShare } from '@/lib/share-store';
import { NextResponse } from 'next/server';

function jsonError(code: string, message: string, status: number) {
    return NextResponse.json({ error: message, code }, { status });
}

function publicSourceFilename(record: { accessCodeRequired: boolean; sourceFilename: string }): string {
    return record.accessCodeRequired ? 'shared-image' : record.sourceFilename;
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const record = await readImageShare(token);
    if (!record) {
        return jsonError('share_not_found', '分享不存在。', 404);
    }

    return NextResponse.json({
        token: record.token,
        sourceFilename: publicSourceFilename(record),
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt ?? null,
        accessCodeRequired: record.accessCodeRequired,
        expired: isImageShareExpired(record)
    });
}
