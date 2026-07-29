import {
    DEFAULT_SHARE_EXPIRY_VALUE,
    ShareDialogFooterActions,
    ShareExpiryField,
    ShareLinkField,
    getShareExpiryMinutes
} from './share-dialog';
import { I18nProvider, useI18n } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

function renderShareLinkField() {
    return renderToStaticMarkup(
        <I18nProvider>
            <ShareLinkField
                shareUrl='https://images.example.test/share/token'
                copyStatus={{ url: 'https://images.example.test/share/token', result: 'copied' }}
                onCopy={noop}
            />
        </I18nProvider>
    );
}

function renderShareExpiryField() {
    return renderToStaticMarkup(
        <I18nProvider>
            <ShareExpiryField expiry='1440' onExpiryChange={noop} />
        </I18nProvider>
    );
}

function renderShareDialogFooterActions() {
    return renderToStaticMarkup(
        <I18nProvider>
            <ShareDialogFooterActions isCreating={false} accessCodeError={null} onClose={noop} onCreate={noop} />
        </I18nProvider>
    );
}

const noop = () => {};

describe('ShareDialog', () => {
    it('defaults to a one-day time-limited share', () => {
        assert.equal(DEFAULT_SHARE_EXPIRY_VALUE, '1440');
        assert.equal(getShareExpiryMinutes(DEFAULT_SHARE_EXPIRY_VALUE), 1440);
    });

    it('falls back to the one-day default for unknown expiry values', () => {
        assert.equal(getShareExpiryMinutes('unexpected'), 1440);
    });

    it('allows an explicit share without an expiry when selected', () => {
        assert.equal(getShareExpiryMinutes('none'), null);
    });

    it('explains public sharing risk for no-access-code links', () => {
        const html = renderShareRiskHint();

        assert.match(html, /无访问码/);
        assert.match(html, /链接获得者/);
    });

    it('associates the expiry label with the select trigger', () => {
        const html = renderShareExpiryField();

        assert.match(html, /share-expiry/);
    });

    it('associates the generated link with its read-only input and announces share feedback', () => {
        const html = renderShareLinkField();

        assert.match(html, /for="share-link"/);
        assert.match(html, /id="share-link"/);
        assert.match(html, /aria-live="polite"/);
    });

    it('renders an explicit footer close action', () => {
        const html = renderShareDialogFooterActions();

        assert.match(html, /type="button"/);
        assert.match(html, />关闭</);
        assert.match(html, />创建分享</);
    });
});
