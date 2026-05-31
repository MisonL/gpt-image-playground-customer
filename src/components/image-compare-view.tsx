'use client';

import Image from 'next/image';

type CompareImage = {
    path: string;
    filename: string;
};

type ImageCompareViewProps = {
    leftImage: CompareImage;
    leftLabel: string;
    rightImage: CompareImage;
    rightLabel: string;
};

export function resolveCompareTargetIndex(imageCount: number, selectedImageIndex: number | null): number | null {
    if (imageCount <= 1 || selectedImageIndex === null || selectedImageIndex < 0 || selectedImageIndex >= imageCount) {
        return null;
    }

    return selectedImageIndex > 0 ? selectedImageIndex - 1 : 1;
}

export function ImageCompareView({ leftImage, leftLabel, rightImage, rightLabel }: ImageCompareViewProps) {
    return (
        <div className='grid w-full max-w-[760px] grid-cols-2 gap-2 sm:gap-3'>
            {[
                { image: leftImage, label: leftLabel },
                { image: rightImage, label: rightLabel }
            ].map(({ image, label }) => (
                <figure key={`${label}-${image.filename}`} className='photo-paper relative aspect-square overflow-hidden p-2'>
                    <div className='relative h-full w-full'>
                        <Image
                            src={image.path}
                            alt={`${label} ${image.filename}`}
                            fill
                            sizes='(max-width: 768px) 46vw, 28vw'
                            className='object-contain'
                            unoptimized
                        />
                    </div>
                    <figcaption className='absolute top-3 left-3 rounded border border-border/70 bg-background/88 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm'>
                        {label}
                    </figcaption>
                    <span className='absolute right-3 bottom-3 left-3 truncate rounded bg-background/84 px-2 py-1 text-[10px] text-muted-foreground'>
                        {image.filename}
                    </span>
                </figure>
            ))}
        </div>
    );
}
