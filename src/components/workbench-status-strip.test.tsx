import { WorkbenchStatusStrip } from './workbench-status-strip';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

describe('WorkbenchStatusStrip', () => {
    it('shows model, request route, streaming mode, requested image count, and runtime state before generation', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='images-sse'
                    streamStatus='自动'
                    requestSummaryLabel='请求 1 张图片'
                />
            </I18nProvider>
        );

        assert.match(html, /当前路由可参与请求/);
        assert.match(html, /gpt-image-2/);
        assert.match(html, /images-sse/);
        assert.match(html, /自动/);
        assert.match(html, /请求 1 张图片/);
    });

    it('shows explicit parallel batch state when the user enabled it for the current request', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='默认线路'
                    streamStatus='自动'
                    parallelBatchEnabled
                    requestSummaryLabel='请求 2 张图片'
                />
            </I18nProvider>
        );

        assert.match(html, /并发已启用/);
    });

    it('reserves the request mode slot before runtime details arrive', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='默认线路'
                    streamStatus='非流式'
                    requestSummaryLabel='请求 1 张图片'
                />
            </I18nProvider>
        );

        assert.match(html, /data-request-mode-placeholder="true"/);
        assert.match(html, /aria-hidden="true"/);
        assert.match(html, /请求方式/);
        assert.doesNotMatch(html, /invisible/);
    });

    it('renders checking, disconnected, route-limited, and custom override runtime states explicitly', () => {
        const checkingHtml = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='非流式'
                    requestSummaryLabel='请求 1 张图片'
                    runtimeHealthStatus='checking'
                />
            </I18nProvider>
        );
        const disconnectedHtml = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='非流式'
                    requestSummaryLabel='请求 1 张图片'
                    runtimeHealthStatus='disconnected'
                />
            </I18nProvider>
        );
        const routeLimitedHtml = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='自动'
                    requestSummaryLabel='请求 1 张图片'
                    runtimeHealthStatus='route-limited'
                />
            </I18nProvider>
        );
        const customOverrideHtml = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='使用自定义上游'
                    streamStatus='非流式'
                    requestSummaryLabel='请求 1 张图片'
                    runtimeHealthStatus='custom-override'
                />
            </I18nProvider>
        );

        assert.match(checkingHtml, /正在读取运行时状态/);
        assert.match(checkingHtml, /animate-spin/);
        assert.match(disconnectedHtml, /未取得运行时状态/);
        assert.match(routeLimitedHtml, /当前路由受限/);
        assert.match(customOverrideHtml, /使用自定义上游/);
    });

    it('shows request mode health details and suggested channel env in the status strip', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchStatusStrip
                    model='gpt-image-2'
                    routeLabel='服务器默认'
                    streamStatus='自动'
                    requestSummaryLabel='请求 1 张图片'
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
        assert.match(html, /可参与路由/);
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
                    streamStatus='自动'
                    requestSummaryLabel='请求 1 张图片'
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

        assert.match(html, /group static max-w-full shrink-0 sm:relative sm:basis-auto/);
        assert.match(html, /min-h-11 min-w-11 cursor-pointer/);
        assert.match(html, /sr-only sm:not-sr-only/);
        assert.match(html, /relative flex w-full min-w-0 flex-wrap/);
        assert.match(html, /sm:w-auto/);
        assert.match(html, /hidden h-3 w-px shrink-0 sm:block/);
        assert.match(html, /hidden truncate sm:inline/);
        assert.match(html, /absolute inset-x-0 top-full/);
        assert.match(html, /sm:right-auto sm:left-0 sm:w-\[min\(88vw,28rem\)\]/);
        assert.match(html, /xl:right-0 xl:left-auto/);
    });
});
