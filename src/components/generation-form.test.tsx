import { GenerationForm } from './generation-form';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const noop = () => {};

function renderGenerationForm(
    options: {
        currentMode?: 'generate' | 'edit' | 'batch' | 'reuse';
        defaultAdvancedTab?: 'output' | 'model' | 'stream' | 'route';
        failedBatchPrompts?: string[];
        canPauseBatch?: boolean;
        isBatchPauseRequested?: boolean;
        defaultAdvancedOpen?: boolean;
        omitPauseHandler?: boolean;
    } = {}
) {
    return renderToStaticMarkup(
        <I18nProvider>
            <GenerationForm
                onSubmit={noop}
                onSaveInspiration={noop}
                isLoading={false}
                currentMode={options.currentMode ?? 'generate'}
                onModeChange={noop}
                reuseContext={null}
                onClearReuseContext={noop}
                isPasswordRequiredByBackend={false}
                clientPasswordHash={null}
                onOpenPasswordDialog={noop}
                model='gpt-image-2'
                setModel={noop}
                prompt='午后咖啡馆窗边，一束粉白花'
                setPrompt={noop}
                batchPromptText={'午后咖啡馆窗边\n奶油色卧室一角'}
                setBatchPromptText={noop}
                failedBatchPrompts={options.failedBatchPrompts}
                canPauseBatch={options.canPauseBatch}
                isBatchPauseRequested={options.isBatchPauseRequested}
                onPauseBatch={options.omitPauseHandler ? undefined : noop}
                n={[1]}
                setN={noop}
                size='auto'
                setSize={noop}
                customWidth={1024}
                setCustomWidth={noop}
                customHeight={1024}
                setCustomHeight={noop}
                quality='high'
                setQuality={noop}
                outputFormat='png'
                setOutputFormat={noop}
                compression={[100]}
                setCompression={noop}
                background='auto'
                setBackground={noop}
                moderation='auto'
                setModeration={noop}
                streamMode='auto'
                setStreamMode={noop}
                allowStreamingBatch={false}
                partialImages={1}
                setPartialImages={noop}
                imageBackend='server-default'
                setImageBackend={noop}
                streamingStrategy='server-default'
                setStreamingStrategy={noop}
                responsesModel=''
                setResponsesModel={noop}
                thinking='server-default'
                setThinking={noop}
                promptOptimization='server-default'
                setPromptOptimization={noop}
                forceWeb={false}
                setForceWeb={noop}
                defaultAdvancedOpen={options.defaultAdvancedOpen}
                defaultAdvancedTab={options.defaultAdvancedTab}
            />
        </I18nProvider>
    );
}

describe('GenerationForm advanced groups', () => {
    it('shows task-specific descriptions in the mode segmented control', () => {
        const html = renderGenerationForm();

        for (const label of ['从灵感开始', '带图继续改', '一次多张', '套用旧稿']) {
            assert.match(html, new RegExp(label));
        }
    });

    it('keeps the left-side professional accordion mobile-only', () => {
        const html = renderGenerationForm({ defaultAdvancedTab: 'route' });

        assert.match(html, /<div class="[^"]*lg:hidden[^"]*"><button[^>]*aria-controls="generation-advanced-panel"/);
    });

    it('labels the collapsed mobile advanced drawer as easy mode', () => {
        const html = renderGenerationForm();

        assert.match(html, /省心模式/);
        assert.match(html, /常用参数已放在基础设置里/);
    });

    it('translates the default backend into a user-facing route label near submit', () => {
        const html = renderGenerationForm();

        assert.match(html, /默认线路/);
        assert.match(html, /预计 0\.12 积分/);
    });

    it('labels the expanded mobile advanced drawer as professional mode', () => {
        const html = renderGenerationForm({ defaultAdvancedOpen: true });

        assert.match(html, /专业模式/);
        assert.match(html, /清晰度: 高, 输出格式: PNG, 服务端默认/);
    });

    it('renders route controls in a separate professional tab', () => {
        const html = renderGenerationForm({ defaultAdvancedOpen: true, defaultAdvancedTab: 'route' });

        for (const label of ['输出', '模型', '流式', '路由']) {
            assert.match(html, new RegExp(label));
        }
        assert.match(html, /image-backend-select/);
        assert.match(html, /streaming-strategy-select/);
        assert.doesNotMatch(html, /model-select/);
    });

    it('explains route choices that affect stability and cost', () => {
        const html = renderGenerationForm({ defaultAdvancedOpen: true, defaultAdvancedTab: 'route' });

        assert.match(html, /影响说明/);
        assert.match(html, /服务端默认会沿用当前部署配置/);
        assert.match(html, /自动或服务端默认会优先使用当前推荐的流式策略/);
        assert.match(html, /费用主要由模型、尺寸、数量和预览图数量决定/);
    });

    it('keeps the model selector out of the route group', () => {
        const html = renderGenerationForm({ defaultAdvancedOpen: true, defaultAdvancedTab: 'model' });

        assert.match(html, /model-select/);
        assert.doesNotMatch(html, /image-backend-select/);
    });
});

describe('GenerationForm batch mode', () => {
    it('renders a real batch prompt list only in batch mode', () => {
        const html = renderGenerationForm({ currentMode: 'batch' });

        assert.match(html, /批量提示词列表/);
        assert.match(html, /2 条任务/);
        assert.match(html, /batch-prompt-list/);
        assert.doesNotMatch(html, /id="prompt"/);
    });

    it('shows a low-interruption task summary for batch jobs', () => {
        const html = renderGenerationForm({ currentMode: 'batch' });

        assert.match(html, /batch-task-summary/);
        assert.match(html, /任务摘要/);
        assert.match(html, /每一行会生成一张图/);
        assert.match(html, /失败后处理/);
        assert.match(html, /生成动态/);
        assert.match(html, /不占用中央单张预览/);
    });

    it('shows a reusable failed-task entry for partial batch failures', () => {
        const html = renderGenerationForm({
            currentMode: 'batch',
            failedBatchPrompts: ['奶油色卧室一角']
        });

        assert.match(html, /上次批量有 1 条未完成/);
        assert.match(html, /只保留失败项/);
    });

    it('keeps the batch prompt list out of the default generate mode', () => {
        const html = renderGenerationForm({ failedBatchPrompts: ['奶油色卧室一角'] });

        assert.doesNotMatch(html, /batch-prompt-list/);
        assert.doesNotMatch(html, /batch-task-summary/);
        assert.doesNotMatch(html, /只保留失败项/);
    });

    it('shows a real pause action while a batch is loading', () => {
        const html = renderGenerationForm({
            currentMode: 'batch',
            canPauseBatch: true
        });

        assert.match(html, /暂停批量/);
        assert.match(html, /已开始的任务会完成，未开始的任务会保留为失败项再重试。/);
    });

    it('keeps the pause action renderable when the handler is omitted', () => {
        const html = renderGenerationForm({
            currentMode: 'batch',
            canPauseBatch: true,
            omitPauseHandler: true
        });

        assert.match(html, /暂停批量/);
    });

    it('switches the pause action into requested state after pause is requested', () => {
        const html = renderGenerationForm({
            currentMode: 'batch',
            canPauseBatch: true,
            isBatchPauseRequested: true
        });

        assert.match(html, /暂停中/);
        assert.match(html, /disabled=""/);
    });
});
