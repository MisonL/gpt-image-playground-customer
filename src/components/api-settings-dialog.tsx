'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/i18n';
import * as React from 'react';

export type ApiSettings = {
    apiKey: string;
    baseUrl: string;
};

type ApiSettingsDialogProps = {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    settings: ApiSettings;
    onSave: (settings: ApiSettings) => void;
};

export function ApiSettingsDialog({ isOpen, onOpenChange, settings, onSave }: ApiSettingsDialogProps) {
    const { t } = useI18n();
    const [draft, setDraft] = React.useState<ApiSettings>(settings);
    const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saved' | 'error'>('idle');
    const closeTimerRef = React.useRef<number | null>(null);

    const clearCloseTimer = React.useCallback(() => {
        if (closeTimerRef.current === null) return;
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    React.useEffect(() => clearCloseTimer, [clearCloseTimer]);

    const handleOpenChange = (open: boolean) => {
        if (open) {
            clearCloseTimer();
            setSaveStatus('idle');
            setDraft(settings);
        }
        onOpenChange(open);
    };

    const closeAfterSaved = () => {
        clearCloseTimer();
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            onOpenChange(false);
        }, 450);
    };

    const handleSave = () => {
        try {
            onSave({
                apiKey: draft.apiKey.trim(),
                baseUrl: draft.baseUrl.trim()
            });
            setSaveStatus('saved');
            closeAfterSaved();
        } catch (error) {
            console.error('Failed to save API settings.', error);
            setSaveStatus('error');
        }
    };

    const handleClear = () => {
        const emptySettings = { apiKey: '', baseUrl: '' };
        try {
            setDraft(emptySettings);
            onSave(emptySettings);
            setSaveStatus('saved');
            closeAfterSaved();
        } catch (error) {
            console.error('Failed to clear API settings.', error);
            setSaveStatus('error');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className='border-white/20 bg-black text-white sm:max-w-[520px]'>
                <DialogHeader>
                    <DialogTitle className='text-white'>{t('api.title')}</DialogTitle>
                    <DialogDescription className='text-white/60'>{t('api.description')}</DialogDescription>
                </DialogHeader>
                <div className='grid gap-4 py-2'>
                    <div className='grid gap-2'>
                        <Label htmlFor='api-key-input' className='text-white'>
                            {t('api.key')}
                        </Label>
                        <Input
                            id='api-key-input'
                            type='password'
                            autoComplete='off'
                            placeholder='sk-...'
                            value={draft.apiKey}
                            onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                            className='border-white/20 bg-black text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/50'
                        />
                    </div>
                    <div className='grid gap-2'>
                        <Label htmlFor='api-base-url-input' className='text-white'>
                            {t('api.url')}
                        </Label>
                        <Input
                            id='api-base-url-input'
                            type='url'
                            placeholder='https://api.openai.com/v1'
                            value={draft.baseUrl}
                            onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                            className='border-white/20 bg-black text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/50'
                        />
                        <p className='text-xs leading-5 text-white/50'>{t('api.urlHint')}</p>
                    </div>
                </div>
                <DialogFooter>
                    {saveStatus === 'saved' && (
                        <p className='mr-auto self-center text-sm text-green-300'>{t('api.saved')}</p>
                    )}
                    {saveStatus === 'error' && (
                        <p className='mr-auto self-center text-sm text-red-300'>{t('api.saveFailed')}</p>
                    )}
                    <Button
                        type='button'
                        variant='ghost'
                        onClick={handleClear}
                        className='text-white/70 hover:bg-white/10 hover:text-white'>
                        {t('common.clear')}
                    </Button>
                    <Button type='button' onClick={handleSave} className='bg-white px-6 text-black hover:bg-white/90'>
                        {t('common.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
