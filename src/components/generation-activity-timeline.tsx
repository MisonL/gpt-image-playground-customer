'use client';

import type { GenerationActivityItem } from '@/lib/generation-activity';
import type { HistoryMetadata } from '@/lib/history-metadata';
import { cn } from '@/lib/utils';
import Image from 'next/image';

type ActivityTimelineProps = {
    activityItems: GenerationActivityItem[];
    history: HistoryMetadata[];
    pendingActivityItems: GenerationActivityItem[];
    onSelectImage: (item: HistoryMetadata) => void;
    onClearHistory: () => void;
    getImageSrc: (filename: string) => string | undefined;
    formatStatusTime: (timestamp: number) => string;
    formatDuration: (ms: number) => string;
    t: (key: string, values?: Record<string, string | number>) => string;
};

function getActivityToneClass(tone: GenerationActivityItem['tone']): string {
    if (tone === 'progress') return 'bg-[oklch(0.58_0.1_220)]';
    if (tone === 'success') return 'bg-[oklch(0.58_0.1_145)]';
    if (tone === 'warning') return 'bg-[oklch(0.62_0.13_38)]';
    return 'bg-[oklch(0.72_0.05_86)]';
}

function getActivityToneLabel(tone: GenerationActivityItem['tone'], t: ActivityTimelineProps['t']): string {
    if (tone === 'progress') return t('history.activityToneProgress');
    if (tone === 'success') return t('history.activityToneSuccess');
    if (tone === 'warning') return t('history.activityToneWarning');
    return t('history.activityToneNeutral');
}

function getPendingStageLabel(id: string, t: ActivityTimelineProps['t']): string {
    if (id === 'pending-request') return t('history.pendingRequestStage');
    if (id === 'pending-streaming') return t('history.pendingStreamingStage');
    if (id === 'pending-saved') return t('history.pendingSavedStage');
    if (id === 'pending-failed') return t('history.pendingFailedStage');
    return t('history.activityToneNeutral');
}

function GenerationActivityRows({
    items,
    t,
    compact = false
}: {
    items: GenerationActivityItem[];
    t: ActivityTimelineProps['t'];
    compact?: boolean;
}) {
    return (
        <>
            {items.map((item, index) => (
                <div
                    key={item.id}
                    className={cn(
                        'grid grid-cols-[auto_auto_1fr] items-start gap-2 rounded-md px-2 text-left transition-[background-color]',
                        index === 0 ? 'bg-[oklch(0.96_0.035_82)]' : 'bg-background/58',
                        compact ? 'py-1.5' : 'py-2',
                        item.tone === 'warning' && 'bg-destructive/5'
                    )}>
                    <span className='text-muted-foreground mt-0.5 w-10 shrink-0 text-right text-[10px] leading-4 tabular-nums'>
                        {getActivityToneLabel(item.tone, t)}
                    </span>
                    <span className={cn('flex h-full w-3 justify-center', compact ? 'pt-1' : 'pt-1.5')}>
                        <span className={cn('h-2 w-2 rounded-full', getActivityToneClass(item.tone))} />
                    </span>
                    <span className='min-w-0'>
                        <span className='text-foreground block truncate text-xs font-medium'>{item.label}</span>
                        <span
                            className={cn(
                                'text-muted-foreground block truncate text-[11px]',
                                compact ? 'mt-0 leading-4' : 'mt-0.5'
                            )}>
                            {item.detail}
                        </span>
                    </span>
                </div>
            ))}
        </>
    );
}

function PendingActivityLine({ items, t }: { items: GenerationActivityItem[]; t: ActivityTimelineProps['t'] }) {
    return (
        <div className='activity-feed grid gap-1.5' aria-label={t('history.pendingActivityFeed')}>
            {items.map((item, index) => (
                <div
                    key={item.id}
                    className={cn(
                        'grid grid-cols-[auto_auto_1fr] items-start gap-2 rounded-md px-2 py-1.5 text-xs',
                        index === 1 ? 'bg-[oklch(0.955_0.04_86)]' : 'bg-background/58'
                    )}>
                    <span className='text-muted-foreground mt-0.5 w-10 shrink-0 text-right text-[10px] leading-4 tabular-nums'>
                        {getPendingStageLabel(item.id, t)}
                    </span>
                    <span className='flex h-full w-3 justify-center pt-1'>
                        <span className={cn('h-1.5 w-1.5 rounded-full', getActivityToneClass(item.tone))} />
                    </span>
                    <span className='min-w-0'>
                        <span className='text-foreground block truncate font-medium'>{item.label}</span>
                        <span className='text-muted-foreground mt-0.5 block truncate text-[11px] leading-4'>
                            {item.detail}
                        </span>
                    </span>
                </div>
            ))}
        </div>
    );
}

