'use client';

import { ImageCompareView, resolveCompareTargetIndex } from '@/components/image-compare-view';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { filterLogsByScope, resolveLogClientRequestIds } from '@/lib/log-filter';
import { cn } from '@/lib/utils';
import {
    Copy,
    Download,
    GitCompare,
    Grid,
    Loader2,
    MoreHorizontal,
    RefreshCcw,
    Send,
    Share2,
    Activity,
    Trash2
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type ImageInfo = {
    path: string;
    filename: string;
    clientRequestId?: string;
    storageMode?: 'fs' | 'indexeddb';
};

type ImageOutputProps = {
    imageBatch: ImageInfo[] | null;
    viewMode: 'grid' | number;
    onViewChange: (view: 'grid' | number) => void;
    altText?: string;
    isLoading: boolean;
    onSendToEdit: (filename: string, storageMode?: ImageInfo['storageMode']) => void;
    onDownloadImage: (filename: string) => void;
    onShareImage: (filename: string) => void;
    onCreateVariant: () => void;
    onReusePrompt: () => void;
    failureMessage?: string | null;
    onRetry?: () => void;
    compareImage?: ImageInfo | null;
    compareImageLabel?: string;
    canCreateVariant: boolean;
    canReusePrompt: boolean;
    currentMode: 'generate' | 'edit';
    baseImagePreviewUrl: string | null;
    streamingPreviewImages?: Map<number, string>;
    isStreamingRequest?: boolean;
    clientPasswordHash: string | null;
    canOpenLogs: boolean;
    openLogsSignal?: number;
    logClientRequestIds?: string[];
    logFilenames?: string[];
};

type LogEntry = {
    id: number;
    at: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    context?: string;
    clientRequestId?: string;
    filenames?: string[];
};

type ImageDimensions = {
    width: number;
    height: number;
};

export function buildSendToEditTarget(
    image: ImageInfo | null
): { filename: string; storageMode?: ImageInfo['storageMode'] } | null {
    if (!image) return null;
    return {
        filename: image.filename,
        ...(image.storageMode ? { storageMode: image.storageMode } : {})
    };
}

function formatLogTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString();
}

function readImageDimensionsFromSource(source: string): Promise<ImageDimensions | null> {
    return new Promise((resolve) => {
        const image = new window.Image();
        image.onload = () => {
            if (!image.naturalWidth || !image.naturalHeight) {
                resolve(null);
                return;
            }
            resolve({
                width: image.naturalWidth,
                height: image.naturalHeight
            });
        };
        image.onerror = () => resolve(null);
        image.src = source;
    });
}

const getGridColsClass = (count: number): string => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 9) return 'grid-cols-3';
    return 'grid-cols-3';
};

type ResultActionButtonProps = {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    emphasized?: boolean;
    iconOnly?: boolean;
};

function ResultActionButton({
    icon,
    label,
    onClick,
    disabled = false,
    active = false,
    emphasized = false,
    iconOnly = false
}: ResultActionButtonProps) {
    return (
        <Button
            variant='ghost'
            size='sm'
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'text-muted-foreground hover:text-foreground h-8 shrink-0 rounded-md px-2 text-xs disabled:opacity-50',
                active && 'bg-accent text-accent-foreground hover:text-accent-foreground',
                emphasized && 'border-border/70 bg-card/80 border'
            )}
            aria-label={iconOnly ? label : undefined}>
            {icon}
            {!iconOnly && <span>{label}</span>}
        </Button>
    );
}

