'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Loader2, Send, Grid } from 'lucide-react';
import Image from 'next/image';

type ImageInfo = {
    path: string;
    filename: string;
};

type ImageOutputProps = {
    imageBatch: ImageInfo[] | null;
    viewMode: 'grid' | number;
    onViewChange: (view: 'grid' | number) => void;
    altText?: string;
    isLoading: boolean;
    onSendToEdit: (filename: string) => void;
    currentMode: 'generate' | 'edit';
    baseImagePreviewUrl: string | null;
    streamingPreviewImages?: Map<number, string>;
};

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
    currentMode,
    baseImagePreviewUrl,
    streamingPreviewImages
}: ImageOutputProps) {
    const { t } = useI18n();
    const handleSendClick = () => {
        // 只有选中单张图片时才允许发送到编辑。
        if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
            onSendToEdit(imageBatch[viewMode].filename);
        }
    };

    const showCarousel = imageBatch && imageBatch.length > 1;
    const isSingleImageView = typeof viewMode === 'number';
    const canSendToEdit = !isLoading && isSingleImageView && imageBatch && imageBatch[viewMode];

    return (
        <div className='flex h-full min-h-[300px] w-full flex-col items-center justify-between gap-4 overflow-hidden rounded-lg border border-white/20 bg-black p-4'>
            <div className='relative flex h-full w-full flex-grow items-center justify-center overflow-hidden'>
                {isLoading ? (
                    streamingPreviewImages && streamingPreviewImages.size > 0 ? (
                        // 展示流式预览图，单图时和最终视图一样居中。
                        <div className='relative flex h-full w-full items-center justify-center'>
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
                                        className='max-h-full max-w-full object-contain'
                                        unoptimized
                                    />
                                );
                            })()}
                            {/* 在底部居中叠加加载状态。 */}
                            <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-white/80'>
                                <Loader2 className='h-4 w-4 animate-spin' />
                                <p className='text-sm'>{t('output.streaming')}</p>
                            </div>
                        </div>
                    ) : currentMode === 'edit' && baseImagePreviewUrl ? (
                        <div className='relative flex h-full w-full items-center justify-center'>
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
                        <div className='flex flex-col items-center justify-center text-white/60'>
                            <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                            <p>{t('output.generating')}</p>
                        </div>
                    )
                ) : imageBatch && imageBatch.length > 0 ? (
                    viewMode === 'grid' ? (
                        <div
                            className={`grid ${getGridColsClass(imageBatch.length)} max-h-full w-full max-w-full gap-1 p-1`}>
                            {imageBatch.map((img, index) => (
                                <div
                                    key={img.filename}
                                    className='relative aspect-square overflow-hidden rounded border border-white/10'>
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
                        <Image
                            src={imageBatch[viewMode].path}
                            alt={altText}
                            width={512}
                            height={512}
                            className='max-h-full max-w-full object-contain'
                            unoptimized
                        />
                    ) : (
                        <div className='text-center text-white/60'>
                            <p>{t('output.error')}</p>
                        </div>
                    )
                ) : (
                    <div className='text-center text-white/60'>
                        <p>{t('output.empty')}</p>
                    </div>
                )}
            </div>

            <div className='flex h-10 w-full shrink-0 items-center justify-center gap-4'>
                {showCarousel && (
                    <div className='flex items-center gap-1.5 rounded-md border border-white/10 bg-neutral-800/50 p-1'>
                        <Button
                            variant='ghost'
                            size='icon'
                            className={cn(
                                'h-8 w-8 rounded p-1',
                                viewMode === 'grid'
                                    ? 'bg-white/20 text-white'
                                    : 'text-white/50 hover:bg-white/10 hover:text-white/80'
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
                                        ? 'ring-2 ring-white ring-offset-1 ring-offset-black'
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

                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleSendClick}
                    disabled={!canSendToEdit}
                    className={cn(
                        'shrink-0 border-white/20 text-white/80 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-50',
                        // 多图网格视图下完全隐藏按钮。
                        showCarousel && viewMode === 'grid' ? 'invisible' : 'visible'
                    )}>
                    <Send className='mr-2 h-4 w-4' />
                    {t('output.sendToEdit')}
                </Button>
            </div>
        </div>
    );
}
