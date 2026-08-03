'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { WorkbenchProDockProps, OutputFormat, Quality, SizePreset } from '@/components/workbench-pro-dock';
import { WorkbenchProRoutePanel } from '@/components/workbench-pro-route-panel';
import type { GptImageModel } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import { getImageOutputFormatLabel } from '@/lib/image-display-labels';
import type { ImageStreamMode } from '@/lib/image-upstream-strategy';
import { getPresetDimensions } from '@/lib/size-utils';
import { resolveStreamingBatchToggleState } from '@/lib/streaming-batch';
import type * as React from 'react';

type Translation = ReturnType<typeof useI18n>['t'];
type ProPanelProps = Omit<WorkbenchProDockProps, 'defaultMode' | 'defaultProTab'>;

const modelOptions: GptImageModel[] = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];
const outputFormatOptions: OutputFormat[] = ['png', 'jpeg', 'webp'];
const qualityOptions: Quality[] = ['auto', 'low', 'medium', 'high'];
const streamModeOptions: ImageStreamMode[] = ['auto', 'stream', 'non_stream'];

function getQualityLabel(quality: Quality, t: Translation): string {
    if (quality === 'auto') return t('common.auto');
    if (quality === 'low') return t('common.low');
    if (quality === 'medium') return t('common.medium');
    return t('common.high');
}

function getStreamModeLabel(streamMode: ImageStreamMode, t: Translation): string {
    if (streamMode === 'stream') return t('streaming.modeStream');
    if (streamMode === 'non_stream') return t('streaming.modeNonStream');
    return t('streaming.modeAuto');
}

function getStreamingStrategyLabel(strategy: ProPanelProps['streamingStrategy'], t: Translation): string {
    if (strategy === 'auto') return t('upstream.strategyAuto');
    if (strategy === 'off') return t('upstream.strategyOff');
    if (strategy === 'openai-sse') return t('upstream.strategyOpenAiSse');
    if (strategy === 'newapi-keepalive-sse') return t('upstream.strategyKeepaliveSse');
    if (strategy === 'responses-sse') return t('upstream.strategyResponsesSse');
    if (strategy === 'force-sse') return t('upstream.strategyForceSse');
    return t('upstream.serverDefault');
}

function formatResolution(
    size: SizePreset,
    model: GptImageModel,
    customWidth: number | undefined,
    customHeight: number | undefined,
    t: Translation
): string {
    if (size === 'custom') {
        if (
            typeof customWidth === 'number' &&
            typeof customHeight === 'number' &&
            Number.isInteger(customWidth) &&
            Number.isInteger(customHeight) &&
            customWidth > 0 &&
            customHeight > 0
        ) {
            return `${customWidth}x${customHeight}`;
        }
        return t('common.custom');
    }
    const resolution = getPresetDimensions(size, model);
    if (resolution) return resolution;
    return t('common.auto');
}

function ReadonlyField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className='space-y-1'>
            <p className='text-muted-foreground'>{label}</p>
            <div className='border-border bg-background/68 flex h-8 items-center rounded-md border px-3 font-medium'>
                {children}
            </div>
        </div>
    );
}

