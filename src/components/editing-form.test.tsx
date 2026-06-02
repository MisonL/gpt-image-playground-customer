import { EditingForm, type EditingFormData } from './editing-form';
import { I18nProvider } from '@/lib/i18n';
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
};

const noop = () => {};

function renderEditingForm({
    backend,
    outputFormat = 'png',
    advancedOpen = true,
    advancedTab = 'route',
    reuseContext = null
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
                imageFiles={[]}
                sourceImagePreviewUrls={[]}
                setImageFiles={noop}
                setSourceImagePreviewUrls={noop}
                maxImages={10}
                editPrompt=''
                setEditPrompt={noop}
                editN={[1]}
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
                allowStreamingBatch={false}
                partialImages={1}
                setPartialImages={noop}
                editImageBackend={backend}
                setEditImageBackend={noop}
                editStreamingStrategy='server-default'
                setEditStreamingStrategy={noop}
                editResponsesModel=''
                setEditResponsesModel={noop}
                editThinking='server-default'
                setEditThinking={noop}
                editPromptOptimization='server-default'
                setEditPromptOptimization={noop}
                editForceWeb={false}
                setEditForceWeb={noop}
                initialAdvancedOpen={advancedOpen}
                initialAdvancedTab={advancedTab}
            />
        </I18nProvider>
    );
}

describe('EditingForm advanced upstream controls', () => {
    it('keeps the left-side professional accordion mobile-only', () => {
        const html = renderEditingForm({ backend: 'server-default', advancedTab: 'route' });

        assert.match(
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

    it('renders Responses-specific edit controls when the Responses backend is selected', () => {
        const html = renderEditingForm({ backend: 'responses-image-generation' });

        assert.match(html, /图片生成后端/);
        assert.match(html, /影响说明/);
        assert.match(html, /Responses image_generation 需要实验开关和顶层模型/);
        assert.match(html, /自动或服务端默认会优先使用当前推荐的流式策略/);
        assert.match(html, /GPT 顶层模型/);
        assert.match(html, /思考强度/);
        assert.match(html, /提示词优化/);
        assert.doesNotMatch(html, /优先 Web 账号/);
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
                promptPreview: '午后咖啡馆窗边，一束粉白花'
            }
        });

        assert.match(html, /已带入内容/);
        assert.match(html, /最近生成：2026\/6\/2 12:00:00/);
        assert.match(html, /参考图/);
        assert.match(html, /提示词/);
        assert.match(html, /模型/);
        assert.match(html, /尺寸/);
        assert.match(html, /数量/);
        assert.match(html, /午后咖啡馆窗边，一束粉白花/);
        assert.match(html, /这些内容已经写入编辑单，可以修改后再生成。/);
    });
});
