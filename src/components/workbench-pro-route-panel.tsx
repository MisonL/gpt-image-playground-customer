'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import type { WorkbenchProDockProps } from '@/components/workbench-pro-dock';
import { useI18n } from '@/lib/i18n';
import type { ImageUpstreamFormBackend, ImageUpstreamFormStreamingStrategy } from '@/lib/image-upstream-form';

type WorkbenchProRoutePanelProps = Pick<
    WorkbenchProDockProps,
    'imageBackend' | 'onImageBackendChange' | 'streamingStrategy' | 'onStreamingStrategyChange' | 'disabled'
>;

type Translation = ReturnType<typeof useI18n>['t'];

const backendOptions: ImageUpstreamFormBackend[] = ['server-default', 'images-api', 'responses-image-generation'];
const streamingStrategyOptions: ImageUpstreamFormStreamingStrategy[] = [
    'server-default',
    'auto',
    'off',
    'openai-sse',
    'newapi-keepalive-sse',
    'responses-sse',
    'force-sse'
];

function getBackendLabel(backend: ImageUpstreamFormBackend, t: Translation): string {
    if (backend === 'images-api') return t('upstream.backendImages');
    if (backend === 'responses-image-generation') return t('upstream.backendResponses');
    return t('upstream.serverDefault');
}

function getStreamingStrategyLabel(strategy: ImageUpstreamFormStreamingStrategy, t: Translation): string {
    if (strategy === 'auto') return t('upstream.strategyAuto');
    if (strategy === 'off') return t('upstream.strategyOff');
    if (strategy === 'openai-sse') return t('upstream.strategyOpenAiSse');
    if (strategy === 'newapi-keepalive-sse') return t('upstream.strategyKeepaliveSse');
    if (strategy === 'responses-sse') return t('upstream.strategyResponsesSse');
    if (strategy === 'force-sse') return t('upstream.strategyForceSse');
    return t('upstream.serverDefault');
}

function getRouteImpactDetails(input: {
    backend: ImageUpstreamFormBackend;
    streamingStrategy: ImageUpstreamFormStreamingStrategy;
    t: Translation;
}): string[] {
    const backendKey =
        input.backend === 'images-api'
            ? 'upstream.backendImpactImages'
            : input.backend === 'responses-image-generation'
              ? 'upstream.backendImpactResponses'
              : 'upstream.backendImpactServerDefault';
    const strategyKey =
        input.streamingStrategy === 'off'
            ? 'upstream.strategyImpactOff'
            : input.streamingStrategy === 'force-sse'
              ? 'upstream.strategyImpactForceSse'
              : input.streamingStrategy === 'server-default' || input.streamingStrategy === 'auto'
                ? 'upstream.strategyImpactAuto'
                : 'upstream.strategyImpactSse';

    return [input.t(backendKey), input.t(strategyKey), input.t('upstream.routeImpactCost')];
}

export function WorkbenchProRoutePanel({
    imageBackend,
    onImageBackendChange,
    streamingStrategy,
    onStreamingStrategyChange,
    disabled
}: WorkbenchProRoutePanelProps) {
    const { t } = useI18n();

    return (
        <TabsContent value='route' className='mt-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('upstream.backend')}</p>
                <Select
                    value={imageBackend}
                    onValueChange={(value) => onImageBackendChange(value as ImageUpstreamFormBackend)}
                    disabled={disabled}>
                    <SelectTrigger id='pro-image-backend-select' className='h-9 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {backendOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                                {getBackendLabel(option, t)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('upstream.streamingStrategy')}</p>
                <Select
                    value={streamingStrategy}
                    onValueChange={(value) => onStreamingStrategyChange(value as ImageUpstreamFormStreamingStrategy)}
                    disabled={disabled}>
                    <SelectTrigger id='pro-streaming-strategy-select' className='h-9 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {streamingStrategyOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                                {getStreamingStrategyLabel(option, t)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className='border-border bg-muted/20 text-muted-foreground col-span-2 grid gap-2 rounded-md border px-3 py-2 leading-5 md:grid-cols-[auto_1fr_1fr_1fr]'>
                <p className='text-foreground font-medium'>{t('upstream.routeImpactTitle')}</p>
                {getRouteImpactDetails({ backend: imageBackend, streamingStrategy, t }).map((detail) => (
                    <p key={detail}>{detail}</p>
                ))}
            </div>
        </TabsContent>
    );
}
