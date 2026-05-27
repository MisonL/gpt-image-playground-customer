import {
    buildApiErrorNotice,
    buildBatchPartialFailureMessage,
    buildUserFacingApiErrorMessage,
    superApiReferralUrl
} from './api-error-guidance';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const translate = (key: string, values?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
        'error.apiFailedWithAdvice': '{message}。建议：{advice}',
        'error.adviceAuth': '检查 API Key、访问码或渠道权限。',
        'error.adviceRateLimit': '请求被限流。请稍后重试，或降低并发和图片数量。',
        'error.adviceUpstream': '上游或 API 中转站异常。请稍后重试，或切换可用渠道。',
        'error.adviceCloudflare':
            '4K 或高分辨率出图可能超过 Cloudflare 100 秒限制。请降低分辨率，或改用支持 4K 流式出图的 API 中转站：{url}',
        'error.batchPartialFailureDetailed': '批量生成部分失败：{failed}/{total} 个任务失败。失败明细：{reasons}'
    };
    return (messages[key] || key).replace(/\{(\w+)\}/g, (match, valueKey) => String(values?.[valueKey] ?? match));
};

describe('buildUserFacingApiErrorMessage', () => {
    it('adds credential advice for authentication and authorization failures', () => {
        const message = buildUserFacingApiErrorMessage({
            message: '未授权',
            status: 401,
            t: translate
        });

        assert.match(message, /检查 API Key、访问码或渠道权限/);
    });

    it('adds rate-limit advice for 429 failures', () => {
        const message = buildUserFacingApiErrorMessage({
            message: 'Too many requests',
            status: 429,
            t: translate
        });

        assert.match(message, /请求被限流/);
        assert.match(message, /降低并发和图片数量/);
    });

    it('adds Cloudflare advice with the configured referral link for 524 failures', () => {
        const message = buildUserFacingApiErrorMessage({
            message: 'API 请求失败，状态码 524',
            status: 524,
            t: translate
        });

        assert.match(message, /Cloudflare 100 秒限制/);
        assert.match(message, new RegExp(superApiReferralUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    it('adds upstream advice for non-524 gateway failures', () => {
        const message = buildUserFacingApiErrorMessage({
            message: 'Bad Gateway',
            status: 502,
            t: translate
        });

        assert.match(message, /上游或 API 中转站异常/);
    });
});

describe('buildBatchPartialFailureMessage', () => {
    it('includes every failure reason instead of only counts', () => {
        const message = buildBatchPartialFailureMessage({
            failed: 2,
            total: 4,
            errors: [
                { message: 'API 请求失败，状态码 429', status: 429 },
                { message: 'API 请求失败，状态码 524', status: 524 }
            ],
            t: translate
        });

        assert.match(message, /2\/4/);
        assert.match(message, /状态码 429/);
        assert.match(message, /请求被限流/);
        assert.match(message, /状态码 524/);
        assert.match(message, /Cloudflare 100 秒限制/);
        assert.match(message, new RegExp(superApiReferralUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
});

describe('buildApiErrorNotice', () => {
    it('keeps API error messages as text without injecting vendor links', () => {
        const notice = buildApiErrorNotice('建议降低分辨率或切换渠道。');

        assert.equal(notice.message, '建议降低分辨率或切换渠道。');
        assert.deepEqual(notice.links, []);
    });
});
