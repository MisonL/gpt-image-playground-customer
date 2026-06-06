import { DEFAULT_SHARE_EXPIRY_VALUE, getShareExpiryMinutes } from './share-dialog';
import { I18nProvider } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function ShareRiskHintProbe() {
    const { t } = useI18n();
    return <p>{t('share.publicRiskHint')}</p>;
}

function renderShareRiskHint() {
    return renderToStaticMarkup(
        <I18nProvider>
            <ShareRiskHintProbe />
        </I18nProvider>
    );
}

describe('ShareDialog', () => {
    it('defaults to a one-day time-limited share', () => {
        assert.equal(DEFAULT_SHARE_EXPIRY_VALUE, '1440');
        assert.equal(getShareExpiryMinutes(DEFAULT_SHARE_EXPIRY_VALUE), 1440);
    });

    it('explains public sharing risk for no-access-code links', () => {
        const html = renderShareRiskHint();

        assert.match(html, /无访问码/);
        assert.match(html, /链接获得者/);
    });
});
