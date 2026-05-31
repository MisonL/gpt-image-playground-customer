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
import type { GptImageModel } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import type {
    ImageUpstreamFormBackend,
    ImageUpstreamFormPromptOptimization,
    ImageUpstreamFormStreamingStrategy,
    ImageUpstreamFormThinking
} from '@/lib/image-upstream-form';
import type { ImageStreamMode } from '@/lib/image-upstream-strategy';
import { getPresetTooltip, validateGptImage2Size } from '@/lib/size-utils';
import type { SizePreset } from '@/lib/size-utils';
import { getStreamingStatusLabel } from '@/lib/streaming-status-label';
import {
    Eraser,
    Save,
    Square,
    RectangleHorizontal,
    RectangleVertical,
    Sparkles,
    SlidersHorizontal,
    ChevronDown,
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
    FileImage,
    WandSparkles,
    Globe2,
    ShieldCheck,
    ShieldAlert
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
    output_format: 'png' | 'jpeg' | 'webp';
    output_compression?: number;
    moderation: 'low' | 'auto';
    imageFiles: File[];
    maskFile: File | null;
    model: GptImageModel;
    image_backend: ImageUpstreamFormBackend;
    streaming_strategy: ImageUpstreamFormStreamingStrategy;
    responsesModel: string;
    thinking: ImageUpstreamFormThinking;
    promptOptimization: ImageUpstreamFormPromptOptimization;
    forceWeb: boolean;
};

type EditingFormProps = {
    onSubmit: (data: EditingFormData) => void;
    isLoading: boolean;
    currentMode: WorkbenchMode;
    onModeChange: (mode: WorkbenchMode) => void;
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
    editOutputFormat: EditingFormData['output_format'];
    setEditOutputFormat: React.Dispatch<React.SetStateAction<EditingFormData['output_format']>>;
    editCompression: number[];
    setEditCompression: React.Dispatch<React.SetStateAction<number[]>>;
    editModeration: EditingFormData['moderation'];
    setEditModeration: React.Dispatch<React.SetStateAction<EditingFormData['moderation']>>;
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
    streamMode: ImageStreamMode;
    setStreamMode: React.Dispatch<React.SetStateAction<ImageStreamMode>>;
    allowStreamingBatch: boolean;
    partialImages: 1 | 2 | 3;
    setPartialImages: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
    editImageBackend: EditingFormData['image_backend'];
    setEditImageBackend: React.Dispatch<React.SetStateAction<EditingFormData['image_backend']>>;
    editStreamingStrategy: EditingFormData['streaming_strategy'];
    setEditStreamingStrategy: React.Dispatch<React.SetStateAction<EditingFormData['streaming_strategy']>>;
    editResponsesModel: string;
    setEditResponsesModel: React.Dispatch<React.SetStateAction<string>>;
    editThinking: EditingFormData['thinking'];
    setEditThinking: React.Dispatch<React.SetStateAction<EditingFormData['thinking']>>;
    editPromptOptimization: EditingFormData['promptOptimization'];
    setEditPromptOptimization: React.Dispatch<React.SetStateAction<EditingFormData['promptOptimization']>>;
    editForceWeb: boolean;
    setEditForceWeb: React.Dispatch<React.SetStateAction<boolean>>;
    initialAdvancedOpen?: boolean;
    initialAdvancedTab?: AdvancedTab;
};

type AdvancedTab = 'output' | 'model' | 'stream' | 'route';

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

function getBackendLabel(backend: EditingFormData['image_backend'], t: (key: string) => string): string {
    if (backend === 'images-api') return t('upstream.backendImages');
    if (backend === 'responses-image-generation') return t('upstream.backendResponses');
    return t('upstream.serverDefault');
}

function getStreamModeLabel(streamMode: ImageStreamMode, t: (key: string) => string): string {
    if (streamMode === 'stream') return t('streaming.modeStream');
    if (streamMode === 'non_stream') return t('streaming.modeNonStream');
    return t('streaming.modeAuto');
}

function getQualityLabel(quality: EditingFormData['quality'], t: (key: string) => string): string {
    if (quality === 'low') return t('common.low');
    if (quality === 'medium') return t('common.medium');
    if (quality === 'high') return t('common.high');
    return t('common.auto');
}

