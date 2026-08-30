import { WorkbenchProDock } from './workbench-pro-dock';
import { resolveWorkbenchModelOptions } from './workbench-pro-dock-panels';
import { I18nProvider } from '@/lib/i18n';
import { isImageUpstreamStreamingStrategySelectable } from '@/lib/image-upstream-form';
import { DEFAULT_MODEL_OPTIONS } from '@/lib/model-directory-options';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const setOutputFormat: React.Dispatch<React.SetStateAction<'png' | 'jpeg' | 'webp'>> = () => {};
const setQuality: React.Dispatch<React.SetStateAction<'low' | 'medium' | 'high' | 'auto'>> = () => {};
const setModel: React.Dispatch<React.SetStateAction<string>> = () => {};
const setStreamMode: React.Dispatch<React.SetStateAction<'auto' | 'stream' | 'non_stream'>> = () => {};
const setEnableParallelBatch: React.Dispatch<React.SetStateAction<boolean>> = () => {};
const setImageBackend: React.Dispatch<
    React.SetStateAction<'server-default' | 'images-api' | 'responses-image-generation'>
> = () => {};
const setStreamingStrategy: React.Dispatch<
    React.SetStateAction<
        'server-default' | 'auto' | 'off' | 'openai-sse' | 'newapi-keepalive-sse' | 'responses-sse' | 'force-sse'
    >
> = () => {};
const setResponsesModel: React.Dispatch<React.SetStateAction<string>> = () => {};

function assertProParallelBatchCheckboxDisabled(html: string) {
    assert.match(
        html,
        /<button[^>]*(?:disabled=""[^>]*id="pro-parallel-batch-enabled"|id="pro-parallel-batch-enabled"[^>]*disabled="")/
    );
}

