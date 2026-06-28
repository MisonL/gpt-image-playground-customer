'use client';

import { ModeToggle } from '@/components/mode-toggle';
import type { WorkbenchMode } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
    getImageUpstreamRouteImpactKeys,
    isImageUpstreamStreamingStrategySelectable,
    resolveImageUpstreamEffectiveStreamingStrategy
} from '@/lib/image-upstream-form';
import {
    buildIntegerRangeOptions,
    clampIntegerToRange,
    getPartialImagesRangeForBackend,
    type ImageUpstreamProfile,
    type PartialImagesCount
} from '@/lib/image-upstream-profile';
import {
    shouldRecommendImageStreaming,
    type ImageStreamMode,
    type ImageStreamingStrategy
} from '@/lib/image-upstream-strategy';
import {
    getPresetDimensions,
    getPresetTooltip,
    getSizePresetOptions,
    validateGptImage2Size,
    validatePositiveIntegerImageSize
} from '@/lib/size-utils';
import type { SizePreset } from '@/lib/size-utils';
import { resolveStreamingBatchToggleState } from '@/lib/streaming-batch';
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
    CircleOff,
    Tally1,
    Tally2,
    Tally3,
    Tally4,
    Loader2,
    BrickWall,
    Lock,
    LockOpen,
    HelpCircle,
    SquareDashed,
    WandSparkles,
    Globe2,
    ListChecks,
    Pause,
    RotateCcw,
    Bookmark
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
    enableParallelBatch: boolean;
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
    canApplyRandomInspiration: boolean;
    onPickRandomInspiration: () => string;
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
    failedBatchPrompts?: string[];
    canPauseBatch?: boolean;
    isBatchPauseRequested?: boolean;
    onPauseBatch?: () => void;
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
    upstreamProfile: ImageUpstreamProfile;
    upstreamProfileMixed?: boolean;
    moderation: GenerationFormData['moderation'];
    setModeration: React.Dispatch<React.SetStateAction<GenerationFormData['moderation']>>;
    streamMode: ImageStreamMode;
    setStreamMode: React.Dispatch<React.SetStateAction<ImageStreamMode>>;
    allowStreamingBatch: boolean;
    enableParallelBatch: boolean;
    setEnableParallelBatch: React.Dispatch<React.SetStateAction<boolean>>;
    partialImages: PartialImagesCount;
    setPartialImages: React.Dispatch<React.SetStateAction<PartialImagesCount>>;
    allowResponsesImageBackend: boolean;
    hasDefaultResponsesModel: boolean;
    imageBackend: GenerationFormData['image_backend'];
    setImageBackend: React.Dispatch<React.SetStateAction<GenerationFormData['image_backend']>>;
    streamingStrategy: GenerationFormData['streaming_strategy'];
    defaultStreamingStrategy: ImageStreamingStrategy;
    setStreamingStrategy: React.Dispatch<React.SetStateAction<GenerationFormData['streaming_strategy']>>;
    responsesModel: string;
    setResponsesModel: React.Dispatch<React.SetStateAction<string>>;
    thinking: GenerationFormData['thinking'];
    setThinking: React.Dispatch<React.SetStateAction<GenerationFormData['thinking']>>;
    promptOptimization: GenerationFormData['promptOptimization'];
    setPromptOptimization: React.Dispatch<React.SetStateAction<GenerationFormData['promptOptimization']>>;
    forceWeb: boolean;
    setForceWeb: React.Dispatch<React.SetStateAction<boolean>>;
    estimatedCostLabel: string;
    defaultAdvancedOpen?: boolean;
    defaultAdvancedTab?: AdvancedTab;
};

type AdvancedTab = 'output' | 'model' | 'stream' | 'route';

const compactSettingRowClass =
    'space-y-1.5 lg:grid lg:grid-cols-[3.4rem_minmax(0,1fr)] lg:items-center lg:gap-1.5 lg:space-y-0';
const compactSettingLabelClass = 'text-muted-foreground text-xs lg:pt-0.5';

