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
                defaultAdvancedOpen
                defaultAdvancedTab={options.defaultAdvancedTab}
            />
        </I18nProvider>
    );
}

describe('GenerationForm advanced groups', () => {
    it('keeps the left-side professional accordion mobile-only', () => {
        const html = renderGenerationForm({ defaultAdvancedTab: 'route' });

        assert.match(
            html,
            /<div class="[^"]*lg:hidden[^"]*"><button[^>]*aria-controls="generation-advanced-panel"/
        );
    });

    it('renders route controls in a separate professional tab', () => {
        const html = renderGenerationForm({ defaultAdvancedTab: 'route' });

        for (const label of ['输出', '模型', '流式', '路由']) {
            assert.match(html, new RegExp(label));
        }
        assert.match(html, /image-backend-select/);
        assert.match(html, /streaming-strategy-select/);
        assert.doesNotMatch(html, /model-select/);
    });

    it('keeps the model selector out of the route group', () => {
        const html = renderGenerationForm({ defaultAdvancedTab: 'model' });

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
    });

    it('keeps the batch prompt list out of the default generate mode', () => {
        const html = renderGenerationForm();

        assert.doesNotMatch(html, /batch-prompt-list/);
    });
});
