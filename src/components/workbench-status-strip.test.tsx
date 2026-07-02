import { WorkbenchStatusStrip } from './workbench-status-strip';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

describe('WorkbenchStatusStrip', () => {
    it('shows model, request route, streaming status, cost, and runtime state before generation', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='images-sse'
                    streamStatus='流式可用'
                    costLabel='预计 0.12 积分'
                />
            </I18nProvider>
        );

        assert.match(html, /运行时可用/);
        assert.match(html, /gpt-image-2/);
        assert.match(html, /images-sse/);
        assert.match(html, /流式可用/);
        assert.match(html, /预计 0\.12 积分/);
    });

    it('shows explicit parallel batch state when the user enabled it for the current request', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='默认线路'
                    streamStatus='流式可用'
                    parallelBatchEnabled
                    costLabel='预计 0.24 积分'
                />
            </I18nProvider>
        );

        assert.match(html, /并发已启用/);
    });

    it('renders disconnected, route-limited, and custom override runtime states explicitly', () => {
        const disconnectedHtml = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='普通生成'
                    costLabel='预计 0.12 积分'
                    runtimeHealthStatus='disconnected'
                />
            </I18nProvider>
        );
        const routeLimitedHtml = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='流式可用'
                    costLabel='预计 0.12 积分'
                    runtimeHealthStatus='route-limited'
                />
            </I18nProvider>
        );
        const customOverrideHtml = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='使用自定义上游'
                    streamStatus='普通生成'
                    costLabel='预计 0.12 积分'
                    runtimeHealthStatus='custom-override'
                />
            </I18nProvider>
        );

        assert.match(disconnectedHtml, /运行时未连接/);
        assert.match(routeLimitedHtml, /运行态受限/);
        assert.match(customOverrideHtml, /使用自定义上游/);
    });
});