export function WorkbenchEasySummary({
    model,
    customWidth,
    customHeight,
    streamMode,
    outputFormat,
    size,
    allowStreamingBatch,
    enableParallelBatch,
    parallelBatchTargetCount,
    streamingStrategy,
    defaultStreamingStrategy
}: ProPanelProps) {
    const { t } = useI18n();
    const resolution = formatResolution(size, model, customWidth, customHeight, t);
    const effectiveStreamingStrategy =
        streamingStrategy === 'server-default' ? defaultStreamingStrategy : streamingStrategy;
    const parallelBatchVisible = resolveStreamingBatchToggleState({
        allowStreamingBatch,
        userEnabled: enableParallelBatch,
        targetCount: parallelBatchTargetCount,
        streamMode,
        streamingStrategy: effectiveStreamingStrategy
    }).checked;

    return (
        <div className='grid grid-cols-4 gap-3 text-xs'>
            <ReadonlyField label={t('form.model')}>{model}</ReadonlyField>
            <ReadonlyField label={t('ux.streaming')}>
                <span className='min-w-0 truncate'>
                    {parallelBatchVisible
                        ? `${getStreamModeLabel(streamMode, t)} / ${t('streaming.parallelBatchEnabled')}`
                        : getStreamModeLabel(streamMode, t)}
                </span>
            </ReadonlyField>
            <ReadonlyField label={t('form.outputFormat')}>{getImageOutputFormatLabel(outputFormat, t)}</ReadonlyField>
            <ReadonlyField label={t('ux.resolution')}>{resolution}</ReadonlyField>
        </div>
    );
}

function OutputPanel({
    outputFormat,
    onOutputFormatChange,
    quality,
    onQualityChange,
    disabled,
    resolution,
    t
}: Pick<ProPanelProps, 'outputFormat' | 'onOutputFormatChange' | 'quality' | 'onQualityChange' | 'disabled'> & {
    resolution: string;
    t: Translation;
}) {
    return (
        <TabsContent value='output' className='mt-0 grid grid-cols-4 gap-3 text-xs'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('form.outputFormat')}</p>
                <Select
                    value={outputFormat}
                    onValueChange={(value) => onOutputFormatChange(value as OutputFormat)}
                    disabled={disabled}>
                    <SelectTrigger
                        id='pro-output-format-select'
                        aria-label={t('form.outputFormat')}
                        className='h-8 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {outputFormatOptions.map((format) => (
                            <SelectItem key={format} value={format}>
                                {getImageOutputFormatLabel(format, t)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('form.quality')}</p>
                <Select
                    value={quality}
                    onValueChange={(value) => onQualityChange(value as Quality)}
                    disabled={disabled}>
                    <SelectTrigger id='pro-quality-select' aria-label={t('form.quality')} className='h-8 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {qualityOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                                {getQualityLabel(option, t)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <ReadonlyField label={t('ux.colorSpace')}>sRGB</ReadonlyField>
            <ReadonlyField label={t('ux.resolution')}>{resolution}</ReadonlyField>
        </TabsContent>
    );
}

function ModelPanel({
    model,
    onModelChange,
    disabled,
    resolution,
    t
}: Pick<ProPanelProps, 'model' | 'onModelChange' | 'disabled'> & { resolution: string; t: Translation }) {
    return (
        <TabsContent value='model' className='mt-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 text-xs'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('form.model')}</p>
                <Select
                    value={model}
                    onValueChange={(value) => onModelChange(value as GptImageModel)}
                    disabled={disabled}>
                    <SelectTrigger id='pro-model-select' aria-label={t('form.model')} className='h-8 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {modelOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                                {option}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <ReadonlyField label={t('ux.resolution')}>{resolution}</ReadonlyField>
        </TabsContent>
    );
}

