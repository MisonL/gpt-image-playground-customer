'use client';

import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import type { WorkbenchMode } from '@/components/mode-toggle';
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
};

type GenerationFormProps = {
    onSubmit: (data: GenerationFormData) => void;
    onSaveInspiration: (prompt: string) => void;
    isLoading: boolean;
    currentMode: WorkbenchMode;
    onModeChange: (mode: WorkbenchMode) => void;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    model: GenerationFormData['model'];
    setModel: React.Dispatch<React.SetStateAction<GenerationFormData['model']>>;
    prompt: string;
    setPrompt: React.Dispatch<React.SetStateAction<string>>;
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
};

type AdvancedTab = 'route' | 'output' | 'stream';

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
            className='border-border text-muted-foreground enabled:hover:border-foreground/20 enabled:hover:bg-accent enabled:hover:text-accent-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground flex aspect-auto h-auto min-h-10 w-full items-center justify-start gap-2 rounded-md px-3 py-2 text-sm shadow-none transition-[background-color,border-color,color,box-shadow,transform] enabled:active:translate-y-0 enabled:motion-safe:hover:-translate-y-0.5 enabled:motion-safe:hover:scale-100 enabled:motion-safe:active:scale-100 [&_[data-slot=radio-group-indicator]]:hidden'>
            <Icon className='h-4 w-4 text-current opacity-70' />
            <span className='min-w-0 whitespace-normal break-words text-left leading-5'>{label}</span>
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
    isPasswordRequiredByBackend,
    clientPasswordHash,
    onOpenPasswordDialog,
    model,
    setModel,
    prompt,
    setPrompt,
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
    setForceWeb
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
    const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(false);
    const [advancedTab, setAdvancedTab] = React.useState<AdvancedTab>('route');
    const submitDisabledReason = React.useMemo(() => {
        if (isLoading) return '';
        if (!prompt.trim()) return t('ux.disabledPrompt');
        if (customSizeInvalid) return customSizeError || t('ux.disabledCustomSize');
        return '';
    }, [customSizeError, customSizeInvalid, isLoading, prompt, t]);
    const advancedSummary = [
        `${t('form.quality')}: ${getQualityLabel(quality, t)}`,
        `${t('form.outputFormat')}: ${getOutputFormatLabel(outputFormat, t)}`,
        getBackendLabel(imageBackend, t)
    ].join(', ');
    const streamModeLabel = getStreamModeLabel(streamMode, t);
    const isBatchMode = currentMode === 'batch';
    const isReuseMode = currentMode === 'reuse';

    const applyPromptTag = React.useCallback(
        (label: string) => {
            setPrompt((current) => {
                const trimmed = current.trim();
                if (!trimmed) return label;
                if (trimmed.includes(label)) return current;
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
            prompt,
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
        if (showCompression) {
            formData.output_compression = compression[0];
        }
        onSubmit(formData);
    };

    return (
        <Card className='bg-card/92 text-card-foreground border-border flex w-full flex-col overflow-hidden rounded-lg border shadow-sm lg:h-full'>
            <CardHeader className='border-border bg-card/80 flex flex-col gap-4 border-b px-4 py-4'>
                <div className='space-y-1'>
                    <p className='text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase'>
                        {t('workbench.creationSheet')}
                    </p>
                    <div className='flex items-center'>
                        <CardTitle className='py-1 text-lg font-medium'>
                            {isBatchMode
                                ? t('mode.batch')
                                : isReuseMode
                                  ? t('mode.reuse')
                                  : t('generate.title')}
                        </CardTitle>
                        {isPasswordRequiredByBackend && (
                            <Button
                                variant='ghost'
                                size='icon'
                                onClick={onOpenPasswordDialog}
                                className='text-muted-foreground hover:text-foreground ml-2'
                                aria-label={t('password.configure')}>
                                {clientPasswordHash ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
                            </Button>
                        )}
                    </div>
                    <CardDescription className='mt-1 text-xs leading-5'>
                        {isBatchMode
                            ? t('mode.batchPanelDescription')
                            : isReuseMode
                              ? t('mode.reusePanelDescription')
                              : t('generate.description')}
                    </CardDescription>
                </div>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <div className='flex flex-1 flex-col lg:h-full lg:overflow-hidden'>
                <CardContent className='space-y-5 p-4 pb-6 lg:flex-1 lg:overflow-y-auto'>
                    <div className='space-y-1.5'>
                        <Label htmlFor='prompt'>{t('workbench.promptTitle')}</Label>
                        <Textarea
                            id='prompt'
                            name='prompt'
                            placeholder={t('form.promptPlaceholder')}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            required
                            disabled={isLoading}
                            className='min-h-[132px] bg-background/72 leading-6'
                        />
                        <div className='flex flex-wrap gap-2 pt-2'>
                            {promptStyleTags.map((key) => {
                                const label = t(key);
                                const selected = prompt.includes(label);
                                return (
                                    <button
                                        key={key}
                                        type='button'
                                        onClick={() => applyPromptTag(label)}
                                        disabled={isLoading}
                                        className={`rounded-full border px-2.5 py-1 text-xs transition-[background-color,border-color,color,transform] enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:opacity-50 ${
                                            selected
                                                ? 'border-primary/40 bg-primary/10 text-primary'
                                                : 'border-border bg-muted/45 text-muted-foreground hover:border-primary/25 hover:bg-accent/55 hover:text-foreground'
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
                            <p className='text-muted-foreground rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs leading-5'>
                                {t('mode.reuseHint')}
                            </p>
                        )}
                    </div>

                    <div className='border-border bg-background/65 space-y-2 rounded-md border p-3'>
                        <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                            {isBatchMode
                                ? t('form.batchNumberOfImages', { count: n[0] })
                                : t('form.numberOfImages', { count: n[0] })}
                        </div>
                        <Slider
                            id='n-slider'
                            name='n'
                            thumbLabel={t('form.numberOfImages', { count: n[0] })}
                            min={1}
                            max={10}
                            step={1}
                            value={n}
                            onValueChange={setN}
                            disabled={isLoading}
                            className='mt-3'
                        />
                        {isBatchMode && (
                            <p className='text-muted-foreground text-xs leading-5'>
                                {t('mode.batchHint')}
                            </p>
                        )}
                    </div>

                    <div className='border-border bg-background space-y-3 rounded-md border p-3'>
                        <div className='text-foreground block text-sm leading-none font-medium select-none'>
                            {t('form.size')}
                        </div>
                        <RadioGroup
                            value={size}
                            onValueChange={(value) => setSize(value as GenerationFormData['size'])}
                            disabled={isLoading}
                            name='size'
                            aria-label={t('form.size')}
                            className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
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
                    </div>

                    <div className='border-border bg-muted/20 rounded-md border'>
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
                                    <TabsList className='grid h-auto w-full grid-cols-3 rounded-md'>
                                        <TabsTrigger value='route' className='min-h-9'>
                                            {t('ux.modelRoute')}
                                        </TabsTrigger>
                                        <TabsTrigger value='output' className='min-h-9'>
                                            {t('ux.output')}
                                        </TabsTrigger>
                                        <TabsTrigger value='stream' className='min-h-9'>
                                            {t('ux.streaming')}
                                        </TabsTrigger>
                                    </TabsList>
                                    <TabsContent value='route' className='space-y-5'>
                                        <div className='grid gap-3 sm:grid-cols-2'>
                                            <div className='space-y-1.5'>
                                                <Label htmlFor='model-select'>{t('form.model')}</Label>
                                                <Select
                                                    value={model}
                                                    onValueChange={(value) => setModel(value as GenerationFormData['model'])}
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
                                                            onValueChange={(value) => setStreamMode(value as ImageStreamMode)}
                                                            disabled={isLoading || streamingDisabledByStrategy}
                                                            name='stream_mode'>
                                                            <SelectTrigger id='stream-mode-select' className='w-full'>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value='auto'>{t('streaming.modeAuto')}</SelectItem>
                                                                <SelectItem value='stream'>{t('streaming.modeStream')}</SelectItem>
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
                            <span className='rounded-full border border-border bg-background/65 px-2 py-1 text-muted-foreground'>
                                {model}
                            </span>
                            <span className='rounded-full border border-border bg-background/65 px-2 py-1 text-muted-foreground'>
                                {streamModeLabel}
                            </span>
                            <span className='rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-primary'>
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
                            className='flex w-full items-center justify-center gap-2'>
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
                                onClick={() =>
                                    setPrompt(t('workbench.randomPromptExample'))
                                }>
                                {t('workbench.randomInspiration')}
                            </button>
                        </div>
                    </div>
                </CardFooter>
            </div>
        </Card>
    );
}
