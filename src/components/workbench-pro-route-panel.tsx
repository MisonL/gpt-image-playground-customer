'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import type { WorkbenchProDockProps } from '@/components/workbench-pro-dock';
import { useI18n } from '@/lib/i18n';
import type { ImageUpstreamFormBackend, ImageUpstreamFormStreamingStrategy } from '@/lib/image-upstream-form';
import {
    getImageUpstreamRouteImpactKeys,
    isImageUpstreamStreamingStrategySelectable
} from '@/lib/image-upstream-form';

type WorkbenchProRoutePanelProps = Pick<
    WorkbenchProDockProps,
    | 'allowResponsesImageBackend'
    | 'upstreamProfileMixed'
    | 'hasDefaultResponsesModel'
    | 'imageBackend'
    | 'onImageBackendChange'
    | 'streamingStrategy'
    | 'defaultStreamingStrategy'
    | 'onStreamingStrategyChange'
    | 'responsesModel'
    | 'onResponsesModelChange'
    | 'disabled'
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

export function WorkbenchProRoutePanel({
    allowResponsesImageBackend,
    hasDefaultResponsesModel,
    imageBackend,
    onImageBackendChange,
    streamingStrategy,
    defaultStreamingStrategy,
    onStreamingStrategyChange,
    responsesModel,
    onResponsesModelChange,
    upstreamProfileMixed = false,
    disabled
}: WorkbenchProRoutePanelProps) {
    const { t } = useI18n();
    const requiresResponsesModel =
        imageBackend === 'responses-image-generation' && !hasDefaultResponsesModel && !responsesModel.trim();

    return (
        <TabsContent value='route' className='mt-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3'>
            <div className='space-y-1'>
                <p className='text-muted-foreground'>{t('upstream.backend')}</p>
                <Select
                    value={imageBackend}
                    onValueChange={(value) => onImageBackendChange(value as ImageUpstreamFormBackend)}
                    disabled={disabled}>
                    <SelectTrigger
                        id='pro-image-backend-select'
                        aria-label={t('upstream.backend')}
                        className='h-9 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {backendOptions.map((option) => (
                            <SelectItem
                                key={option}
                                value={option}
                                disabled={option === 'responses-image-generation' && !allowResponsesImageBackend}>
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
                    <SelectTrigger
                        id='pro-streaming-strategy-select'
                        aria-label={t('upstream.streamingStrategy')}
                        className='h-9 w-full'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {streamingStrategyOptions.map((option) => (
                            <SelectItem
                                key={option}
                                value={option}
                                disabled={
                                    !isImageUpstreamStreamingStrategySelectable({
                                        imageBackend,
                                        streamingStrategy: option,
                                        allowResponsesImageBackend
                                    })
                                }>
                                {getStreamingStrategyLabel(option, t)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className='border-border bg-muted/20 text-muted-foreground col-span-2 grid gap-2 rounded-md border px-3 py-2 leading-5 md:grid-cols-[auto_1fr_1fr_1fr]'>
                <p className='text-foreground font-medium'>{t('upstream.routeImpactTitle')}</p>
                {getImageUpstreamRouteImpactKeys({
                    backend: imageBackend,
                    streamingStrategy,
                    defaultStreamingStrategy,
                    allowResponsesImageBackend,
                    serverProfileMixed: upstreamProfileMixed
                }).map((key) => (
                    <p key={key}>{t(key)}</p>
                ))}
            </div>
            {imageBackend === 'responses-image-generation' && (
                <div className='border-border bg-muted/20 col-span-2 grid gap-2 rounded-md border px-3 py-2'>
                    <label
                        htmlFor='pro-responses-model-input'
                        className='text-foreground text-xs font-medium'>
                        {t('upstream.gptModel')}
                    </label>
                    <Input
                        id='pro-responses-model-input'
                        value={responsesModel}
                        onChange={(event) => onResponsesModelChange(event.target.value)}
                        disabled={disabled}
                        autoComplete='off'
                        spellCheck={false}
                        placeholder='OPENAI_RESPONSES_API_MODEL'
                        className='h-8 text-xs'
                    />
                    {requiresResponsesModel && (
                        <p className='text-destructive text-xs'>{t('upstream.responsesModelRequired')}</p>
                    )}
                </div>
            )}
        </TabsContent>
    );
}