function ActivityHistoryRow({
    item,
    index,
    hasLiveActivity,
    onSelectImage,
    getImageSrc,
    formatStatusTime,
    formatDuration,
    t
}: {
    item: HistoryMetadata;
    index: number;
    hasLiveActivity: boolean;
    onSelectImage: (item: HistoryMetadata) => void;
    getImageSrc: (filename: string) => string | undefined;
    formatStatusTime: (timestamp: number) => string;
    formatDuration: (ms: number) => string;
    t: (key: string, values?: Record<string, string | number>) => string;
}) {
    const isLatestQuietActivity = index === 0 && !hasLiveActivity;
    const isFailedItem = item.status === 'failed';
    const activityLabel = isFailedItem
        ? t('history.failedStatus')
        : item.mode === 'edit'
          ? t('history.statusEditDone')
          : t('history.statusCreateDone');
    const activityDetail = isFailedItem
        ? item.failureMessage?.trim() || t('history.failedReasonUnavailable')
        : t('history.statusBatchSummary', {
              count: item.images.length,
              duration: formatDuration(item.durationMs)
          });

    return (
        <button
            type='button'
            onClick={() => onSelectImage(item)}
            disabled={isFailedItem}
            className={cn(
                'grid w-full grid-cols-[auto_auto_1fr_auto] items-start gap-2 rounded-md px-2 py-2 text-left transition-[background-color,color,transform] hover:-translate-y-0.5 active:translate-y-0',
                isLatestQuietActivity
                    ? 'text-foreground bg-[oklch(0.95_0.04_86)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[oklch(0.965_0.025_84)]',
                isFailedItem && 'cursor-default hover:translate-y-0'
            )}>
            <span className='text-muted-foreground mt-0.5 w-10 shrink-0 text-right text-[10px] leading-4 tabular-nums'>
                {formatStatusTime(item.timestamp)}
            </span>
            <span className='flex h-full w-3 justify-center pt-1.5'>
                <span
                    className={cn(
                        'h-2 w-2 rounded-full',
                        isFailedItem
                            ? 'bg-destructive'
                            : isLatestQuietActivity
                              ? 'bg-[oklch(0.62_0.13_38)]'
                              : 'bg-[oklch(0.66_0.08_145)]'
                    )}
                />
            </span>
            <span className='min-w-0'>
                <span className='flex min-w-0 items-center gap-2'>
                    <span className='text-foreground truncate text-xs font-medium'>{activityLabel}</span>
                </span>
                <span className='text-muted-foreground mt-0.5 block truncate text-[11px]'>{activityDetail}</span>
            </span>
            <span className='hidden shrink-0 gap-1 sm:flex'>
                {item.images.slice(0, 3).map((image) => {
                    const source =
                        item.storageModeUsed === 'indexeddb'
                            ? getImageSrc(image.filename)
                            : `/api/image/${image.filename}`;
                    return source ? (
                        <span
                            key={image.filename}
                            className='border-background bg-muted relative h-7 w-7 overflow-hidden rounded-sm border shadow-sm'>
                            <Image
                                src={source}
                                alt={image.filename}
                                fill
                                sizes='28px'
                                className='object-cover'
                                unoptimized
                            />
                        </span>
                    ) : null;
                })}
            </span>
        </button>
    );
}

export function ActivityTimeline({
    activityItems,
    history,
    pendingActivityItems,
    onSelectImage,
    onClearHistory,
    getImageSrc,
    formatStatusTime,
    formatDuration,
    t
}: ActivityTimelineProps) {
    const hasActivity = activityItems.length > 0 || history.length > 0;

    return (
        <div className='border-border/60 bg-background/48 shrink-0 border-t p-3 lg:mt-1 lg:min-h-[16.5rem] lg:border-t-0 lg:bg-transparent'>
            <div className='space-y-2 rounded-md border border-[oklch(0.86_0.035_78)] bg-[oklch(0.982_0.014_84)] p-2.5 shadow-[0_6px_16px_oklch(0.42_0.035_58/0.08)]'>
                <div className='flex items-center justify-between gap-2'>
                    <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                            <span className='h-2 w-2 rounded-full bg-[oklch(0.62_0.13_38)]' />
                            <p className='text-sm font-medium'>{t('history.generationStatus')}</p>
                        </div>
                        <p className='text-muted-foreground mt-0.5 truncate text-[11px]'>
                            {t('history.generationStatusHint')}
                        </p>
                    </div>
                    {history.length > 0 ? (
                        <button
                            type='button'
                            className='text-muted-foreground hover:text-foreground shrink-0 text-xs'
                            onClick={onClearHistory}>
                            {t('history.clear')}
                        </button>
                    ) : null}
                </div>
                {hasActivity ? (
                    <div className='max-h-56 space-y-2 overflow-y-auto pr-1 text-xs lg:max-h-[12.5rem]'>
                        <GenerationActivityRows items={activityItems} t={t} compact />
                        {history.slice(0, 4).map((item, index) => (
                            <ActivityHistoryRow
                                key={item.timestamp}
                                item={item}
                                index={index}
                                hasLiveActivity={activityItems.length > 0}
                                onSelectImage={onSelectImage}
                                getImageSrc={getImageSrc}
                                formatStatusTime={formatStatusTime}
                                formatDuration={formatDuration}
                                t={t}
                            />
                        ))}
                    </div>
                ) : (
                    <div className='space-y-1.5'>
                        <p className='text-muted-foreground px-1 text-[11px]'>{t('history.statusEmpty')}</p>
                        <PendingActivityLine items={pendingActivityItems} t={t} />
                    </div>
                )}
            </div>
        </div>
    );
}
