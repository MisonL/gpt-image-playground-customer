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
                    className={`rounded-md border px-3 py-1 text-sm transition-colors ${
                        currentMode === 'generate'
                            ? 'border-white bg-white text-black'
                            : 'border-dashed border-white/30 bg-transparent text-white/60 hover:border-white/50 hover:text-white/80'
                    } `}>
                    {t('mode.generate')}
                </TabsTrigger>
                <TabsTrigger
                    value='edit'
                    className={`rounded-md border px-3 py-1 text-sm transition-colors ${
                        currentMode === 'edit'
                            ? 'border-white bg-white text-black'
                            : 'border-dashed border-white/30 bg-transparent text-white/60 hover:border-white/50 hover:text-white/80'
                    } `}>
                    {t('mode.edit')}
                </TabsTrigger>
            </TabsList>
            <TabsContent value='generate' forceMount className='hidden' />
            <TabsContent value='edit' forceMount className='hidden' />
        </Tabs>
    );
}