function getOutputFormatLabel(format: EditingFormData['output_format'], t: (key: string) => string): string {
    if (format === 'jpeg') return t('common.jpeg');
    if (format === 'webp') return t('common.webp');
    return t('common.png');
}

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
    editOutputFormat,
    setEditOutputFormat,
    editCompression,
    setEditCompression,
    editModeration,
    setEditModeration,
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
    streamMode,
    setStreamMode,
    allowStreamingBatch,
    partialImages,
    setPartialImages,
    editImageBackend,
    setEditImageBackend,
    editStreamingStrategy,
    setEditStreamingStrategy,
    editResponsesModel,
    setEditResponsesModel,
    editThinking,
    setEditThinking,
    editPromptOptimization,
    setEditPromptOptimization,
    editForceWeb,
    setEditForceWeb,
    initialAdvancedOpen = false,
    initialAdvancedTab = 'output'
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
    const showCompression = editOutputFormat === 'jpeg' || editOutputFormat === 'webp';

    const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(initialAdvancedOpen);
    const [advancedTab, setAdvancedTab] = React.useState<AdvancedTab>(initialAdvancedTab);
    const submitDisabledReason = React.useMemo(() => {
        if (isLoading) return '';
        if (imageFiles.length === 0) return t('ux.disabledSourceImage');
        if (!editPrompt.trim()) return t('ux.disabledPrompt');
        if (editDrawnPoints.length > 0 && !editGeneratedMaskFile && !editIsMaskSaved) {
            return t('ux.disabledUnsavedMask');
        }
        if (customSizeInvalid) return editCustomSizeError || t('ux.disabledCustomSize');
        return '';
    }, [
        customSizeInvalid,
        editCustomSizeError,
        editDrawnPoints.length,
        editGeneratedMaskFile,
        editIsMaskSaved,
        editPrompt,
        imageFiles.length,
        isLoading,
        t
    ]);
    const advancedSummary = [
        `${t('form.quality')}: ${getQualityLabel(editQuality, t)}`,
        `${t('form.outputFormat')}: ${getOutputFormatLabel(editOutputFormat, t)}`,
        getBackendLabel(editImageBackend, t)
    ].join(', ');
    const streamModeLabel = getStreamModeLabel(streamMode, t);
    const streamStatusLabel = getStreamingStatusLabel(streamMode, t);

    // custom 仅对 gpt-image-2 有效，切换到旧模型时重置。
    React.useEffect(() => {
        if (!isGptImage2 && editSize === 'custom') {
            setEditSize('auto');
        }
    }, [isGptImage2, editSize, setEditSize]);

    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const visualFeedbackCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const isDrawing = React.useRef(false);
    const lastPos = React.useRef<{ x: number; y: number } | null>(null);
    const imageInputRef = React.useRef<HTMLInputElement>(null);
    const maskInputRef = React.useRef<HTMLInputElement>(null);
    const primaryImagePreviewUrl = sourceImagePreviewUrls[0] ?? null;
    const hasSourceImages = imageFiles.length > 0;
    const hasSourcePreviews = sourceImagePreviewUrls.length > 0;
    const canAddSourceImage = !isLoading && imageFiles.length < maxImages;

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
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;
            setEditGeneratedMaskFile(null);
            setEditIsMaskSaved(false);
            setEditOriginalImageSize(null);
            setFirstImagePreviewUrl(null);
            setEditDrawnPoints([]);
            setEditMaskPreviewUrl(null);
        });

        if (primaryImagePreviewUrl) {
            const img = new window.Image();
            img.onload = () => {
                if (cancelled) return;
                setEditOriginalImageSize({ width: img.width, height: img.height });
            };
            img.src = primaryImagePreviewUrl;
            queueMicrotask(() => {
                if (!cancelled) {
                    setFirstImagePreviewUrl(primaryImagePreviewUrl);
                }
            });
        } else {
            queueMicrotask(() => {
                if (!cancelled) {
                    setEditShowMaskEditor(false);
                }
            });
        }

        return () => {
            cancelled = true;
        };
    }, [
        primaryImagePreviewUrl,
        setEditGeneratedMaskFile,
        setEditIsMaskSaved,
        setEditOriginalImageSize,
        setFirstImagePreviewUrl,
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
            console.error('生成遮罩预览 data URL 失败：', e);
            setEditMaskPreviewUrl(null);
        }

        offscreenCanvas.toBlob((blob) => {
            if (blob) {
                const maskFile = new File([blob], 'generated-mask.png', { type: 'image/png' });
                setEditGeneratedMaskFile(maskFile);
                setEditIsMaskSaved(true);
            } else {
                console.error('生成遮罩 blob 失败。');
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
                    console.error('读取新图片文件失败：', error);
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
                console.error('读取遮罩预览文件失败。');
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
            output_format: editOutputFormat,
            ...(showCompression ? { output_compression: editCompression[0] } : {}),
            moderation: editModeration,
            imageFiles: imageFiles,
            maskFile: editGeneratedMaskFile,
            model: editModel,
            image_backend: editImageBackend,
            streaming_strategy: editStreamingStrategy,
            responsesModel: editResponsesModel,
            thinking: editThinking,
            promptOptimization: editPromptOptimization,
            forceWeb: editForceWeb
        };
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
                    <div className='border-border/80 space-y-3 border-b border-dashed pb-4'>
                        <div className='flex items-start justify-between gap-3'>
                            <div className='space-y-1'>
                                <div
                                    id='source-image-upload-label'
                                    className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                    {t('edit.referenceTitle')}
                                </div>
                                <p
                                    id='source-image-upload-description'
                                    className='text-muted-foreground text-xs leading-5'>
                                    {t('edit.referenceHint', { count: maxImages })}
                                </p>
                            </div>
                            <span className='border-primary/20 bg-primary/10 text-primary rounded-full border px-2 py-1 text-xs'>
                                {t('edit.referenceCount', { count: imageFiles.length, max: maxImages })}
                            </span>
                        </div>
                        <button
                            type='button'
                            onClick={() => imageInputRef.current?.click()}
                            disabled={!canAddSourceImage}
                            aria-label={t('edit.referenceAction')}
                            aria-describedby='source-image-upload-description'
                            className={`group hover:border-primary/35 focus-visible:ring-ring flex w-full cursor-pointer rounded-md border border-dashed border-[oklch(0.78_0.035_75)] bg-[oklch(0.982_0.016_84)] text-center shadow-inner transition-[background-color,border-color,box-shadow,transform] hover:bg-[oklch(0.99_0.018_82)] focus-visible:ring-2 focus-visible:outline-none enabled:active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-60 ${
                                hasSourceImages
                                    ? 'min-h-11 flex-row items-center justify-start gap-2 px-3 py-2 text-left'
                                    : 'min-h-[116px] flex-col items-center justify-center gap-2 px-4 py-4'
                            }`}>
                            <span
                                className={`border-primary/20 bg-background/80 text-primary flex items-center justify-center rounded-md border shadow-sm transition-transform group-hover:-translate-y-0.5 ${
                                    hasSourceImages ? 'h-8 w-8 shrink-0' : 'h-10 w-10'
                                }`}>
                                <UploadCloud className='h-5 w-5' />
                            </span>
                            <span className={hasSourceImages ? 'min-w-0' : ''}>
                                <span className='text-foreground block text-sm font-medium'>
                                    {hasSourceImages ? t('edit.referenceAddMore') : t('edit.referenceAction')}
                                </span>
                                <span className='text-muted-foreground block max-w-[18rem] text-xs leading-5'>
                                    {hasSourceImages ? t('edit.referenceReady') : t('edit.referenceEmpty')}
                                </span>
                            </span>
                        </button>
                        <Input
                            ref={imageInputRef}
                            id='image-files-input'
                            name='sourceImages'
                            type='file'
                            accept='image/png, image/jpeg, image/webp'
                            multiple
                            onChange={handleImageFileChange}
                            disabled={isLoading || imageFiles.length >= maxImages}
                            className='hidden'
                        />
                        {!hasSourceImages && (
                            <div className='rounded-md border border-[oklch(0.88_0.05_86)] bg-[oklch(0.975_0.055_88)] px-3 py-2 text-xs leading-5 text-[oklch(0.43_0.055_68)]'>
                                {t('edit.referenceRequiredNote')}
                            </div>
                        )}
                        {hasSourceImages && !hasSourcePreviews && (
                            <div className='border-border/70 bg-background/60 text-muted-foreground rounded-md border px-3 py-2 text-xs leading-5'>
                                {t('edit.referencePreparing')}
                            </div>
                        )}
                        {hasSourcePreviews && (
                            <div className='flex space-x-2 overflow-x-auto pt-1.5'>
                                {sourceImagePreviewUrls.map((url, index) => (
                                    <div
                                        key={url}
                                        className='group relative shrink-0 rounded-sm border border-[oklch(0.86_0.03_78)] bg-white p-1 shadow-[0_6px_14px_oklch(0.42_0.035_58/0.1)]'>
                                        <Image
                                            src={url}
                                            alt={t('edit.sourcePreview', { index: index + 1 })}
                                            width={96}
                                            height={96}
                                            className='h-24 w-24 rounded-[3px] object-cover'
                                            unoptimized
                                        />
                                        <Button
                                            type='button'
                                            variant='secondary'
                                            size='icon'
                                            className='border-background/80 absolute top-1.5 right-1.5 h-7 w-7 rounded-full border bg-[oklch(0.36_0.02_62/0.74)] p-0 text-white opacity-100 shadow-sm transition-opacity hover:bg-[oklch(0.32_0.02_62/0.86)] hover:text-white sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100'
                                            onClick={() => handleRemoveImage(index)}
                                            aria-label={t('edit.removeImage', { index: index + 1 })}>
                                            <X className='h-3 w-3' />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className='border-border/80 space-y-1.5 border-b border-dashed pb-4'>
                        <Label htmlFor='edit-prompt'>{t('edit.instructionTitle')}</Label>
                        <div className='relative'>
                            <Textarea
                                id='edit-prompt'
                                name='editPrompt'
                                placeholder={t('form.editPromptPlaceholder')}
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                required
                                disabled={isLoading}
                                className='min-h-[118px] rounded-md bg-[oklch(0.972_0.018_82)] px-4 py-3 pb-9 leading-7 shadow-inner'
                            />
                            <span className='text-muted-foreground pointer-events-none absolute bottom-3 left-4 text-xs'>
                                {editPrompt.trim().length} / 1000
                            </span>
                        </div>
                    </div>

                    <div className='border-border bg-background space-y-3 rounded-md border p-3'>
                        <div className='text-foreground block text-sm leading-none font-medium select-none'>
                            {t('edit.mask')}
                        </div>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setEditShowMaskEditor(!editShowMaskEditor)}
                            disabled={isLoading || !editOriginalImageSize}
                            className='min-h-9 w-full justify-start px-3'>
                            {editShowMaskEditor
                                ? t('edit.closeMaskEditor')
                                : editGeneratedMaskFile
                                  ? t('edit.editSavedMask')
                                  : t('edit.createMask')}
                            {editIsMaskSaved && !editShowMaskEditor && (
                                <span className='ml-auto text-xs text-emerald-600 dark:text-emerald-400'>
                                    ({t('common.saved')})
                                </span>
                            )}
                            <ScanEye className='mt-0.5' />
                        </Button>

                        {editShowMaskEditor && firstImagePreviewUrl && editOriginalImageSize && (
                            <div className='bg-muted/20 border-border space-y-3 rounded-md border p-3'>
                                <p className='text-muted-foreground text-xs'>{t('edit.drawMaskHint')}</p>
                                <div
                                    className='border-border relative mx-auto w-full overflow-hidden rounded border'
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
                                        <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
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
                                            className='mt-1'
                                        />
                                    </div>
                                </div>
                                <div className='flex flex-col items-stretch gap-2 pt-3 sm:flex-row sm:items-center sm:justify-between'>
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='sm'
                                        onClick={() => maskInputRef.current?.click()}
                                        disabled={isLoading || !editOriginalImageSize}
                                        className='w-full sm:mr-auto sm:w-auto'>
                                        <UploadCloud className='mr-1.5 h-4 w-4' /> {t('edit.uploadMask')}
                                    </Button>
                                    <Input
                                        ref={maskInputRef}
                                        id='mask-file-input'
                                        name='maskFile'
                                        type='file'
                                        accept='image/png'
                                        onChange={handleMaskFileChange}
                                        className='hidden'
                                    />
                                    <div className='flex flex-col gap-2 sm:flex-row'>
                                        <Button
                                            type='button'
                                            variant='outline'
                                            size='sm'
                                            onClick={handleClearMask}
                                            disabled={isLoading}
                                            className='w-full sm:w-auto'>
                                            <Eraser className='mr-1.5 h-4 w-4' /> {t('edit.clearMask')}
                                        </Button>
                                        <Button
                                            type='button'
                                            variant='default'
                                            size='sm'
                                            onClick={generateAndSaveMask}
                                            disabled={isLoading || editDrawnPoints.length === 0}
                                            className='w-full sm:w-auto'>
                                            <Save className='mr-1.5 h-4 w-4' /> {t('edit.saveMask')}
                                        </Button>
                                    </div>
                                </div>
                                {editMaskPreviewUrl && (
                                    <div className='border-border mt-3 border-t pt-3 text-center'>
                                        <div className='text-foreground mb-1.5 block text-sm leading-none font-medium select-none'>
                                            {t('edit.maskPreview')}
                                        </div>
                                        <div className='border-border bg-background inline-block rounded border p-1'>
                                            <Image
                                                src={editMaskPreviewUrl}
                                                alt={t('edit.generatedMaskPreviewAlt')}
                                                width={editOriginalImageSize.width}
                                                height={editOriginalImageSize.height}
                                                className='block max-w-full'
                                                style={{ width: 'auto', height: '134px' }}
                                                unoptimized
                                            />
                                        </div>
                                    </div>
                                )}
                                {editIsMaskSaved && !editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-yellow-600 dark:text-yellow-400'>
                                        {t('edit.maskPreviewLoading')}
                                    </p>
                                )}
                                {editIsMaskSaved && editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-emerald-600 dark:text-emerald-400'>
                                        {t('edit.maskSaved')}
                                    </p>
                                )}
                            </div>
                        )}
                        {!editShowMaskEditor && editGeneratedMaskFile && (
                            <p className='pt-1 text-xs text-emerald-600 dark:text-emerald-400'>
                                {t('edit.maskApplied', { name: editGeneratedMaskFile.name })}
                            </p>
                        )}
                    </div>

                    <div className='border-border bg-background space-y-3 rounded-md border p-3'>
                        <div className='text-foreground block text-sm leading-none font-medium select-none'>
                            {t('form.size')}
                        </div>
                        <RadioGroup
                            value={editSize}
                            onValueChange={(value) => setEditSize(value as EditingFormData['size'])}
                            disabled={isLoading}
                            name='edit-size'
                            aria-label={t('form.size')}
                            className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
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
                            <RadioItemWithIcon
                                value='square'
                                id='edit-size-square'
                                label={t('common.square')}
                                Icon={Square}
                                disabled={isLoading}
                                tooltip={getPresetTooltip('square', editModel)}
                            />
                            <RadioItemWithIcon
                                value='landscape'
                                id='edit-size-landscape'
                                label={t('common.landscape')}
                                Icon={RectangleHorizontal}
                                disabled={isLoading}
                                tooltip={getPresetTooltip('landscape', editModel)}
                            />
                            <RadioItemWithIcon
                                value='portrait'
                                id='edit-size-portrait'
                                label={t('common.portrait')}
                                Icon={RectangleVertical}
                                disabled={isLoading}
                                tooltip={getPresetTooltip('portrait', editModel)}
                            />
                        </RadioGroup>
                        {isGptImage2 && editSize === 'custom' && (
                            <div className='bg-muted/30 border-border space-y-2 rounded-md border p-3'>
                                <div className='flex items-center gap-3'>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='edit-custom-width' className='text-muted-foreground text-xs'>
                                            {t('form.width')}
                                        </Label>
                                        <Input
                                            id='edit-custom-width'
                                            name='editCustomWidth'
                                            type='number'
                                            inputMode='numeric'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={editCustomWidth}
                                            onChange={(e) => setEditCustomWidth(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    <span className='text-muted-foreground pt-5'>x</span>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='edit-custom-height' className='text-muted-foreground text-xs'>
                                            {t('form.height')}
                                        </Label>
                                        <Input
                                            id='edit-custom-height'
                                            name='editCustomHeight'
                                            type='number'
                                            inputMode='numeric'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={editCustomHeight}
                                            onChange={(e) => setEditCustomHeight(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>
                                <p className='text-muted-foreground text-xs'>
                                    {t('form.pixelsMeta', {
                                        pixels: editCustomPixels.toLocaleString(locale),
                                        percent: ((editCustomPixels / 8_294_400) * 100).toFixed(1),
                                        ratio: editCustomRatio
                                    })}
                                </p>
                                {editCustomSizeError && (
                                    <p className='text-destructive text-xs'>{editCustomSizeError}</p>
                                )}
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
                            aria-controls='editing-advanced-panel'>
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
                            <div id='editing-advanced-panel' className='border-border border-t p-3'>
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
                                            <div className='flex items-center justify-between gap-2'>
                                                <Label htmlFor='edit-model-select'>{t('form.model')}</Label>
                                                {isGptImage2 && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <button
                                                                type='button'
                                                                className='text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:ring-ring -my-2 inline-flex h-9 w-9 cursor-help items-center justify-center rounded-sm transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:outline-none active:scale-95'
                                                                aria-label={t('edit.fidelityHint')}>
                                                                <HelpCircle className='h-4 w-4' />
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent className='max-w-[280px]'>
                                                            {t('edit.fidelityHint')}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </div>
                                            <Select
                                                value={editModel}
                                                onValueChange={(value) =>
                                                    setEditModel(value as EditingFormData['model'])
                                                }
                                                disabled={isLoading}
                                                name='edit-model'>
                                                <SelectTrigger id='edit-model-select' className='w-full'>
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
                                                <Label htmlFor='edit-image-backend-select'>
                                                    {t('upstream.backend')}
                                                </Label>
                                                <Select
                                                    value={editImageBackend}
                                                    onValueChange={(value) =>
                                                        setEditImageBackend(value as EditingFormData['image_backend'])
                                                    }
                                                    disabled={isLoading}
                                                    name='edit-image_backend'>
                                                    <SelectTrigger id='edit-image-backend-select'>
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
                                                <Label htmlFor='edit-streaming-strategy-select'>
                                                    {t('upstream.streamingStrategy')}
                                                </Label>
                                                <Select
                                                    value={editStreamingStrategy}
                                                    onValueChange={(value) =>
                                                        setEditStreamingStrategy(
                                                            value as EditingFormData['streaming_strategy']
                                                        )
                                                    }
                                                    disabled={isLoading}
                                                    name='edit-image_streaming_strategy'>
                                                    <SelectTrigger id='edit-streaming-strategy-select'>
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

                                        {editImageBackend === 'responses-image-generation' && (
                                            <div className='border-border bg-muted/20 space-y-3 rounded-md border p-3'>
                                                <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                    <WandSparkles className='text-muted-foreground h-4 w-4' />
                                                    {t('upstream.compatibilityParams')}
                                                </div>
                                                <div className='grid gap-3 sm:grid-cols-2'>
                                                    <div className='space-y-1.5 sm:col-span-2'>
                                                        <Label htmlFor='edit-responses-model-input'>
                                                            {t('upstream.gptModel')}
                                                        </Label>
                                                        <Input
                                                            id='edit-responses-model-input'
                                                            name='editResponsesModel'
                                                            value={editResponsesModel}
                                                            onChange={(event) =>
                                                                setEditResponsesModel(event.target.value)
                                                            }
                                                            disabled={isLoading}
                                                            autoComplete='off'
                                                            spellCheck={false}
                                                            placeholder='gpt-5.4'
                                                        />
                                                    </div>
                                                    <div className='space-y-1.5'>
                                                        <Label htmlFor='edit-thinking-select'>
                                                            {t('upstream.thinking')}
                                                        </Label>
                                                        <Select
                                                            value={editThinking}
                                                            onValueChange={(value) =>
                                                                setEditThinking(value as EditingFormData['thinking'])
                                                            }
                                                            disabled={isLoading}
                                                            name='edit-thinking'>
                                                            <SelectTrigger id='edit-thinking-select'>
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
                                                        <Label htmlFor='edit-prompt-optimization-select'>
                                                            {t('upstream.promptOptimization')}
                                                        </Label>
                                                        <Select
                                                            value={editPromptOptimization}
                                                            onValueChange={(value) =>
                                                                setEditPromptOptimization(
                                                                    value as EditingFormData['promptOptimization']
                                                                )
                                                            }
                                                            disabled={isLoading}
                                                            name='edit-promptOptimization'>
                                                            <SelectTrigger id='edit-prompt-optimization-select'>
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

                                        {editImageBackend === 'images-api' && (
                                            <div className='border-border bg-muted/20 space-y-3 rounded-md border p-3'>
                                                <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                    <Globe2 className='text-muted-foreground h-4 w-4' />
                                                    {t('upstream.compatibilityParams')}
                                                </div>
                                                <RadioGroup
                                                    value={editForceWeb ? 'true' : 'false'}
                                                    onValueChange={(value) => setEditForceWeb(value === 'true')}
                                                    disabled={isLoading}
                                                    name='edit-force_web'
                                                    aria-label={t('upstream.forceWeb')}
                                                    className='grid grid-cols-2 gap-2'>
                                                    <RadioItemWithIcon
                                                        value='false'
                                                        id='edit-force-web-false'
                                                        label={t('upstream.serverDefault')}
                                                        Icon={Sparkles}
                                                        disabled={isLoading}
                                                    />
                                                    <RadioItemWithIcon
                                                        value='true'
                                                        id='edit-force-web-true'
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
                                            <Label htmlFor='edit-stream-mode-select'>{t('streaming.mode')}</Label>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div>
                                                        <Select
                                                            value={streamMode}
                                                            onValueChange={(value) =>
                                                                setStreamMode(value as ImageStreamMode)
                                                            }
                                                            disabled={isLoading}
                                                            name='edit-stream_mode'>
                                                            <SelectTrigger
                                                                id='edit-stream-mode-select'
                                                                className='w-full'>
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
                                                    {allowStreamingBatch && editN[0] > 1 && streamMode !== 'non_stream'
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
                                                    name='edit-partial_images'
                                                    aria-label={t('streaming.previewImages')}
                                                    className='grid grid-cols-3 gap-2'>
                                                    {[1, 2, 3].map((value) => (
                                                        <RadioItemWithIcon
                                                            key={value}
                                                            value={String(value)}
                                                            id={`edit-partial-${value}`}
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
                                                value={editQuality}
                                                onValueChange={(value) =>
                                                    setEditQuality(value as EditingFormData['quality'])
                                                }
                                                disabled={isLoading}
                                                name='edit-quality'
                                                aria-label={t('form.quality')}
                                                className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
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

                                        <div className='space-y-3'>
                                            <div className='text-foreground block text-sm leading-none font-medium select-none'>
                                                {t('form.outputFormat')}
                                            </div>
                                            <RadioGroup
                                                value={editOutputFormat}
                                                onValueChange={(value) =>
                                                    setEditOutputFormat(value as EditingFormData['output_format'])
                                                }
                                                disabled={isLoading}
                                                name='edit-output_format'
                                                aria-label={t('form.outputFormat')}
                                                className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
                                                <RadioItemWithIcon
                                                    value='png'
                                                    id='edit-format-png'
                                                    label='PNG'
                                                    Icon={FileImage}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='jpeg'
                                                    id='edit-format-jpeg'
                                                    label='JPEG'
                                                    Icon={FileImage}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='webp'
                                                    id='edit-format-webp'
                                                    label='WebP'
                                                    Icon={FileImage}
                                                    disabled={isLoading}
                                                />
                                            </RadioGroup>
                                        </div>

                                        {showCompression && (
                                            <div className='space-y-2 pt-2 transition-opacity duration-300'>
                                                <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
                                                    {t('form.compression', { value: editCompression[0] })}
                                                </div>
                                                <Slider
                                                    id='edit-compression-slider'
                                                    name='edit-output_compression'
                                                    thumbLabel={t('form.compression', { value: editCompression[0] })}
                                                    min={0}
                                                    max={100}
                                                    step={1}
                                                    value={editCompression}
                                                    onValueChange={setEditCompression}
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
                                                value={editModeration}
                                                onValueChange={(value) =>
                                                    setEditModeration(value as EditingFormData['moderation'])
                                                }
                                                disabled={isLoading}
                                                name='edit-moderation'
                                                aria-label={t('form.moderation')}
                                                className='grid grid-cols-2 gap-2'>
                                                <RadioItemWithIcon
                                                    value='auto'
                                                    id='edit-mod-auto'
                                                    label={t('common.auto')}
                                                    Icon={ShieldCheck}
                                                    disabled={isLoading}
                                                />
                                                <RadioItemWithIcon
                                                    value='low'
                                                    id='edit-mod-low'
                                                    label={t('common.low')}
                                                    Icon={ShieldAlert}
                                                    disabled={isLoading}
                                                />
                                            </RadioGroup>
                                        </div>

                                        <div className='space-y-2'>
                                            <div className='text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none'>
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
                                                className='mt-3'
                                            />
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
                                {editModel}
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
                            className='flex w-full items-center justify-center gap-2 rounded-md border-0 bg-[oklch(0.615_0.165_30)] text-white shadow-sm hover:bg-[oklch(0.56_0.15_30)] hover:text-white'>
                            {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                            {isLoading ? t('edit.loading') : t('edit.submit')}
                        </Button>
                    </div>
                </CardFooter>
            </div>
        </Card>
    );
}
