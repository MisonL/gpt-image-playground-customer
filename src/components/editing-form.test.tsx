import { EditingForm, type EditingFormData } from './editing-form';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type RenderOptions = {
    backend: EditingFormData['image_backend'];
    outputFormat?: EditingFormData['output_format'];
    advancedTab?: 'route' | 'output' | 'stream';
};

const noop = () => {};

function renderEditingForm({ backend, outputFormat = 'png', advancedTab = 'route' }: RenderOptions): string {
    return renderToStaticMarkup(
        <I18nProvider>
            <EditingForm
                onSubmit={noop}
                isLoading={false}
                currentMode='edit'
                onModeChange={noop}
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
                initialAdvancedOpen
                initialAdvancedTab={advancedTab}
            />
        </I18nProvider>
    );
}

describe('EditingForm advanced upstream controls', () => {
    it('renders Responses-specific edit controls when the Responses backend is selected', () => {
        const html = renderEditingForm({ backend: 'responses-image-generation' });

        assert.match(html, /图片生成后端/);
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
