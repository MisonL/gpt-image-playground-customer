'use client';

import { ModeToggle } from '@/components/mode-toggle';
import type { WorkbenchMode } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { readBatchPromptLines } from '@/lib/batch-prompts';
import type { GptImageModel } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import type {
    ImageUpstreamFormBackend,
    ImageUpstreamFormPromptOptimization,
    ImageUpstreamFormStreamingStrategy,
    ImageUpstreamFormThinking
} from '@/lib/image-upstream-form';
import {
    shouldRecommendImageStreaming,
    type ImageStreamMode,
    type ImageStreamingStrategy
} from '@/lib/image-upstream-strategy';
import { getPresetDimensions, getPresetTooltip, validateGptImage2Size } from '@/lib/size-utils';
import type { SizePreset } from '@/lib/size-utils';
import { getStreamingStatusLabel } from '@/lib/streaming-status-label';
import {
    Square,
    RectangleHorizontal,
    RectangleVertical,
    Sparkles,
    SlidersHorizontal,
    ChevronDown,
    Eraser,
    ShieldCheck,
    ShieldAlert,
    FileImage,
    Tally1,
    Tally2,
    Tally3,
    Loader2,
    BrickWall,
    Lock,
    LockOpen,
    HelpCircle,
    SquareDashed,
    WandSparkles,
    Globe2
} from 'lucide-react';
import * as React from 'react';

export type GenerationFormData = {
    prompt: string;
    n: number;
    size: SizePreset;
    customWidth: number;
    customHeight: number;
    quality: 'low' | 'medium' | 'high' | 'auto';
    output_format: 'png' | 'jpeg' | 'webp';
    output_compression?: number;
    background: 'transparent' | 'opaque' | 'auto';
    moderation: 'low' | 'auto';
    model: GptImageModel;
    image_backend: ImageUpstreamFormBackend;
    streaming_strategy: ImageUpstreamFormStreamingStrategy;
    responsesModel: string;
    thinking: ImageUpstreamFormThinking;
    promptOptimization: ImageUpstreamFormPromptOptimization;
    forceWeb: boolean;
    batchPrompts?: string[];
};

export type WorkbenchReuseContext = {
    sourceLabel: string;
    restoredFields: string[];
    promptPreview: string;
};

type GenerationFormProps = {
    onSubmit: (data: GenerationFormData) => void;
    onSaveInspiration: (prompt: string) => void;
    isLoading: boolean;
    currentMode: WorkbenchMode;
    onModeChange: (mode: WorkbenchMode) => void;
    reuseContext: WorkbenchReuseContext | null;
    onClearReuseContext: () => void;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    model: GenerationFormData['model'];
    setModel: React.Dispatch<React.SetStateAction<GenerationFormData['model']>>;
    prompt: string;
    setPrompt: React.Dispatch<React.SetStateAction<string>>;
    batchPromptText: string;
    setBatchPromptText: React.Dispatch<React.SetStateAction<string>>;
    n: number[];
    setN: React.Dispatch<React.SetStateAction<number[]>>;
    size: GenerationFormData['size'];
    setSize: React.Dispatch<React.SetStateAction<GenerationFormData['size']>>;
    customWidth: number;
    setCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    customHeight: number;
    setCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    quality: GenerationFormData['quality'];
    setQuality: React.Dispatch<React.SetStateAction<GenerationFormData['quality']>>;
    outputFormat: GenerationFormData['output_format'];
    setOutputFormat: React.Dispatch<React.SetStateAction<GenerationFormData['output_format']>>;
    compression: number[];
    setCompression: React.Dispatch<React.SetStateAction<number[]>>;
    background: GenerationFormData['background'];
    setBackground: React.Dispatch<React.SetStateAction<GenerationFormData['background']>>;
    moderation: GenerationFormData['moderation'];
    setModeration: React.Dispatch<React.SetStateAction<GenerationFormData['moderation']>>;
    streamMode: ImageStreamMode;
    setStreamMode: React.Dispatch<React.SetStateAction<ImageStreamMode>>;
    allowStreamingBatch: boolean;
    partialImages: 1 | 2 | 3;
    setPartialImages: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
    imageBackend: GenerationFormData['image_backend'];
    setImageBackend: React.Dispatch<React.SetStateAction<GenerationFormData['image_backend']>>;
    streamingStrategy: GenerationFormData['streaming_strategy'];
    setStreamingStrategy: React.Dispatch<React.SetStateAction<GenerationFormData['streaming_strategy']>>;
    responsesModel: string;
    setResponsesModel: React.Dispatch<React.SetStateAction<string>>;
    thinking: GenerationFormData['thinking'];
    setThinking: React.Dispatch<React.SetStateAction<GenerationFormData['thinking']>>;
    promptOptimization: GenerationFormData['promptOptimization'];
    setPromptOptimization: React.Dispatch<React.SetStateAction<GenerationFormData['promptOptimization']>>;
    forceWeb: boolean;
    setForceWeb: React.Dispatch<React.SetStateAction<boolean>>;
    defaultAdvancedOpen?: boolean;
    defaultAdvancedTab?: AdvancedTab;
};

type AdvancedTab = 'output' | 'model' | 'stream' | 'route';
type PromptTagPattern = {
    test: (value: string) => boolean;
    remove: (value: string) => string;
};

