'use client';

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
    Terminal,
    Trash2
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type ImageInfo = {
    path: string;
    filename: string;
    clientRequestId?: string;
};

type ImageOutputProps = {
    imageBatch: ImageInfo[] | null;
    viewMode: 'grid' | number;
    onViewChange: (view: 'grid' | number) => void;
    altText?: string;
    isLoading: boolean;
    onSendToEdit: (filename: string) => void;
    onDownloadImage: (filename: string) => void;
    onShareImage: (filename: string) => void;
    onCreateVariant: () => void;
    onReusePrompt: () => void;
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

function formatLogTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString();
}

const getGridColsClass = (count: number): string => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 9) return 'grid-cols-3';
    return 'grid-cols-3';
};

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
    const visibleLogs = React.useMemo(
        () => (hasLogScope ? filteredLogs : []),
        [filteredLogs, hasLogScope]
    );

    const handleSendClick = () => {
        // 只有选中单张图片时才允许发送到编辑。
        if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
            onSendToEdit(imageBatch[viewMode].filename);
        }
    };

    const handleDownloadClick = () => {
        if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
            onDownloadImage(imageBatch[viewMode].filename);
        }
    };

    const handleShareClick = () => {
        if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
            onShareImage(imageBatch[viewMode].filename);
        }
    };

    const handleCompareClick = () => {
        if (imageBatch && imageBatch.length > 1) {
            onViewChange('grid');
        }
    };

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

    const showCarousel = imageBatch && imageBatch.length > 1;
    const isSingleImageView = typeof viewMode === 'number';
    const canSendToEdit = !isLoading && isSingleImageView && imageBatch && imageBatch[viewMode];
    const canUseImageActions = !isLoading && isSingleImageView && imageBatch && imageBatch[viewMode];

    return (
        <div className='workbench-panel text-card-foreground flex h-full min-h-[300px] w-full flex-col overflow-hidden rounded-lg border border-border'>
            <div className='flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3'>
                <h2 className='editorial-title text-xl font-semibold'>{t('output.previewTitle')}</h2>
                <div className='text-muted-foreground flex flex-wrap items-center gap-3 text-xs'>
                    <span className='inline-flex items-center gap-1.5'>
                        {isLoading ? (
                            <>
                                <Loader2 className='h-3.5 w-3.5 animate-spin text-primary' />
                                {t('output.progressDeveloping')}
                            </>
                        ) : (
                            t('output.previewReady')
                        )}
                    </span>
                    <span className='h-2 w-24 overflow-hidden rounded-full bg-muted'>
                        <span className='block h-full w-[62%] rounded-full bg-[oklch(0.76_0.12_76)]' />
                    </span>
                    <span>{t('output.estimatedSeconds')}</span>
                    <span>4:3</span>
                    <span>1024 x 768</span>
                </div>
            </div>
            <div className='relative flex min-h-[360px] flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(180deg,oklch(0.995_0.007_85),oklch(0.972_0.016_80))] px-4 py-6 sm:px-8'>
                {isLoading ? (
                    streamingPreviewImages && streamingPreviewImages.size > 0 ? (
                        // 展示流式预览图，单图时和最终视图一样居中。
                        <div className='photo-paper relative flex aspect-[4/3] w-full max-w-[760px] items-center justify-center p-3'>
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
                            <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground/80 px-3 py-1.5 text-background'>
                                <Loader2 className='h-4 w-4 animate-spin' />
                                <p className='text-sm'>{t('output.streaming')}</p>
                            </div>
                        </div>
                    ) : currentMode === 'edit' && baseImagePreviewUrl ? (
                        <div className='photo-paper relative flex aspect-[4/3] w-full max-w-[760px] items-center justify-center p-3'>
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
                ) : imageBatch && imageBatch.length > 0 ? (
                    viewMode === 'grid' ? (
                        <div
                            className={`grid ${getGridColsClass(imageBatch.length)} w-full max-w-[780px] gap-2`}>
                            {imageBatch.map((img, index) => (
                                <div
                                    key={img.filename}
                                    className='photo-paper relative aspect-square overflow-hidden p-2'>
                                    <Image
                                        src={img.path}
                                        alt={t('output.generatedImage', { index: index + 1 })}
                                        fill
                                        style={{ objectFit: 'contain' }}
                                        sizes='(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw'
                                        unoptimized
                                    />
                                </div>
                            ))}
                        </div>
                    ) : imageBatch[viewMode] ? (
                        <div className='photo-paper relative aspect-[4/3] w-full max-w-[760px] p-3'>
                            <Image
                                src={imageBatch[viewMode].path}
                                alt={altText}
                                fill
                                sizes='(max-width: 768px) 92vw, 56vw'
                                className='object-contain'
                                unoptimized
                            />
                        </div>
                    ) : (
                        <div className='text-muted-foreground text-center'>
                            <p>{t('output.error')}</p>
                        </div>
                    )
                ) : (
                    <div className='photo-paper relative aspect-[4/3] w-full max-w-[760px] p-3'>
                        <Image
                            src='/assets/workbench-sample.jpg'
                            alt={t('output.sampleAlt')}
                            fill
                            sizes='(max-width: 768px) 92vw, 56vw'
                            className='object-cover p-3'
                            priority
                        />
                        <div className='absolute right-7 bottom-4 rotate-[-2deg] text-sm text-muted-foreground hand-note'>
                            soft day :)
                        </div>
                        <div className='absolute left-6 bottom-5 rounded-full border border-border/70 bg-background/82 px-3 py-1 text-xs text-muted-foreground shadow-sm'>
                            {t('output.sampleLabel')}
                        </div>
                    </div>
                )}
            </div>

            <Dialog open={isLogDialogOpen} onOpenChange={handleLogDialogOpenChange}>
                <DialogContent className='sm:max-w-[760px]'>
                    <DialogHeader>
                        <DialogTitle>{t('logs.title')}</DialogTitle>
                        <DialogDescription>{t('logs.description')}</DialogDescription>
                    </DialogHeader>
                    <div className='text-muted-foreground bg-muted/40 flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs'>
                        <span>{t(`logs.status.${logConnectionState}`)}</span>
                        <span>{t('logs.count', { count: visibleLogs.length })}</span>
                    </div>
                    {hasLogScope ? (
                        <div className='text-muted-foreground rounded-md border border-border bg-muted/20 px-3 py-2 text-xs'>
                            {t('logs.scopeSelected')}
                        </div>
                    ) : hasSelectedImageBatch ? (
                        <div className='text-muted-foreground rounded-md border border-dashed border-border px-3 py-2 text-xs'>
                            {t('logs.scopeMissing')}
                        </div>
                    ) : (
                        <div className='text-muted-foreground rounded-md border border-dashed border-border px-3 py-2 text-xs'>
                            {t('logs.scopeNone')}
                        </div>
                    )}
                    <div className='bg-muted/30 h-[420px] overflow-y-auto rounded-md border border-border p-3 font-mono text-xs leading-5 text-foreground/80'>
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
                                        <pre className='text-muted-foreground mt-1 whitespace-pre-wrap break-words'>{entry.context}</pre>
                                    ) : null}
                                </div>
                            ))
                        )}
                        <div ref={logEndRef} />
                    </div>
                    <DialogFooter>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setLogs([])}>
                            <Trash2 className='mr-2 h-4 w-4' />
                            {t('logs.clear')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className='flex min-h-12 w-full shrink-0 flex-wrap items-center justify-center gap-1.5 border-t border-border/70 bg-background/72 px-3 py-3'>
                {showCarousel && (
                    <div className='bg-card/80 flex max-w-full items-center gap-1.5 overflow-x-auto rounded-md border border-border p-1'>
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
                                        ? 'ring-2 ring-ring ring-offset-1 ring-offset-background'
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
                    <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setIsLogDialogOpen(true)}
                        className='min-h-9 shrink-0'>
                        <Terminal className='mr-2 h-4 w-4' />
                        {t('logs.open')}
                    </Button>
                )}

                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleSendClick}
                    disabled={!canSendToEdit}
                    className={cn(
                        'min-h-9 shrink-0 disabled:opacity-50',
                        // 多图网格视图下完全隐藏按钮。
                        showCarousel && viewMode === 'grid' ? 'invisible' : 'visible'
                )}>
                    <Send className='mr-2 h-4 w-4' />
                    {t('output.continueEdit')}
                </Button>
                <Button
                    variant='outline'
                    size='sm'
                    onClick={onCreateVariant}
                    disabled={isLoading || !canCreateVariant}
                    className='min-h-9 shrink-0 disabled:opacity-50'>
                    <RefreshCcw className='mr-2 h-4 w-4' />
                    {t('output.createVariant')}
                </Button>
                <Button
                    variant='outline'
                    size='sm'
                    onClick={onReusePrompt}
                    disabled={isLoading || !canReusePrompt}
                    className='min-h-9 shrink-0 disabled:opacity-50'>
                    <Copy className='mr-2 h-4 w-4' />
                    {t('output.reusePrompt')}
                </Button>
                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleCompareClick}
                    disabled={!imageBatch || imageBatch.length <= 1}
                    className='min-h-9 shrink-0 disabled:opacity-50'>
                    <GitCompare className='mr-2 h-4 w-4' />
                    {t('output.compare')}
                </Button>
                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleDownloadClick}
                    disabled={!canUseImageActions}
                    className={cn(
                        'min-h-9 shrink-0 disabled:opacity-50',
                        showCarousel && viewMode === 'grid' ? 'invisible' : 'visible'
                    )}>
                    <Download className='mr-2 h-4 w-4' />
                    {t('output.download')}
                </Button>
                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleShareClick}
                    disabled={!canUseImageActions}
                    className={cn(
                        'min-h-9 shrink-0 disabled:opacity-50',
                        showCarousel && viewMode === 'grid' ? 'invisible' : 'visible'
                    )}>
                    <Share2 className='mr-2 h-4 w-4' />
                    {t('output.share')}
                </Button>
                <Button
                    variant='outline'
                    size='sm'
                    disabled
                    className='min-h-9 shrink-0 disabled:opacity-50'
                    aria-label={t('output.more')}>
                    <MoreHorizontal className='h-4 w-4' />
                </Button>
            </div>
        </div>
    );
}
