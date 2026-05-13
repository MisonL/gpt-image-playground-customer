import { buildAccessCookieOptions, createAccessToken, verifyPasswordHash } from '@/lib/server-runtime';
import { NextRequest, NextResponse } from 'next/server';

type AuthVerifyRequestBody = {
    passwordHash?: string;
};

export async function POST(request: NextRequest) {
    const appPassword = process.env.APP_PASSWORD;
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
        return NextResponse.json({ authenticated: false, error: 'Unauthorized: Invalid password.' }, { status: 401 });
    }

    const response = NextResponse.json({ authenticated: true, passwordRequired: true });
    response.cookies.set('gptImageAccess', createAccessToken(appPassword), buildAccessCookieOptions(request.headers));
    return response;
}
