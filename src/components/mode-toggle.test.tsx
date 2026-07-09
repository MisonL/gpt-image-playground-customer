import { ModeToggle } from './mode-toggle';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const noop = () => {};

describe('ModeToggle responsive labels', () => {
    it('keeps desktop mode tabs text-first so narrow sidebars do not truncate labels', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <ModeToggle currentMode='generate' onModeChange={noop} />
            </I18nProvider>
        );

        assert.match(html, /复用历史/);
        assert.doesNotMatch(html, /2xl:block/);
    });
});
