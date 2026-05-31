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
    it('keeps selected-image actions available in the multi-image grid view', () => {
        const html = renderImageOutput('grid');

        assert.match(html, /aria-label="选择第 1 张图片"/);
        assert.match(html, /aria-label="选择第 2 张图片"/);

        for (const action of ['继续编辑', '做变体', '复用提示词', '对比', '下载']) {
            assert.match(html, new RegExp(`<button[^>]*>.*?${action}.*?</button>`, 's'));
            assert.doesNotMatch(html, new RegExp(`<button[^>]*disabled=""[^>]*>.*?${action}.*?</button>`, 's'));
        }
    });
});
