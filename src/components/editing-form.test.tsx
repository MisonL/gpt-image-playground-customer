import { EditingForm, type EditingFormData } from './editing-form';
import { I18nProvider } from '@/lib/i18n';
import type { ImageStreamingStrategy } from '@/lib/image-upstream-strategy';
import { IMAGE_UPSTREAM_PROFILES, type ImageUpstreamProfile } from '@/lib/image-upstream-profile';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type RenderOptions = {
    backend: EditingFormData['image_backend'];
    outputFormat?: EditingFormData['output_format'];
    advancedOpen?: boolean;
    advancedTab?: 'output' | 'model' | 'stream' | 'route';
    reuseContext?: React.ComponentProps<typeof EditingForm>['reuseContext'];
    allowStreamingBatch?: boolean;
    enableParallelBatch?: boolean;
    editN?: number[];
    streamingStrategy?: EditingFormData['streaming_strategy'];
    defaultStreamingStrategy?: ImageStreamingStrategy;
    allowResponsesImageBackend?: boolean;
    hasDefaultResponsesModel?: boolean;
    editResponsesModel?: string;
    editPrompt?: string;
    imageFiles?: File[];
    upstreamProfile?: ImageUpstreamProfile;
    upstreamProfileMixed?: boolean;
};

const noop = () => {};

function renderEditingForm({
    backend,
    outputFormat = 'png',
    advancedOpen = true,
    advancedTab = 'route',
    reuseContext = null,
    allowStreamingBatch = false,
    enableParallelBatch = false,
    editN = [1],
    streamingStrategy = 'server-default',
    defaultStreamingStrategy = 'auto',
    allowResponsesImageBackend = true,
    hasDefaultResponsesModel = true,
    editResponsesModel = '',
    editPrompt = '',
    imageFiles = [],
    upstreamProfile = IMAGE_UPSTREAM_PROFILES['openai-compatible'],
    upstreamProfileMixed = false
}: RenderOptions): string {
    return renderToStaticMarkup(
        <I18nProvider>
            <EditingForm
                onSubmit={noop}
                isLoading={false}
                currentMode='edit'
                onModeChange={noop}
                reuseContext={reuseContext}
                onClearReuseContext={noop}
                isPasswordRequiredByBackend={false}
                clientPasswordHash={null}
                onOpenPasswordDialog={noop}
                editModel='gpt-image-2'
                setEditModel={noop}
                imageFiles={imageFiles}
                sourceImagePreviewUrls={[]}
                setImageFiles={noop}
                setSourceImagePreviewUrls={noop}
                maxImages={upstreamProfile.upload.maxImages}
                editPrompt={editPrompt}
                setEditPrompt={noop}
                editN={editN}
                setEditN={noop}
                editSize='auto'
                setEditSize={noop}
                editCustomWidth={1024}
                setEditCustomWidth={noop}
                editCustomHeight={1024}
                setEditCustomHeight={noop}
                editQuality='auto'
                setEditQuality={noop}
                editOutputFormat={outputFormat}
                setEditOutputFormat={noop}
                editCompression={[85]}
                setEditCompression={noop}
                upstreamProfile={upstreamProfile}
                upstreamProfileMixed={upstreamProfileMixed}
                editModeration='auto'
                setEditModeration={noop}
                editBrushSize={[20]}
                setEditBrushSize={noop}
                editShowMaskEditor={false}
                setEditShowMaskEditor={noop}
                editGeneratedMaskFile={null}
                setEditGeneratedMaskFile={noop}
                editIsMaskSaved={false}
                setEditIsMaskSaved={noop}
                editOriginalImageSize={null}
                setEditOriginalImageSize={noop}
                editDrawnPoints={[]}
                setEditDrawnPoints={noop}
                editMaskPreviewUrl={null}
                setEditMaskPreviewUrl={noop}
                streamMode='auto'
                setStreamMode={noop}
                allowStreamingBatch={allowStreamingBatch}
                enableParallelBatch={enableParallelBatch}
                setEnableParallelBatch={noop}
                partialImages={1}
                setPartialImages={noop}
                allowResponsesImageBackend={allowResponsesImageBackend}
                hasDefaultResponsesModel={hasDefaultResponsesModel}
                editImageBackend={backend}
                setEditImageBackend={noop}
                editStreamingStrategy={streamingStrategy}
                defaultStreamingStrategy={defaultStreamingStrategy}
                setEditStreamingStrategy={noop}
                editResponsesModel={editResponsesModel}
                setEditResponsesModel={noop}
                editThinking='server-default'
                setEditThinking={noop}
                editPromptOptimization='server-default'
                setEditPromptOptimization={noop}
                editForceWeb={false}
                setEditForceWeb={noop}
                estimatedCostLabel='预计 0.12 积分'
                initialAdvancedOpen={advancedOpen}
                initialAdvancedTab={advancedTab}
            />
        </I18nProvider>
    );
}

