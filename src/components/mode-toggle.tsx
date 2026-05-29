'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n';

type ModeToggleProps = {
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
};

export function ModeToggle({ currentMode, onModeChange }: ModeToggleProps) {
    const { t } = useI18n();

    return (
        <Tabs
            value={currentMode}
            onValueChange={(value) => onModeChange(value as 'generate' | 'edit')}
            className='w-auto'>
            <TabsList className='grid h-auto grid-cols-2 gap-1 rounded-md border-none bg-transparent p-0'>
                <TabsTrigger
                    value='generate'
                    className={`min-h-9 rounded-md border px-3 py-2 text-sm transition-colors ${
                        currentMode === 'generate'
                            ? 'border-border bg-background text-foreground shadow-sm'
                            : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                    } `}>
                    {t('mode.generate')}
                </TabsTrigger>
                <TabsTrigger
                    value='edit'
                    className={`min-h-9 rounded-md border px-3 py-2 text-sm transition-colors ${
                        currentMode === 'edit'
                            ? 'border-border bg-background text-foreground shadow-sm'
                            : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                    } `}>
                    {t('mode.edit')}
                </TabsTrigger>
            </TabsList>
            <TabsContent value='generate' forceMount className='hidden' />
            <TabsContent value='edit' forceMount className='hidden' />
        </Tabs>
    );
}
