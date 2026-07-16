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
    getReturnFocusTarget: () => HTMLButtonElement | null;
};

export function ApiSettingsDialog({
    isOpen,
    onOpenChange,
    settings,
    onSave,
    getReturnFocusTarget
}: ApiSettingsDialogProps) {
    const { t } = useI18n();
    const [draft, setDraft] = React.useState<ApiSettings>(settings);
    const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saved' | 'error'>('idle');
    const [validationMessage, setValidationMessage] = React.useState<string | null>(null);
    const closeTimerRef = React.useRef<number | null>(null);
    const wasOpenRef = React.useRef(false);

    const clearCloseTimer = React.useCallback(() => {
        if (closeTimerRef.current === null) return;
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    React.useEffect(() => clearCloseTimer, [clearCloseTimer]);

    React.useEffect(() => {
        const wasOpen = wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (!isOpen) {
            clearCloseTimer();
            return;
        }
        if (wasOpen) return;

        clearCloseTimer();
        setSaveStatus('idle');
        setValidationMessage(null);
        setDraft(settings);
    }, [clearCloseTimer, isOpen, settings]);

    const handleOpenChange = (open: boolean) => {
        if (!open) clearCloseTimer();
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
        const trimmedApiKey = draft.apiKey.trim();
        const trimmedBaseUrl = draft.baseUrl.trim();
        if (trimmedBaseUrl.length > 0 && trimmedApiKey.length === 0) {
            setSaveStatus('error');
            setValidationMessage(t('api.urlPairRequired'));
            return;
        }
        try {
            onSave({
                apiKey: trimmedApiKey,
                baseUrl: trimmedBaseUrl
            });
            setValidationMessage(null);
            setSaveStatus('saved');
            closeAfterSaved();
        } catch (error) {
            console.error('Failed to save API settings.', error);
            setSaveStatus('error');
            setValidationMessage(null);
        }
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        handleSave();
    };

    const handleClear = () => {
        const emptySettings = { apiKey: '', baseUrl: '' };
        try {
            setDraft(emptySettings);
            onSave(emptySettings);
            setValidationMessage(null);
            setSaveStatus('saved');
            closeAfterSaved();
        } catch (error) {
            console.error('Failed to clear API settings.', error);
            setSaveStatus('error');
            setValidationMessage(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent
                className='sm:max-w-[520px]'
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    getReturnFocusTarget()?.focus();
                }}>
                <form onSubmit={handleSubmit} className='grid gap-4'>
                    <DialogHeader>
                        <DialogTitle>{t('api.title')}</DialogTitle>
                        <DialogDescription>{t('api.description')}</DialogDescription>
                    </DialogHeader>
                    <div className='grid gap-4 py-2'>
                        <div className='grid gap-2'>
                            <Label htmlFor='api-key-input'>{t('api.key')}</Label>
                            <Input
                                id='api-key-input'
                                name='apiKey'
                                type='password'
                                autoComplete='off'
                                spellCheck={false}
                                placeholder='sk-...'
                                value={draft.apiKey}
                                className='min-h-11 sm:min-h-9'
                                onChange={(event) => {
                                    setValidationMessage(null);
                                    setDraft((current) => ({ ...current, apiKey: event.target.value }));
                                }}
                            />
                        </div>
                        <div className='grid gap-2'>
                            <Label htmlFor='api-base-url-input'>{t('api.url')}</Label>
                            <Input
                                id='api-base-url-input'
                                name='baseUrl'
                                type='url'
                                inputMode='url'
                                autoComplete='off'
                                spellCheck={false}
                                placeholder='https://api.openai.com/v1'
                                value={draft.baseUrl}
                                className='min-h-11 sm:min-h-9'
                                onChange={(event) => {
                                    setValidationMessage(null);
                                    setDraft((current) => ({ ...current, baseUrl: event.target.value }));
                                }}
                            />
                            <p className='text-muted-foreground text-xs leading-5'>{t('api.urlHint')}</p>
                            <p className='text-muted-foreground text-xs leading-5'>{t('api.urlPairHint')}</p>
                        </div>
                    </div>
                    <DialogFooter>
                        {saveStatus === 'saved' && (
                            <p
                                className='mr-auto self-center text-sm text-emerald-600 dark:text-emerald-400'
                                aria-live='polite'>
                                {t('api.saved')}
                            </p>
                        )}
                        {saveStatus === 'error' && (
                            <p className='text-destructive mr-auto self-center text-sm' aria-live='polite'>
                                {validationMessage ?? t('api.saveFailed')}
                            </p>
                        )}
                        <Button
                            type='button'
                            variant='ghost'
                            onClick={handleClear}
                            className='text-muted-foreground hover:text-foreground min-h-11 sm:min-h-9'>
                            {t('common.clear')}
                        </Button>
                        <Button type='submit' className='min-h-11 px-6 sm:min-h-9'>
                            {t('common.save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
