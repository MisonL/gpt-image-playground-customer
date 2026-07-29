'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Locale, useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type LanguageSelectorProps = {
    className?: string;
};

function isLocale(value: string): value is Locale {
    return value === 'zh-CN' || value === 'en-US';
}

export function LanguageSelector({ className }: LanguageSelectorProps) {
    const { locale, setLocale, t } = useI18n();

    return (
        <Select
            value={locale}
            onValueChange={(nextLocale) => {
                if (isLocale(nextLocale)) {
                    setLocale(nextLocale);
                }
            }}>
            <SelectTrigger
                aria-label={t('app.language')}
                data-language-selector
                size='sm'
                className={cn('bg-card/80 h-11 min-w-28 shrink-0 shadow-sm lg:h-9', className)}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align='end'>
                <SelectItem value='zh-CN'>{t('app.languageChinese')}</SelectItem>
                <SelectItem value='en-US'>{t('app.languageEnglish')}</SelectItem>
            </SelectContent>
        </Select>
    );
}