const promptStyleTags = [
    'promptTag.film',
    'promptTag.cream',
    'promptTag.japaneseMagazine',
    'promptTag.bouquet',
    'promptTag.clear',
    'promptTag.relaxed',
    'promptTag.coffee',
    'promptTag.summerWindow'
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createPromptTagPattern(label: string): PromptTagPattern {
    const escapedLabel = escapeRegExp(label);
    const tokenPattern = new RegExp(`(^|[，,、\\s])${escapedLabel}(?=$|[，,、\\s])`);
    const removePattern = new RegExp(`(^|[，,、\\s]+)${escapedLabel}(?=$|[，,、\\s]+)`, 'g');

    return {
        test: (value) => tokenPattern.test(value),
        remove: (value) =>
            value
                .replace(removePattern, '$1')
                .replace(/[，,、\s]+$/g, '')
                .replace(/^[，,、\s]+/g, '')
                .replace(/\s*([，,、])\s*/g, '$1')
                .replace(/([，,、]){2,}/g, '$1')
    };
}

const RadioItemWithIcon = ({
    value,
    id,
    label,
    Icon,
    disabled = false,
    tooltip
}: {
    value: string;
    id: string;
    label: string;
    Icon: React.ElementType;
    disabled?: boolean;
    tooltip?: React.ReactNode;
}) => {
    const item = (
        <RadioGroupItem
            value={value}
            id={id}
            disabled={disabled}
            aria-label={label}
            className='border-border bg-background/58 text-muted-foreground enabled:hover:border-primary/25 enabled:hover:bg-accent/45 enabled:hover:text-foreground data-[state=checked]:border-primary/55 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary flex aspect-auto h-auto min-h-8 w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs shadow-none transition-[background-color,border-color,color,box-shadow,transform] enabled:active:translate-y-0 enabled:motion-safe:hover:-translate-y-0.5 enabled:motion-safe:hover:scale-100 enabled:motion-safe:active:scale-100 [&_[data-slot=radio-group-indicator]]:hidden'>
            <Icon className='h-3 w-3 text-current opacity-50' />
            <span className='max-w-full min-w-0 truncate text-center leading-4'>{label}</span>
        </RadioGroupItem>
    );

    if (!tooltip) return item;

    return (
        <Tooltip>
            <TooltipTrigger asChild>{item}</TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
    );
};

function readConcreteSize(input: {
    size: SizePreset;
    model: GptImageModel;
    customWidth: number;
    customHeight: number;
}): { width: number; height: number } | null {
    if (input.size === 'custom') {
        return { width: input.customWidth, height: input.customHeight };
    }
    const preset = getPresetDimensions(input.size, input.model);
    if (!preset) return null;
    const [width, height] = preset.split('x').map(Number);
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}

function getBackendLabel(backend: GenerationFormData['image_backend'], t: (key: string) => string): string {
    if (backend === 'images-api') return t('upstream.backendImages');
    if (backend === 'responses-image-generation') return t('upstream.backendResponses');
    return t('upstream.serverDefault');
}

function getStreamModeLabel(streamMode: ImageStreamMode, t: (key: string) => string): string {
    if (streamMode === 'stream') return t('streaming.modeStream');
    if (streamMode === 'non_stream') return t('streaming.modeNonStream');
    return t('streaming.modeAuto');
}

function getQualityLabel(quality: GenerationFormData['quality'], t: (key: string) => string): string {
    if (quality === 'low') return t('common.low');
    if (quality === 'medium') return t('common.medium');
    if (quality === 'high') return t('common.high');
    return t('common.auto');
}

function getOutputFormatLabel(format: GenerationFormData['output_format'], t: (key: string) => string): string {
    if (format === 'jpeg') return t('common.jpeg');
    if (format === 'webp') return t('common.webp');
    return t('common.png');
}

export function GenerationForm({
    onSubmit,
    onSaveInspiration,
    isLoading,
    currentMode,
    onModeChange,
    reuseContext,
    onClearReuseContext,
    isPasswordRequiredByBackend,
    clientPasswordHash,
    onOpenPasswordDialog,
    model,
    setModel,
    prompt,
    setPrompt,
    batchPromptText,
    setBatchPromptText,
    n,
    setN,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    quality,
    setQuality,
    outputFormat,
    setOutputFormat,
    compression,
    setCompression,
    background,
    setBackground,
    moderation,
    setModeration,
    streamMode,
    setStreamMode,
    allowStreamingBatch,
    partialImages,
    setPartialImages,
    imageBackend,
    setImageBackend,
    streamingStrategy,
    setStreamingStrategy,
    responsesModel,
    setResponsesModel,
    thinking,
    setThinking,
    promptOptimization,
    setPromptOptimization,
    forceWeb,
    setForceWeb,
    defaultAdvancedOpen = false,
    defaultAdvancedTab = 'output'
}: GenerationFormProps) {
    const { locale, t } = useI18n();
    const showCompression = outputFormat === 'jpeg' || outputFormat === 'webp';
    const isGptImage2 = model === 'gpt-image-2';
    const customSizeValidation =
        size === 'custom' ? validateGptImage2Size(customWidth, customHeight) : { valid: true as const };
    const customSizeInvalid = size === 'custom' && !customSizeValidation.valid;
    const customPixels = customWidth * customHeight;
    const customRatio =
        customWidth > 0 && customHeight > 0
            ? t('form.ratio', {
                  ratio: (Math.max(customWidth, customHeight) / Math.min(customWidth, customHeight)).toFixed(2)
              })
            : t('form.noRatio');
    const customSizeError = customSizeValidation.valid
        ? null
        : t(customSizeValidation.reasonKey, customSizeValidation.values);

    const effectiveStreamingStrategy: ImageStreamingStrategy =
        streamingStrategy === 'server-default' ? 'auto' : streamingStrategy;
    const streamingDisabledByStrategy = effectiveStreamingStrategy === 'off';
    const concreteSize = readConcreteSize({ size, model, customWidth, customHeight });
    const recommendStreaming = Boolean(
        concreteSize &&
            shouldRecommendImageStreaming({
                streamingStrategy: effectiveStreamingStrategy,
                quality,
                width: concreteSize.width,
                height: concreteSize.height,
                streamEnabled: streamMode !== 'non_stream'
            })
    );
    const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(defaultAdvancedOpen);
    const [advancedTab, setAdvancedTab] = React.useState<AdvancedTab>(defaultAdvancedTab);
    const isBatchMode = currentMode === 'batch';
    const isReuseMode = currentMode === 'reuse';
    const batchPrompts = React.useMemo(() => readBatchPromptLines(batchPromptText), [batchPromptText]);
    const submitDisabledReason = React.useMemo(() => {
        if (isLoading) return '';
        if (isBatchMode && batchPrompts.length === 0) return t('ux.disabledBatchPrompts');
        if (!isBatchMode && !prompt.trim()) return t('ux.disabledPrompt');
        if (customSizeInvalid) return customSizeError || t('ux.disabledCustomSize');
        return '';
    }, [batchPrompts.length, customSizeError, customSizeInvalid, isBatchMode, isLoading, prompt, t]);
    const advancedSummary = [
        `${t('form.quality')}: ${getQualityLabel(quality, t)}`,
        `${t('form.outputFormat')}: ${getOutputFormatLabel(outputFormat, t)}`,
        getBackendLabel(imageBackend, t)
    ].join(', ');
    const streamModeLabel = getStreamModeLabel(streamMode, t);
    const streamStatusLabel = getStreamingStatusLabel(streamMode, t);

    const applyPromptTag = React.useCallback(
        (label: string) => {
            setPrompt((current) => {
                const trimmed = current.trim();
                const pattern = createPromptTagPattern(label);
                if (!trimmed) return label;
                if (pattern.test(trimmed)) return pattern.remove(trimmed);
                return `${trimmed}，${label}`;
            });
        },
        [setPrompt]
    );

    React.useEffect(() => {
        if (streamingDisabledByStrategy && streamMode !== 'non_stream') {
            setStreamMode('non_stream');
        }
    }, [streamingDisabledByStrategy, streamMode, setStreamMode]);

    // custom 仅对 gpt-image-2 有效，切换到旧模型时重置。
    React.useEffect(() => {
        if (!isGptImage2 && size === 'custom') {
            setSize('auto');
        }
    }, [isGptImage2, size, setSize]);

    // 切换到 gpt-image-2 时重置 transparent 背景，因为该模型不支持。
    React.useEffect(() => {
        if (isGptImage2 && background === 'transparent') {
            setBackground('auto');
        }
    }, [isGptImage2, background, setBackground]);

    const handleSubmit = () => {
        if (customSizeInvalid) {
            return;
        }
        const formData: GenerationFormData = {
            prompt: isBatchMode && batchPrompts.length > 0 ? batchPrompts[0] : prompt,
            n: n[0],
            size,
            customWidth,
            customHeight,
            quality,
            output_format: outputFormat,
            background,
            moderation,
            model,
            image_backend: imageBackend,
            streaming_strategy: streamingStrategy,
            responsesModel,
            thinking,
            promptOptimization,
            forceWeb
        };
        if (isBatchMode) {
            formData.batchPrompts = batchPrompts;
        }
        if (showCompression) {
            formData.output_compression = compression[0];
        }
        onSubmit(formData);
    };

    return (
        <Card className='workbench-panel text-card-foreground border-border flex w-full flex-col gap-0 overflow-hidden rounded-lg border py-0 lg:h-full'>
            <CardHeader className='border-border/70 border-b px-3 pt-2 !pb-2'>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <div className='flex flex-1 flex-col lg:h-full lg:overflow-hidden'>
                <CardContent className='space-y-3 p-4 pb-28 lg:flex-1 lg:overflow-y-auto lg:pb-4'>
                    <div className='space-y-1'>
                        <div className='flex items-center'>
                            <CardTitle className='editorial-title py-0.5 text-xl font-semibold'>
                                {t('workbench.creationSheet')}
                            </CardTitle>
                            {isPasswordRequiredByBackend && (
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    onClick={onOpenPasswordDialog}
                                    className='text-muted-foreground hover:text-foreground ml-auto h-7 px-2'
                                    aria-label={t('password.configure')}>
                                    {clientPasswordHash ? (
                                        <Lock className='h-4 w-4' />
                                    ) : (
                                        <LockOpen className='h-4 w-4' />
                                    )}
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className='space-y-1.5'>
                        <div className='flex items-center'>
                            <Label htmlFor='prompt' className='text-foreground text-sm font-medium'>
                                {t('workbench.promptTitle')}
                            </Label>
                            {prompt.trim() && (
                                <button
                                    type='button'
                                    onClick={() => setPrompt('')}
                                    disabled={isLoading}
                                    className='text-muted-foreground hover:text-foreground ml-auto text-xs disabled:opacity-50'>
                                    {t('common.clear')}
                                </button>
                            )}
                        </div>
                        <div className='relative'>
                            <Textarea
                                id='prompt'
                                name='prompt'
                                placeholder={t('form.promptPlaceholder')}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                required
                                disabled={isLoading}
                                className='min-h-[118px] rounded-md bg-[oklch(0.972_0.018_82)] px-4 py-3 pb-9 leading-7 shadow-inner'
                            />
                            <span className='text-muted-foreground pointer-events-none absolute bottom-3 left-4 text-xs'>
                                {prompt.trim().length} / 1000
                            </span>
                        </div>
                        <div className='flex flex-wrap gap-1.5 pt-1.5'>
                            {promptStyleTags.map((key) => {
                                const label = t(key);
                                const selected = createPromptTagPattern(label).test(prompt);
                                return (
                                    <button
                                        key={key}
                                        type='button'
                                        onClick={() => applyPromptTag(label)}
                                        disabled={isLoading}
                                        aria-pressed={selected}
                                        className={`rounded-full border px-2.5 py-0.5 text-xs shadow-sm transition-[background-color,border-color,color,transform,box-shadow] enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:opacity-50 ${
                                            selected
                                                ? 'border-primary/50 bg-primary/90 text-primary-foreground shadow-[0_4px_10px_oklch(0.5_0.12_30/0.14)]'
                                                : 'border-border text-muted-foreground hover:border-primary/25 hover:bg-accent/45 hover:text-foreground bg-[oklch(0.982_0.012_84)]'
                                        }`}>
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                        {recommendStreaming && (
                            <p className='text-xs text-amber-700 dark:text-amber-300'>
                                {t('streaming.highResolutionRecommendation')}
                            </p>
                        )}
                        {isReuseMode && (
                            <div className='border-primary/25 dark:bg-muted/40 rounded-md border bg-[oklch(0.965_0.03_76)] px-3 py-2 text-xs leading-5 shadow-sm'>
                                {reuseContext ? (
                                    <div className='space-y-2'>
                                        <div className='flex items-start justify-between gap-3'>
                                            <div className='min-w-0'>
                                                <p className='text-foreground font-medium'>{t('reuse.appliedTitle')}</p>
                                                <p className='text-muted-foreground truncate'>
                                                    {reuseContext.sourceLabel}
                                                </p>
                                            </div>
                                            <button
                                                type='button'
                                                onClick={onClearReuseContext}
                                                disabled={isLoading}
                                                className='text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50'>
                                                {t('common.clear')}
                                            </button>
                                        </div>
                                        <div className='flex flex-wrap gap-1'>
                                            {reuseContext.restoredFields.map((field) => (
                                                <span
                                                    key={field}
                                                    className='border-primary/20 bg-background/70 text-primary rounded-full border px-2 py-0.5'>
                                                    {field}
                                                </span>
                                            ))}
                                        </div>
                                        <p className='text-muted-foreground max-h-10 overflow-hidden break-words'>
                                            {reuseContext.promptPreview}
                                        </p>
                                    </div>
                                ) : (
                                    <p className='text-muted-foreground'>{t('mode.reuseHint')}</p>
                                )}
                            </div>
                        )}
                        {isBatchMode && (
                            <div className='border-border/75 bg-background/65 space-y-2 rounded-md border p-3 shadow-sm'>
                                <div className='flex items-center justify-between gap-3'>
                                    <Label htmlFor='batch-prompt-list'>{t('batch.promptList')}</Label>
                                    <span className='text-muted-foreground shrink-0 text-xs'>
                                        {t('batch.promptCount', { count: batchPrompts.length })}
                                    </span>
                                </div>
                                <Textarea
                                    id='batch-prompt-list'
                                    name='batchPrompts'
                                    value={batchPromptText}
                                    onChange={(event) => setBatchPromptText(event.target.value)}
                                    disabled={isLoading}
                                    className='min-h-[132px] rounded-md bg-[oklch(0.978_0.016_82)] px-3 py-2 leading-6 shadow-inner'
                                    placeholder={t('batch.promptPlaceholder')}
                                />
                            </div>
                        )}
                    </div>

                    <div className='border-border/70 space-y-3 border-t pt-3'>
                        <div className='text-foreground block text-sm leading-none font-medium select-none'>
                            {t('workbench.basicSettings')}
                        </div>
                        <div className='space-y-2'>
                            <div className='text-muted-foreground text-xs'>{t('form.size')}</div>
                            <RadioGroup
                                value={size}
                                onValueChange={(value) => setSize(value as GenerationFormData['size'])}
                                disabled={isLoading}
                                name='size'
                                aria-label={t('form.size')}
                                className='grid grid-cols-5 gap-1.5'>
                                <RadioItemWithIcon
                                    value='auto'
                                    id='size-auto'
                                    label={t('common.auto')}
                                    Icon={Sparkles}
                                    disabled={isLoading}
                                />
                                {isGptImage2 && (
                                    <RadioItemWithIcon
                                        value='custom'
                                        id='size-custom'
                                        label={t('common.custom')}
                                        Icon={SquareDashed}
                                        disabled={isLoading}
                                    />
                                )}
                                <RadioItemWithIcon
                                    value='square'
                                    id='size-square'
                                    label={t('common.square')}
                                    Icon={Square}
                                    disabled={isLoading}
                                    tooltip={getPresetTooltip('square', model)}
                                />
                                <RadioItemWithIcon
                                    value='landscape'
                                    id='size-landscape'
                                    label={t('common.landscape')}
                                    Icon={RectangleHorizontal}
                                    disabled={isLoading}
                                    tooltip={getPresetTooltip('landscape', model)}
                                />
                                <RadioItemWithIcon
                                    value='portrait'
                                    id='size-portrait'
                                    label={t('common.portrait')}
                                    Icon={RectangleVertical}
                                    disabled={isLoading}
                                    tooltip={getPresetTooltip('portrait', model)}
                                />
                            </RadioGroup>
                        </div>
                        {isGptImage2 && size === 'custom' && (
                            <div className='bg-muted/30 border-border space-y-2 rounded-md border p-3'>
                                <div className='flex items-center gap-3'>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='custom-width' className='text-muted-foreground text-xs'>
                                            {t('form.width')}
                                        </Label>
                                        <Input
                                            id='custom-width'
                                            name='customWidth'
                                            type='number'
                                            inputMode='numeric'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={customWidth}
                                            onChange={(e) => setCustomWidth(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    <span className='text-muted-foreground pt-5'>x</span>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='custom-height' className='text-muted-foreground text-xs'>
                                            {t('form.height')}
                                        </Label>
                                        <Input
                                            id='custom-height'
                                            name='customHeight'
                                            type='number'
                                            inputMode='numeric'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={customHeight}
                                            onChange={(e) => setCustomHeight(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>
                                <p className='text-muted-foreground text-xs'>
                                    {t('form.pixelsMeta', {
                                        pixels: customPixels.toLocaleString(locale),
                                        percent: ((customPixels / 8_294_400) * 100).toFixed(1),
                                        ratio: customRatio
                                    })}
                                </p>
                                {customSizeError && <p className='text-destructive text-xs'>{customSizeError}</p>}
                                <p className='text-muted-foreground text-xs'>{t('form.customConstraints')}</p>
                            </div>
                        )}

                        <div className='space-y-2'>
                            <div className='text-muted-foreground text-xs'>
                                {isBatchMode
                                    ? t('form.batchNumberOfImages', { count: batchPrompts.length })
                                    : t('form.numberOfImages', { count: n[0] })}
                            </div>
                            {isBatchMode ? (
                                <div className='border-border bg-muted/25 text-muted-foreground rounded-md border px-3 py-2 text-xs leading-5'>
                                    {t('mode.batchHint')}
                                </div>
                            ) : (
                                <RadioGroup
                                    value={String(n[0])}
                                    onValueChange={(value) => setN([Number(value)])}
                                    disabled={isLoading}
                                    name='n'
                                    aria-label={t('form.numberOfImages', { count: n[0] })}
                                    className='grid grid-cols-4 gap-1.5'>
                                    {[1, 2, 4, 8].map((value) => (
                                        <RadioItemWithIcon
                                            key={value}
                                            value={String(value)}
                                            id={`n-${value}`}
                                            label={String(value)}
                                            Icon={value === 1 ? Tally1 : value === 2 ? Tally2 : Tally3}
                                            disabled={isLoading}
                                        />
                                    ))}
                                </RadioGroup>
                            )}
                        </div>

                        <div className='space-y-2'>
                            <div className='text-muted-foreground text-xs'>{t('form.quality')}</div>
                            <RadioGroup
                                value={quality}
                                onValueChange={(value) => setQuality(value as GenerationFormData['quality'])}
                                disabled={isLoading}
                                name='quality'
                                aria-label={t('form.quality')}
                                className='grid grid-cols-3 gap-1.5'>
                                <RadioItemWithIcon
                                    value='medium'
                                    id='quality-medium-quick'
                                    label={t('common.standard')}
                                    Icon={Tally1}
                                    disabled={isLoading}
                                />
                                <RadioItemWithIcon
                                    value='high'
                                    id='quality-high-quick'
                                    label={t('common.high')}
                                    Icon={Tally2}
                                    disabled={isLoading}
                                />
                                <RadioItemWithIcon
                                    value='auto'
                                    id='quality-auto-quick'
                                    label={t('common.auto')}
                                    Icon={Sparkles}
                                    disabled={isLoading}
                                />
                            </RadioGroup>
                        </div>

                        <div className='space-y-2'>
                            <div className='text-muted-foreground text-xs'>{t('form.outputFormat')}</div>
                            <RadioGroup
                                value={outputFormat}
                                onValueChange={(value) => setOutputFormat(value as GenerationFormData['output_format'])}
                                disabled={isLoading}
                                name='output_format'
                                aria-label={t('form.outputFormat')}
                                className='grid grid-cols-3 gap-1.5'>
                                <RadioItemWithIcon
                                    value='jpeg'
                                    id='format-jpeg-quick'
                                    label='JPG'
                                    Icon={FileImage}
                                    disabled={isLoading}
                                />
                                <RadioItemWithIcon
                                    value='png'
                                    id='format-png-quick'
                                    label='PNG'
                                    Icon={FileImage}
                                    disabled={isLoading}
                                />
                                <RadioItemWithIcon
                                    value='webp'
                                    id='format-webp-quick'
                                    label='WEBP'
                                    Icon={FileImage}
                                    disabled={isLoading}
                                />
                            </RadioGroup>
                        </div>
                    </div>

                    <div className='border-border bg-muted/20 rounded-md border lg:hidden'>
                        <button
                            type='button'
                            onClick={() => setIsAdvancedOpen((open) => !open)}
                            className='text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-3 text-left text-sm font-medium transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.995]'
                            aria-expanded={isAdvancedOpen}
                            aria-controls='generation-advanced-panel'>
                            <span className='flex min-w-0 items-center gap-2'>
                                <SlidersHorizontal className='h-4 w-4 shrink-0' />
                                <span className='min-w-0'>
                                    <span className='text-foreground block'>{t('ux.professionalMode')}</span>
                                    <span className='text-muted-foreground block truncate text-xs font-normal'>
                                        {advancedSummary}
                                    </span>
                                </span>
                            </span>
                            <ChevronDown
                                className={`h-4 w-4 shrink-0 transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`}
                            />
                        </button>
                        {isAdvancedOpen && (
                            <div id='generation-advanced-panel' className='border-border border-t p-3'>
                                <Tabs
                                    value={advancedTab}
                                    onValueChange={(value) => setAdvancedTab(value as AdvancedTab)}
                                    className='gap-3'>
                                    <TabsList className='grid h-auto w-full grid-cols-4 rounded-md'>
                                        <TabsTrigger value='output' className='min-h-9'>
                                            {t('ux.output')}
                                        </TabsTrigger>
                                        <TabsTrigger value='model' className='min-h-9'>
                                            {t('ux.modelRoute')}
                                        </TabsTrigger>
                                        <TabsTrigger value='stream' className='min-h-9'>
                                            {t('ux.streaming')}
                                        </TabsTrigger>
                                        <TabsTrigger value='route' className='min-h-9'>
                                            {t('ux.route')}
                                        </TabsTrigger>
                                    </TabsList>
                                    <TabsContent value='model' className='space-y-5'>
                                        <div className='space-y-1.5'>
                                            <Label htmlFor='model-select'>{t('form.model')}</Label>
                                            <Select
                                                value={model}
                                                onValueChange={(value) =>
                                                    setModel(value as GenerationFormData['model'])
                                                }
                                                disabled={isLoading}
                                                name='model'>
                                                <SelectTrigger id='model-select' className='w-full'>
                                                    <SelectValue placeholder={t('form.selectModel')} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value='gpt-image-2'>gpt-image-2</SelectItem>
                                                    <SelectItem value='gpt-image-1.5'>gpt-image-1.5</SelectItem>
                                                    <SelectItem value='gpt-image-1'>gpt-image-1</SelectItem>
                                                    <SelectItem value='gpt-image-1-mini'>gpt-image-1-mini</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </TabsContent>
                                    <TabsContent value='route' className='space-y-5'>
                                        <div className='grid gap-3 sm:grid-cols-2'>
                                            <div className='space-y-1.5'>
                                                <Label htmlFor='image-backend-select'>{t('upstream.backend')}</Label>
                                                <Select
                                                    value={imageBackend}
                                                    onValueChange={(value) =>
                                                        setImageBackend(value as GenerationFormData['image_backend'])
                                                    }
                                                    disabled={isLoading}
                                                    name='image_backend'>
                                                    <SelectTrigger id='image-backend-select'>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value='images-api'>
                                                            {t('upstream.backendImages')}
                                                        </SelectItem>
                                                        <SelectItem value='responses-image-generation'>
                                                            {t('upstream.backendResponses')}
                                                        </SelectItem>
                                                        <SelectItem value='server-default'>
                                                            {t('upstream.serverDefault')}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className='space-y-1.5'>
                                                <Label htmlFor='streaming-strategy-select'>
                                                    {t('upstream.streamingStrategy')}
                                                </Label>
                                                <Select
                                                    value={streamingStrategy}
                                                    onValueChange={(value) =>
                                                        setStreamingStrategy(
                                                            value as GenerationFormData['streaming_strategy']
                                                        )
                                                    }
                                                    disabled={isLoading}
                                                    name='image_streaming_strategy'>
                                                    <SelectTrigger id='streaming-strategy-select'>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value='auto'>
                                                            {t('upstream.strategyAuto')}
                                                        </SelectItem>
                                                        <SelectItem value='off'>{t('upstream.strategyOff')}</SelectItem>
                                                        <SelectItem value='openai-sse'>
                                                            {t('upstream.strategyOpenAiSse')}
                                                        </SelectItem>
                                                        <SelectItem value='newapi-keepalive-sse'>
                                                            {t('upstream.strategyKeepaliveSse')}
                                                        </SelectItem>
                                                        <SelectItem value='responses-sse'>
                                                            {t('upstream.strategyResponsesSse')}
                                                        </SelectItem>
                                                        <SelectItem value='force-sse'>
                                                            {t('upstream.strategyForceSse')}
                                                        </SelectItem>
                                                        <SelectItem value='server-default'>
                                                            {t('upstream.serverDefault')}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        {imageBackend === 'responses-image-generation' && (
                                            <div className='border-border bg-muted/20 space-y-3 rounded-md border p-3'>
                                                <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                    <WandSparkles className='text-muted-foreground h-4 w-4' />
                                                    {t('upstream.compatibilityParams')}
                                                </div>
                                                <div className='grid gap-3 sm:grid-cols-2'>
                                                    <div className='space-y-1.5 sm:col-span-2'>
                                                        <Label htmlFor='responses-model-input'>
                                                            {t('upstream.gptModel')}
                                                        </Label>
                                                        <Input
                                                            id='responses-model-input'
                                                            name='responsesModel'
                                                            value={responsesModel}
                                                            onChange={(event) => setResponsesModel(event.target.value)}
                                                            disabled={isLoading}
                                                            autoComplete='off'
                                                            spellCheck={false}
                                                            placeholder='gpt-5.4'
                                                        />
                                                    </div>
                                                    <div className='space-y-1.5'>
                                                        <Label htmlFor='thinking-select'>
                                                            {t('upstream.thinking')}
                                                        </Label>
                                                        <Select
                                                            value={thinking}
                                                            onValueChange={(value) =>
                                                                setThinking(value as GenerationFormData['thinking'])
                                                            }
                                                            disabled={isLoading}
                                                            name='thinking'>
                                                            <SelectTrigger id='thinking-select'>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value='server-default'>
                                                                    {t('upstream.serverDefault')}
                                                                </SelectItem>
                                                                <SelectItem value='none'>none</SelectItem>
                                                                <SelectItem value='minimal'>minimal</SelectItem>
                                                                <SelectItem value='low'>low</SelectItem>
                                                                <SelectItem value='medium'>medium</SelectItem>
                                                                <SelectItem value='high'>high</SelectItem>
                                                                <SelectItem value='xhigh'>xhigh</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className='space-y-1.5'>
                                                        <Label htmlFor='prompt-optimization-select'>
                                                            {t('upstream.promptOptimization')}
                                                        </Label>
                                                        <Select
                                                            value={promptOptimization}
                                                            onValueChange={(value) =>
                                                                setPromptOptimization(
                                                                    value as GenerationFormData['promptOptimization']
                                                                )
                                                            }
                                                            disabled={isLoading}
                                                            name='promptOptimization'>
                                                            <SelectTrigger id='prompt-optimization-select'>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value='server-default'>
                                                                    {t('upstream.serverDefault')}
                                                                </SelectItem>
                                                                <SelectItem value='on'>
                                                                    {t('common.enabled')}
                                                                </SelectItem>
                                                                <SelectItem value='off'>
                                                                    {t('common.disabled')}
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {imageBackend === 'images-api' && (
                                            <div className='border-border bg-muted/20 space-y-3 rounded-md border p-3'>
                                                <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                    <Globe2 className='text-muted-foreground h-4 w-4' />
                                                    {t('upstream.compatibilityParams')}
                                                </div>
                                                <RadioGroup
                                                    value={forceWeb ? 'true' : 'false'}
                                                    onValueChange={(value) => setForceWeb(value === 'true')}
                                                    disabled={isLoading}
                                                    name='force_web'
                                                    aria-label={t('upstream.forceWeb')}
                                                    className='grid grid-cols-2 gap-2'>
                                                    <RadioItemWithIcon
                                                        value='false'
                                                        id='force-web-false'
                                                        label={t('upstream.serverDefault')}
                                                        Icon={Sparkles}
                                                        disabled={isLoading}
                                                    />
                                                    <RadioItemWithIcon
                                                        value='true'
                                                        id='force-web-true'
                                                        label={t('upstream.forceWeb')}
                                                        Icon={Globe2}
                                                        disabled={isLoading}
                                                        tooltip={t('upstream.forceWebHint')}
                                                    />
                                                </RadioGroup>
                                            </div>
                                        )}
                                    </TabsContent>
                                    <TabsContent value='stream' className='space-y-5'>
                                        <div className='space-y-1.5'>
                                            <Label htmlFor='stream-mode-select'>{t('streaming.mode')}</Label>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div>
                                                        <Select
                                                            value={streamMode}
                                                            onValueChange={(value) =>
                                                                setStreamMode(value as ImageStreamMode)
                                                            }
                                                            disabled={isLoading || streamingDisabledByStrategy}
                                                            name='stream_mode'>
                                                            <SelectTrigger id='stream-mode-select' className='w-full'>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value='auto'>
                                                                    {t('streaming.modeAuto')}
                                                                </SelectItem>
                                                                <SelectItem value='stream'>
                                                                    {t('streaming.modeStream')}
                                                                </SelectItem>
                                                                <SelectItem value='non_stream'>
                                                                    {t('streaming.modeNonStream')}
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent className='max-w-[250px]'>
                                                    {streamingDisabledByStrategy
                                                        ? t('streaming.disabledByStrategy')
                                                        : allowStreamingBatch && n[0] > 1 && streamMode !== 'non_stream'
                                                          ? t('streaming.batchDescription')
                                                          : t('streaming.description')}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        {streamMode !== 'non_stream' && (
                                            <div className='space-y-3'>
                                                <div className='flex items-center gap-2'>
                                                    <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                        {t('streaming.previewImages')}
                                                    </div>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <button
                                                                type='button'
                                                                className='text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:ring-ring -my-2 inline-flex h-9 w-9 cursor-help items-center justify-center rounded-sm transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:outline-none active:scale-95'
                                                                aria-label={t('streaming.costHint')}>
                                                                <HelpCircle className='h-4 w-4' />
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent className='max-w-[250px]'>
                                                            {t('streaming.costHint')}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <RadioGroup
                                                    value={String(partialImages)}
                                                    onValueChange={(value) =>
                                                        setPartialImages(Number(value) as 1 | 2 | 3)
                                                    }
                                                    disabled={isLoading}
                                                    name='partial_images'
                                                    aria-label={t('streaming.previewImages')}
                                                    className='grid grid-cols-3 gap-2'>
                                                    {[1, 2, 3].map((value) => (
                                                        <RadioItemWithIcon
                                                            key={value}
                                                            value={String(value)}
                                                            id={`partial-${value}`}
                                                            label={String(value)}
                                                            Icon={value === 1 ? Tally1 : value === 2 ? Tally2 : Tally3}
                                                            disabled={isLoading}
                                                        />
                                                    ))}
                                                </RadioGroup>
                                            </div>
                                        )}
                                        {streamMode === 'non_stream' && (
                                            <div className='border-border bg-muted/20 text-muted-foreground rounded-md border border-dashed p-3 text-sm'>
                                                {streamModeLabel}
                                            </div>
                                        )}
                                    </TabsContent>
                                    <TabsContent value='output' className='space-y-5'>
                                        <div className='space-y-3'>
                                            <div className='text-foreground block text-sm leading-none font-medium select-none'>
                                                {t('form.quality')}
                                            </div>
                                            <RadioGroup
                                                value={quality}
                                                onValueChange={(value) =>
                                                    setQuality(value as GenerationFormData['quality'])
                                                }
                                                disabled={isLoading}
                                                name='quality'
                                                aria-label={t('form.quality')}
                                                className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                                                <RadioItemWithIcon
                                                    value='auto'
                                                    id='quality-auto'
                                                    label={t('common.auto')}
                                                    Icon={Sparkles}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='low'
                                                    id='quality-low'
                                                    label={t('common.low')}
                                                    Icon={Tally1}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='medium'
                                                    id='quality-medium'
                                                    label={t('common.medium')}
                                                    Icon={Tally2}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='high'
                                                    id='quality-high'
                                                    label={t('common.high')}
                                                    Icon={Tally3}
                                                    disabled={isLoading}
                                                />
                                            </RadioGroup>
                                        </div>

                                        {!isGptImage2 && (
                                            <div className='space-y-3'>
                                                <div className='text-foreground block text-sm leading-none font-medium select-none'>
                                                    {t('form.background')}
                                                </div>
                                                <RadioGroup
                                                    value={background}
                                                    onValueChange={(value) =>
                                                        setBackground(value as GenerationFormData['background'])
                                                    }
                                                    disabled={isLoading}
                                                    name='background'
                                                    aria-label={t('form.background')}
                                                    className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
                                                    <RadioItemWithIcon
                                                        value='auto'
                                                        id='bg-auto'
                                                        label={t('common.auto')}
                                                        Icon={Sparkles}
                                                        disabled={isLoading}
                                                    />
                                                    <RadioItemWithIcon
                                                        value='opaque'
                                                        id='bg-opaque'
                                                        label={t('form.backgroundOpaque')}
                                                        Icon={BrickWall}
                                                        disabled={isLoading}
                                                    />
                                                    <RadioItemWithIcon
                                                        value='transparent'
                                                        id='bg-transparent'
                                                        label={t('form.backgroundTransparent')}
                                                        Icon={Eraser}
                                                        disabled={isLoading}
                                                    />
                                                </RadioGroup>
                                            </div>
                                        )}

                                        <div className='space-y-3'>
                                            <div className='text-foreground block text-sm leading-none font-medium select-none'>
                                                {t('form.outputFormat')}
                                            </div>
                                            <RadioGroup
                                                value={outputFormat}
                                                onValueChange={(value) =>
                                                    setOutputFormat(value as GenerationFormData['output_format'])
                                                }
                                                disabled={isLoading}
                                                name='output_format'
                                                aria-label={t('form.outputFormat')}
                                                className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
                                                <RadioItemWithIcon
                                                    value='png'
                                                    id='format-png'
                                                    label='PNG'
                                                    Icon={FileImage}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='jpeg'
                                                    id='format-jpeg'
                                                    label='JPEG'
                                                    Icon={FileImage}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='webp'
                                                    id='format-webp'
                                                    label='WebP'
                                                    Icon={FileImage}
                                                    disabled={isLoading}
                                                />
                                            </RadioGroup>
                                        </div>

                                        {showCompression && (
                                            <div className='space-y-2 pt-2 transition-opacity duration-300'>
                                                <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                    {t('form.compression', { value: compression[0] })}
                                                </div>
                                                <Slider
                                                    id='compression-slider'
                                                    name='output_compression'
                                                    thumbLabel={t('form.compression', { value: compression[0] })}
                                                    min={0}
                                                    max={100}
                                                    step={1}
                                                    value={compression}
                                                    onValueChange={setCompression}
                                                    disabled={isLoading}
                                                    className='mt-3'
                                                />
                                            </div>
                                        )}

                                        <div className='space-y-3'>
                                            <div className='text-foreground block text-sm leading-none font-medium select-none'>
                                                {t('form.moderation')}
                                            </div>
                                            <RadioGroup
                                                value={moderation}
                                                onValueChange={(value) =>
                                                    setModeration(value as GenerationFormData['moderation'])
                                                }
                                                disabled={isLoading}
                                                name='moderation'
                                                aria-label={t('form.moderation')}
                                                className='grid grid-cols-2 gap-2'>
                                                <RadioItemWithIcon
                                                    value='auto'
                                                    id='mod-auto'
                                                    label={t('common.auto')}
                                                    Icon={ShieldCheck}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='low'
                                                    id='mod-low'
                                                    label={t('common.low')}
                                                    Icon={ShieldAlert}
                                                    disabled={isLoading}
                                                />
                                            </RadioGroup>
                                        </div>
                                    </TabsContent>
                                </Tabs>
                            </div>
                        )}
                    </div>
                </CardContent>
                <CardFooter className='border-border bg-card/80 hidden border-t p-4 lg:flex'>
                    <div className='w-full space-y-2'>
                        <div className='flex flex-wrap items-center gap-1.5 text-xs'>
                            <span className='border-border bg-background/65 text-muted-foreground rounded-full border px-2 py-1'>
                                {model}
                            </span>
                            <span className='border-border bg-background/65 text-muted-foreground rounded-full border px-2 py-1'>
                                {streamStatusLabel}
                            </span>
                            <span className='border-primary/20 bg-primary/10 text-primary rounded-full border px-2 py-1'>
                                {t('workbench.estimatedCost')}
                            </span>
                        </div>
                        {submitDisabledReason && (
                            <p className='text-muted-foreground text-center text-xs'>{submitDisabledReason}</p>
                        )}
                        <Button
                            type='button'
                            onClick={handleSubmit}
                            disabled={isLoading || !!submitDisabledReason}
                            className='flex w-full items-center justify-center gap-2 border-0 bg-[oklch(0.615_0.165_30)] text-white shadow-sm hover:bg-[oklch(0.56_0.15_30)] hover:text-white'>
                            {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                            {isLoading ? t('generate.loading') : t('generate.submit')}
                        </Button>
                        <div className='flex justify-center gap-3 text-xs'>
                            <button
                                type='button'
                                className='text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50'
                                disabled={!prompt.trim() || isLoading}
                                onClick={() => onSaveInspiration(prompt)}>
                                {t('workbench.saveInspiration')}
                            </button>
                            <button
                                type='button'
                                className='text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50'
                                disabled={isLoading}
                                onClick={() => setPrompt(t('workbench.randomPromptExample'))}>
                                {t('workbench.randomInspiration')}
                            </button>
                        </div>
                    </div>
                </CardFooter>
            </div>
        </Card>
    );
}
