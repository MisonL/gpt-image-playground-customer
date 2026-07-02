'use client';

import { useI18n } from '@/lib/i18n';
import type { RuntimeHealthStatus } from '@/lib/runtime-health-status';
import { cn } from '@/lib/utils';
import { CircleCheck } from 'lucide-react';

type WorkbenchStatusStripProps = {
    model: string;
    routeLabel: string;
    streamStatus: string;
    parallelBatchEnabled?: boolean;
    costLabel: string;
    runtimeHealthStatus?: RuntimeHealthStatus;
    className?: string;
};

export function WorkbenchStatusStrip({
    model,
    routeLabel,
    streamStatus,
    parallelBatchEnabled = false,
    costLabel,
    runtimeHealthStatus = 'runtime-ready',
    className
}: WorkbenchStatusStripProps) {
    const { t } = useI18n();
    const runtimeStatusLabel =
        runtimeHealthStatus === 'custom-override'
            ? t('app.apiCustomOverride')
            : runtimeHealthStatus === 'runtime-ready'
              ? t('app.apiRuntimeReady')
              : runtimeHealthStatus === 'route-limited'
                ? t('app.apiRouteLimited')
                : t('app.apiDisconnected');
    const runtimeStatusColorClass =
        runtimeHealthStatus === 'custom-override'
            ? 'text-[oklch(0.44_0.08_55)]'
            : runtimeHealthStatus === 'runtime-ready'
              ? 'text-[oklch(0.5_0.12_150)]'
              : runtimeHealthStatus === 'route-limited'
                ? 'text-[oklch(0.56_0.12_82)]'
                : 'text-[oklch(0.58_0.02_55)]';

    return (
        <div
            className={cn(
                'text-muted-foreground ui-stat flex flex-wrap items-center gap-1.5 text-xs sm:gap-2 sm:text-sm',
                className
            )}>
            <span className='border-border bg-card/70 inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 sm:min-h-7 sm:gap-2 sm:px-2.5 sm:py-1'>
                <CircleCheck className={cn('h-3.5 w-3.5', runtimeStatusColorClass)} />
                {runtimeStatusLabel}
            </span>
            <span className='border-border bg-card/70 inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 sm:min-h-7 sm:px-2.5 sm:py-1'>
                {model}
            </span>
            <span className='border-border bg-card/70 inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 sm:min-h-7 sm:px-2.5 sm:py-1'>
                {routeLabel}
            </span>
            <span className='inline-flex min-h-6 items-center rounded-full border border-[oklch(0.78_0.055_205)] bg-[oklch(0.94_0.028_205)] px-2 py-0.5 text-[oklch(0.38_0.065_218)] sm:min-h-7 sm:px-2.5 sm:py-1'>
                {streamStatus}
            </span>
            {parallelBatchEnabled && (
                <span className='inline-flex min-h-6 items-center rounded-full border border-[oklch(0.72_0.065_142)] bg-[oklch(0.94_0.032_142)] px-2 py-0.5 text-[oklch(0.38_0.075_148)] sm:min-h-7 sm:px-2.5 sm:py-1'>
                    {t('streaming.parallelBatchEnabled')}
                </span>
            )}
            <span className='border-primary/20 bg-primary/10 text-primary inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 sm:min-h-7 sm:px-2.5 sm:py-1'>
                {costLabel}
            </span>
        </div>
    );
}
