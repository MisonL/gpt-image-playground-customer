'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { WorkbenchProDockProps, OutputFormat, Quality, SizePreset } from '@/components/workbench-pro-dock';
import { WorkbenchProRoutePanel } from '@/components/workbench-pro-route-panel';
import type { GptImageModel } from '@/lib/cost-utils';
import type { Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n';
import type { ImageStreamMode } from '@/lib/image-upstream-strategy';
import { getPresetDimensions } from '@/lib/size-utils';
import type * as React from 'react';

type Translation = ReturnType<typeof useI18n>['t'];
type ProPanelProps = Omit<WorkbenchProDockProps, 'defaultMode' | 'defaultProTab'>;

const modelOptions: GptImageModel[] = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];
const outputFormatOptions: OutputFormat[] = ['png', 'jpeg', 'webp'];
const qualityOptions: Quality[] = ['auto', 'low', 'medium', 'high'];
const streamModeOptions: ImageStreamMode[] = ['auto', 'stream', 'non_stream'];

function getOutputFormatLabel(format: OutputFormat): string {
    if (format === 'jpeg') return 'JPG';
    return format.toUpperCase();
}

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

function formatResolution(size: SizePreset, model: GptImageModel, locale: Locale): string {
    const resolution = getPresetDimensions(size, model);
    if (resolution) return resolution;
    if (size === 'custom') return locale === 'zh-CN' ? '自定义' : 'Custom';
    return '1024 px';
}

function ReadonlyField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className='space-y-1'>
            <p className='text-muted-foreground'>{label}</p>
            <div className='border-border bg-background/68 flex h-9 items-center rounded-md border px-3 font-medium'>
                {children}
            </div>
        </div>
    );
}

export function WorkbenchEasySummary({ model, streamMode, outputFormat, size }: ProPanelProps) {
    const { locale, t } = useI18n();
    const resolution = formatResolution(size, model, locale);

    return (
        <div className='grid grid-cols-4 gap-3 px-4 py-3 text-xs'>
            <ReadonlyField label={t('form.model')}>{model}</ReadonlyField>
            <ReadonlyField label={t('ux.streaming')}>{getStreamModeLabel(streamMode, t)}</ReadonlyField>
            <ReadonlyField label={t('form.outputFormat')}>{getOutputFormatLabel(outputFormat)}</ReadonlyField>
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
        <TabsContent value='output' className='mt-0 grid grid-cols-4 gap-3'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('form.outputFormat')}</p>
                <Select
                    value={outputFormat}
                    onValueChange={(value) => onOutputFormatChange(value as OutputFormat)}
                    disabled={disabled}>
                    <SelectTrigger id='pro-output-format-select' className='h-9 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {outputFormatOptions.map((format) => (
                            <SelectItem key={format} value={format}>
                                {getOutputFormatLabel(format)}
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
                    <SelectTrigger id='pro-quality-select' className='h-9 w-full'>
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
        <TabsContent value='model' className='mt-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('form.model')}</p>
                <Select
                    value={model}
                    onValueChange={(value) => onModelChange(value as GptImageModel)}
                    disabled={disabled}>
                    <SelectTrigger id='pro-model-select' className='h-9 w-full'>
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
    disabled,
    strategyLabel,
    t
}: Pick<ProPanelProps, 'streamMode' | 'onStreamModeChange' | 'disabled'> & {
    strategyLabel: string;
    t: Translation;
}) {
    return (
        <TabsContent value='stream' className='mt-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('streaming.mode')}</p>
                <Select
                    value={streamMode}
                    onValueChange={(value) => onStreamModeChange(value as ImageStreamMode)}
                    disabled={disabled}>
                    <SelectTrigger id='pro-stream-mode-select' className='h-9 w-full'>
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
        </TabsContent>
    );
}

export function WorkbenchProPanel({
    defaultTab,
    ...props
}: ProPanelProps & { defaultTab: 'output' | 'model' | 'stream' | 'route' }) {
    const { locale, t } = useI18n();
    const resolution = formatResolution(props.size, props.model, locale);
    const strategyLabel = getStreamingStrategyLabel(props.streamingStrategy, t);

    return (
        <Tabs defaultValue={defaultTab} className='gap-0'>
            <TabsList className='border-border bg-muted/35 grid h-10 w-full grid-cols-4 rounded-none border-b p-0'>
                <TabsTrigger value='output' className='rounded-none'>
                    {t('ux.output')}
                </TabsTrigger>
                <TabsTrigger value='model' className='rounded-none'>
                    {t('ux.modelRoute')}
                </TabsTrigger>
                <TabsTrigger value='stream' className='rounded-none'>
                    {t('ux.streaming')}
                </TabsTrigger>
                <TabsTrigger value='route' className='rounded-none'>
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
