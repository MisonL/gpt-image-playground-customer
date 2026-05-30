'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Languages, Moon, Settings2, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

type AppControlsProps = {
    onOpenApiSettings: () => void;
};

export function AppControls({ onOpenApiSettings }: AppControlsProps) {
    const { locale, setLocale, t } = useI18n();
    const { resolvedTheme, setTheme } = useTheme();
    const [isMounted, setIsMounted] = React.useState(false);
    const effectiveTheme = isMounted ? resolvedTheme : 'light';
    const isDark = effectiveTheme === 'dark';

    React.useEffect(() => {
        queueMicrotask(() => setIsMounted(true));
    }, []);

    return (
        <div className='flex flex-wrap items-center justify-end gap-2'>
            <div
                className='border-border bg-card/80 text-card-foreground inline-flex min-h-11 items-center gap-1 rounded-md border p-1 shadow-sm'
                aria-label={t('app.language')}>
                <Languages className='text-muted-foreground ml-1 h-4 w-4' />
                <Button
                    type='button'
                    variant={locale === 'zh-CN' ? 'default' : 'ghost'}
                    size='sm'
                    onClick={() => setLocale('zh-CN')}
                    className='min-h-9 min-w-11 px-2'>
                    中文
                </Button>
                <Button
                    type='button'
                    variant={locale === 'en-US' ? 'default' : 'ghost'}
                    size='sm'
                    onClick={() => setLocale('en-US')}
                    className='min-h-9 min-w-11 px-2'>
                    EN
                </Button>
            </div>
            <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className={cn('min-h-11 gap-2 bg-card/80 px-3 shadow-sm', isDark ? 'border-border' : 'border-input')}>
                {isDark ? <Moon className='h-4 w-4' /> : <Sun className='h-4 w-4' />}
                {isDark ? t('app.themeDark') : t('app.themeLight')}
            </Button>
            <Button type='button' variant='outline' onClick={onOpenApiSettings} className='min-h-11 gap-2 bg-card/80 shadow-sm'>
                <Settings2 className='h-4 w-4' />
                {t('app.apiSettings')}
            </Button>
        </div>
    );
}