function getSizePresetLabel(
    preset: SizePreset,
    t: (key: string, values?: Record<string, string | number>) => string
): string {
    switch (preset) {
        case 'auto':
            return t('common.auto');
        case 'custom':
            return t('common.custom');
        case 'square':
            return t('common.square');
        case 'landscape':
            return t('common.landscape');
        case 'portrait':
            return t('common.portrait');
        case 'square-1k':
            return '1K';
        case 'square-2k':
            return '2K';
        case 'square-4k':
            return '4K';
        case 'wide-4k':
            return '16:9';
        case 'tall-4k':
            return '9:16';
    }
}

function getSizePresetIcon(preset: SizePreset): React.ElementType {
    switch (preset) {
        case 'auto':
            return Sparkles;
        case 'custom':
            return SquareDashed;
        case 'landscape':
        case 'wide-4k':
            return RectangleHorizontal;
        case 'portrait':
        case 'tall-4k':
            return RectangleVertical;
        default:
            return Square;
    }
}

export function resolveGenerationFooterPromptTarget(input: {
    currentMode: WorkbenchMode;
    prompt: string;
    batchPromptText: string;
}): { value: string; isEmpty: boolean } {
    const value = input.currentMode === 'batch' ? input.batchPromptText : input.prompt;
    return {
        value,
        isEmpty: value.trim().length === 0
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
            className='border-border bg-background/58 text-muted-foreground enabled:hover:border-primary/25 enabled:hover:bg-accent/45 enabled:hover:text-foreground data-[state=checked]:border-primary/55 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary flex aspect-auto h-auto min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs shadow-none transition-[background-color,border-color,color,box-shadow,transform] enabled:active:translate-y-0 enabled:motion-safe:hover:-translate-y-0.5 enabled:motion-safe:hover:scale-100 enabled:motion-safe:active:scale-100 lg:min-h-7 lg:flex-row lg:px-1 lg:text-[11px] 2xl:px-1.5 2xl:text-xs [&_[data-slot=radio-group-indicator]]:hidden [&_[data-slot=radio-group-item-content]]:gap-1 lg:[&_[data-slot=radio-group-item-content]]:gap-0.5 2xl:[&_[data-slot=radio-group-item-content]]:gap-1'>
            <Icon className='h-3 w-3 shrink-0 text-current opacity-50 lg:hidden 2xl:block' />
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

function getWorkbenchBackendLabel(backend: GenerationFormData['image_backend'], t: (key: string) => string): string {
    if (backend === 'images-api') return t('upstream.backendImages');
    if (backend === 'responses-image-generation') return t('upstream.backendResponses');
    return t('upstream.workbenchDefaultRoute');
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
    canApplyRandomInspiration,
    onPickRandomInspiration,
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
    failedBatchPrompts = [],
    canPauseBatch = false,
    isBatchPauseRequested = false,
    onPauseBatch,
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
    upstreamProfile,
    upstreamProfileMixed = false,
    moderation,
    setModeration,
    streamMode,
    setStreamMode,
    allowStreamingBatch,
    enableParallelBatch,
    setEnableParallelBatch,
    partialImages,
    setPartialImages,
    allowResponsesImageBackend,
    hasDefaultResponsesModel,
    imageBackend,
    setImageBackend,
    streamingStrategy,
    defaultStreamingStrategy,
    setStreamingStrategy,
    responsesModel,
    setResponsesModel,
    thinking,
    setThinking,
    promptOptimization,
    setPromptOptimization,
    forceWeb,
    setForceWeb,
    estimatedCostLabel,
    defaultAdvancedOpen = false,
    defaultAdvancedTab = 'output'
}: GenerationFormProps) {
    const { locale, t } = useI18n();
    const showCompression = outputFormat === 'jpeg' || outputFormat === 'webp';
    const isGptImage2 = model === 'gpt-image-2';
    const usesPositiveIntegerCustomSize = upstreamProfile.gptImage2.sizePolicy === 'positive-integer';
    const customSizeValidation =
        size === 'custom'
            ? usesPositiveIntegerCustomSize
                ? validatePositiveIntegerImageSize(customWidth, customHeight)
                : validateGptImage2Size(customWidth, customHeight)
            : { valid: true as const };
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

    const effectiveStreamingStrategy = resolveImageUpstreamEffectiveStreamingStrategy({
        streamingStrategy,
        defaultStreamingStrategy
    });
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
    const parallelBatchTargetCount = isBatchMode ? batchPrompts.length : n[0];
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
    const hasFailedBatchPrompts = isBatchMode && failedBatchPrompts.length > 0;
    const requiresResponsesModel =
        imageBackend === 'responses-image-generation' && !hasDefaultResponsesModel && !responsesModel.trim();
    const submitDisabledReason = React.useMemo(() => {
        if (isLoading) return '';
        if (isBatchMode && batchPrompts.length === 0) return t('ux.disabledBatchPrompts');
        if (!isBatchMode && !prompt.trim()) return t('ux.disabledPrompt');
        if (requiresResponsesModel) return t('upstream.responsesModelRequired');
        if (customSizeInvalid) return customSizeError || t('ux.disabledCustomSize');
        return '';
    }, [
        batchPrompts.length,
        customSizeError,
        customSizeInvalid,
        isBatchMode,
        isLoading,
        prompt,
        requiresResponsesModel,
        t
    ]);
    const advancedSummary = [
        `${t('form.quality')}: ${getQualityLabel(quality, t)}`,
        `${t('form.outputFormat')}: ${getOutputFormatLabel(outputFormat, t)}`,
        getBackendLabel(imageBackend, t)
    ].join(', ');
    const streamModeLabel = getStreamModeLabel(streamMode, t);
    const streamStatusLabel = getStreamingStatusLabel(streamMode, t);
    const workbenchBackendLabel = getWorkbenchBackendLabel(imageBackend, t);
    const sizePresetOptions = getSizePresetOptions({ model, upstreamProfile });
    const partialImagesRange = React.useMemo(
        () => getPartialImagesRangeForBackend(upstreamProfile, imageBackend),
        [imageBackend, upstreamProfile]
    );
    const partialImageOptions = buildIntegerRangeOptions(partialImagesRange) as PartialImagesCount[];
    const generationCountOptions = buildIntegerRangeOptions(upstreamProfile.generateCount);
    const footerPromptTarget = resolveGenerationFooterPromptTarget({
        currentMode,
        prompt,
        batchPromptText
    });

    React.useEffect(() => {
        if (partialImages < partialImagesRange.min || partialImages > partialImagesRange.max) {
            setPartialImages(clampIntegerToRange(partialImages, partialImagesRange) as PartialImagesCount);
        }
        if (n[0] < upstreamProfile.generateCount.min || n[0] > upstreamProfile.generateCount.max) {
            setN([clampIntegerToRange(n[0], upstreamProfile.generateCount)]);
        }
        if (background === 'transparent' && !upstreamProfile.gptImage2.allowTransparentBackground) {
            setBackground('auto');
        }
    }, [
        background,
        n,
        partialImages,
        partialImagesRange,
        setBackground,
        setN,
        setPartialImages,
        upstreamProfile.generateCount,
        upstreamProfile.gptImage2.allowTransparentBackground
    ]);

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

    const handleSubmit = () => {
        if (customSizeInvalid) {
            return;
        }
        if (partialImages < partialImagesRange.min || partialImages > partialImagesRange.max) {
            setPartialImages(clampIntegerToRange(partialImages, partialImagesRange) as PartialImagesCount);
            return;
        }
        if (n[0] < upstreamProfile.generateCount.min || n[0] > upstreamProfile.generateCount.max) {
            setN([clampIntegerToRange(n[0], upstreamProfile.generateCount)]);
            return;
        }
        if (background === 'transparent' && !upstreamProfile.gptImage2.allowTransparentBackground) {
            setBackground('auto');
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
            forceWeb,
            enableParallelBatch: parallelBatchChecked
        };
        if (isBatchMode) {
            formData.batchPrompts = batchPrompts;
        }
        if (showCompression) {
            formData.output_compression = compression[0];
        }
        onSubmit(formData);
    };

    const reuseFailedBatchPrompts = () => {
        setBatchPromptText(failedBatchPrompts.join('\n'));
    };

    return (
        <Card className='workbench-panel text-card-foreground border-border flex w-full flex-col gap-0 overflow-hidden rounded-lg border py-0 lg:h-full'>
            <CardHeader className='border-border/70 border-b px-3 pt-2 !pb-2'>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <div className='flex flex-1 flex-col lg:h-full lg:overflow-hidden'>
                <CardContent className='literary-scrollbar space-y-2.5 p-4 pb-28 lg:max-h-[calc(100%-9.75rem)] lg:flex-none lg:overflow-y-auto lg:px-4 lg:py-3 2xl:space-y-2.5'>
                    <div className='flex items-center'>
                        <CardTitle className='editorial-title py-0.5 text-xl font-semibold'>
                            {t('workbench.creationSheet')}
                        </CardTitle>
                        {isPasswordRequiredByBackend && (
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={onOpenPasswordDialog}
                                className='text-muted-foreground hover:text-foreground ml-auto min-h-11 min-w-11 px-2 lg:min-h-7 lg:min-w-0'
                                aria-label={t('password.configure')}>
                                {clientPasswordHash ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
                            </Button>
                        )}
                    </div>
                    <div className='space-y-1.5 lg:space-y-1'>
                        {!isBatchMode && (
                            <>
                                <div className='flex items-center'>
                                    <Label htmlFor='prompt' className='text-foreground text-sm font-medium'>
                                        {t('workbench.promptTitle')}
                                    </Label>
                                    {prompt.trim() && (
                                        <button
                                            type='button'
                                            onClick={() => setPrompt('')}
                                            disabled={isLoading}
                                            className='text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-2 ml-auto min-h-11 min-w-11 rounded-md px-2 text-xs transition-[color,box-shadow] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 lg:mr-0 lg:min-h-7 lg:min-w-0 lg:px-0'>
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
                                        className='min-h-[104px] rounded-md bg-[oklch(0.972_0.018_82)] px-4 py-3 pb-8 leading-6 shadow-inner lg:min-h-[92px]'
                                    />
                                    <span className='text-muted-foreground pointer-events-none absolute bottom-3 left-4 text-xs'>
                                        {prompt.trim().length} / 1000
                                    </span>
                                </div>
                            </>
                        )}
                        {recommendStreaming && !isBatchMode && (
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
                                                className='text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-2 min-h-11 shrink-0 rounded-md px-2 transition-[color,box-shadow] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 lg:mr-0 lg:min-h-7 lg:px-0'>
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
                                {hasFailedBatchPrompts && (
                                    <div className='border-destructive/25 bg-destructive/5 text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs leading-5'>
                                        <span>
                                            {t('batch.failedReuseHint', {
                                                count: failedBatchPrompts.length
                                            })}
                                        </span>
                                        <Button
                                            type='button'
                                            variant='outline'
                                            size='sm'
                                            onClick={reuseFailedBatchPrompts}
                                            disabled={isLoading}
                                            className='bg-background/80 min-h-11 px-3 text-xs lg:h-7 lg:min-h-0 lg:px-2'>
                                            <RotateCcw className='mr-1.5 h-3.5 w-3.5' />
                                            {t('batch.reuseFailed')}
                                        </Button>
                                    </div>
                                )}
                                <div
                                    id='batch-task-summary'
                                    className='border-border/60 grid gap-2 border-t pt-2 text-xs leading-5 sm:grid-cols-2'>
                                    <div className='flex gap-2'>
                                        <ListChecks className='text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0' />
                                        <div className='min-w-0'>
                                            <div className='text-foreground font-medium'>{t('batch.summaryTitle')}</div>
                                            <p className='text-muted-foreground'>{t('batch.summaryPerLine')}</p>
                                        </div>
                                    </div>
                                    <div className='flex gap-2'>
                                        <RotateCcw className='text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0' />
                                        <div className='min-w-0'>
                                            <div className='text-foreground font-medium'>
                                                {t('batch.summaryFailureTitle')}
                                            </div>
                                            <p className='text-muted-foreground'>{t('batch.summaryFailureDetail')}</p>
                                        </div>
                                    </div>
                                    <p className='text-muted-foreground sm:col-span-2'>{t('batch.summaryProgress')}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className='border-border/70 space-y-2 border-t pt-2'>
                        <div className='text-foreground block text-sm leading-none font-medium select-none'>
                            {t('workbench.basicSettings')}
                        </div>
                        <div className={compactSettingRowClass}>
                            <div className={compactSettingLabelClass}>{t('form.size')}</div>
                            <RadioGroup
                                value={size}
                                onValueChange={(value) => setSize(value as GenerationFormData['size'])}
                                disabled={isLoading}
                                name='size'
                                aria-label={t('form.size')}
                                className='grid grid-cols-5 gap-1.5 2xl:grid-cols-6'>
                                {sizePresetOptions.map((option) => (
                                    <RadioItemWithIcon
                                        key={option.value}
                                        value={option.value}
                                        id={`size-${option.value}`}
                                        label={getSizePresetLabel(option.value, t)}
                                        Icon={getSizePresetIcon(option.value)}
                                        disabled={isLoading}
                                        tooltip={getPresetTooltip(option.value, model)}
                                    />
                                ))}
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
                                            min={usesPositiveIntegerCustomSize ? 1 : 16}
                                            max={usesPositiveIntegerCustomSize ? undefined : 3840}
                                            step={usesPositiveIntegerCustomSize ? 1 : 16}
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
                                            min={usesPositiveIntegerCustomSize ? 1 : 16}
                                            max={usesPositiveIntegerCustomSize ? undefined : 3840}
                                            step={usesPositiveIntegerCustomSize ? 1 : 16}
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

                        <div className={compactSettingRowClass}>
                            <div className={compactSettingLabelClass}>
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
                                    {generationCountOptions.map((value) => (
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

                        <div className={compactSettingRowClass}>
                            <div className={compactSettingLabelClass}>{t('form.quality')}</div>
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

                        <div className={compactSettingRowClass}>
                            <div className={compactSettingLabelClass}>{t('form.outputFormat')}</div>
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
                                    <span className='text-foreground block'>
                                        {isAdvancedOpen ? t('ux.professionalMode') : t('ux.easyMode')}
                                    </span>
                                    <span className='text-muted-foreground block truncate text-xs font-normal'>
                                        {isAdvancedOpen ? advancedSummary : t('ux.easyModeSummary')}
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
                                        <TabsTrigger value='output' className='min-h-11 lg:min-h-9'>
                                            {t('ux.output')}
                                        </TabsTrigger>
                                        <TabsTrigger value='model' className='min-h-11 lg:min-h-9'>
                                            {t('ux.modelRoute')}
                                        </TabsTrigger>
                                        <TabsTrigger value='stream' className='min-h-11 lg:min-h-9'>
                                            {t('ux.streaming')}
                                        </TabsTrigger>
                                        <TabsTrigger value='route' className='min-h-11 lg:min-h-9'>
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
                                                <SelectTrigger id='model-select' className='min-h-11 w-full lg:min-h-9'>
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
                                                    <SelectTrigger
                                                        id='image-backend-select'
                                                        className='min-h-11 lg:min-h-9'>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value='images-api'>
                                                            {t('upstream.backendImages')}
                                                        </SelectItem>
                                                        <SelectItem
                                                            value='responses-image-generation'
                                                            disabled={!allowResponsesImageBackend}>
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
                                                    <SelectTrigger
                                                        id='streaming-strategy-select'
                                                        className='min-h-11 lg:min-h-9'>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value='auto'>
                                                            {t('upstream.strategyAuto')}
                                                        </SelectItem>
                                                        <SelectItem value='off'>{t('upstream.strategyOff')}</SelectItem>
                                                        <SelectItem
                                                            value='openai-sse'
                                                            disabled={
                                                                !isImageUpstreamStreamingStrategySelectable({
                                                                    imageBackend,
                                                                    streamingStrategy: 'openai-sse',
                                                                    allowResponsesImageBackend
                                                                })
                                                            }>
                                                            {t('upstream.strategyOpenAiSse')}
                                                        </SelectItem>
                                                        <SelectItem
                                                            value='newapi-keepalive-sse'
                                                            disabled={
                                                                !isImageUpstreamStreamingStrategySelectable({
                                                                    imageBackend,
                                                                    streamingStrategy: 'newapi-keepalive-sse',
                                                                    allowResponsesImageBackend
                                                                })
                                                            }>
                                                            {t('upstream.strategyKeepaliveSse')}
                                                        </SelectItem>
                                                        <SelectItem
                                                            value='responses-sse'
                                                            disabled={
                                                                !isImageUpstreamStreamingStrategySelectable({
                                                                    imageBackend,
                                                                    streamingStrategy: 'responses-sse',
                                                                    allowResponsesImageBackend
                                                                })
                                                            }>
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
                                        <div className='border-border bg-muted/20 text-muted-foreground space-y-1.5 rounded-md border p-3 text-xs leading-5'>
                                            <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                <ShieldAlert className='text-muted-foreground h-4 w-4' />
                                                {t('upstream.routeImpactTitle')}
                                            </div>
                                            {getImageUpstreamRouteImpactKeys({
                                                backend: imageBackend,
                                                streamingStrategy,
                                                defaultStreamingStrategy,
                                                allowResponsesImageBackend,
                                                serverProfileMixed: upstreamProfileMixed
                                            }).map((key) => (
                                                <p key={key}>{t(key)}</p>
                                            ))}
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
                                                            placeholder='OPENAI_RESPONSES_API_MODEL'
                                                        />
                                                        {requiresResponsesModel && (
                                                            <p className='text-destructive text-xs'>
                                                                {t('upstream.responsesModelRequired')}
                                                            </p>
                                                        )}
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
                                                            <SelectTrigger
                                                                id='thinking-select'
                                                                className='min-h-11 lg:min-h-9'>
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
                                                            <SelectTrigger
                                                                id='prompt-optimization-select'
                                                                className='min-h-11 lg:min-h-9'>
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
                                                            <SelectTrigger
                                                                id='stream-mode-select'
                                                                disabled={isLoading || streamingDisabledByStrategy}
                                                                className='min-h-11 w-full lg:min-h-9'>
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
                                        <div className='border-border bg-muted/20 flex items-start gap-3 rounded-md border p-3'>
                                            <label
                                                htmlFor='parallel-batch-enabled'
                                                className='-m-2 flex min-h-11 min-w-11 cursor-pointer items-start justify-center p-2 has-disabled:cursor-not-allowed'>
                                                <Checkbox
                                                    id='parallel-batch-enabled'
                                                    checked={parallelBatchChecked}
                                                    onCheckedChange={(value) => setEnableParallelBatch(value === true)}
                                                    disabled={isLoading || !canEnableParallelBatch}
                                                    aria-label={t('streaming.parallelBatch')}
                                                    className='mt-0.5'
                                                />
                                            </label>
                                            <div className='grid gap-1'>
                                                <Label
                                                    htmlFor='parallel-batch-enabled'
                                                    className='text-foreground text-sm leading-none font-medium'>
                                                    {t('streaming.parallelBatch')}
                                                </Label>
                                                <p className='text-muted-foreground text-xs leading-5'>
                                                    {canEnableParallelBatch
                                                        ? t('streaming.parallelBatchDescription')
                                                        : t(parallelBatchUnavailableKey)}
                                                </p>
                                            </div>
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
                                                                className='text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:ring-ring -my-2 inline-flex h-11 w-11 cursor-help items-center justify-center rounded-sm transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:outline-none active:scale-95 lg:h-9 lg:w-9'
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
                                                        setPartialImages(Number(value) as PartialImagesCount)
                                                    }
                                                    disabled={isLoading}
                                                    name='partial_images'
                                                    aria-label={t('streaming.previewImages')}
                                                    className='grid grid-cols-5 gap-2'>
                                                    {partialImageOptions.map((value) => (
                                                        <RadioItemWithIcon
                                                            key={value}
                                                            value={String(value)}
                                                            id={`partial-${value}`}
                                                            label={String(value)}
                                                            Icon={
                                                                value === 0
                                                                    ? CircleOff
                                                                    : value === 1
                                                                      ? Tally1
                                                                      : value === 2
                                                                        ? Tally2
                                                                        : value === 3
                                                                          ? Tally3
                                                                          : Tally4
                                                            }
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
                                                    disabled={
                                                        isLoading ||
                                                        !upstreamProfile.gptImage2.allowTransparentBackground
                                                    }
                                                />
                                            </RadioGroup>
                                        </div>

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
                <CardFooter className='border-border bg-card/88 flex shrink-0 border-t p-3'>
                    <div className='w-full space-y-2'>
                        <div className='flex flex-wrap items-center gap-1.5 text-xs'>
                            <span className='border-border bg-background/65 text-muted-foreground rounded-full border px-2 py-1'>
                                {model}
                            </span>
                            <span className='border-border bg-background/65 text-muted-foreground rounded-full border px-2 py-1'>
                                {workbenchBackendLabel}
                            </span>
                            <span className='border-border bg-background/65 text-muted-foreground rounded-full border px-2 py-1'>
                                {streamStatusLabel}
                            </span>
                            {parallelBatchChecked && (
                                <span className='rounded-full border border-[oklch(0.72_0.065_142)] bg-[oklch(0.94_0.032_142)] px-2 py-1 text-[oklch(0.38_0.075_148)]'>
                                    {t('streaming.parallelBatchEnabled')}
                                </span>
                            )}
                            <span className='border-primary/20 bg-primary/10 text-primary rounded-full border px-2 py-1'>
                                {estimatedCostLabel}
                            </span>
                        </div>
                        {submitDisabledReason && (
                            <p className='text-muted-foreground text-center text-xs'>{submitDisabledReason}</p>
                        )}
                        <div className='grid gap-2 sm:grid-cols-[1fr_auto]'>
                            <Button
                                type='button'
                                onClick={handleSubmit}
                                disabled={isLoading || !!submitDisabledReason}
                                className='flex w-full items-center justify-center gap-2 border-0 bg-[oklch(0.615_0.165_30)] text-white shadow-sm hover:bg-[oklch(0.56_0.15_30)] hover:text-white'>
                                {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                                {isLoading ? t('generate.loading') : t('generate.submit')}
                            </Button>
                            {canPauseBatch && (
                                <Button
                                    type='button'
                                    variant='outline'
                                    onClick={() => onPauseBatch?.()}
                                    disabled={isBatchPauseRequested}
                                    title={t('batch.pauseHint')}
                                    className='bg-background/80 min-h-10 gap-2 px-3'>
                                    {isBatchPauseRequested ? (
                                        <Loader2 className='h-4 w-4 animate-spin' />
                                    ) : (
                                        <Pause className='h-4 w-4' />
                                    )}
                                    <span className='whitespace-nowrap'>
                                        {isBatchPauseRequested ? t('batch.pauseRequested') : t('batch.pause')}
                                    </span>
                                </Button>
                            )}
                        </div>
                        {canPauseBatch && (
                            <p className='text-muted-foreground text-center text-xs'>{t('batch.pauseHint')}</p>
                        )}
                        <div className='grid grid-cols-2 gap-2'>
                            <button
                                type='button'
                                className='border-border bg-background/70 text-muted-foreground hover:border-primary/25 hover:bg-accent/45 hover:text-foreground flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-xs transition-[background-color,border-color,color,transform] enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:opacity-50 lg:min-h-9'
                                disabled={footerPromptTarget.isEmpty || isLoading}
                                onClick={() => onSaveInspiration(footerPromptTarget.value)}>
                                <Bookmark className='h-3.5 w-3.5' />
                                {t('workbench.saveInspiration')}
                            </button>
                            <button
                                type='button'
                                className='border-border bg-background/70 text-muted-foreground hover:border-primary/25 hover:bg-accent/45 hover:text-foreground flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-xs transition-[background-color,border-color,color,transform] enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:opacity-50 lg:min-h-9'
                                disabled={isLoading || !canApplyRandomInspiration}
                                onClick={() => {
                                    const nextPrompt = onPickRandomInspiration().trim();
                                    if (!nextPrompt) return;
                                    if (currentMode === 'batch') {
                                        setBatchPromptText(nextPrompt);
                                        return;
                                    }
                                    setPrompt(nextPrompt);
                                }}>
                                <WandSparkles className='h-3.5 w-3.5' />
                                {t('workbench.randomInspiration')}
                            </button>
                        </div>
                    </div>
                </CardFooter>
            </div>
        </Card>
    );
}
