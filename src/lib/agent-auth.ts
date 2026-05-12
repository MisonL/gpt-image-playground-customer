import { AgentApiError } from './api-error-response';
import crypto from 'crypto';
import { verifyPasswordHash } from './server-runtime';

export function assertAgentAuthorized(headers: Headers, env: Record<string, string | undefined> = process.env): void {
    const configuredToken = env.AGENT_API_TOKEN?.trim();
    if (configuredToken) {
        const authorization = headers.get('authorization') || '';
        const expected = `Bearer ${configuredToken}`;
        if (!timingSafeStringEqual(authorization, expected)) {
            throw new AgentApiError({
                code: 'unauthorized',
                message: 'Unauthorized: invalid or missing bearer token.',
                status: 401,
                retryable: false
            });
        }
        return;
    }

    const appPassword = env.APP_PASSWORD;
    if (!appPassword) return;

    const passwordHash = headers.get('x-app-password-hash');
    if (!passwordHash || !verifyPasswordHash(passwordHash, appPassword)) {
        throw new AgentApiError({
            code: 'unauthorized',
            message: 'Unauthorized: invalid or missing password hash.',
            status: 401,
            retryable: false
        });
    }
}

function timingSafeStringEqual(actual: string, expected: string): boolean {
    const actualHash = crypto.createHash('sha256').update(actual).digest();
    const expectedHash = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(actualHash, expectedHash);
}
