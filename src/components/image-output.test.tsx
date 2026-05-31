import { ImageOutput } from './image-output';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const noop = () => {};

function renderImageOutput(viewMode: 'grid' | number): string {
    return renderToStaticMarkup(
        <I18nProvider>
            <ImageOutput
                imageBatch={[
                    { path: '/api/image/first.png', filename: 'first.png' },
                    { path: '/api/image/second.png', filename: 'second.png' }
                ]}
                viewMode={viewMode}
                onViewChange={noop}
                isLoading={false}
                onSendToEdit={noop}
                onDownloadImage={noop}
                onShareImage={noop}
                onCreateVariant={noop}
                onReusePrompt={noop}
                canCreateVariant
                canReusePrompt
                currentMode='generate'
                baseImagePreviewUrl={null}
                clientPasswordHash={null}
                canOpenLogs={false}
            />
        </I18nProvider>
    );
}

describe('ImageOutput result actions', () => {
    it('does not show fixed preview timing or dimensions before real image metadata is known', () => {
        const html = renderImageOutput(0);

        assert.match(html, /第 1 张 \/ 共 2 张/);
        assert.doesNotMatch(html, /预计 8-12 秒/);
        assert.doesNotMatch(html, /1024 x 768/);
    });

    it('uses the no-image state in the preview header before generation', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <ImageOutput
                    imageBatch={null}
                    viewMode='grid'
                    onViewChange={noop}
                    isLoading={false}
                    onSendToEdit={noop}
                    onDownloadImage={noop}
                    onShareImage={noop}
                    onCreateVariant={noop}
                    onReusePrompt={noop}
                    canCreateVariant={false}
                    canReusePrompt={false}
                    currentMode='generate'
                    baseImagePreviewUrl={null}
                    clientPasswordHash={null}
                    canOpenLogs={false}
                />
            </I18nProvider>
        );

        assert.match(html, /还没有生成图像/);
        assert.doesNotMatch(html, /1024 x 768/);
        for (const action of ['继续编辑', '做变体', '复用提示词', '对比', '下载']) {
            assert.doesNotMatch(html, new RegExp(action));
        }
    });

    it('keeps selected-image actions available in the multi-image grid view', () => {
        const html = renderImageOutput('grid');

        assert.match(html, /aria-label="选择第 1 张图片"/);
        assert.match(html, /aria-label="选择第 2 张图片"/);

        for (const action of ['继续编辑', '做变体', '复用提示词', '对比', '下载']) {
            assert.match(html, new RegExp(`<button[^>]*>.*?${action}.*?</button>`, 's'));
            assert.doesNotMatch(html, new RegExp(`<button[^>]*disabled=""[^>]*>.*?${action}.*?</button>`, 's'));
        }
    });

    it('keeps compare disabled for single-image results', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <ImageOutput
                    imageBatch={[{ path: '/api/image/only.png', filename: 'only.png' }]}
                    viewMode={0}
                    onViewChange={noop}
                    isLoading={false}
                    onSendToEdit={noop}
                    onDownloadImage={noop}
                    onShareImage={noop}
                    onCreateVariant={noop}
                    onReusePrompt={noop}
                    canCreateVariant
                    canReusePrompt
                    currentMode='generate'
                    baseImagePreviewUrl={null}
                    clientPasswordHash={null}
                    canOpenLogs={false}
                />
            </I18nProvider>
        );

        assert.match(html, /<button[^>]*disabled=""[^>]*>.*?对比.*?<\/button>/s);
    });

    it('enables compare for single-image results with a previous history image', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <ImageOutput
                    imageBatch={[{ path: '/api/image/only.png', filename: 'only.png' }]}
                    compareImage={{ path: '/api/image/previous.png', filename: 'previous.png' }}
                    viewMode={0}
                    onViewChange={noop}
                    isLoading={false}
                    onSendToEdit={noop}
                    onDownloadImage={noop}
                    onShareImage={noop}
                    onCreateVariant={noop}
                    onReusePrompt={noop}
                    canCreateVariant
                    canReusePrompt
                    currentMode='generate'
                    baseImagePreviewUrl={null}
                    clientPasswordHash={null}
                    canOpenLogs={false}
                />
            </I18nProvider>
        );

        assert.match(html, /<button(?![^>]*disabled="")[^>]*>.*?对比.*?<\/button>/s);
    });

    it('uses user-facing generation activity copy for the activity entry', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <ImageOutput
                    imageBatch={[{ path: '/api/image/only.png', filename: 'only.png' }]}
                    viewMode={0}
                    onViewChange={noop}
                    isLoading={false}
                    onSendToEdit={noop}
                    onDownloadImage={noop}
                    onShareImage={noop}
                    onCreateVariant={noop}
                    onReusePrompt={noop}
                    canCreateVariant
                    canReusePrompt
                    currentMode='generate'
                    baseImagePreviewUrl={null}
                    clientPasswordHash='test-hash'
                    canOpenLogs
                />
            </I18nProvider>
        );

        assert.match(html, /查看动态/);
        assert.doesNotMatch(html, /查看日志/);
    });
});
