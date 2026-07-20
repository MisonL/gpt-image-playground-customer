'use client';

import { useI18n } from '@/lib/i18n';
import type { RuntimeHealthStatus } from '@/lib/runtime-health-status';
import { cn } from '@/lib/utils';
import { CircleAlert, CircleCheck } from 'lucide-react';

type RuntimeRequestModeHealth = {
    mode: string;
    configuredCredentialCount: number;
    healthyCredentialCount: number;
    configuredChannelCount: number;
    healthyChannelCount: number;
};

type RuntimeChannelRoutingSummary = {
    effectiveRequestModes?: string[];
    requestModeHealth?: RuntimeRequestModeHealth[];
};

type RuntimeLastFailure = {
    scope: 'credential' | 'channel';
    status?: number;
    code?: string;
    requestId?: string;
    requestMode?: string;
};

type WorkbenchStatusStripProps = {
    model: string;
    routeLabel: string;
    streamStatus: string;
    parallelBatchEnabled?: boolean;
    costLabel: string;
    runtimeHealthStatus?: RuntimeHealthStatus;
    channelRouting?: RuntimeChannelRoutingSummary | null;
    runtimeLastFailure?: RuntimeLastFailure | null;
    className?: string;
};

export function WorkbenchStatusStrip({
    model,
    routeLabel,
    streamStatus,
    parallelBatchEnabled = false,
    costLabel,
    runtimeHealthStatus = 'runtime-ready',
    channelRouting,
    runtimeLastFailure,
    className
}: WorkbenchStatusStripProps) {
    const { t } = useI18n();
    const requestModeHealth = channelRouting?.requestModeHealth ?? [];
    const effectiveRequestModes = channelRouting?.effectiveRequestModes ?? [];
    const configuredHealthyModes = requestModeHealth
        .filter((item) => item.healthyCredentialCount > 0 && item.healthyChannelCount > 0)
        .map((item) => item.mode);
    const suggestedRequestModes = configuredHealthyModes.length ? configuredHealthyModes : effectiveRequestModes;
    const hasRequestModeDetails = requestModeHealth.length > 0 || Boolean(runtimeLastFailure);
    const hasRouteWarnings =
        runtimeHealthStatus !== 'runtime-ready' ||
        requestModeHealth.some((item) => item.configuredCredentialCount > 0 && item.healthyCredentialCount === 0);
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
            ? 'text-amber-700 dark:text-amber-300'
            : runtimeHealthStatus === 'runtime-ready'
              ? 'text-emerald-700 dark:text-emerald-300'
              : runtimeHealthStatus === 'route-limited'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-slate-600 dark:text-slate-300';
    const RuntimeStatusIcon = runtimeHealthStatus === 'runtime-ready' ? CircleCheck : CircleAlert;

    return (
        <div
            className={cn(
                'text-muted-foreground ui-stat flex w-full min-w-0 flex-wrap items-center gap-1.5 text-xs sm:w-auto sm:text-sm',
                className
            )}>
            <span className='border-border bg-card inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 py-0.5 sm:min-h-7 sm:gap-2 sm:px-2.5 sm:py-1'>
                <RuntimeStatusIcon className={cn('h-3.5 w-3.5', runtimeStatusColorClass)} />
                {runtimeStatusLabel}
            </span>
            {hasRequestModeDetails ? (
                <details className='group relative max-w-full basis-full sm:basis-auto'>
                    <summary
                        className={cn(
                            'border-border bg-card inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md border px-2 py-0.5 sm:px-2.5 sm:py-1 lg:min-h-7',
                            hasRouteWarnings
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-emerald-700 dark:text-emerald-300'
                        )}>
                        {hasRouteWarnings ? (
                            <CircleAlert className='h-3.5 w-3.5' />
                        ) : (
                            <CircleCheck className='h-3.5 w-3.5' />
                        )}
                        {t('app.requestModeHealth')}
                    </summary>
                    <div className='border-border bg-card text-card-foreground absolute right-0 left-0 z-30 mt-2 grid w-[min(100%,calc(100vw-2rem))] max-w-full gap-3 rounded-lg border p-3 text-xs shadow-lg sm:right-auto sm:left-0 sm:w-[min(88vw,28rem)] sm:max-w-[28rem] xl:right-0 xl:left-auto'>
                        {requestModeHealth.length > 0 && (
                            <div className='grid gap-2'>
                                {requestModeHealth.map((item) => {
                                    const status =
                                        item.configuredCredentialCount === 0
                                            ? t('app.requestModeNotConfigured')
                                            : item.healthyCredentialCount > 0 && item.healthyChannelCount > 0
                                              ? t('app.requestModeVerified')
                                              : t('app.requestModeCoolingOrProbe');
                                    return (
                                        <div
                                            key={item.mode}
                                            className='grid grid-cols-[minmax(8rem,1fr)_auto] items-center gap-3'>
                                            <span className='font-mono text-[11px]'>{item.mode}</span>
                                            <span className='text-muted-foreground text-right'>{status}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {runtimeLastFailure && (
                            <p className='text-muted-foreground'>
                                {t('app.recentChannelFailure')}:{' '}
                                {[
                                    runtimeLastFailure.scope,
                                    runtimeLastFailure.status ? `HTTP ${runtimeLastFailure.status}` : undefined,
                                    runtimeLastFailure.code,
                                    runtimeLastFailure.requestMode,
                                    runtimeLastFailure.requestId
                                ]
                                    .filter(Boolean)
                                    .join(' / ')}
                            </p>
                        )}
                        <p className='text-muted-foreground'>
                            {t('app.suggestedRequestModes')}:{' '}
                            <span className='font-mono text-[11px]'>
                                OPENAI_CHANNEL_N_REQUEST_MODES=
                                {suggestedRequestModes.length ? suggestedRequestModes.join(',') : 'images-non-stream'}
                            </span>
                        </p>
                    </div>
                </details>
            ) : (
                <span
                    data-request-mode-placeholder='true'
                    aria-hidden='true'
                    className='relative max-w-full basis-full sm:basis-auto'>
                    <span className='border-border bg-card text-muted-foreground inline-flex min-h-11 items-center gap-1.5 rounded-md border px-2 py-0.5 sm:px-2.5 sm:py-1 lg:min-h-7'>
                        <CircleAlert className='h-3.5 w-3.5' />
                        {t('app.requestModeHealth')}
                    </span>
                </span>
            )}
            <span className='border-border bg-card inline-flex min-h-6 min-w-0 items-center gap-2 rounded-md border px-2 py-0.5 sm:min-h-7 sm:px-2.5 sm:py-1'>
                <span className='truncate'>{model}</span>
                <span className='bg-border h-3 w-px shrink-0' aria-hidden='true' />
                <span className='text-muted-foreground truncate'>{routeLabel}</span>
            </span>
            <span className='inline-flex min-h-6 items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700 sm:min-h-7 sm:px-2.5 sm:py-1 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300'>
                {streamStatus}
            </span>
            {parallelBatchEnabled && (
                <span className='inline-flex min-h-6 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700 sm:min-h-7 sm:px-2.5 sm:py-1 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'>
                    {t('streaming.parallelBatchEnabled')}
                </span>
            )}
            <span className='border-primary/20 bg-primary/10 text-primary inline-flex min-h-6 min-w-0 basis-full items-center rounded-md border px-2 py-0.5 sm:min-h-7 sm:basis-auto sm:px-2.5 sm:py-1'>
                {costLabel}
            </span>
        </div>
    );
}