describe('EditingForm advanced upstream controls', () => {
    it('keeps the full professional accordion available on desktop and mobile', () => {
        const html = renderEditingForm({ backend: 'server-default', advancedTab: 'route' });

        assert.match(
            html,
            /<div class="border-border bg-muted\/20 rounded-md border"><button[^>]*aria-controls="editing-advanced-panel"/
        );
        assert.doesNotMatch(
            html,
            /<div class="[^"]*lg:hidden[^"]*"><button[^>]*aria-controls="editing-advanced-panel"/
        );
    });

    it('keeps model and streaming controls out of the default edit form surface', () => {
        const html = renderEditingForm({ backend: 'server-default', advancedOpen: false });

        assert.match(html, /参考图/);
        assert.match(html, /修改想法/);
        assert.match(html, /专业模式/);
        assert.doesNotMatch(html, /edit-model-select/);
        assert.doesNotMatch(html, /edit-stream-mode-select/);
    });

    it('translates the default backend into a user-facing route label near submit', () => {
        const html = renderEditingForm({ backend: 'server-default', advancedOpen: false });

        assert.match(html, /默认线路/);
        assert.match(html, /预计 0\.12 积分/);
    });

    it('renders edit model controls only in the professional model tab', () => {
        const html = renderEditingForm({ backend: 'server-default', advancedTab: 'model' });

        assert.match(html, /edit-model-select/);
        assert.match(html, /gpt-image-2 始终以高保真方式处理参考图/);
        assert.doesNotMatch(html, /edit-image-backend-select/);
    });

    it('renders edit stream controls only in the professional stream tab', () => {
        const html = renderEditingForm({ backend: 'server-default', advancedTab: 'stream' });

        assert.match(html, /edit-stream-mode-select/);
        assert.match(html, /edit-partial-1/);
        assert.doesNotMatch(html, /edit-model-select/);
    });

    it('hides Matsca-only edit stream controls for the default OpenAI-compatible profile', () => {
        const html = renderEditingForm({ backend: 'server-default', advancedTab: 'stream' });

        assert.doesNotMatch(html, /edit-partial-0/);
        assert.match(html, /edit-partial-1/);
        assert.match(html, /edit-partial-3/);
        assert.doesNotMatch(html, /edit-partial-4/);
    });

    it('renders Matsca edit stream controls when the active upstream profile allows them', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'stream',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        });

        assert.match(html, /edit-partial-0/);
        assert.match(html, /edit-partial-4/);
    });

    it('intersects Matsca edit partial image options with the Responses backend contract', () => {
        const html = renderEditingForm({
            backend: 'responses-image-generation',
            advancedTab: 'stream',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        });

        assert.doesNotMatch(html, /edit-partial-0/);
        assert.match(html, /edit-partial-1/);
        assert.match(html, /edit-partial-3/);
        assert.doesNotMatch(html, /edit-partial-4/);
    });

    it('uses Matsca edit upload limits when the active upstream profile requires them', () => {
        const imageFiles = Array.from(
            { length: 9 },
            (_, index) => new File(['x'], `source-${index}.png`, { type: 'image/png' })
        );
        const html = renderEditingForm({
            backend: 'server-default',
            advancedOpen: false,
            editPrompt: '用户真实编辑要求',
            imageFiles,
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        });

        assert.match(html, /最多 8 张/);
        assert.match(html, /9 \/ 8 张/);
        assert.match(html, /最多只能选择 8 张图片。/);
        assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*编辑图像[\s\S]*<\/button>/);
    });

    it('renders profile-aware high resolution edit size presets', () => {
        const openAiHtml = renderEditingForm({ backend: 'server-default' });
        const matscaHtml = renderEditingForm({
            backend: 'server-default',
            upstreamProfile: IMAGE_UPSTREAM_PROFILES.matsca
        });

        assert.match(openAiHtml, /id="edit-size-wide-4k"/);
        assert.doesNotMatch(openAiHtml, /id="edit-size-square-4k"/);
        assert.match(matscaHtml, /id="edit-size-square-4k"/);
    });

    it('renders an explicit parallel batch toggle in edit stream settings', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true,
            editN: [2]
        });

        assert.match(html, /并发批量/);
        assert.match(html, /多张图或多条提示词会按当前渠道容量并发执行/);
        assert.match(html, /id="edit-parallel-batch-enabled"/);
        assert.match(html, /aria-checked="true"/);
    });

    it('keeps edit parallel batch disabled for a single output image', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true
        });

        assert.match(html, /选择至少 2 张图片或 2 条提示词后可启用并发/);
        assert.match(html, /id="edit-parallel-batch-enabled"/);
        assert.match(html, /aria-checked="false"/);
        assert.match(html, /disabled=""/);
    });

    it('keeps edit parallel batch disabled when streaming strategy is off', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true,
            editN: [2],
            streamingStrategy: 'off'
        });

        assert.match(html, /并发批量需要流式模式；非流式会保持顺序执行。/);
        assert.match(html, /id="edit-parallel-batch-enabled"/);
        assert.match(html, /aria-checked="false"/);
        assert.match(html, /disabled=""/);
    });

    it('keeps edit parallel batch disabled when the server default streaming strategy is off', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'stream',
            allowStreamingBatch: true,
            enableParallelBatch: true,
            editN: [2],
            defaultStreamingStrategy: 'off'
        });

        assert.match(html, /并发批量需要流式模式；非流式会保持顺序执行。/);
        assert.match(html, /id="edit-parallel-batch-enabled"/);
        assert.match(html, /aria-checked="false"/);
        assert.match(html, /disabled=""/);
    });

    it('disables the edit stream mode selector when the server default streaming strategy is off', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'stream',
            defaultStreamingStrategy: 'off'
        });

        assert.match(html, /<button[^>]*(?:disabled=""[^>]*id="edit-stream-mode-select"|id="edit-stream-mode-select"[^>]*disabled="")/);
    });

    it('renders Responses-specific edit controls when the Responses backend is selected', () => {
        const html = renderEditingForm({ backend: 'responses-image-generation', upstreamProfileMixed: true });

        assert.match(html, /图片生成后端/);
        assert.match(html, /影响说明/);
        assert.match(html, /Responses image_generation 需要实验开关和顶层模型/);
        assert.match(html, /当前服务端渠道包含不同上游模式/);
        assert.match(html, /自动或服务端默认会优先使用当前推荐的流式策略/);
        assert.match(html, /GPT 顶层模型/);
        assert.match(html, /思考强度/);
        assert.match(html, /提示词优化/);
        assert.doesNotMatch(html, /优先 Web 账号/);
    });

    it('explains the resolved edit server default streaming strategy', () => {
        const offHtml = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'route',
            streamingStrategy: 'server-default',
            defaultStreamingStrategy: 'off'
        });
        const forceHtml = renderEditingForm({
            backend: 'server-default',
            advancedTab: 'route',
            streamingStrategy: 'server-default',
            defaultStreamingStrategy: 'force-sse'
        });

        assert.match(offHtml, /关闭流式会减少长连接不稳定因素/);
        assert.doesNotMatch(offHtml, /自动或服务端默认会优先使用当前推荐的流式策略/);
        assert.match(forceHtml, /强制 SSE 会跳过自动判断/);
        assert.doesNotMatch(forceHtml, /自动或服务端默认会优先使用当前推荐的流式策略/);
    });

    it('disables the experimental Responses backend when runtime capabilities do not allow it', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            allowResponsesImageBackend: false
        });

        assert.match(html, /当前运行时未启用 Responses image_generation/);
        assert.doesNotMatch(html, /GPT 顶层模型/);
    });

    it('blocks Responses edits until a top-level model is available', () => {
        const html = renderEditingForm({
            backend: 'responses-image-generation',
            hasDefaultResponsesModel: false,
            editResponsesModel: '',
            editPrompt: '用户真实编辑要求',
            imageFiles: [new File(['x'], 'source.png', { type: 'image/png' })]
        });

        assert.match(html, /Responses image_generation 需要填写 GPT 顶层模型/);
        assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*编辑图像[\s\S]*<\/button>/);
    });

    it('renders Images API edit controls and compression when JPEG output is selected', () => {
        const html = renderEditingForm({ backend: 'images-api', outputFormat: 'jpeg', advancedTab: 'output' });

        assert.match(html, /Images API/);
        assert.match(html, /输出格式/);
        assert.match(html, /压缩：85%/);
        assert.match(html, /内容审核级别/);
        assert.doesNotMatch(html, /GPT 顶层模型/);
    });
});

describe('EditingForm reused history context', () => {
    it('shows which history values were carried into edit mode', () => {
        const html = renderEditingForm({
            backend: 'server-default',
            reuseContext: {
                sourceLabel: '最近生成：2026/6/2 12:00:00',
                restoredFields: ['参考图', '提示词', '模型', '尺寸', '数量'],
                promptPreview: '用户真实编辑提示词'
            }
        });

        assert.match(html, /已带入内容/);
        assert.match(html, /最近生成：2026\/6\/2 12:00:00/);
        assert.match(html, /参考图/);
        assert.match(html, /提示词/);
        assert.match(html, /模型/);
        assert.match(html, /尺寸/);
        assert.match(html, /数量/);
        assert.match(html, /用户真实编辑提示词/);
        assert.match(html, /这些内容已经写入编辑单，可以修改后再生成。/);
    });
});
