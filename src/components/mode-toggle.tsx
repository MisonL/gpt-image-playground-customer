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
            <TabsList className='grid h-auto w-full grid-cols-4 gap-1 rounded-md border border-border bg-background/70 p-1'>
                {modeItems.map(({ value, labelKey, descriptionKey, Icon }) => (
                    <TabsTrigger
                        key={value}
                        value={value}
                        className={`min-h-10 rounded-md border px-2 py-2 text-center transition-colors ${
                            currentMode === value
                                ? 'border-primary/35 bg-primary text-primary-foreground shadow-sm'
                                : 'border-transparent bg-muted/30 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'
                        } `}>
                        <span className='flex w-full items-center justify-center gap-1.5'>
                            <Icon className='hidden h-3.5 w-3.5 shrink-0 opacity-75 sm:block' />
                            <span className='min-w-0'>
                                <span className='block text-sm leading-5 font-medium'>{t(labelKey)}</span>
                                <span className='hidden truncate text-[11px] leading-4 font-normal opacity-75 xl:block'>
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
