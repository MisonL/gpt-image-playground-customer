import {
    HistoryPanel,
    resolveHistoryPanelTabSync,
    type GenerationActivityItem,
    type InspirationItem
} from './history-panel';
import type { HistoryMetadata } from '@/lib/history-metadata';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
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
    prompt: '用户真实历史提示词',
    mode: 'generate',
    costDetails: null,
    output_format: 'png',
    model: 'gpt-image-2',
    size: '2048x2048'
};
const batchHistoryItem: HistoryMetadata = {
    ...historyItem,
    images: [
        { filename: 'batch-card-1.png', clientRequestId: 'batch-request-1' },
        { filename: 'batch-card-2.png', clientRequestId: 'batch-request-2' },
        { filename: 'batch-card-3.png', clientRequestId: 'batch-request-3' }
    ]
};
const failedHistoryItem: HistoryMetadata = {
    ...historyItem,
    timestamp: Date.UTC(2026, 4, 31, 12, 35),
    images: [],
    status: 'failed',
    failureMessage: '上游或 API 中转站异常。请稍后重试。',
    durationMs: 2200,
    prompt: '用户真实失败提示词'
};
const inspirationItem: InspirationItem = {
    id: 1,
    createdAt: Date.UTC(2026, 4, 31, 12, 20),
    prompt: '用户保存的真实灵感提示词'
};

