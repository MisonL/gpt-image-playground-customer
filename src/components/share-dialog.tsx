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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import { Copy, Loader2 } from 'lucide-react';
import * as React from 'react';

export type ShareDialogValues = {
    accessCode: string;
    expiresInMinutes: number | null;
};

type ShareDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isCreating: boolean;
    shareUrl: string | null;
    error: string | null;
    onCreate: (values: ShareDialogValues) => void;
};

const expiryOptions = [
    { value: 'none', minutes: null, labelKey: 'share.expiryNone' },
    { value: '60', minutes: 60, labelKey: 'share.expiryOneHour' },
    { value: '1440', minutes: 1440, labelKey: 'share.expiryOneDay' },
    { value: '10080', minutes: 10080, labelKey: 'share.expirySevenDays' }
] as const;

export const DEFAULT_SHARE_EXPIRY_VALUE = '1440';
const MIN_ACCESS_CODE_LENGTH = 8;

function getDefaultShareExpiryMinutes(): number | null {
    const defaultOption = expiryOptions.find((option) => option.value === DEFAULT_SHARE_EXPIRY_VALUE);
    if (!defaultOption) {
        throw new Error('Default share expiry option is not configured.');
    }
    return defaultOption.minutes;
}

export function getShareExpiryMinutes(value: string): number | null {
    const option = expiryOptions.find((candidate) => candidate.value === value);
    return option === undefined ? getDefaultShareExpiryMinutes() : option.minutes;
}

export function ShareExpiryField(props: { expiry: string; onExpiryChange: (value: string) => void }) {
    const { t } = useI18n();
    return (
        <div className='grid gap-2'>
            <Label htmlFor='share-expiry'>{t('share.expiry')}</Label>
            <Select value={props.expiry} onValueChange={props.onExpiryChange}>
                <SelectTrigger id='share-expiry' className='w-full'>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {expiryOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {t(option.labelKey)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

export function ShareDialogFooterActions(props: {
    isCreating: boolean;
    accessCodeError: string | null;
    onClose: () => void;
    onCreate: () => void;
}) {
    const { t } = useI18n();
    return (
        <DialogFooter className='gap-2'>
            <Button type='button' variant='outline' className='min-h-11 sm:min-h-9' onClick={props.onClose}>
                {t('common.close')}
            </Button>
            <Button
                type='button'
                className='min-h-11 sm:min-h-9'
                onClick={props.onCreate}
                disabled={props.isCreating || Boolean(props.accessCodeError)}>
                {props.isCreating ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
                {t('share.create')}
            </Button>
        </DialogFooter>
    );
}

export function ShareLinkField(props: {
    shareUrl: string;
    copyStatus: { url: string; result: 'copied' | 'error' } | null;
    onCopy: () => void;
}) {
    const { t } = useI18n();
    const copyResult = props.copyStatus?.url === props.shareUrl ? props.copyStatus.result : null;

    return (
        <div className='grid gap-2'>
            <Label htmlFor='share-link'>{t('share.link')}</Label>
            <div className='flex gap-2'>
                <Input id='share-link' name='shareLink' value={props.shareUrl} readOnly />
                <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    className='min-h-11 min-w-11 sm:min-h-9 sm:min-w-9'
                    onClick={props.onCopy}
                    aria-label={t('share.copyLink')}>
                    <Copy className='h-4 w-4' />
                </Button>
            </div>
            {copyResult === 'copied' ? (
                <p aria-live='polite' className='text-sm text-emerald-600'>
                    {t('common.copied')}
                </p>
            ) : null}
            {copyResult === 'error' ? (
                <p aria-live='polite' className='text-destructive text-sm'>
                    {t('share.copyFailed')}
                </p>
            ) : null}
        </div>
    );
}

export function ShareDialog({ open, onOpenChange, isCreating, shareUrl, error, onCreate }: ShareDialogProps) {
    const { t } = useI18n();
    const [accessCode, setAccessCode] = React.useState('');
    const [expiry, setExpiry] = React.useState(DEFAULT_SHARE_EXPIRY_VALUE);
    const [copyStatus, setCopyStatus] = React.useState<{ url: string; result: 'copied' | 'error' } | null>(null);

    const trimmedAccessCode = accessCode.trim();
    const accessCodeError =
        trimmedAccessCode && trimmedAccessCode.length < MIN_ACCESS_CODE_LENGTH ? t('share.accessCodeTooShort') : null;

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            setCopyStatus(null);
        }
        onOpenChange(nextOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('share.dialogTitle')}</DialogTitle>
                    <DialogDescription>{t('share.dialogDescription')}</DialogDescription>
                </DialogHeader>
                <div className='grid gap-4'>
                    <div className='grid gap-2'>
                        <Label htmlFor='share-access-code'>{t('share.accessCode')}</Label>
                        <Input
                            id='share-access-code'
                            name='shareAccessCode'
                            value={accessCode}
                            onChange={(event) => setAccessCode(event.target.value)}
                            placeholder={t('share.accessCodeOptional')}
                            type='password'
                            autoComplete='new-password'
                            spellCheck={false}
                        />
                        <p className='text-muted-foreground text-xs'>{t('share.publicRiskHint')}</p>
                    </div>
                    <ShareExpiryField expiry={expiry} onExpiryChange={setExpiry} />
                    {accessCodeError ? <p className='text-destructive text-sm'>{accessCodeError}</p> : null}
                    {error ? (
                        <p aria-live='polite' className='text-destructive text-sm'>
                            {error}
                        </p>
                    ) : null}
                    {shareUrl ? (
                        <ShareLinkField
                            shareUrl={shareUrl}
                            copyStatus={copyStatus}
                            onCopy={() => {
                                void (async () => {
                                    setCopyStatus(null);
                                    try {
                                        if (!navigator.clipboard?.writeText) {
                                            throw new Error(t('share.copyFailed'));
                                        }
                                        await navigator.clipboard.writeText(shareUrl);
                                        setCopyStatus({ url: shareUrl, result: 'copied' });
                                    } catch {
                                        setCopyStatus({ url: shareUrl, result: 'error' });
                                    }
                                })();
                            }}
                        />
                    ) : null}
                </div>
                <ShareDialogFooterActions
                    isCreating={isCreating}
                    accessCodeError={accessCodeError}
                    onClose={() => handleOpenChange(false)}
                    onCreate={() =>
                        onCreate({ accessCode: trimmedAccessCode, expiresInMinutes: getShareExpiryMinutes(expiry) })
                    }
                />
            </DialogContent>
        </Dialog>
    );
}
