type Translate = (key: string) => string;

const translationKeyByErrorCode: Record<string, string> = {
    share_not_found: 'share.notFound',
    share_expired: 'share.expired',
    share_access_code_required: 'share.accessCodeRequired',
    share_access_denied: 'share.accessCodeInvalid',
    share_rate_limited: 'share.accessCodeRateLimited'
};

export function resolveShareApiErrorMessage(value: unknown, t: Translate, fallbackKey: string): string {
    if (!isRecord(value) || typeof value.code !== 'string') return t(fallbackKey);
    return t(translationKeyByErrorCode[value.code] ?? fallbackKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
