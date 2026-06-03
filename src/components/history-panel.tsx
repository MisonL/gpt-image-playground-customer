'use client';

import { ActivityTimeline } from '@/components/generation-activity-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getModelRates, type GptImageModel } from '@/lib/cost-utils';
import type { GenerationActivityItem } from '@/lib/generation-activity';
import type { HistoryMetadata } from '@/lib/history-metadata';
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
    Trash2,
    WandSparkles,
    Bookmark,
    Plus,
    ChevronDown,
    AlertTriangle
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type HistoryPanelProps = {
    history: HistoryMetadata[];
    inspirations: InspirationItem[];
    activityItems?: GenerationActivityItem[];
    onSelectImage: (item: HistoryMetadata) => void;
    onApplyPrompt: (prompt: string, source: PromptApplySource) => void;
    onSaveInspiration: (prompt: string) => void;
    onSendHistoryToEdit: (item: HistoryMetadata) => void | Promise<void>;
    onDeleteInspiration: (id: number) => void;
    onClearHistory: () => void;
    getImageSrc: (filename: string) => string | undefined;
    onDeleteItemRequest: (item: HistoryMetadata) => void;
    itemPendingDeleteConfirmation: HistoryMetadata | null;
    onConfirmDeletion: () => void;
    onCancelDeletion: () => void;
    deletePreferenceDialogValue: boolean;
    onDeletePreferenceDialogChange: (isChecked: boolean) => void;
};

export type InspirationItem = {
    id: number;
    prompt: string;
    createdAt: number;
};

export type { GenerationActivityItem } from '@/lib/generation-activity';