export function ImageOutput({
    imageBatch,
    viewMode,
    onViewChange,
    altText = 'Generated image output',
    isLoading,
    onSendToEdit,
    onDownloadImage,
    onShareImage,
    onCreateVariant,
    onReusePrompt,
    failureMessage = null,
    onRetry,
    compareImage = null,
    compareImageLabel,
    canCreateVariant,
    canReusePrompt,
    currentMode,
    baseImagePreviewUrl,
    streamingPreviewImages,
    isStreamingRequest = false,
    clientPasswordHash,
    canOpenLogs,
    openLogsSignal,
    logClientRequestIds = [],
    logFilenames = []
}: ImageOutputProps) {
    const { t } = useI18n();
    const [isLogDialogOpen, setIsLogDialogOpen] = React.useState(false);
    const [logs, setLogs] = React.useState<LogEntry[]>([]);
    const [logConnectionState, setLogConnectionState] = React.useState<'idle' | 'connected' | 'error'>('idle');
    const [compareSelection, setCompareSelection] = React.useState<{
        imageBatch: ImageInfo[];
        selectedImageIndex: number;
        compareTargetFilename: string;
    } | null>(null);
    const [imageDimensions, setImageDimensions] = React.useState<Record<string, ImageDimensions>>({});
    const logEndRef = React.useRef<HTMLDivElement | null>(null);
    const resolvedLogClientRequestIds = React.useMemo(
        () => resolveLogClientRequestIds({ logs, clientRequestIds: logClientRequestIds, filenames: logFilenames }),
        [logClientRequestIds, logFilenames, logs]
    );
    const filteredLogs = React.useMemo(
        () => filterLogsByScope({ logs, clientRequestIds: resolvedLogClientRequestIds, filenames: [] }) as LogEntry[],
        [logs, resolvedLogClientRequestIds]
    );
    const hasSelectedImageBatch = !!imageBatch && imageBatch.length > 0;
    const hasLogScope = resolvedLogClientRequestIds.length > 0;
    const hasScopeCandidate = logClientRequestIds.length > 0 || logFilenames.length > 0;
    const visibleLogs = React.useMemo(() => (hasLogScope ? filteredLogs : []), [filteredLogs, hasLogScope]);
    const showCarousel = Boolean(imageBatch && imageBatch.length > 1);
    const selectedImageIndex =
        imageBatch && imageBatch.length > 0
            ? typeof viewMode === 'number' && imageBatch[viewMode]
                ? viewMode
                : 0
            : null;
    const selectedImage = selectedImageIndex === null ? null : imageBatch?.[selectedImageIndex] || null;
    const sameBatchCompareTargetIndex = imageBatch
        ? resolveCompareTargetIndex(imageBatch.length, selectedImageIndex)
        : null;
    const sameBatchCompareTargetImage =
        sameBatchCompareTargetIndex === null ? null : imageBatch?.[sameBatchCompareTargetIndex] || null;
    const compareTargetImage = sameBatchCompareTargetImage || compareImage || null;
    const selectedImageDimensions = selectedImage ? imageDimensions[selectedImage.filename] : null;
    const hasFailure = !isLoading && !hasSelectedImageBatch && Boolean(failureMessage);
    const hasEditReferencePreview = currentMode === 'edit' && Boolean(baseImagePreviewUrl);
    const previewStateLabel = isLoading
        ? t('output.progressDeveloping')
        : hasFailure
          ? t('output.failedTitle')
          : hasEditReferencePreview
            ? t('output.editReferenceReady')
            : currentMode === 'edit'
              ? t('output.editReferenceNeeded')
              : imageBatch && imageBatch.length > 0
                ? t('output.previewReady')
                : t('output.emptyTitle');
    const previewMetaItems = [
        !isLoading && imageBatch && imageBatch.length > 0
            ? t('output.selectedImageMeta', {
                  index: selectedImageIndex === null ? 1 : selectedImageIndex + 1,
                  count: imageBatch.length
              })
            : null,
        !isLoading && selectedImageDimensions
            ? t('output.imageDimensions', {
                  width: selectedImageDimensions.width,
                  height: selectedImageDimensions.height
              })
            : null,
        isLoading ? (isStreamingRequest ? t('output.streaming') : t('output.progressGenerating')) : null
    ].filter((item): item is string => Boolean(item));
    const canUseSelectedImageActions = !isLoading && !!selectedImage;
    const canCompareImages = !isLoading && !!selectedImage && !!compareTargetImage;
    const isCompareView =
        !!compareSelection &&
        compareSelection.imageBatch === imageBatch &&
        compareSelection.selectedImageIndex === selectedImageIndex &&
        compareSelection.compareTargetFilename === compareTargetImage?.filename;
    const compareReferenceLabel = sameBatchCompareTargetImage
        ? selectedImageIndex === 0
            ? t('output.compareOther')
            : t('output.compareReference')
        : (compareImageLabel ?? t('output.compareReference'));

    const handleSendClick = () => {
        const target = buildSendToEditTarget(selectedImage);
        if (!target) return;
        onSendToEdit(target.filename, target.storageMode);
    };

    const handleDownloadClick = () => {
        if (selectedImage) {
            onDownloadImage(selectedImage.filename);
        }
    };

    const handleShareClick = () => {
        if (selectedImage) {
            onShareImage(selectedImage.filename);
        }
    };

    const handleCompareClick = () => {
        if (canCompareImages && imageBatch && selectedImageIndex !== null && compareTargetImage) {
            setCompareSelection({ imageBatch, selectedImageIndex, compareTargetFilename: compareTargetImage.filename });
        }
    };

    const handleImageLoad = React.useCallback((filename: string, event: React.SyntheticEvent<HTMLImageElement>) => {
        const source = event.currentTarget.currentSrc || event.currentTarget.src;
        if (!source) return;

        void readImageDimensionsFromSource(source).then((nextDimensions) => {
            if (!nextDimensions) return;
            setImageDimensions((current) => {
                const currentDimensions = current[filename];
                if (
                    currentDimensions?.width === nextDimensions.width &&
                    currentDimensions.height === nextDimensions.height
                ) {
                    return current;
                }
                return { ...current, [filename]: nextDimensions };
            });
        });
    }, []);

    const handleLogDialogOpenChange = (open: boolean) => {
        setIsLogDialogOpen(open);
        if (!open) {
            setLogConnectionState('idle');
        }
    };

    React.useEffect(() => {
        if (!isLogDialogOpen || !canOpenLogs) return;

        const abortController = new AbortController();
        const readLogs = async () => {
            try {
                const response = await fetch('/api/logs', {
                    headers: clientPasswordHash ? { Authorization: `Bearer ${clientPasswordHash}` } : {},
                    signal: abortController.signal
                });
                if (!response.ok || !response.body) {
                    setLogConnectionState('error');
                    return;
                }

                setLogConnectionState('connected');
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                const processEvent = (rawEvent: string) => {
                    const dataLines = rawEvent
                        .split(/\r?\n/)
                        .filter((line) => line.startsWith('data: '))
                        .map((line) => line.slice(6));
                    if (dataLines.length === 0) return;

                    let entry: LogEntry;
                    try {
                        entry = JSON.parse(dataLines.join('\n')) as LogEntry;
                    } catch (error) {
                        console.error('解析日志事件失败。', error);
                        return;
                    }

                    setLogs((prevLogs) => {
                        const nextLogs = prevLogs.some((log) => log.id === entry.id)
                            ? prevLogs
                            : [...prevLogs, entry].slice(-300);
                        return nextLogs;
                    });
                };

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const events = buffer.split(/\n\n|\r\n\r\n/);
                    buffer = events.pop() || '';
                    events.forEach(processEvent);
                }

                const remainingEvent = buffer.trim();
                if (remainingEvent) {
                    processEvent(remainingEvent);
                }
                setLogConnectionState('idle');
            } catch (error) {
                if (abortController.signal.aborted) return;
                console.error('读取日志流失败。', error);
                setLogConnectionState('error');
            }
        };

        void readLogs();

        return () => {
            abortController.abort();
        };
    }, [canOpenLogs, clientPasswordHash, isLogDialogOpen]);

    React.useEffect(() => {
        if (!isLogDialogOpen) return;
        logEndRef.current?.scrollIntoView({ block: 'end' });
    }, [isLogDialogOpen, visibleLogs]);

    React.useEffect(() => {
        if (!openLogsSignal || !canOpenLogs) return;
        queueMicrotask(() => setIsLogDialogOpen(true));
    }, [canOpenLogs, openLogsSignal]);

    return (
        <div className='workbench-panel text-card-foreground border-border flex h-full min-h-[300px] w-full flex-col overflow-hidden rounded-lg border'>
            <div className='border-border/70 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
                <h2 className='editorial-title text-xl font-semibold'>{t('output.previewTitle')}</h2>
                <div className='text-muted-foreground flex flex-wrap items-center gap-3 text-xs'>
                    <span className='inline-flex items-center gap-1.5'>
                        {isLoading ? (
                            <Loader2 className='text-primary h-3.5 w-3.5 animate-spin' />
                        ) : (
                            <span
                                className={cn(
                                    'h-2 w-2 rounded-full',
                                    imageBatch && imageBatch.length > 0
                                        ? 'bg-[oklch(0.5_0.12_150)]'
                                        : 'bg-muted-foreground/45'
                                )}
                            />
                        )}
                        {previewStateLabel}
                    </span>
                    {previewMetaItems.map((item) => (
                        <span key={item}>{item}</span>
                    ))}
                </div>
            </div>
            <div className='preview-gallery-board relative flex min-h-[300px] flex-1 items-center justify-center overflow-hidden px-3 py-5 sm:min-h-[420px] sm:px-6 lg:min-h-[520px]'>
                {isLoading ? (
                    streamingPreviewImages && streamingPreviewImages.size > 0 ? (
                        // 展示流式预览图，单图时和最终视图一样居中。
                        <div className='photo-paper relative flex aspect-[4/3] w-full max-w-[720px] items-center justify-center p-3'>
                            {/* 展示最新的预览图，也就是最大索引图片。 */}
                            {(() => {
                                const entries = Array.from(streamingPreviewImages.entries());
                                const latestEntry = entries[entries.length - 1];
                                if (!latestEntry) return null;
                                const [, dataUrl] = latestEntry;
                                return (
                                    <Image
                                        src={dataUrl}
                                        alt={t('output.streaming')}
                                        width={512}
                                        height={512}
                                        className='h-full w-full object-contain'
                                        unoptimized
                                    />
                                );
                            })()}
                            {/* 在底部居中叠加加载状态。 */}
                            <div className='bg-foreground/80 text-background absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5'>
                                <Loader2 className='h-4 w-4 animate-spin' />
                                <p className='text-sm'>{t('output.streaming')}</p>
                            </div>
                        </div>
                    ) : currentMode === 'edit' && baseImagePreviewUrl ? (
                        <div className='photo-paper relative flex aspect-[4/3] w-full max-w-[720px] items-center justify-center p-3'>
                            <Image
                                src={baseImagePreviewUrl}
                                alt={t('output.editing')}
                                fill
                                style={{ objectFit: 'contain' }}
                                className='blur-md filter'
                                unoptimized
                            />
                            <div className='absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white/80'>
                                <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                                <p>{t('output.editing')}</p>
                            </div>
                        </div>
                    ) : (
                        <div className='text-muted-foreground flex flex-col items-center justify-center'>
                            <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                            <p>{isStreamingRequest ? t('output.keepalive') : t('output.generating')}</p>
                        </div>
                    )
                ) : hasFailure ? (
                    <div className='photo-paper relative flex aspect-[4/3] w-full max-w-[720px] flex-col justify-between p-5 sm:p-6'>
                        <div className='space-y-3'>
                            <div className='text-muted-foreground text-xs'>{t('output.failedKicker')}</div>
                            <div className='space-y-2'>
                                <h3 className='editorial-title text-2xl font-semibold'>{t('output.failedTitle')}</h3>
                                <p className='text-muted-foreground max-w-[46rem] text-sm leading-6'>
                                    {failureMessage}
                                </p>
                            </div>
                        </div>
                        <div className='flex flex-wrap items-center gap-2'>
                            {onRetry ? (
                                <Button type='button' onClick={onRetry} className='min-h-11'>
                                    <RefreshCcw className='mr-2 h-4 w-4' />
                                    {t('output.retry')}
                                </Button>
                            ) : null}
                            {canOpenLogs ? (
                                <Button
                                    type='button'
                                    variant='outline'
                                    onClick={() => setIsLogDialogOpen(true)}
                                    className='bg-background/76 min-h-11'>
                                    <Activity className='mr-2 h-4 w-4' />
                                    {t('logs.open')}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ) : isCompareView && selectedImage && compareTargetImage ? (
                    <ImageCompareView
                        leftImage={compareTargetImage}
                        leftLabel={compareReferenceLabel}
                        rightImage={selectedImage}
                        rightLabel={t('output.compareCurrent')}
                    />
                ) : imageBatch && imageBatch.length > 0 ? (
                    viewMode === 'grid' ? (
                        <div className={`grid ${getGridColsClass(imageBatch.length)} w-full max-w-[720px] gap-2`}>
                            {imageBatch.map((img, index) => (
                                <button
                                    type='button'
                                    key={img.filename}
                                    onClick={() => onViewChange(index)}
                                    className={cn(
                                        'photo-paper relative aspect-square overflow-hidden p-2 text-left transition-[box-shadow,transform] enabled:motion-safe:hover:-translate-y-0.5',
                                        selectedImageIndex === index
                                            ? 'ring-ring ring-offset-background ring-2 ring-offset-2'
                                            : 'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2'
                                    )}
                                    aria-label={t('output.selectImage', { index: index + 1 })}>
                                    <Image
                                        src={img.path}
                                        alt={t('output.generatedImage', { index: index + 1 })}
                                        fill
                                        style={{ objectFit: 'contain' }}
                                        sizes='(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw'
                                        onLoad={(event) => handleImageLoad(img.filename, event)}
                                        unoptimized
                                    />
                                </button>
                            ))}
                        </div>
                    ) : imageBatch[viewMode] ? (
                        <div className='photo-paper relative aspect-[4/3] w-full max-w-[720px] p-3'>
                            <Image
                                src={imageBatch[viewMode].path}
                                alt={altText}
                                fill
                                sizes='(max-width: 768px) 92vw, (max-width: 1800px) 44vw, 720px'
                                className='object-contain'
                                onLoad={(event) => handleImageLoad(imageBatch[viewMode].filename, event)}
                                unoptimized
                            />
                        </div>
                    ) : (
                        <div className='text-muted-foreground text-center'>
                            <p>{t('output.error')}</p>
                        </div>
                    )
                ) : (
                    <>
                        {currentMode === 'edit' ? (
                            <div className='photo-paper relative flex aspect-[4/3] w-full max-w-[720px] flex-col justify-between p-5 sm:p-6'>
                                {baseImagePreviewUrl ? (
                                    <>
                                        <Image
                                            src={baseImagePreviewUrl}
                                            alt={t('output.editReferenceAlt')}
                                            fill
                                            sizes='(max-width: 768px) 92vw, (max-width: 1800px) 44vw, 720px'
                                            className='object-contain p-3'
                                            unoptimized
                                        />
                                        <div className='border-border/70 bg-background/86 text-muted-foreground absolute bottom-5 left-6 rounded-full border px-3 py-1 text-xs shadow-sm'>
                                            {t('output.editReferenceReadyLabel')}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className='space-y-3'>
                                            <div className='text-muted-foreground text-xs'>
                                                {t('output.editReferenceKicker')}
                                            </div>
                                            <div className='space-y-2'>
                                                <h3 className='editorial-title text-2xl font-semibold'>
                                                    {t('output.editReferenceNeeded')}
                                                </h3>
                                                <p className='text-muted-foreground max-w-[36rem] text-sm leading-6'>
                                                    {t('output.editReferenceDescription')}
                                                </p>
                                            </div>
                                        </div>
                                        <div className='border-border/70 bg-background/78 text-muted-foreground w-fit rounded-full border px-3 py-1 text-xs shadow-sm'>
                                            {t('output.editReferenceWaitingLabel')}
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className='photo-paper relative aspect-[4/3] w-full max-w-[720px] p-3'>
                                <Image
                                    src='/assets/workbench-sample.jpg'
                                    alt={t('output.sampleAlt')}
                                    fill
                                    sizes='(max-width: 768px) 92vw, (max-width: 1800px) 44vw, 720px'
                                    className='sample-art-image object-cover p-2'
                                    loading='eager'
                                />
                                <div className='text-muted-foreground hand-note absolute right-7 bottom-4 rotate-[-2deg] text-sm'>
                                    {t('output.sampleNote')}
                                </div>
                                <div className='border-border/70 bg-background/82 text-muted-foreground absolute bottom-5 left-6 rounded-full border px-3 py-1 text-xs shadow-sm'>
                                    {t('output.sampleLabel')}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <Dialog open={isLogDialogOpen} onOpenChange={handleLogDialogOpenChange}>
                <DialogContent className='sm:max-w-[760px]'>
                    <DialogHeader>
                        <DialogTitle>{t('logs.title')}</DialogTitle>
                        <DialogDescription>{t('logs.description')}</DialogDescription>
                    </DialogHeader>
                    <div className='text-muted-foreground bg-muted/40 border-border flex items-center justify-between rounded-md border px-3 py-2 text-xs'>
                        <span>{t(`logs.status.${logConnectionState}`)}</span>
                        <span>{t('logs.count', { count: visibleLogs.length })}</span>
                    </div>
                    {hasLogScope ? (
                        <div className='text-muted-foreground border-border bg-muted/20 rounded-md border px-3 py-2 text-xs'>
                            {t('logs.scopeSelected')}
                        </div>
                    ) : hasSelectedImageBatch ? (
                        <div className='text-muted-foreground border-border rounded-md border border-dashed px-3 py-2 text-xs'>
                            {t('logs.scopeMissing')}
                        </div>
                    ) : (
                        <div className='text-muted-foreground border-border rounded-md border border-dashed px-3 py-2 text-xs'>
                            {t('logs.scopeNone')}
                        </div>
                    )}
                    <div className='literary-scrollbar bg-muted/30 border-border text-foreground/80 h-[420px] overflow-y-auto rounded-md border p-3 font-mono text-xs leading-5'>
                        {visibleLogs.length === 0 ? (
                            <p className='text-muted-foreground'>
                                {hasLogScope
                                    ? t('logs.emptyForSelection')
                                    : hasSelectedImageBatch && !hasScopeCandidate
                                      ? t('logs.historyWithoutScope')
                                      : t('logs.selectImage')}
                            </p>
                        ) : (
                            visibleLogs.map((entry) => (
                                <div key={entry.id} className='border-border/50 border-b py-2 last:border-b-0'>
                                    <div className='flex flex-wrap items-center gap-2'>
                                        <span className='text-muted-foreground'>{formatLogTime(entry.at)}</span>
                                        <span
                                            className={cn(
                                                'rounded border px-1.5 py-0.5 uppercase',
                                                entry.level === 'error' &&
                                                    'border-red-500/40 text-red-700 dark:border-red-400/40 dark:text-red-200',
                                                entry.level === 'warn' &&
                                                    'border-yellow-500/40 text-yellow-700 dark:border-yellow-400/40 dark:text-yellow-200',
                                                entry.level === 'info' &&
                                                    'border-blue-500/40 text-blue-700 dark:border-blue-300/30 dark:text-blue-100',
                                                entry.level === 'debug' && 'border-border text-muted-foreground'
                                            )}>
                                            {entry.level}
                                        </span>
                                        <span className='text-foreground break-all'>{entry.message}</span>
                                    </div>
                                    {entry.context ? (
                                        <pre className='text-muted-foreground mt-1 break-words whitespace-pre-wrap'>
                                            {entry.context}
                                        </pre>
                                    ) : null}
                                </div>
                            ))
                        )}
                        <div ref={logEndRef} />
                    </div>
                    <DialogFooter>
                        <Button type='button' variant='outline' size='sm' onClick={() => setLogs([])}>
                            <Trash2 className='mr-2 h-4 w-4' />
                            {t('logs.clear')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div
                className={cn(
                    'border-border/40 flex w-full shrink-0 flex-wrap items-center justify-center gap-1 border-t bg-transparent px-3 py-2',
                    !hasSelectedImageBatch && 'bg-background/36'
                )}>
                {hasSelectedImageBatch ? (
                    <>
                    {showCarousel && (
                        <div className='bg-card/80 border-border flex max-w-full items-center gap-1.5 overflow-x-auto rounded-md border p-1'>
                            <Button
                                variant='ghost'
                                size='icon'
                                className={cn(
                                    'h-8 w-8 rounded p-1',
                                    viewMode === 'grid' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                                )}
                                onClick={() => onViewChange('grid')}
                                aria-label={t('output.showGrid')}>
                                <Grid className='h-4 w-4' />
                            </Button>
                            {imageBatch.map((img, index) => (
                                <Button
                                    key={img.filename}
                                    variant='ghost'
                                    size='icon'
                                    className={cn(
                                        'h-8 w-8 overflow-hidden rounded p-0.5',
                                        viewMode === index
                                            ? 'ring-ring ring-offset-background ring-2 ring-offset-1'
                                            : 'opacity-60 hover:opacity-100'
                                    )}
                                    onClick={() => onViewChange(index)}
                                    aria-label={t('output.selectImage', { index: index + 1 })}>
                                    <Image
                                        src={img.path}
                                        alt={t('output.thumbnail', { index: index + 1 })}
                                        width={28}
                                        height={28}
                                        className='h-full w-full object-cover'
                                        unoptimized
                                    />
                                </Button>
                            ))}
                        </div>
                    )}

                    {canOpenLogs && (
                        <ResultActionButton
                            icon={<Activity className='mr-2 h-4 w-4' />}
                            label={t('logs.open')}
                            onClick={() => setIsLogDialogOpen(true)}
                        />
                    )}

                    <ResultActionButton
                        icon={<Download className='mr-2 h-4 w-4' />}
                        label={t('output.download')}
                        onClick={handleDownloadClick}
                        disabled={!canUseSelectedImageActions}
                        emphasized={showCarousel && viewMode === 'grid'}
                    />
                    <ResultActionButton
                        icon={<Send className='mr-2 h-4 w-4' />}
                        label={t('output.continueEdit')}
                        onClick={handleSendClick}
                        disabled={!canUseSelectedImageActions}
                        emphasized={showCarousel && viewMode === 'grid'}
                    />
                    <ResultActionButton
                        icon={<RefreshCcw className='mr-2 h-4 w-4' />}
                        label={t('output.createVariant')}
                        onClick={onCreateVariant}
                        disabled={isLoading || !canCreateVariant}
                    />
                    <ResultActionButton
                        icon={<Copy className='mr-2 h-4 w-4' />}
                        label={t('output.reusePrompt')}
                        onClick={onReusePrompt}
                        disabled={isLoading || !canReusePrompt}
                    />
                    <ResultActionButton
                        icon={<GitCompare className='mr-2 h-4 w-4' />}
                        label={t('output.compare')}
                        onClick={handleCompareClick}
                        disabled={!canCompareImages}
                        active={isCompareView}
                    />
                    <ResultActionButton
                        icon={<Share2 className='mr-2 h-4 w-4' />}
                        label={t('output.share')}
                        onClick={handleShareClick}
                        disabled={!canUseSelectedImageActions}
                        emphasized={showCarousel && viewMode === 'grid'}
                    />
                    <ResultActionButton
                        icon={<MoreHorizontal className='h-4 w-4' />}
                        label={t('output.more')}
                        disabled
                        iconOnly
                    />
                    </>
                ) : (
                    <>
                        <ResultActionButton
                            icon={<Download className='mr-2 h-4 w-4' />}
                            label={t('output.download')}
                            disabled
                        />
                        <ResultActionButton
                            icon={<Send className='mr-2 h-4 w-4' />}
                            label={t('output.continueEdit')}
                            disabled
                        />
                        <ResultActionButton
                            icon={<RefreshCcw className='mr-2 h-4 w-4' />}
                            label={t('output.createVariant')}
                            disabled
                        />
                        <ResultActionButton
                            icon={<Copy className='mr-2 h-4 w-4' />}
                            label={t('output.reusePrompt')}
                            disabled
                        />
                        <ResultActionButton
                            icon={<GitCompare className='mr-2 h-4 w-4' />}
                            label={t('output.compare')}
                            disabled
                        />
                    </>
                )}
            </div>
        </div>
    );
}