describe('WorkbenchProDock', () => {
    it('uses the shared upstream compatibility rule for professional route strategies', () => {
        assert.equal(
            isImageUpstreamStreamingStrategySelectable({
                imageBackend: 'responses-image-generation',
                streamingStrategy: 'openai-sse',
                allowResponsesImageBackend: true
            }),
            false
        );
        assert.equal(
            isImageUpstreamStreamingStrategySelectable({
                imageBackend: 'server-default',
                streamingStrategy: 'responses-sse',
                allowResponsesImageBackend: true
            }),
            false
        );
    });

    it('defaults to easy mode and keeps professional controls collapsed', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={false}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={1}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                />
            </I18nProvider>
        );

        assert.match(html, /省心模式/);
        assert.match(html, /专业模式/);
        assert.match(html, /workbench-panel/);
        assert.match(html, /mt-4/);
        assert.match(html, /rounded-lg/);
        assert.match(html, /xl:max-h-80/);
        assert.match(html, /xl:overflow-y-auto/);
        assert.match(html, /aria-pressed="true"[^>]*>省心模式/);
        assert.match(html, /输出格式/);
        assert.match(html, /gpt-image-2/);
        assert.match(html, /分辨率[\s\S]*?>自动</);
        assert.doesNotMatch(html, /1024 px/);
        assert.doesNotMatch(html, /pro-output-format-select/);
        assert.doesNotMatch(html, /水印/);
        assert.doesNotMatch(html, /EXIF/);
    });

    it('shows the actual custom resolution in the workbench summary', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='custom'
                    customWidth={1536}
                    customHeight={1024}
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={false}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={1}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                />
            </I18nProvider>
        );

        assert.match(html, /分辨率[\s\S]*?>1536x1024</);
        assert.doesNotMatch(html, /分辨率[\s\S]*?>自定义</);
    });

    it('renders interactive professional groups without fake output switches', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={false}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={1}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                />
            </I18nProvider>
        );

        for (const label of ['输出', '模型', '流式', '路由', '输出格式', '清晰度', '色彩空间', '分辨率']) {
            assert.match(html, new RegExp(label));
        }
        assert.match(html, /aria-pressed="true"[^>]*>专业模式/);
        assert.match(html, /pro-output-format-select/);
        assert.match(html, /pro-quality-select/);
        assert.doesNotMatch(html, /水印/);
        assert.doesNotMatch(html, /EXIF/);
    });

    it('renders route controls as real professional selectors', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={false}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={1}
                    allowResponsesImageBackend
                    upstreamProfileMixed
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='route'
                />
            </I18nProvider>
        );

        assert.match(html, /pro-image-backend-select/);
        assert.match(html, /pro-streaming-strategy-select/);
        assert.match(html, /图片生成后端/);
        assert.match(html, /流式兼容模式/);
        assert.match(html, /影响说明/);
        assert.match(html, /服务端默认会沿用当前部署配置/);
        assert.match(html, /当前服务端渠道包含不同上游模式/);
        assert.match(html, /费用主要由模型、尺寸、数量和预览图数量决定/);
    });

    it('explains the resolved desktop server default streaming strategy', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={false}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={1}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='off'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='route'
                />
            </I18nProvider>
        );

        assert.match(html, /关闭流式会减少长连接不稳定因素/);
        assert.doesNotMatch(html, /当前自动策略会由服务端按渠道选择传输方式/);
    });

    it('disables the experimental Responses backend when runtime capabilities do not allow it', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={false}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={1}
                    allowResponsesImageBackend={false}
                    hasDefaultResponsesModel={false}
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='route'
                />
            </I18nProvider>
        );

        assert.match(html, /当前运行时或默认服务器渠道未开放 Responses image_generation/);
        assert.doesNotMatch(html, /GPT 顶层模型/);
    });

    it('renders a desktop parallel batch switch in stream settings', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={true}
                    enableParallelBatch={true}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={2}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='stream'
                />
            </I18nProvider>
        );

        assert.match(html, /pro-parallel-batch-enabled/);
        assert.match(html, /并发批量/);
        assert.match(html, /多张图或多条提示词会按当前服务端配置的并发上限尝试执行/);
        assert.match(html, /aria-checked="true"/);
    });

    it('keeps enabled parallel batch visible in easy mode summary', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={true}
                    enableParallelBatch={true}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={2}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                />
            </I18nProvider>
        );

        assert.match(html, /自动 \/ 并发已启用/);
    });

    it('keeps the desktop parallel batch switch disabled when streaming strategy is off', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={true}
                    enableParallelBatch={true}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={2}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='off'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='stream'
                />
            </I18nProvider>
        );

        assert.match(html, /pro-parallel-batch-enabled/);
        assert.match(html, /并发批量需要流式模式；非流式会保持顺序执行。/);
        assert.match(html, /aria-checked="false"/);
        assertProParallelBatchCheckboxDisabled(html);
    });

    it('keeps the desktop parallel batch switch disabled when the server default streaming strategy is off', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={true}
                    enableParallelBatch={true}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={2}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='off'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='stream'
                />
            </I18nProvider>
        );

        assert.match(html, /pro-parallel-batch-enabled/);
        assert.match(html, /并发批量需要流式模式；非流式会保持顺序执行。/);
        assert.match(html, /aria-checked="false"/);
        assertProParallelBatchCheckboxDisabled(html);
    });

    it('disables the desktop stream mode selector when the server default streaming strategy is off', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={true}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={2}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='off'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='stream'
                />
            </I18nProvider>
        );

        assert.match(
            html,
            /<button[^>]*(?:disabled=""[^>]*id="pro-stream-mode-select"|id="pro-stream-mode-select"[^>]*disabled="")/
        );
    });

    it('renders a desktop Responses top-level model input when the Responses backend is selected', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <WorkbenchProDock
                    outputFormat='png'
                    onOutputFormatChange={setOutputFormat}
                    quality='high'
                    onQualityChange={setQuality}
                    model='gpt-image-2'
                    onModelChange={setModel}
                    size='auto'
                    streamMode='auto'
                    onStreamModeChange={setStreamMode}
                    allowStreamingBatch={false}
                    enableParallelBatch={false}
                    onEnableParallelBatchChange={setEnableParallelBatch}
                    parallelBatchTargetCount={1}
                    allowResponsesImageBackend
                    hasDefaultResponsesModel={false}
                    imageBackend='responses-image-generation'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='responses-sse'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    responsesModel=''
                    onResponsesModelChange={setResponsesModel}
                    defaultMode='pro'
                    defaultProTab='route'
                />
            </I18nProvider>
        );

        assert.match(html, /pro-responses-model-input/);
        assert.match(html, /GPT 顶层模型/);
        assert.match(html, /Responses image_generation 需要填写 GPT 顶层模型/);
        assert.match(html, /col-span-full grid grid-cols-1 gap-2/);
        assert.match(html, /sm:grid-cols-2/);
        assert.doesNotMatch(html, /md:grid-cols-\[auto_1fr_1fr_1fr\]/);
    });

    it('uses model options discovered from the active channel directory', () => {
        assert.deepEqual(resolveWorkbenchModelOptions(['provider-custom-model', 'gpt-image-2']), [
            'provider-custom-model',
            'gpt-image-2'
        ]);
        assert.deepEqual(resolveWorkbenchModelOptions(), DEFAULT_MODEL_OPTIONS);
        assert.deepEqual(resolveWorkbenchModelOptions([]), DEFAULT_MODEL_OPTIONS);
    });
});
