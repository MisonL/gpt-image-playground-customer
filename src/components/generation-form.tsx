'use client';

import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { GptImageModel } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import { getPresetTooltip, validateGptImage2Size } from '@/lib/size-utils';
import type { SizePreset } from '@/lib/size-utils';
import {
    Square,
    RectangleHorizontal,
    RectangleVertical,
    Sparkles,
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
    SquareDashed
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
};

type GenerationFormProps = {
    onSubmit: (data: GenerationFormData) => void;
    isLoading: boolean;
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
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
    enableStreaming: boolean;
    setEnableStreaming: React.Dispatch<React.SetStateAction<boolean>>;
    allowStreamingBatch: boolean;
    partialImages: 1 | 2 | 3;
    setPartialImages: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
};

const RadioItemWithIcon = ({
    value,
    id,
    label,
    Icon,
    disabled = false
}: {
    value: string;
    id: string;
    label: string;
    Icon: React.ElementType;
    disabled?: boolean;
}) => (
    <div className='flex items-center space-x-2'>
        <RadioGroupItem
            value={value}
            id={id}
            className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
        />
        <Label
            htmlFor={id}
            className={`flex items-center gap-2 text-base ${disabled ? 'cursor-not-allowed text-white/40' : 'cursor-pointer text-white/80'}`}>
            <Icon className='h-5 w-5 text-white/60' />
            {label}
        </Label>
    </div>
);

