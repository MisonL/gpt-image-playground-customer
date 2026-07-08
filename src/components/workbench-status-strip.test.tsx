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

    it('shows request mode health details and suggested channel env in the status strip', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='流式可用'
                    costLabel='预计 0.12 积分'
                    channelRouting={{
                        effectiveRequestModes: ['images-non-stream', 'images-sse'],
                        requestModeHealth: [
                            {
                                mode: 'images-non-stream',
                                configuredCredentialCount: 2,
                                healthyCredentialCount: 1,
                                configuredChannelCount: 2,
                                healthyChannelCount: 1
                            },
                            {
                                mode: 'responses-sse',
                                configuredCredentialCount: 1,
                                healthyCredentialCount: 0,
                                configuredChannelCount: 1,
                                healthyChannelCount: 0
                            }
                        ]
                    }}
                    runtimeLastFailure={{
                        scope: 'channel',
                        status: 403,
                        code: 'image_generation_disabled',
                        requestMode: 'responses-sse'
                    }}
                />
            </I18nProvider>
        );

        assert.match(html, /请求方式/);
        assert.match(html, /images-non-stream/);
        assert.match(html, /已验证/);
        assert.match(html, /responses-sse/);
        assert.match(html, /冷却中或待探测/);
        assert.match(html, /最近渠道失败/);
        assert.match(html, /HTTP 403/);
        assert.match(html, /responses-sse/);
        assert.match(html, /OPENAI_CHANNEL_N_REQUEST_MODES=images-non-stream/);
    });

    it('keeps request mode details constrained on narrow screens', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='流式可用'
                    costLabel='预计 0.12 积分'
                    channelRouting={{
                        effectiveRequestModes: ['images-non-stream'],
                        requestModeHealth: [
                            {
                                mode: 'images-non-stream',
                                configuredCredentialCount: 1,
                                healthyCredentialCount: 1,
                                configuredChannelCount: 1,
                                healthyChannelCount: 1
                            }
                        ]
                    }}
                />
            </I18nProvider>
        );

        assert.match(html, /basis-full sm:basis-auto/);
        assert.match(html, /absolute/);
        assert.match(html, /left-0/);
        assert.match(html, /right-0/);
        assert.match(html, /sm:left-auto sm:w-\[min\(88vw,28rem\)\]/);
    });
});
