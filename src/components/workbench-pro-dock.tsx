'use client';

import { WorkbenchEasySummary, WorkbenchProPanel } from '@/components/workbench-pro-dock-panels';
import type { GptImageModel } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import type { ImageUpstreamFormBackend, ImageUpstreamFormStreamingStrategy } from '@/lib/image-upstream-form';
import type { ImageStreamMode } from '@/lib/image-upstream-strategy';
import * as React from 'react';

export type OutputFormat = 'png' | 'jpeg' | 'webp';
export type Quality = 'low' | 'medium' | 'high' | 'auto';
export type SizePreset = 'auto' | 'square' | 'landscape' | 'portrait' | 'custom';

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
    imageBackend: ImageUpstreamFormBackend;
    onImageBackendChange: React.Dispatch<React.SetStateAction<ImageUpstreamFormBackend>>;
    streamingStrategy: ImageUpstreamFormStreamingStrategy;
    onStreamingStrategyChange: React.Dispatch<React.SetStateAction<ImageUpstreamFormStreamingStrategy>>;
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
            className={`border-b-2 px-3 pb-2 font-medium transition-colors ${
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
        <div className='border-border/70 bg-background/64 hidden border-t px-5 py-3 lg:block'>
            <div className='mb-3 flex items-center gap-2 text-sm'>
                <DockModeButton active={!isProMode} onClick={() => setDockMode('easy')}>
                    {t('ux.easyMode')}
                </DockModeButton>
                <DockModeButton active={isProMode} onClick={() => setDockMode('pro')}>
                    {t('ux.professionalMode')}
                </DockModeButton>
            </div>
            <div className='border-border bg-card/76 overflow-hidden rounded-lg border'>
                {isProMode ? (
                    <WorkbenchProPanel {...props} defaultTab={defaultProTab} />
                ) : (
                    <WorkbenchEasySummary {...props} />
                )}
            </div>
        </div>
    );
}