export function GenerationForm({
    onSubmit,
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
    enableStreaming,
    setEnableStreaming,
    allowStreamingBatch,
    partialImages,
    setPartialImages
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

    const streamingDisabledByCount = n[0] > 1 && !allowStreamingBatch;

    // 未显式开启批量流式分发时，n > 1 会禁用流式输出。
    React.useEffect(() => {
        if (streamingDisabledByCount && enableStreaming) {
            setEnableStreaming(false);
        }
    }, [streamingDisabledByCount, enableStreaming, setEnableStreaming]);

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
            model
        };
        if (showCompression) {
            formData.output_compression = compression[0];
        }
        onSubmit(formData);
    };

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black'>
            <CardHeader className='flex items-start justify-between border-b border-white/10 pb-4'>
                <div>
                    <div className='flex items-center'>
                        <CardTitle className='py-1 text-lg font-medium text-white'>{t('generate.title')}</CardTitle>
                        {isPasswordRequiredByBackend && (
                            <Button
                                variant='ghost'
                                size='icon'
                                onClick={onOpenPasswordDialog}
                                className='ml-2 text-white/60 hover:text-white'
                                aria-label={t('password.configure')}>
                                {clientPasswordHash ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
                            </Button>
                        )}
                    </div>
                    <CardDescription className='mt-1 text-white/60'>{t('generate.description')}</CardDescription>
                </div>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <div className='flex h-full flex-1 flex-col overflow-hidden'>
                <CardContent className='flex-1 space-y-5 overflow-y-auto p-4'>
                    <div className='space-y-1.5'>
                        <Label htmlFor='model-select' className='text-white'>
                            {t('form.model')}
                        </Label>
                        <div className='flex items-center gap-4'>
                            <Select
                                value={model}
                                onValueChange={(value) => setModel(value as GenerationFormData['model'])}
                                disabled={isLoading}
                                name='model'>
                                <SelectTrigger
                                    id='model-select'
                                    className='w-[180px] rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'>
                                    <SelectValue placeholder={t('form.selectModel')} />
                                </SelectTrigger>
                                <SelectContent className='border-white/20 bg-black text-white'>
                                    <SelectItem value='gpt-image-2' className='focus:bg-white/10'>
                                        gpt-image-2
                                    </SelectItem>
                                    <SelectItem value='gpt-image-1.5' className='focus:bg-white/10'>
                                        gpt-image-1.5
                                    </SelectItem>
                                    <SelectItem value='gpt-image-1' className='focus:bg-white/10'>
                                        gpt-image-1
                                    </SelectItem>
                                    <SelectItem value='gpt-image-1-mini' className='focus:bg-white/10'>
                                        gpt-image-1-mini
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className='flex items-center gap-2'>
                                        <Checkbox
                                            id='enable-streaming'
                                            name='enable-streaming'
                                            checked={enableStreaming}
                                            onCheckedChange={(checked) => setEnableStreaming(!!checked)}
                                            disabled={isLoading || streamingDisabledByCount}
                                            className='border-white/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-black'
                                        />
                                        <Label
                                            htmlFor='enable-streaming'
                                            className={`text-sm ${streamingDisabledByCount ? 'cursor-not-allowed text-white/40' : 'cursor-pointer text-white/80'}`}>
                                            {t('streaming.enable')}
                                        </Label>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className='max-w-[250px]'>
                                    {streamingDisabledByCount
                                        ? t('streaming.disabledByCount')
                                        : allowStreamingBatch && n[0] > 1
                                          ? t('streaming.batchDescription')
                                          : t('streaming.description')}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </div>

                    {enableStreaming && (
                        <div className='space-y-3'>
                            <div className='flex items-center gap-2'>
                                <div className='flex items-center gap-2 text-sm leading-none font-medium text-white select-none'>
                                    {t('streaming.previewImages')}
                                </div>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <HelpCircle className='h-4 w-4 cursor-help text-white/40 hover:text-white/60' />
                                    </TooltipTrigger>
                                    <TooltipContent className='max-w-[250px]'>{t('streaming.costHint')}</TooltipContent>
                                </Tooltip>
                            </div>
                            <RadioGroup
                                value={String(partialImages)}
                                onValueChange={(value) => setPartialImages(Number(value) as 1 | 2 | 3)}
                                disabled={isLoading}
                                name='partial_images'
                                aria-label={t('streaming.previewImages')}
                                className='flex gap-x-5'>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='1'
                                        id='partial-1'
                                        className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
                                    />
                                    <Label htmlFor='partial-1' className='cursor-pointer text-white/80'>
                                        1
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='2'
                                        id='partial-2'
                                        className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
                                    />
                                    <Label htmlFor='partial-2' className='cursor-pointer text-white/80'>
                                        2
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='3'
                                        id='partial-3'
                                        className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
                                    />
                                    <Label htmlFor='partial-3' className='cursor-pointer text-white/80'>
                                        3
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                    )}

                    <div className='space-y-1.5'>
                        <Label htmlFor='prompt' className='text-white'>
                            {t('form.prompt')}
                        </Label>
                        <Textarea
                            id='prompt'
                            placeholder={t('form.promptPlaceholder')}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            required
                            disabled={isLoading}
                            className='min-h-[80px] rounded-md border border-white/20 bg-black text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/50'
                        />
                    </div>

                    <div className='space-y-2'>
                        <div className='flex items-center gap-2 text-sm leading-none font-medium text-white select-none'>
                            {t('form.numberOfImages', { count: n[0] })}
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
                            className='mt-3 [&>button]:border-black [&>button]:bg-white [&>button]:ring-offset-black [&>span:first-child]:h-1 [&>span:first-child>span]:bg-white'
                        />
                    </div>

                    <div className='space-y-3'>
                        <div className='block text-sm leading-none font-medium text-white select-none'>
                            {t('form.size')}
                        </div>
                        <RadioGroup
                            value={size}
                            onValueChange={(value) => setSize(value as GenerationFormData['size'])}
                            disabled={isLoading}
                            name='size'
                            aria-label={t('form.size')}
                            className='flex flex-wrap gap-x-5 gap-y-3'>
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
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='square'
                                            id='size-square'
                                            label={t('common.square')}
                                            Icon={Square}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('square', model)}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='landscape'
                                            id='size-landscape'
                                            label={t('common.landscape')}
                                            Icon={RectangleHorizontal}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('landscape', model)}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='portrait'
                                            id='size-portrait'
                                            label={t('common.portrait')}
                                            Icon={RectangleVertical}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('portrait', model)}</TooltipContent>
                            </Tooltip>
                        </RadioGroup>
                        {isGptImage2 && size === 'custom' && (
                            <div className='space-y-2 rounded-md border border-white/10 bg-white/5 p-3'>
                                <div className='flex items-center gap-3'>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='custom-width' className='text-xs text-white/70'>
                                            {t('form.width')}
                                        </Label>
                                        <Input
                                            id='custom-width'
                                            type='number'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={customWidth}
                                            onChange={(e) => setCustomWidth(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                            className='rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'
                                        />
                                    </div>
                                    <span className='pt-5 text-white/60'>x</span>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='custom-height' className='text-xs text-white/70'>
                                            {t('form.height')}
                                        </Label>
                                        <Input
                                            id='custom-height'
                                            type='number'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={customHeight}
                                            onChange={(e) => setCustomHeight(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                            className='rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'
                                        />
                                    </div>
                                </div>
                                <p className='text-xs text-white/50'>
                                    {t('form.pixelsMeta', {
                                        pixels: customPixels.toLocaleString(locale),
                                        percent: ((customPixels / 8_294_400) * 100).toFixed(1),
                                        ratio: customRatio
                                    })}
                                </p>
                                {customSizeError && <p className='text-xs text-red-400'>{customSizeError}</p>}
                                <p className='text-xs text-white/40'>{t('form.customConstraints')}</p>
                            </div>
                        )}
                    </div>

                    <div className='space-y-3'>
                        <div className='block text-sm leading-none font-medium text-white select-none'>
                            {t('form.quality')}
                        </div>
                        <RadioGroup
                            value={quality}
                            onValueChange={(value) => setQuality(value as GenerationFormData['quality'])}
                            disabled={isLoading}
                            name='quality'
                            aria-label={t('form.quality')}
                            className='flex flex-wrap gap-x-5 gap-y-3'>
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
                            <div className='block text-sm leading-none font-medium text-white select-none'>
                                {t('form.background')}
                            </div>
                            <RadioGroup
                                value={background}
                                onValueChange={(value) => setBackground(value as GenerationFormData['background'])}
                                disabled={isLoading}
                                name='background'
                                aria-label={t('form.background')}
                                className='flex flex-wrap gap-x-5 gap-y-3'>
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
                        <div className='block text-sm leading-none font-medium text-white select-none'>
                            {t('form.outputFormat')}
                        </div>
                        <RadioGroup
                            value={outputFormat}
                            onValueChange={(value) => setOutputFormat(value as GenerationFormData['output_format'])}
                            disabled={isLoading}
                            name='output_format'
                            aria-label={t('form.outputFormat')}
                            className='flex flex-wrap gap-x-5 gap-y-3'>
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
                            <div className='flex items-center gap-2 text-sm leading-none font-medium text-white select-none'>
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
                                className='mt-3 [&>button]:border-black [&>button]:bg-white [&>button]:ring-offset-black [&>span:first-child]:h-1 [&>span:first-child>span]:bg-white'
                            />
                        </div>
                    )}

                    <div className='space-y-3'>
                        <div className='block text-sm leading-none font-medium text-white select-none'>
                            {t('form.moderation')}
                        </div>
                        <RadioGroup
                            value={moderation}
                            onValueChange={(value) => setModeration(value as GenerationFormData['moderation'])}
                            disabled={isLoading}
                            name='moderation'
                            aria-label={t('form.moderation')}
                            className='flex flex-wrap gap-x-5 gap-y-3'>
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
                </CardContent>
                <CardFooter className='border-t border-white/10 p-4'>
                    <Button
                        type='button'
                        onClick={handleSubmit}
                        disabled={isLoading || !prompt || customSizeInvalid}
                        className='flex w-full items-center justify-center gap-2 rounded-md bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/40'>
                        {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                        {isLoading ? t('generate.loading') : t('generate.submit')}
                    </Button>
                </CardFooter>
            </div>
        </Card>
    );
}
