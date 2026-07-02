import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { buildAccessCookie, verifyPasswordHash } from '@/lib/server-runtime';
import { NextRequest, NextResponse } from 'next/server';

type AuthVerifyRequestBody = {
    passwordHash?: string;
};

export async function POST(request: NextRequest) {
    const appPassword = process.env.APP_PASSWORD?.trim();
    if (!appPassword) {
        return NextResponse.json({ authenticated: true, passwordRequired: false });
    }

    let requestBody: AuthVerifyRequestBody;
    try {
        requestBody = (await request.json()) as AuthVerifyRequestBody;
    } catch {
        return NextResponse.json({ authenticated: false, error: 'Invalid request body.' }, { status: 400 });
    }

    const clientPasswordHash = requestBody.passwordHash;
    if (!clientPasswordHash || !verifyPasswordHash(clientPasswordHash, appPassword)) {
        return NextResponse.json(
            {
                authenticated: false,
                error: 'Unauthorized: Invalid access code.',
                code: PAGE_PASSWORD_AUTH_ERROR_CODES.invalid
            },
            { status: 401 }
        );
    }

    const response = NextResponse.json({ authenticated: true, passwordRequired: true });
    const accessCookie = buildAccessCookie(appPassword, request.headers);
    response.cookies.set(accessCookie.name, accessCookie.value, accessCookie.options);
    return response;
}
