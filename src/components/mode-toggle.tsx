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
        <Tabs value={currentMode} onValueChange={(value) => onModeChange(value as WorkbenchMode)} className='w-full'>
            <TabsList className='border-border bg-background/70 grid h-auto w-full grid-cols-4 gap-1 rounded-md border p-0.5'>
                {modeItems.map(({ value, labelKey, descriptionKey, Icon }) => (
                    <TabsTrigger
                        key={value}
                        value={value}
                        data-workbench-mode={value}
                        className={`min-h-11 rounded-md border px-1 py-1 text-center whitespace-normal transition-colors lg:min-h-10 ${
                            currentMode === value
                                ? 'border-primary/35 bg-primary text-primary-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground shadow-sm'
                                : 'bg-muted/30 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground border-transparent'
                        } `}>
                        <span className='flex w-full min-w-0 items-center justify-center gap-0.5'>
                            <Icon className='hidden h-3.5 w-3.5 shrink-0 opacity-75' />
                            <span className='max-w-full min-w-0'>
                                <span className='block max-w-full min-w-0 text-[13px] leading-4 font-medium break-words whitespace-normal'>
                                    {t(labelKey)}
                                </span>
                                <span className='sr-only'>{t(descriptionKey)}</span>
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