function StreamPanel({
    streamMode,
    onStreamModeChange,
    allowStreamingBatch,
    enableParallelBatch,
    onEnableParallelBatchChange,
    parallelBatchTargetCount,
    disabled,
    strategyLabel,
    streamingStrategy,
    defaultStreamingStrategy,
    t
}: Pick<
    ProPanelProps,
    | 'streamMode'
    | 'onStreamModeChange'
    | 'allowStreamingBatch'
    | 'enableParallelBatch'
    | 'onEnableParallelBatchChange'
    | 'parallelBatchTargetCount'
    | 'disabled'
    | 'streamingStrategy'
    | 'defaultStreamingStrategy'
> & {
    strategyLabel: string;
    t: Translation;
}) {
    const effectiveStreamingStrategy =
        streamingStrategy === 'server-default' ? defaultStreamingStrategy : streamingStrategy;
    const streamingDisabledByStrategy = effectiveStreamingStrategy === 'off';
    const parallelBatchToggle = resolveStreamingBatchToggleState({
        allowStreamingBatch,
        userEnabled: enableParallelBatch,
        targetCount: parallelBatchTargetCount,
        streamMode,
        streamingStrategy: effectiveStreamingStrategy
    });
    const canEnableParallelBatch = parallelBatchToggle.canEnable;
    const parallelBatchChecked = parallelBatchToggle.checked;
    const parallelBatchUnavailableKey = parallelBatchToggle.unavailableReasonKey;

    return (
        <TabsContent value='stream' className='mt-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 text-xs'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('streaming.mode')}</p>
                <Select
                    value={streamMode}
                    onValueChange={(value) => onStreamModeChange(value as ImageStreamMode)}
                    disabled={disabled || streamingDisabledByStrategy}>
                    <SelectTrigger
                        id='pro-stream-mode-select'
                        aria-label={t('streaming.mode')}
                        disabled={disabled || streamingDisabledByStrategy}
                        className='h-8 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {streamModeOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                                {getStreamModeLabel(option, t)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <ReadonlyField label={t('upstream.streamingStrategy')}>{strategyLabel}</ReadonlyField>
            <div className='border-border bg-muted/20 col-span-2 flex items-start gap-3 rounded-md border p-3'>
                <label
                    htmlFor='pro-parallel-batch-enabled'
                    className='-m-1.5 flex min-h-8 min-w-8 cursor-pointer items-start justify-center p-1.5 has-disabled:cursor-not-allowed'>
                    <Checkbox
                        id='pro-parallel-batch-enabled'
                        checked={parallelBatchChecked}
                        onCheckedChange={(value) => onEnableParallelBatchChange(value === true)}
                        disabled={disabled || !canEnableParallelBatch}
                        aria-label={t('streaming.parallelBatch')}
                        className='mt-0.5'
                    />
                </label>
                <div className='grid gap-1'>
                    <label
                        htmlFor='pro-parallel-batch-enabled'
                        className='text-foreground text-sm leading-none font-medium'>
                        {t('streaming.parallelBatch')}
                    </label>
                    <p className='text-muted-foreground text-xs leading-5'>
                        {canEnableParallelBatch
                            ? t('streaming.parallelBatchDescription')
                            : t(parallelBatchUnavailableKey)}
                    </p>
                </div>
            </div>
        </TabsContent>
    );
}

export function WorkbenchProPanel({
    defaultTab,
    ...props
}: ProPanelProps & { defaultTab: 'output' | 'model' | 'stream' | 'route' }) {
    const { t } = useI18n();
    const resolution = formatResolution(props.size, props.model, props.customWidth, props.customHeight, t);
    const strategyLabel = getStreamingStrategyLabel(props.streamingStrategy, t);

    return (
        <Tabs defaultValue={defaultTab} className='gap-0'>
            <TabsList className='border-border bg-background/45 mb-3 grid h-9 w-full grid-cols-4 rounded-md border p-0'>
                <TabsTrigger value='output' className='rounded-md'>
                    {t('ux.output')}
                </TabsTrigger>
                <TabsTrigger value='model' className='rounded-md'>
                    {t('ux.modelRoute')}
                </TabsTrigger>
                <TabsTrigger value='stream' className='rounded-md'>
                    {t('ux.streaming')}
                </TabsTrigger>
                <TabsTrigger value='route' className='rounded-md'>
                    {t('ux.route')}
                </TabsTrigger>
            </TabsList>
            <div className='px-4 py-3 text-xs'>
                <OutputPanel {...props} resolution={resolution} t={t} />
                <ModelPanel {...props} resolution={resolution} t={t} />
                <StreamPanel {...props} strategyLabel={strategyLabel} t={t} />
                <WorkbenchProRoutePanel {...props} />
            </div>
        </Tabs>
    );
}
