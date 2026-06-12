import { GenerationForm, resolveGenerationFooterPromptTarget } from './generation-form';
import { I18nProvider } from '@/lib/i18n';
import type { ImageStreamingStrategy } from '@/lib/image-upstream-strategy';
import { IMAGE_UPSTREAM_PROFILES, type ImageUpstreamProfile } from '@/lib/image-upstream-profile';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const noop = () => {};

function readButtonById(html: string, id: string): string {
    const match = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    assert.ok(match, `missing button ${id}`);
    return match[0];
}

function renderGenerationForm(
    options: {
        currentMode?: 'generate' | 'edit' | 'batch' | 'reuse';
        defaultAdvancedTab?: 'output' | 'model' | 'stream' | 'route';
        failedBatchPrompts?: string[];
        canPauseBatch?: boolean;
        isBatchPauseRequested?: boolean;
        defaultAdvancedOpen?: boolean;
        omitPauseHandler?: boolean;
        allowStreamingBatch?: boolean;
        enableParallelBatch?: boolean;
        streamingStrategy?: React.ComponentProps<typeof GenerationForm>['streamingStrategy'];
        defaultStreamingStrategy?: ImageStreamingStrategy;
        prompt?: string;
        batchPromptText?: string;
        canApplyRandomInspiration?: boolean;
        allowResponsesImageBackend?: boolean;
        hasDefaultResponsesModel?: boolean;
        responsesModel?: string;
        imageBackend?: React.ComponentProps<typeof GenerationForm>['imageBackend'];
        upstreamProfile?: ImageUpstreamProfile;
        upstreamProfileMixed?: boolean;
    } = {}
) {
    return renderToStaticMarkup(
        <I18nProvider>
            <GenerationForm
                onSubmit={noop}
                onSaveInspiration={noop}
                canApplyRandomInspiration={options.canApplyRandomInspiration ?? true}
                onPickRandomInspiration={() => '用户保存的真实提示词'}
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
                prompt={options.prompt ?? '用户真实提示词 A'}
                setPrompt={noop}
                batchPromptText={options.batchPromptText ?? '用户真实提示词 A\n用户真实提示词 B'}
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
                upstreamProfile={options.upstreamProfile ?? IMAGE_UPSTREAM_PROFILES['openai-compatible']}
                upstreamProfileMixed={options.upstreamProfileMixed ?? false}
                moderation='auto'
                setModeration={noop}
                streamMode='auto'
                setStreamMode={noop}
                allowStreamingBatch={options.allowStreamingBatch ?? false}
                enableParallelBatch={options.enableParallelBatch ?? false}
                setEnableParallelBatch={noop}
                partialImages={1}
                setPartialImages={noop}
                allowResponsesImageBackend={options.allowResponsesImageBackend ?? true}
                hasDefaultResponsesModel={options.hasDefaultResponsesModel ?? true}
                imageBackend={options.imageBackend ?? 'server-default'}
                setImageBackend={noop}
                streamingStrategy={options.streamingStrategy ?? 'server-default'}
                defaultStreamingStrategy={options.defaultStreamingStrategy ?? 'auto'}
                setStreamingStrategy={noop}
                responsesModel={options.responsesModel ?? ''}
                setResponsesModel={noop}
                thinking='server-default'
                setThinking={noop}
                promptOptimization='server-default'
                setPromptOptimization={noop}
                forceWeb={false}
                setForceWeb={noop}
                estimatedCostLabel='预计 0.12 积分'
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

    it('keeps the full professional accordion available on desktop and mobile', () => {
        const html = renderGenerationForm({ defaultAdvancedTab: 'route' });

        assert.match(
            html,
            /<div class="border-border bg-muted\/20 rounded-md border"><button[^>]*aria-controls="generation-advanced-panel"/
        );
        assert.doesNotMatch(
            html,
            /<div class="[^"]*lg:hidden[^"]*"><button[^>]*aria-controls="generation-advanced-panel"/
        );
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
        const html = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'route',
            upstreamProfileMixed: true
        });

        assert.match(html, /影响说明/);
        assert.match(html, /服务端默认会沿用当前部署配置/);
        assert.match(html, /当前服务端渠道包含不同上游模式/);
        assert.match(html, /自动或服务端默认会优先使用当前推荐的流式策略/);
        assert.match(html, /费用主要由模型、尺寸、数量和预览图数量决定/);
    });

    it('explains the resolved server default streaming strategy', () => {
        const offHtml = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'route',
            streamingStrategy: 'server-default',
            defaultStreamingStrategy: 'off'
        });
        const forceHtml = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'route',
            streamingStrategy: 'server-default',
            defaultStreamingStrategy: 'force-sse'
        });

        assert.match(offHtml, /关闭流式会减少长连接不稳定因素/);
        assert.doesNotMatch(offHtml, /自动或服务端默认会优先使用当前推荐的流式策略/);
        assert.match(forceHtml, /强制 SSE 会跳过自动判断/);
        assert.doesNotMatch(forceHtml, /自动或服务端默认会优先使用当前推荐的流式策略/);
    });

    it('disables the experimental Responses backend when runtime capabilities do not allow it', () => {
        const html = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'route',
            allowResponsesImageBackend: false
        });

        assert.match(html, /当前运行时未启用 Responses image_generation/);
        assert.doesNotMatch(html, /GPT 顶层模型/);
    });

    it('blocks Responses generation until a top-level model is available', () => {
        const html = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'route',
            imageBackend: 'responses-image-generation',
            hasDefaultResponsesModel: false,
            responsesModel: ''
        });

        assert.match(html, /Responses image_generation 需要填写 GPT 顶层模型/);
        assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*生成图像[\s\S]*<\/button>/);
    });

    it('allows Responses generation when the runtime has a default top-level model', () => {
        const html = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'route',
            imageBackend: 'responses-image-generation',
            hasDefaultResponsesModel: true,
            responsesModel: ''
        });

        assert.match(html, /GPT 顶层模型/);
        assert.doesNotMatch(html, /Responses image_generation 需要填写 GPT 顶层模型/);
    });

    it('keeps the model selector out of the route group', () => {
        const html = renderGenerationForm({ defaultAdvancedOpen: true, defaultAdvancedTab: 'model' });

        assert.match(html, /model-select/);
        assert.doesNotMatch(html, /image-backend-select/);
    });

    it('keeps OpenAI-compatible generation controls within its upstream profile', () => {
        const streamHtml = renderGenerationForm({ defaultAdvancedOpen: true, defaultAdvancedTab: 'stream' });
        const outputHtml = renderGenerationForm({ defaultAdvancedOpen: true, defaultAdvancedTab: 'output' });

        assert.doesNotMatch(streamHtml, /partial-0/);
        assert.match(streamHtml, /partial-1/);
        assert.match(streamHtml, /partial-3/);
        assert.doesNotMatch(streamHtml, /partial-4/);
        assert.match(outputHtml, /n-3/);
        assert.match(outputHtml, /n-10/);
        assert.match(outputHtml, /n-8/);
        assert.match(readButtonById(outputHtml, 'bg-transparent'), /disabled=""/);
    });

    it('renders Matsca generation controls when the active upstream profile allows them', () => {
        const streamHtml = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'stream',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        });
        const outputHtml = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'output',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        });

        assert.match(streamHtml, /partial-0/);
        assert.match(streamHtml, /partial-4/);
        assert.match(outputHtml, /n-3/);
        assert.doesNotMatch(outputHtml, /n-8/);
        assert.doesNotMatch(readButtonById(outputHtml, 'bg-transparent'), /disabled=""/);
    });

    it('intersects Matsca partial image options with the Responses backend contract', () => {
        const html = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'stream',
            imageBackend: 'responses-image-generation',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        });

        assert.doesNotMatch(html, /partial-0/);
        assert.match(html, /partial-1/);
        assert.match(html, /partial-3/);
        assert.doesNotMatch(html, /partial-4/);
    });

    it('renders profile-aware high resolution size presets', () => {
        const openAiHtml = renderGenerationForm();
        const matscaHtml = renderGenerationForm({ upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca });

        assert.match(openAiHtml, /id="size-wide-4k"/);
        assert.doesNotMatch(openAiHtml, /id="size-square-4k"/);
        assert.match(matscaHtml, /id="size-square-4k"/);
    });

    it('disables random inspiration when no saved prompt is available', () => {
        const html = renderGenerationForm({ canApplyRandomInspiration: false });

        assert.match(html, /随便来点/);
        assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*随便来点[\s\S]*<\/button>/);
        assert.doesNotMatch(html, /夏日窗边的奶油色房间/);
    });

    it('does not render built-in prompt style chips before the user enters real content', () => {
        const html = renderGenerationForm();

        assert.doesNotMatch(html, /风格偏好/);
        assert.doesNotMatch(html, /胶片感/);
        assert.doesNotMatch(html, /奶油色/);
        assert.doesNotMatch(html, /夏日窗边/);
    });
});

