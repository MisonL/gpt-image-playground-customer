import { buildContentSecurityPolicy } from './src/lib/content-security-policy';
import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    const contentSecurityPolicy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
    requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

    const response = NextResponse.next({
        request: {
            headers: requestHeaders
        }
    });
    response.headers.set('Content-Security-Policy', contentSecurityPolicy);
    return response;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
