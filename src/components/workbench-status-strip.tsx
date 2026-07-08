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
            ? 'text-[oklch(0.44_0.08_55)]'
            : runtimeHealthStatus === 'runtime-ready'
              ? 'text-[oklch(0.5_0.12_150)]'
              : runtimeHealthStatus === 'route-limited'
                ? 'text-[oklch(0.56_0.12_82)]'
                : 'text-[oklch(0.58_0.02_55)]';
    const RuntimeStatusIcon = runtimeHealthStatus === 'runtime-ready' ? CircleCheck : CircleAlert;

    return (
        <div
            className={cn(
                'text-muted-foreground ui-stat flex w-full min-w-0 flex-wrap items-center gap-1.5 text-xs sm:w-auto sm:gap-2 sm:text-sm',
                className
            )}>
            <span className='border-border bg-card/70 inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 sm:min-h-7 sm:gap-2 sm:px-2.5 sm:py-1'>
                <RuntimeStatusIcon className={cn('h-3.5 w-3.5', runtimeStatusColorClass)} />
                {runtimeStatusLabel}
            </span>
            {(requestModeHealth.length > 0 || runtimeLastFailure) && (
                <details className='group relative max-w-full basis-full sm:basis-auto'>
                    <summary
                        className={cn(
                            'border-border bg-card/70 inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 rounded-full border px-2 py-0.5 sm:min-h-7 sm:px-2.5 sm:py-1',
                            hasRouteWarnings ? 'text-[oklch(0.48_0.11_72)]' : 'text-[oklch(0.42_0.09_150)]'
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
            )}
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
            <span className='border-primary/20 bg-primary/10 text-primary inline-flex min-h-6 min-w-0 basis-full items-center rounded-full border px-2 py-0.5 sm:min-h-7 sm:basis-auto sm:px-2.5 sm:py-1'>
                {costLabel}
            </span>
        </div>
    );
}
