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
    const [draft, setDraft] = React.useState<ApiSettings>(settings);

    React.useEffect(() => {
        if (isOpen) {
            setDraft(settings);
        }
    }, [isOpen, settings]);

    const handleSave = () => {
        onSave({
            apiKey: draft.apiKey.trim(),
            baseUrl: draft.baseUrl.trim()
        });
        onOpenChange(false);
    };

    const handleClear = () => {
        const emptySettings = { apiKey: '', baseUrl: '' };
        setDraft(emptySettings);
        onSave(emptySettings);
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className='border-white/20 bg-black text-white sm:max-w-[520px]'>
                <DialogHeader>
                    <DialogTitle className='text-white'>API 设置</DialogTitle>
                    <DialogDescription className='text-white/60'>
                        留空时使用服务器环境变量；填写后仅保存在当前浏览器。
                    </DialogDescription>
                </DialogHeader>
                <div className='grid gap-4 py-2'>
                    <div className='grid gap-2'>
                        <Label htmlFor='api-key-input' className='text-white'>
                            API Key
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
                            API URL
                        </Label>
                        <Input
                            id='api-base-url-input'
                            type='url'
                            placeholder='https://api.openai.com/v1'
                            value={draft.baseUrl}
                            onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                            className='border-white/20 bg-black text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/50'
                        />
                        <p className='text-xs leading-5 text-white/50'>
                            填 OpenAI 兼容接口根地址，通常以 /v1 结尾；不要填管理后台网页地址。
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type='button'
                        variant='ghost'
                        onClick={handleClear}
                        className='text-white/70 hover:bg-white/10 hover:text-white'>
                        清空
                    </Button>
                    <Button type='button' onClick={handleSave} className='bg-white px-6 text-black hover:bg-white/90'>
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
