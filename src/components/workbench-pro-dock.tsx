'use client';

import { WorkbenchEasySummary, WorkbenchProPanel } from '@/components/workbench-pro-dock-panels';
import type { GptImageModel } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import type { ImageUpstreamFormBackend, ImageUpstreamFormStreamingStrategy } from '@/lib/image-upstream-form';
import type { ImageStreamMode, ImageStreamingStrategy } from '@/lib/image-upstream-strategy';
import type { SizePreset } from '@/lib/size-utils';
import * as React from 'react';

export type OutputFormat = 'png' | 'jpeg' | 'webp';
export type Quality = 'low' | 'medium' | 'high' | 'auto';
export type { SizePreset };

export type WorkbenchProDockProps = {
    outputFormat: OutputFormat;
    onOutputFormatChange: React.Dispatch<React.SetStateAction<OutputFormat>>;
    quality: Quality;
    onQualityChange: React.Dispatch<React.SetStateAction<Quality>>;
    model: GptImageModel;
    onModelChange: React.Dispatch<React.SetStateAction<GptImageModel>>;
    size: SizePreset;
    streamMode: ImageStreamMode;
    onStreamModeChange: React.Dispatch<React.SetStateAction<ImageStreamMode>>;
    allowStreamingBatch: boolean;
    enableParallelBatch: boolean;
    onEnableParallelBatchChange: React.Dispatch<React.SetStateAction<boolean>>;
    parallelBatchTargetCount: number;
    allowResponsesImageBackend: boolean;
    upstreamProfileMixed?: boolean;
    hasDefaultResponsesModel: boolean;
    imageBackend: ImageUpstreamFormBackend;
    onImageBackendChange: React.Dispatch<React.SetStateAction<ImageUpstreamFormBackend>>;
    streamingStrategy: ImageUpstreamFormStreamingStrategy;
    defaultStreamingStrategy: ImageStreamingStrategy;
    onStreamingStrategyChange: React.Dispatch<React.SetStateAction<ImageUpstreamFormStreamingStrategy>>;
    responsesModel: string;
    onResponsesModelChange: React.Dispatch<React.SetStateAction<string>>;
    disabled?: boolean;
    defaultMode?: 'easy' | 'pro';
    defaultProTab?: 'output' | 'model' | 'stream' | 'route';
};

type DockModeButtonProps = {
    active: boolean;
    children: React.ReactNode;
    onClick: () => void;
};

function DockModeButton({ active, children, onClick }: DockModeButtonProps) {
    return (
        <button
            type='button'
            className={`focus-visible:ring-ring rounded-t-md border-b-2 px-3 pb-2 font-medium transition-[border-color,color,box-shadow] focus-visible:ring-2 focus-visible:outline-none ${
                active
                    ? 'border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
            aria-pressed={active}
            onClick={onClick}>
            {children}
        </button>
    );
}

export function WorkbenchProDock({ defaultMode = 'easy', defaultProTab = 'output', ...props }: WorkbenchProDockProps) {
    const { t } = useI18n();
    const [dockMode, setDockMode] = React.useState<'easy' | 'pro'>(defaultMode);
    const isProMode = dockMode === 'pro';

    return (
        <div className='workbench-panel border-border/70 mt-4 hidden shrink-0 overflow-hidden rounded-lg border lg:block xl:max-h-80 xl:overflow-y-auto'>
            <div className='border-border/60 flex items-center gap-4 border-b px-5 pt-3 text-sm'>
                <DockModeButton active={!isProMode} onClick={() => setDockMode('easy')}>
                    {t('ux.easyMode')}
                </DockModeButton>
                <DockModeButton active={isProMode} onClick={() => setDockMode('pro')}>
                    {t('ux.professionalMode')}
                </DockModeButton>
            </div>
            <div className='bg-card/56 px-5 py-3'>
                {isProMode ? (
                    <WorkbenchProPanel {...props} defaultTab={defaultProTab} />
                ) : (
                    <WorkbenchEasySummary {...props} />
                )}
            </div>
        </div>
    );
}
