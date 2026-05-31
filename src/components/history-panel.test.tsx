import { HistoryPanel } from './history-panel';
import type { HistoryMetadata } from '@/app/page';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const noop = () => {};
const historyItem: HistoryMetadata = {
    timestamp: Date.UTC(2026, 4, 31, 12, 15),
    images: [{ filename: 'history-card.png', clientRequestId: 'request-1' }],
    storageModeUsed: 'indexeddb',
    durationMs: 1350,
    quality: 'high',
    background: 'auto',
    moderation: 'auto',
    prompt: '窗边花束与复古杂志，柔和自然光，胶片感',
    mode: 'generate',
    costDetails: null,
    output_format: 'png',
    model: 'gpt-image-2',
    size: '2048x2048'
};

function renderHistoryPanel(history: HistoryMetadata[]): string {
    return renderToStaticMarkup(
        <I18nProvider>
            <HistoryPanel
                history={history}
                inspirations={[]}
                onSelectImage={noop}
                onApplyPrompt={noop}
                onSaveInspiration={noop}
                onSendHistoryToEdit={noop}
                onDeleteInspiration={noop}
                onClearHistory={noop}
                getImageSrc={() => '/api/image/history-card.png'}
                onDeleteItemRequest={noop}
                itemPendingDeleteConfirmation={null}
                onConfirmDeletion={noop}
                onCancelDeletion={noop}
                deletePreferenceDialogValue={false}
                onDeletePreferenceDialogChange={noop}
            />
        </I18nProvider>
    );
}

describe('HistoryPanel recent history actions', () => {
    it('renders visible save, reuse, and continue-edit actions on history cards', () => {
        const html = renderHistoryPanel([historyItem]);

        assert.match(html, /最近生成/);
        assert.match(html, /窗边花束与复古杂志/);
        assert.match(html, /收藏这条历史提示词/);
        assert.match(html, /复用这条历史记录到创作单/);
        assert.match(html, /用这条历史记录的首张图片继续编辑/);
    });
});