function renderHistoryPanel(
    history: HistoryMetadata[],
    inspirations: InspirationItem[] = [],
    activityItems: GenerationActivityItem[] = [],
    isSendingToEdit = false
): string {
    return renderToStaticMarkup(
        <I18nProvider>
            <HistoryPanel
                history={history}
                inspirations={inspirations}
                activityItems={activityItems}
                isSendingToEdit={isSendingToEdit}
                onSelectImage={noop}
                onApplyPrompt={noop}
                onSaveInspiration={noop}
                onSendHistoryToEdit={noop}
                onMarkResultFeedback={noop}
                onUpdateResultFeedbackNote={noop}
                onDeleteInspiration={noop}
                onDownloadHistoryItem={noop}
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
    it('switches to recent history when history appears and no inspirations exist', () => {
        assert.equal(
            resolveHistoryPanelTabSync({
                activeTab: 'inspiration',
                historyCount: 1,
                inspirationCount: 0
            }),
            'history'
        );
        assert.equal(
            resolveHistoryPanelTabSync({
                activeTab: 'inspiration',
                historyCount: 1,
                inspirationCount: 1
            }),
            'inspiration'
        );
        assert.equal(
            resolveHistoryPanelTabSync({
                activeTab: 'history',
                historyCount: 0,
                inspirationCount: 1
            }),
            'inspiration'
        );
    });

    it('renders visible save, reuse, and continue-edit actions on history cards', () => {
        const html = renderHistoryPanel([historyItem]);

        assert.match(html, /最近生成/);
        assert.match(html, /用户真实历史提示词/);
        assert.match(html, /数据库/);
        assert.doesNotMatch(html, /Album/);
        assert.doesNotMatch(html, /Local/);
        assert.match(html, /收藏这条历史提示词/);
        assert.match(html, /复用这条历史记录到创作单/);
        assert.match(html, /用这条历史记录的首张图片继续编辑/);
        assert.match(html, /aria-label="下载批次"/);
        assert.match(html, /结果反馈/);
        assert.match(html, /未标记/);
        assert.match(html, /aria-label="标记本次结果可用"/);
        assert.match(html, /aria-label="标记本次结果需要修改"/);
        assert.doesNotMatch(html, /2xl:grid-cols-2/);
    });

    it('disables continue-edit actions while an image is being prepared for editing', () => {
        const html = renderHistoryPanel([historyItem], [], [], true);
        const continueEditButton =
            html.match(
                /<button(?=[^>]*aria-label="用这条历史记录的首张图片继续编辑")(?=[^>]*disabled="")[^>]*>/
            )?.[0] ?? '';

        assert.ok(continueEditButton, 'missing continue-edit action');
    });

    it('formats summary and token counters with the active locale', async () => {
        const source = await readFile(new URL('./history-panel.tsx', import.meta.url), 'utf8');

        assert.match(source, /totalImages\.toLocaleString\(locale\)/);
        assert.match(source, /actualQuota\.toLocaleString\(\s*locale\s*\)/);
        assert.match(source, /text_input_tokens\.toLocaleString\(\s*locale\s*\)/);
        assert.match(source, /image_input_tokens\.toLocaleString\(\s*locale\s*\)/);
        assert.match(source, /image_output_tokens\.toLocaleString\(\s*locale\s*\)/);
    });

    it('renders saved result feedback on completed history cards', () => {
        const html = renderHistoryPanel([
            {
                ...historyItem,
                resultFeedback: {
                    value: 'needs_revision',
                    updatedAt: Date.UTC(2026, 4, 31, 12, 18)
                }
            }
        ]);

        assert.match(html, /结果反馈/);
        assert.match(html, /需修改/);
        assert.match(html, /aria-label="标记本次结果需要修改"/);
        assert.match(html, /aria-pressed="true"/);
    });

    it('renders result feedback notes in cards and detail dialogs', () => {
        const html = renderHistoryPanel([
            {
                ...historyItem,
                resultFeedback: {
                    value: 'usable',
                    updatedAt: Date.UTC(2026, 4, 31, 12, 18),
                    note: '首版可直接进入文案排期。'
                }
            }
        ]);

        assert.match(html, /反馈原因/);
        assert.match(html, /首版可直接进入文案排期。/);
        assert.match(html, /Record why it is usable or needs revision|记录为什么可用或需要修改/);
    });

    it('renders recent history as a mobile horizontal snap album', () => {
        const html = renderHistoryPanel([historyItem]);

        assert.match(html, /snap-x snap-mandatory/);
        assert.match(html, /w-\[min\(76vw,280px\)\]/);
    });

    it('keeps multi-image history batches collapsed by default with an expand control', () => {
        const html = renderHistoryPanel([batchHistoryItem]);

        assert.match(html, /展开批次/);
        assert.match(html, /3 张图/);
        assert.match(html, /aria-expanded="false"/);
        assert.match(html, /aria-controls="history-batch-/);
        assert.doesNotMatch(html, /batch-thumbnail-strip/);
    });

    it('shows failed recent history reasons without a fake thumbnail', () => {
        const html = renderHistoryPanel([failedHistoryItem]);

        assert.match(html, /生成失败/);
        assert.match(html, /失败原因：/);
        assert.match(html, /上游或 API 中转站异常。请稍后重试。/);
        assert.match(html, /用户真实失败提示词/);
        assert.doesNotMatch(html, /<img/);
        assert.doesNotMatch(html, /新图已入册 0 张/);
        assert.doesNotMatch(html, /结果反馈/);
        assert.doesNotMatch(html, /标记本次结果可用/);
    });

    it('renders inspirations as a mobile horizontal snap album', () => {
        const html = renderHistoryPanel([], [inspirationItem]);

        assert.match(html, /snap-x snap-mandatory/);
        assert.match(html, /w-\[min\(84vw,360px\)\]/);
        assert.match(html, /用户保存的真实灵感提示词/);
        assert.match(html, /aria-label="套用灵感：用户保存的真实灵感提示词"/);
        assert.doesNotMatch(html, /窗边的花与书/);
        assert.doesNotMatch(html, /inspiration-flowers/);
    });

    it('does not render fake inspiration actions without handlers', () => {
        const html = renderHistoryPanel([], [inspirationItem]);

        assert.match(html, /已保存的灵感/);
        assert.match(html, /套用首个模板/);
        assert.match(html, /1 条灵感/);
        assert.doesNotMatch(html, /aria-label="收藏"/);
        assert.doesNotMatch(html, />管理</);
    });

    it('centers a completely empty collection while keeping short desktop panels scrollable', () => {
        const html = renderHistoryPanel([]);

        assert.match(html, /lg:overflow-y-auto/);
        assert.match(html, /xl:flex xl:max-h-none xl:flex-1 xl:flex-col/);
        assert.doesNotMatch(html, /xl:overflow-hidden/);
        assert.match(html, /xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:space-y-0/);
        assert.match(html, /text-center text-sm xl:my-auto/);
        assert.match(html, /items-center justify-between rounded-md px-1 text-sm xl:mt-auto/);
    });

    it('renders a non-fake pending activity timeline before the first generation', () => {
        const html = renderHistoryPanel([], [inspirationItem]);

        assert.match(html, /activity-feed/);
        assert.match(html, /role="status"/);
        assert.match(html, /aria-live="polite"/);
        assert.match(html, /aria-atomic="true"/);
        assert.match(html, /xl:mt-auto xl:flex-none/);
        assert.doesNotMatch(html, /xl:flex xl:h-full xl:min-h-0 xl:flex-col/);
        assert.match(html, /aria-label="待开始生成动态"/);
        assert.match(html, /点击生成后，这里会记录创作过程。/);
        assert.match(html, /准备/);
        assert.match(html, /预览/);
        assert.match(html, /保存/);
        assert.match(html, /失败/);
        assert.match(html, /等待请求开始/);
        assert.match(html, /等待流式预览/);
        assert.match(html, /等待保存结果/);
        assert.match(html, /失败时显示原因/);
        assert.match(html, /text-\[11px\] leading-4 break-words/);
        assert.doesNotMatch(html, /block truncate text-\[11px\] leading-4/);
        assert.doesNotMatch(html, /新图已入册/);
    });

    it('renders live generation activity before completed history', () => {
        const html = renderHistoryPanel(
            [historyItem],
            [inspirationItem],
            [
                {
                    id: 'generating',
                    label: '正在生成',
                    detail: '正在把当前创作单送去生成，完成后会进入最近生成。',
                    tone: 'progress'
                }
            ]
        );

        assert.match(html, /正在生成/);
        assert.match(html, /正在把当前创作单送去生成/);
        assert.match(html, /text-\[11px\] break-words mt-0 leading-4/);
        assert.match(html, /role="status"/);
        assert.match(html, /aria-live="polite"/);
        assert.match(html, /aria-atomic="true"/);
        assert.match(html, /xl:flex-1 xl:shrink/);
        assert.match(html, /xl:flex xl:h-full xl:min-h-0 xl:flex-col/);
        assert.match(html, /xl:max-h-none/);
        assert.match(html, /xl:min-h-0/);
        assert.match(html, /xl:flex-1/);
        assert.match(html, /新图已入册/);
    });

    it('announces saved completion after retained streaming preview activity', () => {
        const html = renderHistoryPanel(
            [historyItem],
            [inspirationItem],
            [
                {
                    id: 'streaming-preview',
                    label: '流式预览已更新',
                    detail: '已收到 1 张过程预览。',
                    tone: 'progress'
                },
                {
                    id: 'saved',
                    label: '图片保存完成',
                    detail: '本次结果共 1 张，已可继续编辑或下载。',
                    tone: 'success'
                }
            ]
        );
        const liveStatus = html.match(/<p role="status"[^>]*>(.*?)<\/p>/)?.[1];

        assert.equal(liveStatus, '图片保存完成 本次结果共 1 张，已可继续编辑或下载。');
    });

    it('announces changing batch progress instead of the initial generating activity', () => {
        const html = renderHistoryPanel(
            [historyItem],
            [inspirationItem],
            [
                {
                    id: 'generating',
                    label: '正在生成',
                    detail: '正在把当前创作单送去生成。',
                    tone: 'progress'
                },
                {
                    id: 'batch-progress',
                    label: '批量进度',
                    detail: '已完成 2/3 条任务。',
                    tone: 'progress'
                }
            ]
        );
        const liveStatus = html.match(/<p role="status"[^>]*>(.*?)<\/p>/)?.[1];

        assert.equal(liveStatus, '批量进度 已完成 2/3 条任务。');
    });

    it('announces a partial batch failure ahead of a saved partial result', () => {
        const html = renderHistoryPanel(
            [historyItem],
            [inspirationItem],
            [
                {
                    id: 'batch-progress',
                    label: '批量进度',
                    detail: '已完成 3/3 条任务，失败 1 条。',
                    tone: 'warning'
                },
                {
                    id: 'failed',
                    label: '生成失败',
                    detail: '一条任务失败，请检查后重试。',
                    tone: 'warning'
                },
                {
                    id: 'saved',
                    label: '图片保存完成',
                    detail: '本次结果共 2 张，已可继续编辑或下载。',
                    tone: 'success'
                }
            ]
        );
        const liveStatus = html.match(/<p role="status"[^>]*>(.*?)<\/p>/)?.[1];

        assert.equal(liveStatus, '生成失败 一条任务失败，请检查后重试。');
    });

    it('keeps generation activity visible outside the inspiration tab content', () => {
        const html = renderHistoryPanel([historyItem], [inspirationItem]);
        const tabContentIndex = html.indexOf('用户保存的真实灵感提示词');
        const activityIndex = html.indexOf('请求、预览、保存和失败会在这里轻量更新。');

        assert.ok(tabContentIndex >= 0);
        assert.ok(activityIndex > tabContentIndex);
        assert.match(html, /最近生成/);
        assert.match(html, /新图已入册/);
        assert.match(html, /text-\[11px\] leading-4 break-words/);
    });

    it('renders batch progress activity as user-facing copy', () => {
        const html = renderHistoryPanel(
            [historyItem],
            [inspirationItem],
            [
                {
                    id: 'batch-progress',
                    label: '批量进度',
                    detail: '已完成 2/3 条任务。',
                    tone: 'progress'
                }
            ]
        );

        assert.match(html, /批量进度/);
        assert.match(html, /已完成 2\/3 条任务。/);
    });
});
