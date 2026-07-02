import { isImageShareExpired, readImageShare, readImageShareContent, verifyImageShareAccess } from '@/lib/share-store';
import { NextResponse } from 'next/server';

const MAX_ACCESS_FAILURES = 10;
const ACCESS_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_ACCESS_FAILURE_TOKENS = 1000;

type AccessFailureState = {
    count: number;
    firstFailedAt: number;
    blockedUntil?: number;
};

const accessFailures = new Map<string, AccessFailureState>();

function jsonError(code: string, message: string, status: number) {
    return NextResponse.json({ error: message, code }, { status });
}

function isAccessBlocked(token: string, now: number): boolean {
    pruneExpiredAccessFailures(now);
    const state = accessFailures.get(token);
    if (!state) return false;
    if (state.blockedUntil && state.blockedUntil > now) return true;
    if (state.blockedUntil && state.blockedUntil <= now) accessFailures.delete(token);
    return false;
}

function recordAccessFailure(token: string, now: number) {
    pruneExpiredAccessFailures(now);
    const current = accessFailures.get(token);
    const state =
        current && now - current.firstFailedAt <= ACCESS_FAILURE_WINDOW_MS ? current : { count: 0, firstFailedAt: now };
    state.count += 1;
    if (state.count >= MAX_ACCESS_FAILURES) {
        state.blockedUntil = now + ACCESS_FAILURE_WINDOW_MS;
    }
    accessFailures.delete(token);
    accessFailures.set(token, state);
    trimAccessFailures();
}

function clearAccessFailure(token: string) {
    accessFailures.delete(token);
}

function mimeExtension(mimeType: string): string {
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/webp') return '.webp';
    return '.png';
}

function sanitizeHeaderFilename(filename: string): string {
    const sanitized = filename
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '');
    return sanitized || 'shared-image';
}

function contentDispositionFilename(record: {
    accessCodeRequired: boolean;
    sourceFilename: string;
    mimeType: string;
}): string {
    if (record.accessCodeRequired) {
        return `shared-image${mimeExtension(record.mimeType)}`;
    }
    const sanitized = sanitizeHeaderFilename(record.sourceFilename);
    const stem = sanitized.replace(/\.[^.]+$/, '') || 'shared-image';
    return `${stem}${mimeExtension(record.mimeType)}`;
}

function pruneExpiredAccessFailures(now: number) {
    for (const [token, state] of accessFailures) {
        const blocked = Boolean(state.blockedUntil && state.blockedUntil > now);
        const withinWindow = now - state.firstFailedAt <= ACCESS_FAILURE_WINDOW_MS;
        if (!blocked && !withinWindow) {
            accessFailures.delete(token);
        }
    }
}

function trimAccessFailures() {
    while (accessFailures.size > MAX_TRACKED_ACCESS_FAILURE_TOKENS) {
        const oldestToken = accessFailures.keys().next().value;
        if (!oldestToken) return;
        accessFailures.delete(oldestToken);
    }
}

async function readAccessCode(request: Request): Promise<string | undefined> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return undefined;
    const body = (await request.json().catch(() => ({}))) as { accessCode?: unknown };
    return typeof body.accessCode === 'string' ? body.accessCode : undefined;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
    return serveShareContent(request, params);
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
    return serveShareContent(request, params, { publicOnly: true });
}

async function serveShareContent(
    request: Request,
    paramsPromise: Promise<{ token: string }>,
    options: { publicOnly?: boolean } = {}
) {
    const { token } = await paramsPromise;
    const record = await readImageShare(token);
    if (!record) {
        return jsonError('share_not_found', '分享不存在。', 404);
    }
    if (isImageShareExpired(record)) {
        return jsonError('share_expired', '分享已过期。', 410);
    }

    const now = Date.now();
    if (isAccessBlocked(token, now)) {
        return jsonError('share_rate_limited', '访问码尝试次数过多。', 429);
    }

    if (options.publicOnly && record.accessCodeRequired) {
        return jsonError('share_access_code_required', '该分享需要访问码。', 401);
    }

    const accessCode = options.publicOnly ? undefined : await readAccessCode(request);
    if (!verifyImageShareAccess(record, accessCode)) {
        recordAccessFailure(token, now);
        return jsonError('share_access_denied', '访问码无效。', 401);
    }
    clearAccessFailure(token);

    const content = await readImageShareContent(record);
    return new NextResponse(content.buffer, {
        status: 200,
        headers: {
            'Content-Type': content.mimeType,
            'Content-Length': content.buffer.length.toString(),
            'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
            'Surrogate-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': `inline; filename="${contentDispositionFilename(record)}"`
        }
    });
}
