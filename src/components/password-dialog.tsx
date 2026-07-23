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

interface PasswordDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onSave: (password: string) => void;
    title?: string;
    description?: string;
}

export function PasswordDialog({
    isOpen,
    onOpenChange,
    onSave,
    title = 'Configure Access Code',
    description
}: PasswordDialogProps) {
    const { t } = useI18n();
    const [currentPassword, setCurrentPassword] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleSave = () => {
        inputRef.current?.blur();
        onSave(currentPassword);
        setCurrentPassword('');
        onOpenChange(false);
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!currentPassword.trim()) return;
        handleSave();
    };

    const handleDialogClose = (open: boolean) => {
        if (!open) {
            setCurrentPassword('');
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogClose}>
            <DialogContent className='sm:max-w-[425px]'>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                <form onSubmit={handleSubmit} className='grid gap-4'>
                    <div className='grid gap-4 py-4'>
                        <div className='grid grid-cols-1 items-center gap-4'>
                            <Label htmlFor='password-input' className='sr-only'>
                                {t('password.placeholder')}
                            </Label>
                            <Input
                                ref={inputRef}
                                id='password-input'
                                name='password'
                                type='password'
                                autoComplete='current-password'
                                placeholder={t('password.placeholder')}
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                className='col-span-1'
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type='submit' disabled={!currentPassword.trim()} className='px-6'>
                            {t('common.save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
