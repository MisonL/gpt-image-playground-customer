'use client';

import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CircleCheck } from 'lucide-react';

type WorkbenchStatusStripProps = {
    model: string;
    streamStatus: string;
    costLabel: string;
    className?: string;
};

export function WorkbenchStatusStrip({ model, streamStatus, costLabel, className }: WorkbenchStatusStripProps) {
    const { t } = useI18n();

    return (
        <div className={cn('flex flex-wrap items-center gap-2 text-sm text-muted-foreground', className)}>
            <span className='inline-flex min-h-7 items-center gap-2 rounded-full border border-border bg-card/70 px-2.5 py-1'>
                <CircleCheck className='h-3.5 w-3.5 text-[oklch(0.5_0.12_150)]' />
                {t('app.apiConnected')}
            </span>
            <span className='inline-flex min-h-7 items-center rounded-full border border-border bg-card/70 px-2.5 py-1'>
                {model}
            </span>
            <span className='inline-flex min-h-7 items-center rounded-full border border-[oklch(0.78_0.055_205)] bg-[oklch(0.94_0.028_205)] px-2.5 py-1 text-[oklch(0.38_0.065_218)]'>
                {streamStatus}
            </span>
            <span className='inline-flex min-h-7 items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary'>
                {costLabel}
            </span>
        </div>
    );
}
