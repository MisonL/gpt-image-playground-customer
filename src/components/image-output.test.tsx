import { buildSendToEditTarget, ImageOutput } from './image-output';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const noop = () => {};
const buttonContentPattern = '[\\s\\S]*?';

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
            assert.match(
                html,
                new RegExp(
                    `<button[^>]*disabled=""[^>]*>${buttonContentPattern}${action}${buttonContentPattern}</button>`
                )
            );
        }
    });

    it('uses an edit reference placeholder instead of the sample image in edit mode', () => {
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
                    currentMode='edit'
                    baseImagePreviewUrl={null}
                    clientPasswordHash={null}
                    canOpenLogs={false}
                />
            </I18nProvider>
        );

        assert.match(html, /先放入参考图/);
        assert.match(html, /等待参考图/);
        assert.doesNotMatch(html, /灵感样张/);
    });

    it('shows the edit reference image before an edit result exists', () => {
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
                    currentMode='edit'
                    baseImagePreviewUrl='data:image/png;base64,reference'
                    clientPasswordHash={null}
                    canOpenLogs={false}
                />
            </I18nProvider>
        );

        assert.match(html, /参考图已就绪/);
        assert.match(html, /图生图参考图预览/);
        assert.match(html, /参考图/);
        assert.doesNotMatch(html, /灵感样张/);
    });

    it('keeps selected-image actions available in the multi-image grid view', () => {
        const html = renderImageOutput('grid');

        assert.match(html, /aria-label="选择第 1 张图片"/);
        assert.match(html, /aria-label="选择第 2 张图片"/);

        assert.ok(html.indexOf('下载') < html.indexOf('继续编辑'));

        for (const action of ['继续编辑', '做变体', '复用提示词', '对比', '下载']) {
            assert.match(
                html,
                new RegExp(`<button[^>]*>${buttonContentPattern}${action}${buttonContentPattern}</button>`)
            );
            assert.doesNotMatch(
                html,
                new RegExp(
                    `<button[^>]*disabled=""[^>]*>${buttonContentPattern}${action}${buttonContentPattern}</button>`
                )
            );
        }
    });

    it('passes the selected image storage mode to continue editing', () => {
        assert.deepEqual(
            buildSendToEditTarget({
                path: 'data:image/png;base64,selected',
                filename: 'selected.png',
                storageMode: 'indexeddb'
            }),
            { filename: 'selected.png', storageMode: 'indexeddb' }
        );
        assert.deepEqual(
            buildSendToEditTarget({
                path: '/api/image/fs.png',
                filename: 'fs.png'
            }),
            { filename: 'fs.png' }
        );
        assert.equal(buildSendToEditTarget(null), null);
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

        assert.match(
            html,
            new RegExp(`<button[^>]*disabled=""[^>]*>${buttonContentPattern}对比${buttonContentPattern}</button>`)
        );
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

        assert.match(
            html,
            new RegExp(`<button(?![^>]*disabled="")[^>]*>${buttonContentPattern}对比${buttonContentPattern}</button>`)
        );
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

    it('shows an explicit failure state with retry near the canvas', () => {
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
                    failureMessage='上游或 API 中转站异常。请稍后重试。'
                    onRetry={noop}
                    canCreateVariant={false}
                    canReusePrompt={false}
                    currentMode='generate'
                    baseImagePreviewUrl={null}
                    clientPasswordHash={null}
                    canOpenLogs={false}
                />
            </I18nProvider>
        );

        assert.match(html, /生成失败/);
        assert.match(html, /上游或 API 中转站异常。请稍后重试。/);
        assert.match(
            html,
            new RegExp(`<button[^>]*>${buttonContentPattern}重试生成${buttonContentPattern}</button>`)
        );
        assert.doesNotMatch(html, /灵感样张/);
    });
});