export type PromptApplySource =
    | {
          type: 'inspiration';
          title: string;
      }
    | {
          type: 'history';
          item: HistoryMetadata;
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
const inspirationThumbnails = [
    '/assets/inspiration-flowers.jpg',
    '/assets/inspiration-desk.jpg',
    '/assets/inspiration-window.jpg'
];
const inspirationTitles = ['窗边的花与书', '复古桌面时光', '海边的夏日下午'];
const inspirationTags = ['奶油色', '花束', '日杂', '胶片感', '复古', '咖啡', '清透', '夏日'];
const storageDisplayLabels = {
    fs: 'Local',
    indexeddb: 'Album'
} as const;

function getCostBadge(
    item: HistoryMetadata,
    labels: { actual: string; estimated: string; pending: string }
): { label: string; actual: boolean } | null {
    if (
        item.actualCostDetails?.source === 'new-api-log-token' &&
        typeof item.actualCostDetails.actualAmount === 'number'
    ) {
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

function buildPendingActivityItems(t: (key: string) => string): GenerationActivityItem[] {
    return [
        {
            id: 'pending-request',
            label: t('history.pendingRequest'),
            detail: t('history.pendingRequestDetail'),
            tone: 'neutral'
        },
        {
            id: 'pending-streaming',
            label: t('history.pendingStreaming'),
            detail: t('history.pendingStreamingDetail'),
            tone: 'neutral'
        },
        {
            id: 'pending-saved',
            label: t('history.pendingSaved'),
            detail: t('history.pendingSavedDetail'),
            tone: 'neutral'
        },
        {
            id: 'pending-failed',
            label: t('history.pendingFailed'),
            detail: t('history.pendingFailedDetail'),
            tone: 'neutral'
        }
    ];
}

function getCostStatusLabel(
    item: HistoryMetadata,
    labels: { actual: string; pending: string; unavailable: string; estimated: string }
) {
    if (item.actualCostDetails?.source === 'new-api-log-token') return labels.actual;
    if (item.actualCostDetails?.source === 'pending') return labels.pending;
    if (item.actualCostDetails?.source === 'unavailable') return labels.unavailable;
    if (item.costDetails) return labels.estimated;
    return '-';
}

function HistoryPanelImpl({
    history,
    inspirations,
    activityItems = [],
    onSelectImage,
    onApplyPrompt,
    onSaveInspiration,
    onSendHistoryToEdit,
    onDeleteInspiration,
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
    const pendingActivityItems = React.useMemo(() => buildPendingActivityItems(t), [t]);
    const [activeTab, setActiveTab] = React.useState<'inspiration' | 'history'>(() =>
        history.length > 0 && inspirations.length === 0 ? 'history' : 'inspiration'
    );
    const [openPromptDialogTimestamp, setOpenPromptDialogTimestamp] = React.useState<number | null>(null);
    const [openCostDialogTimestamp, setOpenCostDialogTimestamp] = React.useState<number | null>(null);
    const [isTotalCostDialogOpen, setIsTotalCostDialogOpen] = React.useState(false);
    const [copiedTimestamp, setCopiedTimestamp] = React.useState<number | null>(null);
    const [imageResolutions, setImageResolutions] = React.useState<Record<string, string>>({});
    const [failedThumbnails, setFailedThumbnails] = React.useState<Record<string, boolean>>({});
    const [expandedBatchTimestamp, setExpandedBatchTimestamp] = React.useState<number | null>(null);

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
    const formatStatusTime = React.useCallback(
        (timestamp: number) =>
            new Date(timestamp).toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit'
            }),
        [locale]
    );
    const handleThumbnailLoad = React.useCallback((filename: string, event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        if (!image.naturalWidth || !image.naturalHeight) return;
        const resolution = `${image.naturalWidth}x${image.naturalHeight}`;
        setImageResolutions((current) => {
            if (current[filename] === resolution) return current;
            return { ...current, [filename]: resolution };
        });
    }, []);
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
        <Card className='workbench-panel text-card-foreground border-border flex h-full w-full flex-col gap-0 overflow-hidden rounded-lg border py-0'>
            <CardHeader className='border-border/70 flex flex-col gap-2 border-b px-4 pt-3 !pb-3'>
                {totalCost > 0 ? (
                    <div className='flex items-center justify-end gap-3'>
                        <Dialog open={isTotalCostDialogOpen} onOpenChange={setIsTotalCostDialogOpen}>
                            <DialogTrigger asChild>
                                <button
                                    type='button'
                                    className='bg-secondary text-secondary-foreground hover:bg-secondary/80 mt-0.5 flex min-h-6 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[12px] transition-[background-color,transform] hover:-translate-y-0.5 active:translate-y-0'
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
                                            className='hover:border-border hover:bg-accent hover:text-accent-foreground border border-transparent shadow-sm active:scale-[0.98]'>
                                            {t('common.close')}
                                        </Button>
                                    </DialogClose>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                ) : null}
                <Tabs
                    value={activeTab}
                    onValueChange={(value) => setActiveTab(value as 'inspiration' | 'history')}
                    className='gap-0'>
                    <TabsList className='border-border grid h-auto w-full grid-cols-2 rounded-none border-0 border-b bg-transparent p-0'>
                        <TabsTrigger
                            value='inspiration'
                            className='data-[state=active]:border-primary data-[state=active]:text-primary min-h-11 rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none lg:min-h-8'>
                            {t('history.inspirationAlbum')}
                        </TabsTrigger>
                        <TabsTrigger
                            value='history'
                            className='data-[state=active]:border-primary data-[state=active]:text-primary min-h-11 rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none lg:min-h-8'>
                            {t('history.recentGenerated')}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value='inspiration' forceMount className='hidden' />
                    <TabsContent value='history' forceMount className='hidden' />
                </Tabs>
                {history.length > 0 && activeTab === 'history' && (
                    <Button
                        variant='ghost'
                        size='sm'
                        onClick={onClearHistory}
                        className='text-muted-foreground hover:text-foreground h-auto rounded-md px-2 py-1'>
                        {t('history.clear')}
                    </Button>
                )}
            </CardHeader>
            <CardContent className='literary-scrollbar min-h-0 p-3 lg:max-h-[calc(100%-17.5rem)] lg:overflow-y-auto lg:p-3 xl:flex-none'>
                {activeTab === 'inspiration' ? (
                    <div className='space-y-3 lg:space-y-2'>
                        {inspirations.length === 0 ? (
                            <div className='text-muted-foreground border-border bg-muted/20 flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 text-center text-sm'>
                                <WandSparkles className='h-5 w-5 opacity-70' />
                                <p>{t('history.inspirationEmpty')}</p>
                            </div>
                        ) : (
                            <div className='-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 lg:mx-0 lg:block lg:space-y-2 lg:overflow-visible lg:px-0 lg:pb-0'>
                                {inspirations.map((item, index) => {
                                    const thumbnail = inspirationThumbnails[index % inspirationThumbnails.length];
                                    const title =
                                        inspirationTitles[index % inspirationTitles.length] ||
                                        t('history.inspirationAlbum');
                                    const tags = inspirationTags.slice(index * 2, index * 2 + 2);
                                    return (
                                        <div
                                            key={item.id}
                                            className='group border-border/70 bg-card/58 hover:border-primary/30 flex w-[min(84vw,360px)] shrink-0 snap-start items-stretch gap-3 overflow-hidden rounded-md border p-2 shadow-sm transition-[border-color,box-shadow] hover:shadow-md lg:w-auto lg:gap-2 lg:p-1.5 2xl:p-1'>
                                            <button
                                                type='button'
                                                onClick={() =>
                                                    onApplyPrompt(item.prompt, { type: 'inspiration', title })
                                                }
                                                className='border-border bg-muted relative min-h-24 w-36 shrink-0 overflow-hidden rounded border shadow-sm sm:w-40 lg:min-h-20 lg:w-32 2xl:min-h-18 2xl:w-28'>
                                                <Image
                                                    src={thumbnail}
                                                    alt={title}
                                                    fill
                                                    sizes='160px'
                                                    className='object-cover'
                                                    loading={index === 0 ? 'eager' : 'lazy'}
                                                />
                                            </button>
                                            <div className='flex min-w-0 flex-1 flex-col gap-1.5 pr-1 2xl:gap-1'>
                                                <div className='flex items-start justify-between gap-1.5'>
                                                    <div className='min-w-0'>
                                                        <p className='truncate text-[15px] leading-5 font-medium 2xl:text-sm'>
                                                            {title}
                                                        </p>
                                                        <div className='mt-1 flex gap-1 overflow-hidden 2xl:mt-0.5'>
                                                            {tags.map((tag) => (
                                                                <span
                                                                    key={tag}
                                                                    className='bg-muted/80 text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-[11px]'>
                                                                    {tag}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className='flex shrink-0 gap-0.5 opacity-65 transition-opacity group-hover:opacity-100'>
                                                        <span
                                                            className='text-primary flex h-11 w-11 items-center justify-center rounded-md lg:h-7 lg:w-7'
                                                            aria-label={t('history.savedInspiration')}
                                                            role='img'>
                                                            <Bookmark className='h-3.5 w-3.5 fill-current' />
                                                        </span>
                                                        <Button
                                                            type='button'
                                                            variant='ghost'
                                                            size='icon'
                                                            className='text-muted-foreground hover:text-destructive h-11 w-11 lg:h-7 lg:w-7'
                                                            onClick={() => onDeleteInspiration(item.id)}
                                                            aria-label={t('history.deleteInspiration')}>
                                                            <Trash2 className='h-3.5 w-3.5' />
                                                        </Button>
                                                    </div>
                                                </div>
                                                <p
                                                    className='text-muted-foreground max-h-8 min-h-8 overflow-hidden text-xs leading-4 2xl:max-h-4 2xl:min-h-4'
                                                    title={item.prompt}>
                                                    {item.prompt}
                                                </p>
                                                <div className='flex items-center justify-between gap-2'>
                                                    <span className='text-muted-foreground text-[11px]'>
                                                        {item.createdAt > 0
                                                            ? formatTimestamp(item.createdAt)
                                                            : t('history.template')}
                                                    </span>
                                                    <Button
                                                        type='button'
                                                        size='sm'
                                                        variant='ghost'
                                                        className='min-h-11 px-3 text-xs lg:min-h-7 lg:px-2'
                                                        onClick={() =>
                                                            onApplyPrompt(item.prompt, { type: 'inspiration', title })
                                                        }>
                                                        {t('history.applyInspiration')}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div className='flex items-center justify-between rounded-md px-1 text-sm'>
                            <button
                                type='button'
                                className='text-muted-foreground hover:text-primary focus-visible:ring-ring -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:outline-none lg:ml-0 lg:min-h-8 lg:px-0'
                                disabled={!inspirations[0]}
                                onClick={() =>
                                    inspirations[0] &&
                                    onApplyPrompt(inspirations[0].prompt, {
                                        type: 'inspiration',
                                        title: t('history.inspirationAlbum')
                                    })
                                }>
                                <Plus className='h-4 w-4' />
                                {t('history.applyFirstTemplate')}
                            </button>
                            <span className='text-muted-foreground -mr-2 min-h-11 rounded-md px-2 py-3 lg:mr-0 lg:min-h-8 lg:py-1.5'>
                                {t('history.inspirationCount', { count: inspirations.length })}
                            </span>
                        </div>
                    </div>
                ) : history.length === 0 ? (
                    <div className='text-muted-foreground border-border flex min-h-24 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm'>
                        <p>{t('history.empty')}</p>
                    </div>
                ) : (
                    <div className='-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-1 lg:overflow-visible lg:px-0 lg:pb-0 2xl:grid-cols-2'>
                        {[...history].map((item) => {
                            const firstImage = item.images?.[0];
                            const imageCount = item.images?.length ?? 0;
                            const isFailedItem = item.status === 'failed';
                            const failureMessage = item.failureMessage?.trim();
                            const isMultiImage = imageCount > 1;
                            const itemKey = item.timestamp;
                            const hasPrompt = item.prompt.trim().length > 0;
                            const originalStorageMode = item.storageModeUsed || 'fs';
                            const outputFormat = item.output_format || 'png';
                            const costBadge = getCostBadge(item, {
                                actual: t('history.actualCostShort'),
                                estimated: t('history.estimatedCostShort'),
                                pending: t('history.actualCostPending')
                            });
                            const requestIds = getHistoryClientRequestIds(item);
                            const filenames = item.images.map((image) => image.filename);
                            const isBatchExpanded = expandedBatchTimestamp === item.timestamp;
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
                                <div
                                    key={itemKey}
                                    className='flex w-[min(76vw,280px)] shrink-0 snap-start flex-col lg:w-auto'>
                                    <div className='group relative'>
                                        <button
                                            type='button'
                                            onClick={() => onSelectImage(item)}
                                            disabled={isFailedItem}
                                            className={cn(
                                                'focus:ring-ring focus:ring-offset-background border-border relative block aspect-square w-full overflow-hidden rounded-t-md border transition-[border-color,filter,transform,box-shadow] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none active:translate-y-0',
                                                isFailedItem
                                                    ? 'cursor-default'
                                                    : 'hover:border-foreground/20 cursor-pointer hover:-translate-y-0.5 hover:brightness-110'
                                            )}
                                            aria-label={t('history.viewBatch', {
                                                time: formatTimestamp(item.timestamp)
                                            })}>
                                            {isFailedItem ? (
                                                <div className='bg-destructive/5 text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs'>
                                                    <AlertTriangle
                                                        size={20}
                                                        className='text-destructive'
                                                        aria-hidden='true'
                                                    />
                                                    <span className='text-foreground font-medium'>
                                                        {t('history.failedStatus')}
                                                    </span>
                                                    <span className='line-clamp-2'>
                                                        {failureMessage || t('history.failedReasonUnavailable')}
                                                    </span>
                                                </div>
                                            ) : !isThumbnailUnavailable && thumbnailUrl && firstImage ? (
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
                                                    'pointer-events-none absolute top-1 left-1 z-10 flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]',
                                                    isFailedItem
                                                        ? 'border-destructive/35 bg-destructive/90 text-destructive-foreground'
                                                        : item.mode === 'edit'
                                                          ? 'border-primary/30 bg-primary/88 text-primary-foreground'
                                                          : 'border-secondary/40 bg-secondary/90 text-secondary-foreground'
                                                )}>
                                                {isFailedItem ? (
                                                    <AlertTriangle size={12} />
                                                ) : item.mode === 'edit' ? (
                                                    <Pencil size={12} />
                                                ) : (
                                                    <SparklesIcon size={12} />
                                                )}
                                                {isFailedItem
                                                    ? t('history.failedStatus')
                                                    : item.mode === 'edit'
                                                      ? t('history.modeEdit')
                                                      : t('history.modeCreate')}
                                            </div>
                                            {isMultiImage && (
                                                <div className='pointer-events-none absolute right-1 bottom-1 z-10 flex items-center gap-1 rounded-sm bg-[oklch(0.28_0.028_58/0.78)] px-1.5 py-0.5 text-[12px] text-white'>
                                                    <Layers size={16} />
                                                    {imageCount}
                                                </div>
                                            )}
                                            <div className='pointer-events-none absolute bottom-1 left-1 z-10 flex items-center gap-1'>
                                                <div className='bg-background/85 text-muted-foreground border-border flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[11px]'>
                                                    {originalStorageMode === 'fs' ? (
                                                        <HardDrive size={12} className='text-muted-foreground' />
                                                    ) : (
                                                        <Database size={12} className='text-primary' />
                                                    )}
                                                    <span>{storageDisplayLabels[originalStorageMode]}</span>
                                                </div>
                                                {item.output_format && (
                                                    <div className='bg-background/85 text-muted-foreground border-border flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[11px]'>
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
                                                            'absolute top-7 right-1 z-20 flex min-h-6 cursor-pointer items-center gap-0.5 rounded-sm px-2 py-0.5 text-[11px] text-white shadow-sm transition-[background-color,transform] hover:-translate-y-0.5 active:translate-y-0',
                                                            costBadge.actual
                                                                ? 'bg-secondary text-secondary-foreground hover:bg-secondary/85'
                                                                : 'bg-foreground/80 text-background hover:bg-foreground/70'
                                                        )}
                                                        aria-label={`${t('history.showCost')} ${costBadge.label}`}>
                                                        <DollarSign size={12} />
                                                        {costBadge.label}
                                                    </button>
                                                </DialogTrigger>
                                                <DialogContent className='sm:max-w-[450px]'>
                                                    <DialogHeader>
                                                        <DialogTitle>{t('history.costBreakdown')}</DialogTitle>
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
                                                                        <div className='border-border bg-card/70 space-y-2 rounded-md border p-3'>
                                                                            <div className='flex justify-between gap-3'>
                                                                                <span>{t('history.actualCost')}</span>
                                                                                <span className='text-foreground font-medium'>
                                                                                    {formatActualCostLabel(
                                                                                        item,
                                                                                        t(
                                                                                            'history.actualCostUnavailable'
                                                                                        ),
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
                                                                                <span>
                                                                                    {t('history.costConfidence')}
                                                                                </span>
                                                                                <span>
                                                                                    {item.actualCostDetails.confidence}
                                                                                </span>
                                                                            </div>
                                                                            {typeof item.actualCostDetails
                                                                                .actualQuota === 'number' && (
                                                                                <div className='flex justify-between gap-3'>
                                                                                    <span>
                                                                                        {t('history.actualQuota')}
                                                                                    </span>
                                                                                    <span>
                                                                                        {item.actualCostDetails.actualQuota.toLocaleString()}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                            {typeof item.actualCostDetails
                                                                                .matchedLogId === 'number' && (
                                                                                <div className='flex justify-between gap-3'>
                                                                                    <span>
                                                                                        {t('history.matchedLogId')}
                                                                                    </span>
                                                                                    <span>
                                                                                        {
                                                                                            item.actualCostDetails
                                                                                                .matchedLogId
                                                                                        }
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
                                                                                <span>
                                                                                    {t('history.textInputTokens')}
                                                                                </span>{' '}
                                                                                <span>
                                                                                    {item.costDetails.text_input_tokens.toLocaleString()}{' '}
                                                                                    (
                                                                                    {formatEstimatedTokenCost(
                                                                                        item.costDetails
                                                                                            .text_input_tokens,
                                                                                        rates.textInputPerToken
                                                                                    )}
                                                                                    )
                                                                                </span>
                                                                            </div>
                                                                            {item.costDetails.image_input_tokens >
                                                                                0 && (
                                                                                <div className='flex justify-between'>
                                                                                    <span>
                                                                                        {t('history.imageInputTokens')}
                                                                                    </span>{' '}
                                                                                    <span>
                                                                                        {item.costDetails.image_input_tokens.toLocaleString()}{' '}
                                                                                        (
                                                                                        {formatEstimatedTokenCost(
                                                                                            item.costDetails
                                                                                                .image_input_tokens,
                                                                                            rates.imageInputPerToken
                                                                                        )}
                                                                                        )
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                            <div className='flex justify-between'>
                                                                                <span>
                                                                                    {t('history.imageOutputTokens')}
                                                                                </span>{' '}
                                                                                <span>
                                                                                    {item.costDetails.image_output_tokens.toLocaleString()}{' '}
                                                                                    (
                                                                                    {formatEstimatedTokenCost(
                                                                                        item.costDetails
                                                                                            .image_output_tokens,
                                                                                        rates.imageOutputPerToken
                                                                                    )}
                                                                                    )
                                                                                </span>
                                                                            </div>
                                                                            <hr className='border-border my-2' />
                                                                            <div className='text-foreground flex justify-between font-medium'>
                                                                                <span>
                                                                                    {t('history.totalEstimatedCost')}
                                                                                </span>
                                                                                <span>
                                                                                    $
                                                                                    {item.costDetails.estimated_cost_usd.toFixed(
                                                                                        4
                                                                                    )}
                                                                                </span>
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
                                                                className='hover:border-border hover:bg-accent hover:text-accent-foreground border border-transparent shadow-sm active:scale-[0.98]'>
                                                                {t('common.close')}
                                                            </Button>
                                                        </DialogClose>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>

                                    <div className='text-muted-foreground bg-card/70 border-border space-y-1 rounded-b-md border border-t-0 p-2 text-xs'>
                                        <p title={t('history.generatedOn', { time: formatTimestamp(item.timestamp) })}>
                                            <span className='text-foreground font-medium'>
                                                {t('history.generatedAt')}
                                            </span>{' '}
                                            {formatStatusTime(item.timestamp)}
                                            <span className='text-muted-foreground/70 px-1'>/</span>
                                            {isFailedItem
                                                ? `${t('history.failedStatus')}，${formatDuration(item.durationMs)}`
                                                : t('history.statusBatchSummary', {
                                                      count: imageCount,
                                                      duration: formatDuration(item.durationMs)
                                                  })}
                                        </p>
                                        {isFailedItem && (
                                            <p className='border-destructive/25 bg-destructive/5 text-destructive rounded-sm border px-2 py-1 leading-4'>
                                                <span className='font-medium'>{t('history.failureReason')}</span>{' '}
                                                {failureMessage || t('history.failedReasonUnavailable')}
                                            </p>
                                        )}
                                        <p>
                                            <span className='text-foreground font-medium'>{t('history.model')}</span>{' '}
                                            {item.model || 'gpt-image-1'}
                                        </p>
                                        <p>
                                            <span className='text-foreground font-medium'>
                                                {t('history.resolution')}
                                            </span>{' '}
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
                                        <p
                                            className='mt-2 max-h-8 min-h-8 overflow-hidden leading-4 break-words'
                                            title={item.prompt || t('history.noPrompt')}>
                                            {item.prompt || t('history.noPrompt')}
                                        </p>
                                        <div className='mt-2 grid grid-cols-3 gap-1'>
                                            <Button
                                                type='button'
                                                variant='outline'
                                                size='sm'
                                                className='min-h-11 min-w-0 px-2 text-[11px] lg:h-7 lg:min-h-0 lg:px-1'
                                                disabled={!hasPrompt}
                                                onClick={() => onSaveInspiration(item.prompt)}
                                                aria-label={t('history.saveHistoryPrompt')}>
                                                <Bookmark className='h-3.5 w-3.5' />
                                                <span className='truncate'>{t('history.saveToInspiration')}</span>
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outline'
                                                size='sm'
                                                className='min-h-11 min-w-0 px-2 text-[11px] lg:h-7 lg:min-h-0 lg:px-1'
                                                disabled={!hasPrompt}
                                                onClick={() => onApplyPrompt(item.prompt, { type: 'history', item })}
                                                aria-label={t('history.reuseHistoryPrompt')}>
                                                <WandSparkles className='h-3.5 w-3.5' />
                                                <span className='truncate'>{t('history.reuseHistory')}</span>
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outline'
                                                size='sm'
                                                className='min-h-11 min-w-0 px-2 text-[11px] lg:h-7 lg:min-h-0 lg:px-1'
                                                disabled={!firstImage || isFailedItem}
                                                onClick={() => onSendHistoryToEdit(item)}
                                                aria-label={t('history.continueHistoryEdit')}>
                                                <Pencil className='h-3.5 w-3.5' />
                                                <span className='truncate'>{t('history.continueEdit')}</span>
                                            </Button>
                                        </div>
                                        {isMultiImage && (
                                            <div className='mt-2 space-y-1.5'>
                                                <Button
                                                    type='button'
                                                    variant='ghost'
                                                    size='sm'
                                                    className='text-muted-foreground hover:text-foreground min-h-11 w-full justify-between px-2 text-[11px] lg:h-7 lg:min-h-0'
                                                    aria-expanded={isBatchExpanded}
                                                    aria-controls={`history-batch-${item.timestamp}`}
                                                    onClick={() =>
                                                        setExpandedBatchTimestamp((current) =>
                                                            current === item.timestamp ? null : item.timestamp
                                                        )
                                                    }>
                                                    <span>
                                                        {isBatchExpanded
                                                            ? t('history.collapseBatch')
                                                            : t('history.expandBatch')}
                                                    </span>
                                                    <span className='inline-flex items-center gap-1'>
                                                        {t('history.batchImageCount', { count: imageCount })}
                                                        <ChevronDown
                                                            className={cn(
                                                                'h-3.5 w-3.5 transition-transform',
                                                                isBatchExpanded && 'rotate-180'
                                                            )}
                                                        />
                                                    </span>
                                                </Button>
                                                {isBatchExpanded && (
                                                    <div
                                                        id={`history-batch-${item.timestamp}`}
                                                        className='batch-thumbnail-strip grid grid-cols-3 gap-1.5'
                                                        aria-label={t('history.batchThumbnails')}>
                                                        {item.images.map((image, index) => {
                                                            const imageSrc =
                                                                originalStorageMode === 'indexeddb'
                                                                    ? getImageSrc(image.filename)
                                                                    : `/api/image/${image.filename}`;
                                                            const unavailable =
                                                                !imageSrc || failedThumbnails[image.filename];

                                                            return (
                                                                <button
                                                                    key={`${item.timestamp}-${image.filename}`}
                                                                    type='button'
                                                                    onClick={() => onSelectImage(item)}
                                                                    className='border-border bg-muted relative aspect-square overflow-hidden rounded-sm border'
                                                                    aria-label={t('history.batchThumbnail', {
                                                                        index: index + 1
                                                                    })}>
                                                                    {!unavailable ? (
                                                                        <Image
                                                                            src={imageSrc}
                                                                            alt={t('history.batchThumbnail', {
                                                                                index: index + 1
                                                                            })}
                                                                            fill
                                                                            sizes='88px'
                                                                            className='object-cover'
                                                                            onLoad={(event) =>
                                                                                handleThumbnailLoad(
                                                                                    image.filename,
                                                                                    event
                                                                                )
                                                                            }
                                                                            onError={() =>
                                                                                handleThumbnailError(image.filename)
                                                                            }
                                                                            unoptimized
                                                                        />
                                                                    ) : (
                                                                        <span className='text-muted-foreground flex h-full items-center justify-center px-1 text-center text-[10px] leading-3'>
                                                                            {t('history.previewUnavailable')}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div className='mt-1 flex items-center gap-1'>
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
                                                        <DialogTitle>{t('history.details')}</DialogTitle>
                                                        <DialogDescription className='sr-only'>
                                                            {t('history.detailsDescription')}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <div className='space-y-3'>
                                                        <dl className='border-border bg-card/70 grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border p-3 text-sm sm:grid-cols-3'>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.generatedAt')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {formatTimestamp(item.timestamp)}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.time')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {formatDuration(item.durationMs)}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.mode')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.mode === 'edit'
                                                                        ? t('history.modeEdit')
                                                                        : t('history.modeCreate')}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.model')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.model || 'gpt-image-1'}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.resolution')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {formatResolution(item, firstImage)}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.quality')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.quality}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.bg')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.background}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.mod')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.moderation}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.imageCount')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {imageCount.toLocaleString(locale)}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.outputFormat')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {outputFormat.toUpperCase()}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.storage')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {originalStorageMode === 'fs'
                                                                        ? t('history.storageFile')
                                                                        : t('history.storageDb')}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.costStatus')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {costStatus}
                                                                </dd>
                                                            </div>
                                                            {isFailedItem && (
                                                                <div>
                                                                    <dt className='text-muted-foreground'>
                                                                        {t('history.status')}
                                                                    </dt>
                                                                    <dd className='text-destructive font-medium'>
                                                                        {t('history.failedStatus')}
                                                                    </dd>
                                                                </div>
                                                            )}
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.actualCost')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {formatActualCostLabel(
                                                                        item,
                                                                        t('history.actualCostUnavailable'),
                                                                        t('history.actualCostPending')
                                                                    )}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.totalEstimatedCost')}
                                                                </dt>
                                                                <dd className='text-foreground font-medium'>
                                                                    {item.costDetails
                                                                        ? `$${item.costDetails.estimated_cost_usd.toFixed(4)}`
                                                                        : '-'}
                                                                </dd>
                                                            </div>
                                                        </dl>
                                                        {isFailedItem && (
                                                            <div>
                                                                <p className='mb-1 text-sm font-medium'>
                                                                    {t('history.failureReason')}
                                                                </p>
                                                                <div className='border-destructive/25 bg-destructive/5 text-destructive max-h-[180px] overflow-y-auto rounded-md border p-3 text-sm break-words whitespace-pre-wrap'>
                                                                    {failureMessage ||
                                                                        t('history.failedReasonUnavailable')}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <dl className='border-border bg-card/70 space-y-2 rounded-md border p-3 text-sm'>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.filename')}
                                                                </dt>
                                                                <dd className='text-foreground mt-1 font-mono text-xs break-all'>
                                                                    {filenames.length > 0 ? filenames.join(', ') : '-'}
                                                                </dd>
                                                            </div>
                                                            <div>
                                                                <dt className='text-muted-foreground'>
                                                                    {t('history.requestId')}
                                                                </dt>
                                                                <dd className='text-foreground mt-1 font-mono text-xs break-all'>
                                                                    {requestIds.length > 0
                                                                        ? requestIds.join(', ')
                                                                        : '-'}
                                                                </dd>
                                                            </div>
                                                        </dl>
                                                        <div>
                                                            <p className='mb-1 text-sm font-medium'>
                                                                {t('history.prompt')}
                                                            </p>
                                                            <div className='text-foreground bg-muted border-border max-h-[320px] overflow-y-auto rounded-md border p-3 py-4 text-sm break-words whitespace-pre-wrap'>
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
                                                                className='hover:border-border hover:bg-accent hover:text-accent-foreground border border-transparent shadow-sm active:scale-[0.98]'>
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
                                                        className='bg-destructive hover:bg-destructive/90 h-6 w-6 text-white'
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
                                                        <DialogTitle>{t('history.confirmDeletion')}</DialogTitle>
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
                                                        <Button
                                                            type='button'
                                                            variant='outline'
                                                            size='sm'
                                                            onClick={onCancelDeletion}>
                                                            {t('common.cancel')}
                                                        </Button>
                                                        <Button
                                                            type='button'
                                                            variant='destructive'
                                                            size='sm'
                                                            onClick={onConfirmDeletion}>
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
            <ActivityTimeline
                activityItems={activityItems}
                history={history}
                pendingActivityItems={pendingActivityItems}
                onSelectImage={onSelectImage}
                onClearHistory={onClearHistory}
                getImageSrc={getImageSrc}
                formatStatusTime={formatStatusTime}
                formatDuration={formatDuration}
                t={t}
            />
        </Card>
    );
}

export const HistoryPanel = React.memo(HistoryPanelImpl);
