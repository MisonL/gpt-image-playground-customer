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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
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
    { value: 'none', minutes: null },
    { value: '60', minutes: 60 },
    { value: '1440', minutes: 1440 },
    { value: '10080', minutes: 10080 }
] as const;

const MIN_ACCESS_CODE_LENGTH = 8;

export function ShareDialog({ open, onOpenChange, isCreating, shareUrl, error, onCreate }: ShareDialogProps) {
    const { t } = useI18n();
    const [accessCode, setAccessCode] = React.useState('');
    const [expiry, setExpiry] = React.useState('none');
    const [copied, setCopied] = React.useState(false);

    const selectedExpiry = expiryOptions.find((option) => option.value === expiry) ?? expiryOptions[0];
    const trimmedAccessCode = accessCode.trim();
    const accessCodeError =
        trimmedAccessCode && trimmedAccessCode.length < MIN_ACCESS_CODE_LENGTH ? t('share.accessCodeTooShort') : null;

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            setCopied(false);
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
                            value={accessCode}
                            onChange={(event) => setAccessCode(event.target.value)}
                            placeholder={t('share.accessCodeOptional')}
                        />
                    </div>
                    <div className='grid gap-2'>
                        <Label>{t('share.expiry')}</Label>
                        <Select value={expiry} onValueChange={setExpiry}>
                            <SelectTrigger className='w-full'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value='none'>{t('share.expiryNone')}</SelectItem>
                                <SelectItem value='60'>{t('share.expiryOneHour')}</SelectItem>
                                <SelectItem value='1440'>{t('share.expiryOneDay')}</SelectItem>
                                <SelectItem value='10080'>{t('share.expirySevenDays')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {accessCodeError ? <p className='text-destructive text-sm'>{accessCodeError}</p> : null}
                    {error ? <p className='text-destructive text-sm'>{error}</p> : null}
                    {shareUrl ? (
                        <div className='grid gap-2'>
                            <Label>{t('share.link')}</Label>
                            <div className='flex gap-2'>
                                <Input value={shareUrl} readOnly />
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='icon'
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(shareUrl);
                                        setCopied(true);
                                    }}
                                    aria-label={t('share.copyLink')}>
                                    <Copy className='h-4 w-4' />
                                </Button>
                            </div>
                            {copied ? <p className='text-sm text-emerald-600'>{t('common.copied')}</p> : null}
                        </div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button
                        type='button'
                        onClick={() => onCreate({ accessCode: trimmedAccessCode, expiresInMinutes: selectedExpiry.minutes })}
                        disabled={isCreating || Boolean(accessCodeError)}>
                        {isCreating ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
                        {t('share.create')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