describe('GenerationForm batch mode', () => {
    it('uses the visible batch prompt text for footer prompt actions', () => {
        assert.deepEqual(
            resolveGenerationFooterPromptTarget({
                currentMode: 'batch',
                prompt: 'hidden single prompt',
                batchPromptText: 'first batch prompt\nsecond batch prompt'
            }),
            {
                value: 'first batch prompt\nsecond batch prompt',
                isEmpty: false
            }
        );
        assert.deepEqual(
            resolveGenerationFooterPromptTarget({
                currentMode: 'generate',
                prompt: 'visible single prompt',
                batchPromptText: 'hidden batch prompt'
            }),
            {
                value: 'visible single prompt',
                isEmpty: false
            }
        );
    });

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
            failedBatchPrompts: ['用户真实提示词 B']
        });

        assert.match(html, /上次批量有 1 条未完成/);
        assert.match(html, /只保留失败项/);
    });

    it('keeps the batch prompt list out of the default generate mode', () => {
        const html = renderGenerationForm({ failedBatchPrompts: ['用户真实提示词 B'] });

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

    it('renders an explicit parallel batch toggle in stream settings', () => {
        const html = renderGenerationForm({
            currentMode: 'batch',
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true
        });

        assert.match(html, /并发批量/);
        assert.match(html, /多张图或多条提示词会按当前渠道容量并发执行/);
        assert.match(html, /id="parallel-batch-enabled"/);
        assert.match(html, /aria-checked="true"/);
    });

    it('keeps the parallel batch toggle disabled for a single image request', () => {
        const html = renderGenerationForm({
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true
        });

        assert.match(html, /选择至少 2 张图片或 2 条提示词后可启用并发/);
        assert.match(html, /id="parallel-batch-enabled"/);
        assert.match(html, /aria-checked="false"/);
        assert.match(html, /disabled=""/);
    });

    it('keeps the parallel batch toggle disabled when streaming strategy is off', () => {
        const html = renderGenerationForm({
            currentMode: 'batch',
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true,
            streamingStrategy: 'off'
        });

        assert.match(html, /并发批量需要流式模式；非流式会保持顺序执行。/);
        assert.match(html, /id="parallel-batch-enabled"/);
        assert.match(html, /aria-checked="false"/);
        assert.match(html, /disabled=""/);
    });

    it('keeps the parallel batch toggle disabled when the server default streaming strategy is off', () => {
        const html = renderGenerationForm({
            currentMode: 'batch',
            defaultAdvancedOpen: true,
            defaultAdvancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true,
            defaultStreamingStrategy: 'off'
        });

        assert.match(html, /并发批量需要流式模式；非流式会保持顺序执行。/);
        assert.match(html, /id="parallel-batch-enabled"/);
        assert.match(html, /aria-checked="false"/);
        assert.match(html, /disabled=""/);
    });
});
