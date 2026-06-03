import { WorkbenchProDock } from './workbench-pro-dock';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const setOutputFormat: React.Dispatch<React.SetStateAction<'png' | 'jpeg' | 'webp'>> = () => {};
const setQuality: React.Dispatch<React.SetStateAction<'low' | 'medium' | 'high' | 'auto'>> = () => {};
const setModel: React.Dispatch<
    React.SetStateAction<'gpt-image-2' | 'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini'>
> = () => {};
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

function assertProParallelBatchCheckboxDisabled(html: string) {
    assert.match(
        html,
        /<button[^>]*(?:disabled=""[^>]*id="pro-parallel-batch-enabled"|id="pro-parallel-batch-enabled"[^>]*disabled="")/
    );
}

describe('WorkbenchProDock', () => {
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                />
            </I18nProvider>
        );

        assert.match(html, /省心模式/);
        assert.match(html, /专业模式/);
        assert.match(html, /workbench-panel/);
        assert.match(html, /mt-4/);
        assert.match(html, /rounded-lg/);
        assert.match(html, /aria-pressed="true"[^>]*>省心模式/);
        assert.match(html, /输出格式/);
        assert.match(html, /gpt-image-2/);
        assert.doesNotMatch(html, /pro-output-format-select/);
        assert.doesNotMatch(html, /水印/);
        assert.doesNotMatch(html, /EXIF/);
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
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
        assert.match(html, /费用主要由模型、尺寸、数量和预览图数量决定/);
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
                    defaultMode='pro'
                    defaultProTab='stream'
                />
            </I18nProvider>
        );

        assert.match(html, /pro-parallel-batch-enabled/);
        assert.match(html, /并发批量/);
        assert.match(html, /多张图或多条提示词会按当前渠道容量并发执行/);
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='off'
                    defaultStreamingStrategy='auto'
                    onStreamingStrategyChange={setStreamingStrategy}
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='off'
                    onStreamingStrategyChange={setStreamingStrategy}
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
                    imageBackend='server-default'
                    onImageBackendChange={setImageBackend}
                    streamingStrategy='server-default'
                    defaultStreamingStrategy='off'
                    onStreamingStrategyChange={setStreamingStrategy}
                    defaultMode='pro'
                    defaultProTab='stream'
                />
            </I18nProvider>
        );

        assert.match(html, /<button[^>]*(?:disabled=""[^>]*id="pro-stream-mode-select"|id="pro-stream-mode-select"[^>]*disabled="")/);
    });
});
