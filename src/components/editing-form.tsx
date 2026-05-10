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
    Upload,
    Eraser,
    Save,
    Square,
    RectangleHorizontal,
    RectangleVertical,
    Sparkles,
    Tally1,
    Tally2,
    Tally3,
    Loader2,
    X,
    ScanEye,
    UploadCloud,
    Lock,
    LockOpen,
    HelpCircle,
    SquareDashed,
    Info
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

export type EditingFormData = {
    prompt: string;
    n: number;
    size: SizePreset;
    customWidth: number;
    customHeight: number;
    quality: 'low' | 'medium' | 'high' | 'auto';
    imageFiles: File[];
    maskFile: File | null;
    model: GptImageModel;
};

type EditingFormProps = {
    onSubmit: (data: EditingFormData) => void;
    isLoading: boolean;
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    editModel: EditingFormData['model'];
    setEditModel: React.Dispatch<React.SetStateAction<EditingFormData['model']>>;
    imageFiles: File[];
    sourceImagePreviewUrls: string[];
    setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
    setSourceImagePreviewUrls: React.Dispatch<React.SetStateAction<string[]>>;
    maxImages: number;
    editPrompt: string;
    setEditPrompt: React.Dispatch<React.SetStateAction<string>>;
    editN: number[];
    setEditN: React.Dispatch<React.SetStateAction<number[]>>;
    editSize: EditingFormData['size'];
    setEditSize: React.Dispatch<React.SetStateAction<EditingFormData['size']>>;
    editCustomWidth: number;
    setEditCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    editCustomHeight: number;
    setEditCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    editQuality: EditingFormData['quality'];
    setEditQuality: React.Dispatch<React.SetStateAction<EditingFormData['quality']>>;
    editBrushSize: number[];
    setEditBrushSize: React.Dispatch<React.SetStateAction<number[]>>;
    editShowMaskEditor: boolean;
    setEditShowMaskEditor: React.Dispatch<React.SetStateAction<boolean>>;
    editGeneratedMaskFile: File | null;
    setEditGeneratedMaskFile: React.Dispatch<React.SetStateAction<File | null>>;
    editIsMaskSaved: boolean;
    setEditIsMaskSaved: React.Dispatch<React.SetStateAction<boolean>>;
    editOriginalImageSize: { width: number; height: number } | null;
    setEditOriginalImageSize: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
    editDrawnPoints: DrawnPoint[];
    setEditDrawnPoints: React.Dispatch<React.SetStateAction<DrawnPoint[]>>;
    editMaskPreviewUrl: string | null;
    setEditMaskPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
    enableStreaming: boolean;
    setEnableStreaming: React.Dispatch<React.SetStateAction<boolean>>;
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

export function EditingForm({
    onSubmit,
    isLoading,
    currentMode,
    onModeChange,
    isPasswordRequiredByBackend,
    clientPasswordHash,
    onOpenPasswordDialog,
    editModel,
    setEditModel,
    imageFiles,
    sourceImagePreviewUrls,
    setImageFiles,
    setSourceImagePreviewUrls,
    maxImages,
    editPrompt,
    setEditPrompt,
    editN,
    setEditN,
    editSize,
    setEditSize,
    editCustomWidth,
    setEditCustomWidth,
    editCustomHeight,
    setEditCustomHeight,
    editQuality,
    setEditQuality,
    editBrushSize,
    setEditBrushSize,
    editShowMaskEditor,
    setEditShowMaskEditor,
    editGeneratedMaskFile,
    setEditGeneratedMaskFile,
    editIsMaskSaved,
    setEditIsMaskSaved,
    editOriginalImageSize,
    setEditOriginalImageSize,
    editDrawnPoints,
    setEditDrawnPoints,
    editMaskPreviewUrl,
    setEditMaskPreviewUrl,
    enableStreaming,
    setEnableStreaming,
    partialImages,
    setPartialImages
}: EditingFormProps) {
    const { locale, t } = useI18n();
    const [firstImagePreviewUrl, setFirstImagePreviewUrl] = React.useState<string | null>(null);

    const isGptImage2 = editModel === 'gpt-image-2';
    const customSizeValidation =
        editSize === 'custom' ? validateGptImage2Size(editCustomWidth, editCustomHeight) : { valid: true as const };
    const customSizeInvalid = editSize === 'custom' && !customSizeValidation.valid;
    const editCustomPixels = editCustomWidth * editCustomHeight;
    const editCustomRatio =
        editCustomWidth > 0 && editCustomHeight > 0
            ? t('form.ratio', {
                  ratio: (
                      Math.max(editCustomWidth, editCustomHeight) / Math.min(editCustomWidth, editCustomHeight)
                  ).toFixed(2)
              })
            : t('form.noRatio');
    const editCustomSizeError = customSizeValidation.valid
        ? null
        : t(customSizeValidation.reasonKey, customSizeValidation.values);

    // Disable streaming when editN > 1 (OpenAI limitation)
    React.useEffect(() => {
        if (editN[0] > 1 && enableStreaming) {
            setEnableStreaming(false);
        }
    }, [editN, enableStreaming, setEnableStreaming]);

    // 'custom' is only valid on gpt-image-2; reset when switching to a legacy model
    React.useEffect(() => {
        if (!isGptImage2 && editSize === 'custom') {
            setEditSize('auto');
        }
    }, [isGptImage2, editSize, setEditSize]);

    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const visualFeedbackCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const isDrawing = React.useRef(false);
    const lastPos = React.useRef<{ x: number; y: number } | null>(null);
    const maskInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (editOriginalImageSize) {
            if (!visualFeedbackCanvasRef.current) {
                visualFeedbackCanvasRef.current = document.createElement('canvas');
            }
            visualFeedbackCanvasRef.current.width = editOriginalImageSize.width;
            visualFeedbackCanvasRef.current.height = editOriginalImageSize.height;
        }
    }, [editOriginalImageSize]);

    React.useEffect(() => {
        queueMicrotask(() => {
            setEditGeneratedMaskFile(null);
            setEditIsMaskSaved(false);
            setEditOriginalImageSize(null);
            setFirstImagePreviewUrl(null);
            setEditDrawnPoints([]);
            setEditMaskPreviewUrl(null);
        });

        if (imageFiles.length > 0 && sourceImagePreviewUrls.length > 0) {
            const img = new window.Image();
            img.onload = () => {
                setEditOriginalImageSize({ width: img.width, height: img.height });
            };
            img.src = sourceImagePreviewUrls[0];
            queueMicrotask(() => {
                setFirstImagePreviewUrl(sourceImagePreviewUrls[0]);
            });
        } else {
            queueMicrotask(() => {
                setEditShowMaskEditor(false);
            });
        }
    }, [
        imageFiles,
        sourceImagePreviewUrls,
        setEditGeneratedMaskFile,
        setEditIsMaskSaved,
        setEditOriginalImageSize,
        setEditDrawnPoints,
        setEditMaskPreviewUrl,
        setEditShowMaskEditor
    ]);

    React.useEffect(() => {
        const displayCtx = canvasRef.current?.getContext('2d');
        const displayCanvas = canvasRef.current;
        const feedbackCanvas = visualFeedbackCanvasRef.current;

        if (!displayCtx || !displayCanvas || !feedbackCanvas || !editOriginalImageSize) return;

        const feedbackCtx = feedbackCanvas.getContext('2d');
        if (!feedbackCtx) return;

        feedbackCtx.clearRect(0, 0, feedbackCanvas.width, feedbackCanvas.height);
        feedbackCtx.fillStyle = 'red';
        editDrawnPoints.forEach((point) => {
            feedbackCtx.beginPath();
            feedbackCtx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
            feedbackCtx.fill();
        });

        displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.save();
        displayCtx.globalAlpha = 0.5;
        displayCtx.drawImage(feedbackCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.restore();
    }, [editDrawnPoints, editOriginalImageSize]);

    const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const addPoint = (x: number, y: number) => {
        setEditDrawnPoints((prevPoints) => [...prevPoints, { x, y, size: editBrushSize[0] }]);
        setEditIsMaskSaved(false);
        setEditMaskPreviewUrl(null);
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        isDrawing.current = true;
        const currentPos = getMousePos(e);
        if (!currentPos) return;
        lastPos.current = currentPos;
        addPoint(currentPos.x, currentPos.y);
    };

    const drawLine = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const currentPos = getMousePos(e);
        if (!currentPos || !lastPos.current) return;

        const dist = Math.hypot(currentPos.x - lastPos.current.x, currentPos.y - lastPos.current.y);
        const angle = Math.atan2(currentPos.y - lastPos.current.y, currentPos.x - lastPos.current.x);
        const step = Math.max(1, editBrushSize[0] / 4);

        for (let i = step; i < dist; i += step) {
            const x = lastPos.current.x + Math.cos(angle) * i;
            const y = lastPos.current.y + Math.sin(angle) * i;
            addPoint(x, y);
        }
        addPoint(currentPos.x, currentPos.y);

        lastPos.current = currentPos;
    };

    const drawMaskStroke = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    };

    const stopDrawing = () => {
        isDrawing.current = false;
        lastPos.current = null;
    };

    const handleClearMask = () => {
        setEditDrawnPoints([]);
        setEditGeneratedMaskFile(null);
        setEditIsMaskSaved(false);
        setEditMaskPreviewUrl(null);
    };

    const generateAndSaveMask = () => {
        if (!editOriginalImageSize || editDrawnPoints.length === 0) {
            setEditGeneratedMaskFile(null);
            setEditIsMaskSaved(false);
            setEditMaskPreviewUrl(null);
            return;
        }

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = editOriginalImageSize.width;
        offscreenCanvas.height = editOriginalImageSize.height;
        const offscreenCtx = offscreenCanvas.getContext('2d');

        if (!offscreenCtx) return;

        offscreenCtx.fillStyle = '#000000';
        offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        offscreenCtx.globalCompositeOperation = 'destination-out';
        editDrawnPoints.forEach((point) => {
            drawMaskStroke(offscreenCtx, point.x, point.y, point.size);
        });

        try {
            const dataUrl = offscreenCanvas.toDataURL('image/png');
            setEditMaskPreviewUrl(dataUrl);
        } catch (e) {
            console.error('Error generating mask preview data URL:', e);
            setEditMaskPreviewUrl(null);
        }

        offscreenCanvas.toBlob((blob) => {
            if (blob) {
                const maskFile = new File([blob], 'generated-mask.png', { type: 'image/png' });
                setEditGeneratedMaskFile(maskFile);
                setEditIsMaskSaved(true);
            } else {
                console.error('Failed to generate mask blob.');
                setEditIsMaskSaved(false);
                setEditMaskPreviewUrl(null);
            }
        }, 'image/png');
    };

    const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const newFiles = Array.from(event.target.files);
            const totalFiles = imageFiles.length + newFiles.length;

            if (totalFiles > maxImages) {
                alert(t('alert.maxImages', { count: maxImages }));
                const allowedNewFiles = newFiles.slice(0, maxImages - imageFiles.length);
                if (allowedNewFiles.length === 0) {
                    event.target.value = '';
                    return;
                }
                newFiles.splice(allowedNewFiles.length);
            }

            setImageFiles((prevFiles) => [...prevFiles, ...newFiles]);

            const newFilePromises = newFiles.map((file) => {
                return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            });

            Promise.all(newFilePromises)
                .then((newUrls) => {
                    setSourceImagePreviewUrls((prevUrls) => [...prevUrls, ...newUrls]);
                })
                .catch((error) => {
                    console.error('Error reading new image files:', error);
                });

            event.target.value = '';
        }
    };

    const handleRemoveImage = (indexToRemove: number) => {
        setImageFiles((prevFiles) => prevFiles.filter((_, index) => index !== indexToRemove));
        setSourceImagePreviewUrls((prevUrls) => prevUrls.filter((_, index) => index !== indexToRemove));
    };

    const handleMaskFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !editOriginalImageSize) {
            event.target.value = '';
            return;
        }

        if (file.type !== 'image/png') {
            alert(t('alert.maskInvalidType'));
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        const img = new window.Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            if (img.width !== editOriginalImageSize.width || img.height !== editOriginalImageSize.height) {
                alert(
                    t('alert.maskDimensionMismatch', {
                        actual: `${img.width}x${img.height}`,
                        expected: `${editOriginalImageSize.width}x${editOriginalImageSize.height}`
                    })
                );
                URL.revokeObjectURL(objectUrl);
                event.target.value = '';
                return;
            }

            setEditGeneratedMaskFile(file);
            setEditIsMaskSaved(true);
            setEditDrawnPoints([]);

            reader.onloadend = () => {
                setEditMaskPreviewUrl(reader.result as string);
                URL.revokeObjectURL(objectUrl);
            };
            reader.onerror = () => {
                console.error('Error reading mask file for preview.');
                setEditMaskPreviewUrl(null);
                URL.revokeObjectURL(objectUrl);
            };
            reader.readAsDataURL(file);

            event.target.value = '';
        };

        img.onerror = () => {
            alert(t('alert.maskLoadFailed'));
            URL.revokeObjectURL(objectUrl);
            event.target.value = '';
        };

        img.src = objectUrl;
    };

    const handleSubmit = () => {
        if (imageFiles.length === 0) {
            alert(t('alert.editNoImage'));
            return;
        }
        if (editDrawnPoints.length > 0 && !editGeneratedMaskFile && !editIsMaskSaved) {
            alert(t('alert.saveMaskBeforeSubmit'));
            return;
        }
        if (customSizeInvalid) {
            return;
        }

        const formData: EditingFormData = {
            prompt: editPrompt,
            n: editN[0],
            size: editSize,
            customWidth: editCustomWidth,
            customHeight: editCustomHeight,
            quality: editQuality,
            imageFiles: imageFiles,
            maskFile: editGeneratedMaskFile,
            model: editModel
        };
        onSubmit(formData);
    };

    const displayFileNames = (files: File[]) => {
        if (files.length === 0) return t('edit.noFile');
        if (files.length === 1) return files[0].name;
        return t('edit.filesSelected', { count: files.length });
    };

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black'>
            <CardHeader className='flex items-start justify-between border-b border-white/10 pb-4'>
                <div>
                    <div className='flex items-center'>
                        <CardTitle className='py-1 text-lg font-medium text-white'>{t('edit.title')}</CardTitle>
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
                    <CardDescription className='mt-1 text-white/60'>{t('edit.description')}</CardDescription>
                </div>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <div className='flex h-full flex-1 flex-col overflow-hidden'>
                <CardContent className='flex-1 space-y-5 overflow-y-auto p-4'>
                    <div className='space-y-1.5'>
                        <Label htmlFor='edit-model-select' className='text-white'>
                            {t('form.model')}
                        </Label>
                        <div className='flex items-center gap-4'>
                            <Select
                                value={editModel}
                                onValueChange={(value) => setEditModel(value as EditingFormData['model'])}
                                disabled={isLoading}
                                name='edit-model'>
                                <SelectTrigger
                                    id='edit-model-select'
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
                            {isGptImage2 && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Info className='h-4 w-4 cursor-help text-white/40 hover:text-white/60' />
                                    </TooltipTrigger>
                                    <TooltipContent className='max-w-[280px]'>{t('edit.fidelityHint')}</TooltipContent>
                                </Tooltip>
                            )}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className='flex items-center gap-2'>
                                        <Checkbox
                                            id='edit-enable-streaming'
                                            name='edit-enable-streaming'
                                            checked={enableStreaming}
                                            onCheckedChange={(checked) => setEnableStreaming(!!checked)}
                                            disabled={isLoading || editN[0] > 1}
                                            className='border-white/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-black'
                                        />
                                        <Label
                                            htmlFor='edit-enable-streaming'
                                            className={`text-sm ${editN[0] > 1 ? 'cursor-not-allowed text-white/40' : 'cursor-pointer text-white/80'}`}>
                                            {t('streaming.enable')}
                                        </Label>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className='max-w-[250px]'>
                                    {editN[0] > 1 ? t('streaming.disabledByCount') : t('streaming.description')}
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
                                name='edit-partial_images'
                                aria-label={t('streaming.previewImages')}
                                className='flex gap-x-5'>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='1'
                                        id='edit-partial-1'
                                        className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
                                    />
                                    <Label htmlFor='edit-partial-1' className='cursor-pointer text-white/80'>
                                        1
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='2'
                                        id='edit-partial-2'
                                        className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
                                    />
                                    <Label htmlFor='edit-partial-2' className='cursor-pointer text-white/80'>
                                        2
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='3'
                                        id='edit-partial-3'
                                        className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
                                    />
                                    <Label htmlFor='edit-partial-3' className='cursor-pointer text-white/80'>
                                        3
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                    )}

                    <div className='space-y-1.5'>
                        <Label htmlFor='edit-prompt' className='text-white'>
                            {t('form.prompt')}
                        </Label>
                        <Textarea
                            id='edit-prompt'
                            placeholder={t('form.editPromptPlaceholder')}
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            required
                            disabled={isLoading}
                            className='min-h-[80px] rounded-md border border-white/20 bg-black text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/50'
                        />
                    </div>

                    <div className='space-y-2'>
                        <div className='flex items-center gap-2 text-sm leading-none font-medium text-white select-none'>
                            {t('edit.sourceImages', { count: maxImages })}
                        </div>
                        <Label
                            htmlFor='image-files-input'
                            className='flex h-10 w-full cursor-pointer items-center justify-between rounded-md border border-white/20 bg-black px-3 py-2 text-sm transition-colors hover:bg-white/5'>
                            <span className='truncate pr-2 text-white/60'>{displayFileNames(imageFiles)}</span>
                            <span className='flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/20'>
                                <Upload className='h-3 w-3' /> {t('edit.browse')}
                            </span>
                        </Label>
                        <Input
                            id='image-files-input'
                            type='file'
                            accept='image/png, image/jpeg, image/webp'
                            multiple
                            onChange={handleImageFileChange}
                            disabled={isLoading || imageFiles.length >= maxImages}
                            className='sr-only'
                        />
                        {sourceImagePreviewUrls.length > 0 && (
                            <div className='flex space-x-2 overflow-x-auto pt-2'>
                                {sourceImagePreviewUrls.map((url, index) => (
                                    <div key={url} className='relative shrink-0'>
                                        <Image
                                            src={url}
                                            alt={t('edit.sourcePreview', { index: index + 1 })}
                                            width={80}
                                            height={80}
                                            className='rounded border border-white/10 object-cover'
                                            unoptimized
                                        />
                                        <Button
                                            type='button'
                                            variant='destructive'
                                            size='icon'
                                            className='absolute top-0 right-0 h-5 w-5 translate-x-1/3 -translate-y-1/3 transform rounded-full bg-red-600 p-0.5 text-white hover:bg-red-700'
                                            onClick={() => handleRemoveImage(index)}
                                            aria-label={t('edit.removeImage', { index: index + 1 })}>
                                            <X className='h-3 w-3' />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className='space-y-3'>
                        <div className='block text-sm leading-none font-medium text-white select-none'>
                            {t('edit.mask')}
                        </div>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setEditShowMaskEditor(!editShowMaskEditor)}
                            disabled={isLoading || !editOriginalImageSize}
                            className='w-full justify-start border-white/20 px-3 text-white/80 hover:bg-white/10 hover:text-white'>
                            {editShowMaskEditor
                                ? t('edit.closeMaskEditor')
                                : editGeneratedMaskFile
                                  ? t('edit.editSavedMask')
                                  : t('edit.createMask')}
                            {editIsMaskSaved && !editShowMaskEditor && (
                                <span className='ml-auto text-xs text-green-400'>({t('common.saved')})</span>
                            )}
                            <ScanEye className='mt-0.5' />
                        </Button>

                        {editShowMaskEditor && firstImagePreviewUrl && editOriginalImageSize && (
                            <div className='space-y-3 rounded-md border border-white/20 bg-black p-3'>
                                <p className='text-xs text-white/60'>{t('edit.drawMaskHint')}</p>
                                <div
                                    className='relative mx-auto w-full overflow-hidden rounded border border-white/10'
                                    style={{
                                        maxWidth: `min(100%, ${editOriginalImageSize.width}px)`,
                                        aspectRatio: `${editOriginalImageSize.width} / ${editOriginalImageSize.height}`
                                    }}>
                                    <Image
                                        src={firstImagePreviewUrl}
                                        alt={t('edit.imagePreviewForMasking')}
                                        width={editOriginalImageSize.width}
                                        height={editOriginalImageSize.height}
                                        className='block h-auto w-full'
                                        unoptimized
                                    />
                                    <canvas
                                        ref={canvasRef}
                                        width={editOriginalImageSize.width}
                                        height={editOriginalImageSize.height}
                                        className='absolute top-0 left-0 h-full w-full cursor-crosshair'
                                        onMouseDown={startDrawing}
                                        onMouseMove={drawLine}
                                        onMouseUp={stopDrawing}
                                        onMouseLeave={stopDrawing}
                                        onTouchStart={startDrawing}
                                        onTouchMove={drawLine}
                                        onTouchEnd={stopDrawing}
                                    />
                                </div>
                                <div className='grid grid-cols-1 gap-4 pt-2'>
                                    <div className='space-y-2'>
                                        <div className='flex items-center gap-2 text-sm leading-none font-medium text-white select-none'>
                                            {t('edit.brushSize', { value: editBrushSize[0] })}
                                        </div>
                                        <Slider
                                            id='brush-size-slider'
                                            name='brush-size'
                                            thumbLabel={t('edit.brushSizeLabel')}
                                            min={5}
                                            max={100}
                                            step={1}
                                            value={editBrushSize}
                                            onValueChange={setEditBrushSize}
                                            disabled={isLoading}
                                            className='mt-1 [&>button]:border-black [&>button]:bg-white [&>button]:ring-offset-black [&>span:first-child]:h-1 [&>span:first-child>span]:bg-white'
                                        />
                                    </div>
                                </div>
                                <div className='flex items-center justify-between gap-2 pt-3'>
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='sm'
                                        onClick={() => maskInputRef.current?.click()}
                                        disabled={isLoading || !editOriginalImageSize}
                                        className='mr-auto border-white/20 text-white/80 hover:bg-white/10 hover:text-white'>
                                        <UploadCloud className='mr-1.5 h-4 w-4' /> {t('edit.uploadMask')}
                                    </Button>
                                    <Input
                                        ref={maskInputRef}
                                        id='mask-file-input'
                                        type='file'
                                        accept='image/png'
                                        onChange={handleMaskFileChange}
                                        className='sr-only'
                                    />
                                    <div className='flex gap-2'>
                                        <Button
                                            type='button'
                                            variant='outline'
                                            size='sm'
                                            onClick={handleClearMask}
                                            disabled={isLoading}
                                            className='border-white/20 text-white/80 hover:bg-white/10 hover:text-white'>
                                            <Eraser className='mr-1.5 h-4 w-4' /> {t('edit.clearMask')}
                                        </Button>
                                        <Button
                                            type='button'
                                            variant='default'
                                            size='sm'
                                            onClick={generateAndSaveMask}
                                            disabled={isLoading || editDrawnPoints.length === 0}
                                            className='bg-white text-black hover:bg-white/90 disabled:opacity-50'>
                                            <Save className='mr-1.5 h-4 w-4' /> {t('edit.saveMask')}
                                        </Button>
                                    </div>
                                </div>
                                {editMaskPreviewUrl && (
                                    <div className='mt-3 border-t border-white/10 pt-3 text-center'>
                                        <div className='mb-1.5 block text-sm leading-none font-medium text-white select-none'>
                                            {t('edit.maskPreview')}
                                        </div>
                                        <div className='inline-block rounded border border-gray-300 bg-white p-1'>
                                            <Image
                                                src={editMaskPreviewUrl}
                                                alt={t('edit.generatedMaskPreviewAlt')}
                                                width={0}
                                                height={134}
                                                className='block max-w-full'
                                                style={{ width: 'auto', height: '134px' }}
                                                unoptimized
                                            />
                                        </div>
                                    </div>
                                )}
                                {editIsMaskSaved && !editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-yellow-400'>
                                        {t('edit.maskPreviewLoading')}
                                    </p>
                                )}
                                {editIsMaskSaved && editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-green-400'>{t('edit.maskSaved')}</p>
                                )}
                            </div>
                        )}
                        {!editShowMaskEditor && editGeneratedMaskFile && (
                            <p className='pt-1 text-xs text-green-400'>
                                {t('edit.maskApplied', { name: editGeneratedMaskFile.name })}
                            </p>
                        )}
                    </div>

                    <div className='space-y-3'>
                        <div className='block text-sm leading-none font-medium text-white select-none'>
                            {t('form.size')}
                        </div>
                        <RadioGroup
                            value={editSize}
                            onValueChange={(value) => setEditSize(value as EditingFormData['size'])}
                            disabled={isLoading}
                            name='edit-size'
                            aria-label={t('form.size')}
                            className='flex flex-wrap gap-x-5 gap-y-3'>
                            <RadioItemWithIcon
                                value='auto'
                                id='edit-size-auto'
                                label={t('common.auto')}
                                Icon={Sparkles}
                                disabled={isLoading}
                            />
                            {isGptImage2 && (
                                <RadioItemWithIcon
                                    value='custom'
                                    id='edit-size-custom'
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
                                            id='edit-size-square'
                                            label={t('common.square')}
                                            Icon={Square}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('square', editModel)}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='landscape'
                                            id='edit-size-landscape'
                                            label={t('common.landscape')}
                                            Icon={RectangleHorizontal}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('landscape', editModel)}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='portrait'
                                            id='edit-size-portrait'
                                            label={t('common.portrait')}
                                            Icon={RectangleVertical}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('portrait', editModel)}</TooltipContent>
                            </Tooltip>
                        </RadioGroup>
                        {isGptImage2 && editSize === 'custom' && (
                            <div className='space-y-2 rounded-md border border-white/10 bg-white/5 p-3'>
                                <div className='flex items-center gap-3'>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='edit-custom-width' className='text-xs text-white/70'>
                                            {t('form.width')}
                                        </Label>
                                        <Input
                                            id='edit-custom-width'
                                            type='number'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={editCustomWidth}
                                            onChange={(e) => setEditCustomWidth(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                            className='rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'
                                        />
                                    </div>
                                    <span className='pt-5 text-white/60'>x</span>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='edit-custom-height' className='text-xs text-white/70'>
                                            {t('form.height')}
                                        </Label>
                                        <Input
                                            id='edit-custom-height'
                                            type='number'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={editCustomHeight}
                                            onChange={(e) => setEditCustomHeight(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                            className='rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'
                                        />
                                    </div>
                                </div>
                                <p className='text-xs text-white/50'>
                                    {t('form.pixelsMeta', {
                                        pixels: editCustomPixels.toLocaleString(locale),
                                        percent: ((editCustomPixels / 8_294_400) * 100).toFixed(1),
                                        ratio: editCustomRatio
                                    })}
                                </p>
                                {editCustomSizeError && <p className='text-xs text-red-400'>{editCustomSizeError}</p>}
                                <p className='text-xs text-white/40'>{t('form.customConstraints')}</p>
                            </div>
                        )}
                    </div>

                    <div className='space-y-3'>
                        <div className='block text-sm leading-none font-medium text-white select-none'>
                            {t('form.quality')}
                        </div>
                        <RadioGroup
                            value={editQuality}
                            onValueChange={(value) => setEditQuality(value as EditingFormData['quality'])}
                            disabled={isLoading}
                            name='edit-quality'
                            aria-label={t('form.quality')}
                            className='flex flex-wrap gap-x-5 gap-y-3'>
                            <RadioItemWithIcon
                                value='auto'
                                id='edit-quality-auto'
                                label={t('common.auto')}
                                Icon={Sparkles}
                                disabled={isLoading}
                            />
                            <RadioItemWithIcon
                                value='low'
                                id='edit-quality-low'
                                label={t('common.low')}
                                Icon={Tally1}
                                disabled={isLoading}
                            />
                            <RadioItemWithIcon
                                value='medium'
                                id='edit-quality-medium'
                                label={t('common.medium')}
                                Icon={Tally2}
                                disabled={isLoading}
                            />
                            <RadioItemWithIcon
                                value='high'
                                id='edit-quality-high'
                                label={t('common.high')}
                                Icon={Tally3}
                                disabled={isLoading}
                            />
                        </RadioGroup>
                    </div>

                    <div className='space-y-2'>
                        <div className='flex items-center gap-2 text-sm leading-none font-medium text-white select-none'>
                            {t('form.numberOfImages', { count: editN[0] })}
                        </div>
                        <Slider
                            id='edit-n-slider'
                            name='edit-n'
                            thumbLabel={t('form.numberOfImages', { count: editN[0] })}
                            min={1}
                            max={10}
                            step={1}
                            value={editN}
                            onValueChange={setEditN}
                            disabled={isLoading}
                            className='mt-3 [&>button]:border-black [&>button]:bg-white [&>button]:ring-offset-black [&>span:first-child]:h-1 [&>span:first-child>span]:bg-white'
                        />
                    </div>
                </CardContent>
                <CardFooter className='border-t border-white/10 p-4'>
                    <Button
                        type='button'
                        onClick={handleSubmit}
                        disabled={isLoading || !editPrompt || imageFiles.length === 0 || customSizeInvalid}
                        className='flex w-full items-center justify-center gap-2 rounded-md bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/40'>
                        {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                        {isLoading ? t('edit.loading') : t('edit.submit')}
                    </Button>
                </CardFooter>
            </div>
        </Card>
    );
}
