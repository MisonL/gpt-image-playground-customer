'use client';

import type { HistoryMetadata } from '@/app/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogClose
} from '@/components/ui/dialog';
import { getModelRates, type GptImageModel } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
    Copy,
    Check,
    Layers,
    DollarSign,
    Pencil,
    Sparkles as SparklesIcon,
    HardDrive,
    Database,
    FileImage,
    Trash2
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type HistoryPanelProps = {
    history: HistoryMetadata[];
    onSelectImage: (item: HistoryMetadata) => void;
    onClearHistory: () => void;
    getImageSrc: (filename: string) => string | undefined;
    onDeleteItemRequest: (item: HistoryMetadata) => void;
    itemPendingDeleteConfirmation: HistoryMetadata | null;
    onConfirmDeletion: () => void;
    onCancelDeletion: () => void;
    deletePreferenceDialogValue: boolean;
    onDeletePreferenceDialogChange: (isChecked: boolean) => void;
};

const formatDuration = (ms: number): string => {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) {
        return `${(ms / 1000).toFixed(1)}s`;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds.toString().padStart(2, '0');

    if (hours > 0) {
        return `${hours}h ${minutes.toString().padStart(2, '0')}m ${paddedSeconds}s`;
    }
    return `${minutes}m ${paddedSeconds}s`;
};

const calculateCost = (value: number, rate: number): string => {
    const cost = value * rate;
    return isNaN(cost) ? 'N/A' : cost.toFixed(4);
};

const formatMoney = (value: number): string => value.toFixed(4);
const formatEstimatedTokenCost = (value: number, rate: number): string => `$${calculateCost(value, rate)}`;

function getCostBadge(
    item: HistoryMetadata,
    labels: { actual: string; estimated: string; pending: string }
): { label: string; actual: boolean } | null {
    if (item.actualCostDetails?.source === 'new-api-log-token' && typeof item.actualCostDetails.actualAmount === 'number') {
        return { label: `${labels.actual} $${formatMoney(item.actualCostDetails.actualAmount)}`, actual: true };
    }
    if (item.actualCostDetails?.source === 'pending') {
        return { label: labels.pending, actual: false };
    }
    if (item.costDetails) {
        return { label: `${labels.estimated} $${formatMoney(item.costDetails.estimated_cost_usd)}`, actual: false };
    }
    return null;
}

function formatActualCostLabel(item: HistoryMetadata, unavailableLabel: string, pendingLabel: string): string {
    if (item.actualCostDetails?.source === 'pending') {
        return pendingLabel;
    }
    if (
        item.actualCostDetails?.source === 'new-api-log-token' &&
        typeof item.actualCostDetails.actualAmount === 'number'
    ) {
        return `$${formatMoney(item.actualCostDetails.actualAmount)}`;
    }
    return unavailableLabel;
}

function getHistoryClientRequestIds(item: HistoryMetadata): string[] {
    return Array.from(
        new Set(
            [...(item.clientRequestIds ?? []), ...item.images.map((image) => image.clientRequestId)].filter(
                (value): value is string => typeof value === 'string' && value.length > 0
            )
        )
    );
}

function getCostStatusLabel(item: HistoryMetadata, labels: { actual: string; pending: string; unavailable: string; estimated: string }) {
    if (item.actualCostDetails?.source === 'new-api-log-token') return labels.actual;
    if (item.actualCostDetails?.source === 'pending') return labels.pending;
    if (item.actualCostDetails?.source === 'unavailable') return labels.unavailable;
    if (item.costDetails) return labels.estimated;
    return '-';
}

