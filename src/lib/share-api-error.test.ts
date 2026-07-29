import { resolveShareApiErrorMessage } from './share-api-error';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const t = (key: string) => `translated:${key}`;

describe('resolveShareApiErrorMessage', () => {
    it('maps known share error codes to locale keys without rendering API error text', () => {
        assert.equal(
            resolveShareApiErrorMessage({ code: 'share_not_found', error: '分享不存在。' }, t, 'share.loadFailed'),
            'translated:share.notFound'
        );
        assert.equal(
            resolveShareApiErrorMessage(
                { code: 'share_access_denied', error: '访问码无效。' },
                t,
                'share.unlockFailed'
            ),
            'translated:share.accessCodeInvalid'
        );
        assert.equal(
            resolveShareApiErrorMessage(
                { code: 'share_rate_limited', error: '访问码尝试次数过多。' },
                t,
                'share.unlockFailed'
            ),
            'translated:share.accessCodeRateLimited'
        );
    });

    it('uses the localized fallback for malformed and unknown API errors', () => {
        assert.equal(
            resolveShareApiErrorMessage({ error: 'raw response' }, t, 'share.loadFailed'),
            'translated:share.loadFailed'
        );
        assert.equal(
            resolveShareApiErrorMessage({ code: 'unknown_error', error: 'raw response' }, t, 'share.unlockFailed'),
            'translated:share.unlockFailed'
        );
    });
});
