export const PAGE_PASSWORD_AUTH_ERROR_CODES = {
    missing: 'page_password_missing',
    invalid: 'page_password_invalid'
} as const;

export type PagePasswordAuthErrorCode =
    (typeof PAGE_PASSWORD_AUTH_ERROR_CODES)[keyof typeof PAGE_PASSWORD_AUTH_ERROR_CODES];

export function isPagePasswordAuthErrorCode(value: unknown): value is PagePasswordAuthErrorCode {
    return value === PAGE_PASSWORD_AUTH_ERROR_CODES.missing || value === PAGE_PASSWORD_AUTH_ERROR_CODES.invalid;
}

export function hasPreservedDisplayedAuthError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'preserveDisplayedError' in error &&
        error.preserveDisplayedError === true
    );
}
