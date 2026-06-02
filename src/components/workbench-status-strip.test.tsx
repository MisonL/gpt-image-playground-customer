import { WorkbenchStatusStrip } from './workbench-status-strip';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

describe('WorkbenchStatusStrip', () => {
    it('shows model, channel, streaming status, cost, and API state before generation', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    channelLabel='默认线路'
                    streamStatus='流式可用'
                    costLabel='预计 0.12 积分'
                />
            </I18nProvider>
        );

        assert.match(html, /API 连接正常/);
        assert.match(html, /gpt-image-2/);
        assert.match(html, /默认线路/);
        assert.match(html, /流式可用/);
        assert.match(html, /预计 0\.12 积分/);
    });
});
