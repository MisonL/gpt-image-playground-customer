'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n';
import { History, Images, Layers3, Sparkles } from 'lucide-react';

export type WorkbenchMode = 'generate' | 'edit' | 'batch' | 'reuse';

type ModeToggleProps = {
    currentMode: WorkbenchMode;
    onModeChange: (mode: WorkbenchMode) => void;
};

const modeItems: Array<{
    value: WorkbenchMode;
    labelKey: string;
    descriptionKey: string;
    Icon: typeof Sparkles;
}> = [
    { value: 'generate', labelKey: 'mode.generate', descriptionKey: 'mode.generateDescription', Icon: Sparkles },
    { value: 'edit', labelKey: 'mode.edit', descriptionKey: 'mode.editDescription', Icon: Images },
    { value: 'batch', labelKey: 'mode.batch', descriptionKey: 'mode.batchDescription', Icon: Layers3 },
    { value: 'reuse', labelKey: 'mode.reuse', descriptionKey: 'mode.reuseDescription', Icon: History }
];

export function ModeToggle({ currentMode, onModeChange }: ModeToggleProps) {
    const { t } = useI18n();

    return (
        <Tabs
            value={currentMode}
            onValueChange={(value) => onModeChange(value as WorkbenchMode)}
            className='w-full'>
            <TabsList className='bg-muted/55 grid h-auto w-full grid-cols-2 gap-1 rounded-md border border-border p-1'>
                {modeItems.map(({ value, labelKey, descriptionKey, Icon }) => (
                    <TabsTrigger
                        key={value}
                        value={value}
                        className={`min-h-14 rounded-md border px-2.5 py-2 text-left transition-colors ${
                            currentMode === value
                                ? 'border-primary/35 bg-card text-foreground shadow-sm'
                                : 'border-transparent text-muted-foreground hover:border-border hover:bg-background/60 hover:text-foreground'
                        } `}>
                        <span className='flex w-full items-start gap-2'>
                            <Icon className='mt-0.5 h-4 w-4 shrink-0 opacity-75' />
                            <span className='min-w-0'>
                                <span className='block text-sm leading-5 font-medium'>{t(labelKey)}</span>
                                <span className='text-muted-foreground block truncate text-[11px] leading-4 font-normal'>
                                    {t(descriptionKey)}
                                </span>
                            </span>
                        </span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {modeItems.map(({ value }) => (
                <TabsContent key={value} value={value} forceMount className='hidden' />
            ))}
        </Tabs>
    );
}
