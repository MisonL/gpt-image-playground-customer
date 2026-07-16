import { ModeToggle } from './mode-toggle';
import { I18nProvider } from '@/lib/i18n';
import { renderInClientDom } from '@/test-utils/react-dom';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const noop = () => {};

describe('ModeToggle responsive labels', { concurrency: false }, () => {
    it('lets translated mode labels wrap inside narrow tab cells', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <ModeToggle currentMode='generate' onModeChange={noop} />
            </I18nProvider>
        );

        assert.match(html, /复用历史/);
        assert.match(html, /data-workbench-mode="generate"/);
        assert.match(html, /data-workbench-mode="edit"/);
        assert.match(html, /data-workbench-mode="batch"/);
        assert.match(html, /data-workbench-mode="reuse"/);
        assert.match(html, /text-\[13px\] leading-4 font-medium break-words whitespace-normal/);
        assert.match(html, /flex w-full min-w-0 items-center/);
        assert.doesNotMatch(html, /font-medium whitespace-nowrap/);
        assert.doesNotMatch(html, /block truncate text-\[13px\]/);
        assert.doesNotMatch(html, /sm:text-\[13px\]/);
        assert.doesNotMatch(html, /2xl:text-sm/);
        assert.doesNotMatch(html, /2xl:block/);
    });

    it('updates the controlled mode through a rendered tab click', async () => {
        function ModeToggleHarness() {
            const [mode, setMode] = React.useState<'generate' | 'edit' | 'batch' | 'reuse'>('generate');

            return <ModeToggle currentMode={mode} onModeChange={setMode} />;
        }

        const view = await renderInClientDom(
            <I18nProvider>
                <ModeToggleHarness />
            </I18nProvider>
        );

        try {
            const editTab = view.container.querySelector<HTMLButtonElement>('[data-workbench-mode="edit"]');
            assert.ok(editTab, 'missing edit mode tab');

            await view.click(editTab);

            assert.equal(editTab.getAttribute('data-state'), 'active');
        } finally {
            await view.cleanup();
        }
    });
});
