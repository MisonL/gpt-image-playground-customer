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
    Icon: typeof Sparkles;
}> = [
    { value: 'generate', labelKey: 'mode.generate', Icon: Sparkles },
    { value: 'edit', labelKey: 'mode.edit', Icon: Images },
    { value: 'batch', labelKey: 'mode.batch', Icon: Layers3 },
    { value: 'reuse', labelKey: 'mode.reuse', Icon: History }
];

export function ModeToggle({ currentMode, onModeChange }: ModeToggleProps) {
    const { t } = useI18n();

    return (
        <Tabs
            value={currentMode}
            onValueChange={(value) => onModeChange(value as WorkbenchMode)}
            className='w-full'>
            <TabsList className='grid h-auto w-full grid-cols-4 gap-1 rounded-md border border-border bg-background/70 p-0.5'>
                {modeItems.map(({ value, labelKey, Icon }) => (
                    <TabsTrigger
                        key={value}
                        value={value}
                        className={`min-h-7 rounded-md border px-2 py-1 text-center transition-colors ${
                            currentMode === value
                                ? 'border-primary/35 bg-primary text-primary-foreground shadow-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground'
                                : 'border-transparent bg-muted/30 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'
                        } `}>
                        <span className='flex w-full items-center justify-center gap-1.5'>
                            <Icon className='hidden h-3.5 w-3.5 shrink-0 opacity-75 2xl:block' />
                            <span className='min-w-0'>
                                <span className='block text-sm leading-4 font-medium'>{t(labelKey)}</span>
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