function HistoryPanelImpl({
    history,
    onSelectImage,
    onClearHistory,
    getImageSrc,
    onDeleteItemRequest,
    itemPendingDeleteConfirmation,
    onConfirmDeletion,
    onCancelDeletion,
    deletePreferenceDialogValue,
    onDeletePreferenceDialogChange
}: HistoryPanelProps) {
    const { locale, t } = useI18n();
    const [openPromptDialogTimestamp, setOpenPromptDialogTimestamp] = React.useState<number | null>(null);
    const [openCostDialogTimestamp, setOpenCostDialogTimestamp] = React.useState<number | null>(null);
    const [isTotalCostDialogOpen, setIsTotalCostDialogOpen] = React.useState(false);
    const [copiedTimestamp, setCopiedTimestamp] = React.useState<number | null>(null);
    const [imageResolutions, setImageResolutions] = React.useState<Record<string, string>>({});
    const [failedThumbnails, setFailedThumbnails] = React.useState<Record<string, boolean>>({});

    const { totalCost, totalImages } = React.useMemo(() => {
        let cost = 0;
        let images = 0;
        history.forEach((item) => {
            if (item.costDetails) {
                cost += item.costDetails.estimated_cost_usd;
            }
            images += item.images?.length ?? 0;
        });

        return { totalCost: Math.round(cost * 10000) / 10000, totalImages: images };
    }, [history]);

    const averageCost = totalImages > 0 ? totalCost / totalImages : 0;

    const handleCopy = async (text: string | null | undefined, timestamp: number) => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopiedTimestamp(timestamp);
            setTimeout(() => setCopiedTimestamp(null), 1500);
        } catch (err) {
            console.error('复制文本失败：', err);
        }
    };
    const formatTimestamp = React.useCallback(
        (timestamp: number) => new Date(timestamp).toLocaleString(locale),
        [locale]
    );
    const handleThumbnailLoad = React.useCallback(
        (filename: string, event: React.SyntheticEvent<HTMLImageElement>) => {
            const image = event.currentTarget;
            if (!image.naturalWidth || !image.naturalHeight) return;
            const resolution = `${image.naturalWidth}x${image.naturalHeight}`;
            setImageResolutions((current) => {
                if (current[filename] === resolution) return current;
                return { ...current, [filename]: resolution };
            });
        },
        []
    );
    const handleThumbnailError = React.useCallback((filename: string) => {
        setFailedThumbnails((current) => {
            if (current[filename]) return current;
            return { ...current, [filename]: true };
        });
    }, []);
    const formatResolution = React.useCallback(
        (item: HistoryMetadata, firstImage: { filename: string } | undefined) => {
            if (firstImage && imageResolutions[firstImage.filename]) return imageResolutions[firstImage.filename];
            if (item.size && item.size !== 'auto') return item.size;
            return '-';
        },
        [imageResolutions]
    );

    return (
        <Card className='bg-card text-card-foreground flex h-full w-full flex-col overflow-hidden rounded-lg border border-border'>
            <CardHeader className='flex flex-row items-center justify-between gap-4 border-b border-border px-4 py-3'>
                <div className='flex items-center gap-2'>
                    <CardTitle className='text-lg font-medium'>{t('history.title')}</CardTitle>
                    {totalCost > 0 && (
                        <Dialog open={isTotalCostDialogOpen} onOpenChange={setIsTotalCostDialogOpen}>
	                            <DialogTrigger asChild>
	                                <button
	                                    type='button'
	                                    className='mt-0.5 flex cursor-pointer items-center gap-1 rounded-full bg-green-600/80 px-1.5 py-0.5 text-[12px] text-white transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-green-500/90 active:translate-y-0'
	                                    aria-label={t('history.showTotalCost')}>
                                    {t('history.totalCost', { cost: totalCost.toFixed(4) })}
                                </button>
                            </DialogTrigger>
                            <DialogContent className='sm:max-w-[450px]'>
                                <DialogHeader>
                                    <DialogTitle>{t('history.totalCostSummary')}</DialogTitle>
                                    <DialogDescription className='sr-only'>
                                        {t('history.costSummaryDescription')}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className='text-muted-foreground space-y-1 pt-1 text-xs'>
                                    <p className='font-medium'>gpt-image-2:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')} $5{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')} $8{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')} $30{t('history.tokens1m')}
                                        </li>
                                    </ul>
                                    <p className='mt-2 font-medium'>gpt-image-1.5:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')} $5{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')} $8{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')} $32{t('history.tokens1m')}
                                        </li>
                                    </ul>
                                    <p className='mt-2 font-medium'>gpt-image-1:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')} $5{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')} $10{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')} $40{t('history.tokens1m')}
                                        </li>
                                    </ul>
                                    <p className='mt-2 font-medium'>gpt-image-1-mini:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')} $2{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')} $2.50{t('history.tokens1m')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')} $8{t('history.tokens1m')}
                                        </li>
                                    </ul>
                                </div>
                                <div className='text-muted-foreground space-y-2 py-4 text-sm'>
                                    <div className='flex justify-between'>
                                        <span>{t('history.totalImages')}</span>{' '}
                                        <span>{totalImages.toLocaleString()}</span>
                                    </div>
                                    <div className='flex justify-between'>
                                        <span>{t('history.averageCost')}</span> <span>${averageCost.toFixed(4)}</span>
                                    </div>
                                    <hr className='border-border my-2' />
                                    <div className='text-foreground flex justify-between font-medium'>
                                        <span>{t('history.totalEstimatedCost')}</span>
                                        <span>${totalCost.toFixed(4)}</span>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <DialogClose asChild>
                                        <Button
                                            type='button'
                                            variant='secondary'
                                            size='sm'
                                            className='border border-transparent shadow-sm hover:border-border hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'>
                                            {t('common.close')}
                                        </Button>
                                    </DialogClose>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
                {history.length > 0 && (
                    <Button
                        variant='ghost'
                        size='sm'
                        onClick={onClearHistory}
                        className='text-muted-foreground h-auto rounded-md px-2 py-1 hover:text-foreground'>
                        {t('history.clear')}
                    </Button>
                )}
            </CardHeader>
            <CardContent className='flex-grow overflow-y-auto p-4'>
                {history.length === 0 ? (
                    <div className='text-muted-foreground flex min-h-24 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-sm'>
                        <p>{t('history.empty')}</p>
                    </div>
                ) : (
                    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
                        {[...history].map((item) => {
                            const firstImage = item.images?.[0];
                            const imageCount = item.images?.length ?? 0;
                            const isMultiImage = imageCount > 1;
                            const itemKey = item.timestamp;
	                            const originalStorageMode = item.storageModeUsed || 'fs';
	                            const outputFormat = item.output_format || 'png';
	                            const costBadge = getCostBadge(item, {
	                                actual: t('history.actualCostShort'),
	                                estimated: t('history.estimatedCostShort'),
	                                pending: t('history.actualCostPending')
	                            });
	                            const requestIds = getHistoryClientRequestIds(item);
	                            const filenames = item.images.map((image) => image.filename);
	                            const costStatus = getCostStatusLabel(item, {
	                                actual: t('history.actualCostShort'),
	                                pending: t('history.actualCostPending'),
	                                unavailable: t('history.actualCostUnavailable'),
	                                estimated: t('history.estimatedCostShort')
	                            });

	                            let thumbnailUrl: string | undefined;
	                            if (firstImage) {
                                if (originalStorageMode === 'indexeddb') {
                                    thumbnailUrl = getImageSrc(firstImage.filename);
                                } else {
	                                    thumbnailUrl = `/api/image/${firstImage.filename}`;
	                                }
	                            }
	                            const isThumbnailUnavailable =
	                                !thumbnailUrl || (firstImage ? failedThumbnails[firstImage.filename] : false);

	                            return (
	                                <div key={itemKey} className='flex flex-col'>
	                                    <div className='group relative'>
	                                        <button
	                                            type='button'
	                                            onClick={() => onSelectImage(item)}
	                                            className='focus:ring-ring focus:ring-offset-background relative block aspect-square w-full cursor-pointer overflow-hidden rounded-t-md border border-border transition-[border-color,filter,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-foreground/20 hover:brightness-110 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-offset-2'
                                            aria-label={t('history.viewBatch', {
                                                time: formatTimestamp(item.timestamp)
                                            })}>
	                                            {!isThumbnailUnavailable && thumbnailUrl && firstImage ? (
	                                                <Image
	                                                    src={thumbnailUrl}
	                                                    alt={t('history.previewBatch', {
                                                        time: formatTimestamp(item.timestamp)
                                                    })}
                                                    width={150}
	                                                    height={150}
	                                                    className='h-full w-full object-cover'
	                                                    onLoad={(event) => handleThumbnailLoad(firstImage.filename, event)}
	                                                    onError={() => handleThumbnailError(firstImage.filename)}
	                                                    unoptimized
	                                                />
	                                            ) : (
	                                                <div className='bg-muted text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center text-xs'>
	                                                    <FileImage size={18} className='text-muted-foreground' />
	                                                    <span>{t('history.previewUnavailable')}</span>
	                                                </div>
	                                            )}
                                            <div
                                                className={cn(
                                                    'pointer-events-none absolute top-1 left-1 z-10 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-white',
                                                    item.mode === 'edit' ? 'bg-orange-600/80' : 'bg-blue-600/80'
                                                )}>
                                                {item.mode === 'edit' ? (
                                                    <Pencil size={12} />
                                                ) : (
                                                    <SparklesIcon size={12} />
                                                )}
                                                {item.mode === 'edit' ? t('history.modeEdit') : t('history.modeCreate')}
                                            </div>
                                            {isMultiImage && (
                                                <div className='pointer-events-none absolute right-1 bottom-1 z-10 flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[12px] text-white'>
                                                    <Layers size={16} />
                                                    {imageCount}
                                                </div>
                                            )}
                                            <div className='pointer-events-none absolute bottom-1 left-1 z-10 flex items-center gap-1'>
                                                <div className='bg-background/85 text-muted-foreground flex items-center gap-1 rounded-full border border-border px-1 py-0.5 text-[11px]'>
                                                    {originalStorageMode === 'fs' ? (
                                                        <HardDrive size={12} className='text-muted-foreground' />
                                                    ) : (
                                                        <Database size={12} className='text-blue-400' />
                                                    )}
                                                    <span>
                                                        {originalStorageMode === 'fs'
                                                            ? t('history.storageFile')
                                                            : t('history.storageDb')}
                                                    </span>
                                                </div>
                                                {item.output_format && (
                                                    <div className='bg-background/85 text-muted-foreground flex items-center gap-1 rounded-full border border-border px-1 py-0.5 text-[11px]'>
                                                        <FileImage size={12} className='text-muted-foreground' />
                                                        <span>{outputFormat.toUpperCase()}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </button>
	                                        {costBadge && (
	                                            <Dialog
	                                                open={openCostDialogTimestamp === itemKey}
	                                                onOpenChange={(isOpen) => !isOpen && setOpenCostDialogTimestamp(null)}>
	                                                <DialogTrigger asChild>
	                                                    <button
	                                                        type='button'
	                                                        onClick={(e) => {
	                                                            e.stopPropagation();
	                                                            setOpenCostDialogTimestamp(itemKey);
	                                                        }}
	                                                        className={cn(
	                                                            'absolute top-7 right-1 z-20 flex min-h-6 cursor-pointer items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] text-white shadow-sm transition-[background-color,transform] hover:-translate-y-0.5 active:translate-y-0',
	                                                            costBadge.actual
	                                                                ? 'bg-green-600/80 hover:bg-green-500/90'
	                                                                : 'bg-zinc-700/80 hover:bg-zinc-600/90'
	                                                        )}
	                                                        aria-label={`${t('history.showCost')} ${costBadge.label}`}>
	                                                        <DollarSign size={12} />
	                                                        {costBadge.label}
	                                                    </button>
	                                                </DialogTrigger>
                                                <DialogContent className='sm:max-w-[450px]'>
                                                    <DialogHeader>
                                                        <DialogTitle>
                                                            {t('history.costBreakdown')}
                                                        </DialogTitle>
                                                        <DialogDescription className='sr-only'>
                                                            {t('history.costBreakdownDescription')}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    {(() => {
                                                        const modelForRates: GptImageModel = (item.model ||
                                                            'gpt-image-1') as GptImageModel;
                                                        const rates = getModelRates(modelForRates);
                                                        return (
                                                            <>
                                                                <div className='text-muted-foreground space-y-1 pt-1 text-xs'>
                                                                    <p>
                                                                        {t('history.pricingFor', {
                                                                            model: modelForRates
                                                                        })}
                                                                    </p>
                                                                    <ul className='list-disc pl-4'>
                                                                        <li>
                                                                            {t('history.textInput')} $
                                                                            {rates.textInputPerMillion}
                                                                            {t('history.tokens1m')}
                                                                        </li>
                                                                        <li>
                                                                            {t('history.imageInput')} $
                                                                            {rates.imageInputPerMillion}
                                                                            {t('history.tokens1m')}
                                                                        </li>
                                                                        <li>
                                                                            {t('history.imageOutput')} $
                                                                            {rates.imageOutputPerMillion}
                                                                            {t('history.tokens1m')}
                                                                        </li>
                                                                    </ul>
                                                                </div>
                                                                <div className='text-muted-foreground space-y-2 py-4 text-sm'>
                                                                    {item.actualCostDetails && (
                                                                        <div className='space-y-2 rounded-md border border-border bg-card/70 p-3'>
                                                                            <div className='flex justify-between gap-3'>
                                                                                <span>{t('history.actualCost')}</span>
                                                                                <span className='text-foreground font-medium'>
                                                                                    {formatActualCostLabel(
                                                                                        item,
                                                                                        t('history.actualCostUnavailable'),
                                                                                        t('history.actualCostPending')
                                                                                    )}
                                                                                </span>
                                                                            </div>
                                                                            <div className='flex justify-between gap-3'>
                                                                                <span>{t('history.costSource')}</span>
                                                                                <span className='text-right'>
                                                                                    {item.actualCostDetails.source}
                                                                                </span>
                                                                            </div>
                                                                            <div className='flex justify-between gap-3'>
                                                                                <span>{t('history.costConfidence')}</span>
                                                                                <span>{item.actualCostDetails.confidence}</span>
                                                                            </div>
                                                                            {typeof item.actualCostDetails.actualQuota ===
                                                                                'number' && (
                                                                                <div className='flex justify-between gap-3'>
                                                                                    <span>{t('history.actualQuota')}</span>
                                                                                    <span>
                                                                                        {item.actualCostDetails.actualQuota.toLocaleString()}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                            {typeof item.actualCostDetails.matchedLogId ===
                                                                                'number' && (
                                                                                <div className='flex justify-between gap-3'>
                                                                                    <span>{t('history.matchedLogId')}</span>
                                                                                    <span>
                                                                                        {item.actualCostDetails.matchedLogId}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                            {item.actualCostDetails.reason && (
                                                                                <p className='text-xs'>
                                                                                    {item.actualCostDetails.reason}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    {item.costDetails && (
                                                                        <>
                                                                            <div className='flex justify-between'>
                                                                                <span>{t('history.textInputTokens')}</span>{' '}
                                                                                <span>
                                                                                    {item.costDetails.text_input_tokens.toLocaleString()}{' '}
                                                                                    (
                                                                                    {formatEstimatedTokenCost(
                                                                                        item.costDetails.text_input_tokens,
                                                                                        rates.textInputPerToken
                                                                                    )}
                                                                                    )
                                                                                </span>
                                                                            </div>
                                                                            {item.costDetails.image_input_tokens > 0 && (
                                                                                <div className='flex justify-between'>
                                                                                    <span>{t('history.imageInputTokens')}</span>{' '}
                                                                                    <span>
                                                                                        {item.costDetails.image_input_tokens.toLocaleString()}{' '}
                                                                                        (
                                                                                        {formatEstimatedTokenCost(
                                                                                            item.costDetails.image_input_tokens,
                                                                                            rates.imageInputPerToken
                                                                                        )}
                                                                                        )
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                            <div className='flex justify-between'>
                                                                                <span>{t('history.imageOutputTokens')}</span>{' '}
                                                                                <span>
                                                                                    {item.costDetails.image_output_tokens.toLocaleString()}{' '}
                                                                                    (
                                                                                    {formatEstimatedTokenCost(
                                                                                        item.costDetails.image_output_tokens,
                                                                                        rates.imageOutputPerToken
                                                                                    )}
                                                                                    )
                                                                                </span>
                                                                            </div>
                                                                            <hr className='border-border my-2' />
                                                                            <div className='text-foreground flex justify-between font-medium'>
                                                                                <span>{t('history.totalEstimatedCost')}</span>
                                                                                <span>${item.costDetails.estimated_cost_usd.toFixed(4)}</span>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </>
                                                        );
                                                    })()}
                                                    <DialogFooter>
                                                        <DialogClose asChild>
                                                            <Button
                                                                type='button'
                                                                variant='secondary'
                                                                size='sm'
                                                                className='border border-transparent shadow-sm hover:border-border hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'>
                                                                {t('common.close')}
                                                            </Button>
                                                        </DialogClose>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>

                                    <div className='text-muted-foreground bg-card/70 space-y-1 rounded-b-md border border-t-0 border-border p-2 text-xs'>
                                        <p title={t('history.generatedOn', { time: formatTimestamp(item.timestamp) })}>
                                            <span className='text-foreground font-medium'>{t('history.time')}</span>{' '}
                                            {formatDuration(item.durationMs)}
                                        </p>
                                        <p>
                                            <span className='text-foreground font-medium'>{t('history.model')}</span>{' '}
                                            {item.model || 'gpt-image-1'}
                                        </p>
                                        <p>
                                            <span className='text-foreground font-medium'>{t('history.resolution')}</span>{' '}
                                            {formatResolution(item, firstImage)}
                                        </p>
                                        <p>
                                            <span className='text-foreground font-medium'>{t('history.quality')}</span>{' '}
                                            {item.quality}
                                        </p>
                                        <p>
                                            <span className='text-foreground font-medium'>{t('history.bg')}</span>{' '}
                                            {item.background}
                                        </p>
                                        <p>
                                            <span className='text-foreground font-medium'>{t('history.mod')}</span>{' '}
                                            {item.moderation}
                                        </p>
                                        <div className='mt-2 flex items-center gap-1'>
                                            <Dialog
                                                open={openPromptDialogTimestamp === itemKey}
                                                onOpenChange={(isOpen) =>
                                                    !isOpen && setOpenPromptDialogTimestamp(null)
                                                }>
                                                <DialogTrigger asChild>
                                                    <Button
                                                        variant='outline'
                                                        size='sm'
                                                        className='h-6 flex-grow px-2 py-1 text-xs'
                                                        onClick={() => setOpenPromptDialogTimestamp(itemKey)}>
                                                        {t('history.showDetails')}
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className='sm:max-w-[625px]'>
                                                    <DialogHeader>
                                                        <DialogTitle>
                                                            {t('history.details')}
                                                        </DialogTitle>
                                                        <DialogDescription className='sr-only'>
                                                            {t('history.detailsDescription')}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <div className='space-y-3'>
                                                        <dl className='grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-border bg-card/70 p-3 text-sm sm:grid-cols-3'>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.generatedAt')}</dt>
                                                                <dd className='text-foreground font-medium'>{formatTimestamp(item.timestamp)}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.time')}</dt>
                                                                <dd className='text-foreground font-medium'>{formatDuration(item.durationMs)}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.mode')}</dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.mode === 'edit' ? t('history.modeEdit') : t('history.modeCreate')}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.model')}</dt>
                                                                <dd className='text-foreground font-medium'>{item.model || 'gpt-image-1'}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.resolution')}</dt>
                                                                <dd className='text-foreground font-medium'>{formatResolution(item, firstImage)}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.quality')}</dt>
                                                                <dd className='text-foreground font-medium'>{item.quality}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.bg')}</dt>
                                                                <dd className='text-foreground font-medium'>{item.background}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.mod')}</dt>
                                                                <dd className='text-foreground font-medium'>{item.moderation}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.imageCount')}</dt>
                                                                <dd className='text-foreground font-medium'>{imageCount.toLocaleString(locale)}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.outputFormat')}</dt>
                                                                <dd className='text-foreground font-medium'>{outputFormat.toUpperCase()}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.storage')}</dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {originalStorageMode === 'fs' ? t('history.storageFile') : t('history.storageDb')}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.costStatus')}</dt>
                                                                <dd className='text-foreground font-medium'>{costStatus}</dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.actualCost')}</dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {formatActualCostLabel(
                                                                        item,
                                                                        t('history.actualCostUnavailable'),
                                                                        t('history.actualCostPending')
                                                                    )}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.totalEstimatedCost')}</dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.costDetails ? `$${item.costDetails.estimated_cost_usd.toFixed(4)}` : '-'}
                                                                </dd>
                                                            </div>
                                                        </dl>
                                                        <dl className='space-y-2 rounded-md border border-border bg-card/70 p-3 text-sm'>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.filename')}</dt>
                                                                <dd className='text-foreground mt-1 break-all font-mono text-xs'>
                                                                    {filenames.length > 0 ? filenames.join(', ') : '-'}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>{t('history.requestId')}</dt>
                                                                <dd className='text-foreground mt-1 break-all font-mono text-xs'>
                                                                    {requestIds.length > 0 ? requestIds.join(', ') : '-'}
                                                                </dd>
                                                            </div>
                                                        </dl>
                                                        <div>
                                                            <p className='mb-1 text-sm font-medium'>{t('history.prompt')}</p>
                                                            <div className='text-foreground bg-muted max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 py-4 text-sm'>
                                                                {item.prompt || t('history.noPrompt')}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button
                                                            variant='outline'
                                                            size='sm'
                                                            onClick={() => handleCopy(item.prompt, itemKey)}>
                                                            {copiedTimestamp === itemKey ? (
                                                                <Check className='mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400' />
                                                            ) : (
                                                                <Copy className='mr-2 h-4 w-4' />
                                                            )}
                                                            {copiedTimestamp === itemKey
                                                                ? t('common.copied')
                                                                : t('common.copy')}
                                                        </Button>
                                                        <DialogClose asChild>
                                                            <Button
                                                                type='button'
                                                                variant='secondary'
                                                                size='sm'
                                                                className='border border-transparent shadow-sm hover:border-border hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'>
                                                                {t('common.close')}
                                                            </Button>
                                                        </DialogClose>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                            <Dialog
                                                open={itemPendingDeleteConfirmation?.timestamp === item.timestamp}
                                                onOpenChange={(isOpen) => {
                                                    if (!isOpen) onCancelDeletion();
                                                }}>
                                                <DialogTrigger asChild>
                                                    <Button
                                                        className='h-6 w-6 bg-red-700/60 text-white hover:bg-red-600/60'
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDeleteItemRequest(item);
                                                        }}
                                                        aria-label={t('history.deleteItem')}>
                                                        <Trash2 size={14} />
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className='sm:max-w-md'>
                                                    <DialogHeader>
                                                        <DialogTitle>
                                                            {t('history.confirmDeletion')}
                                                        </DialogTitle>
                                                        <DialogDescription className='pt-2'>
                                                            {t('history.confirmDeletionDescription', {
                                                                count: item.images.length
                                                            })}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <div className='flex items-center space-x-2 py-2'>
                                                        <Checkbox
                                                            id={`dont-ask-${item.timestamp}`}
                                                            checked={deletePreferenceDialogValue}
                                                            onCheckedChange={(checked) =>
                                                                onDeletePreferenceDialogChange(!!checked)
                                                            }
                                                            className='data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground'
                                                        />
                                                        <label
                                                            htmlFor={`dont-ask-${item.timestamp}`}
                                                            className='text-muted-foreground text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                                                            {t('history.dontAskAgain')}
                                                        </label>
                                                    </div>
                                                    <DialogFooter className='gap-2 sm:justify-end'>
                                                        <Button type='button' variant='outline' size='sm' onClick={onCancelDeletion}>
                                                            {t('common.cancel')}
                                                        </Button>
                                                        <Button type='button' variant='destructive' size='sm' onClick={onConfirmDeletion}>
                                                            {t('common.delete')}
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export const HistoryPanel = React.memo(HistoryPanelImpl);
