type Translate = (key: string, values?: Record<string, string | number>) => string;

export const superApiReferralUrl = 'https://gpt2image.superapi.buzz/';

export type ApiErrorSummary = {
    message: string;
    status?: number;
};

export type ApiErrorNotice = {
    message: string;
    links: Array<{
        label: string;
        url: string;
    }>;
};

export function buildUserFacingApiErrorMessage(options: ApiErrorSummary & { t: Translate }): string {
    const advice = buildApiErrorAdvice(options.status, options.t);
    if (!advice) return options.message;

    return options.t('error.apiFailedWithAdvice', {
        message: options.message,
        advice
    });
}

export function buildBatchPartialFailureMessage(options: {
    failed: number;
    total: number;
    errors: ApiErrorSummary[];
    t: Translate;
}): string {
    const reasons = options.errors
        .map(
            (error, index) =>
                `${index + 1}. ${buildUserFacingApiErrorMessage({
                    message: error.message,
                    status: error.status,
                    t: options.t
                })}`
        )
        .join(' ');

    return options.t('error.batchPartialFailureDetailed', {
        failed: options.failed,
        total: options.total,
        reasons
    });
}

export function buildApiErrorNotice(message: string): ApiErrorNotice {
    return { message, links: [] };
}

function buildApiErrorAdvice(status: number | undefined, t: Translate): string | null {
    if (status === 401 || status === 403) return t('error.adviceAuth');
    if (status === 429) return t('error.adviceRateLimit');
    if (status === 524) return t('error.adviceCloudflare', { url: superApiReferralUrl });
    if (isUpstreamStatus(status)) return t('error.adviceUpstream');
    return null;
}

function isUpstreamStatus(status: number | undefined): boolean {
    return (
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status === 520 ||
        status === 522 ||
        status === 523
    );
}
