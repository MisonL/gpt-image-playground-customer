'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n';
import Image from 'next/image';
import * as React from 'react';

type ShareMetadata = {
    token: string;
    sourceFilename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    expiresAt: string | null;
    accessCodeRequired: boolean;
    expired: boolean;
};

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
    const { t } = useI18n();
    const resolvedParams = React.use(params);
    const token = resolvedParams.token;
    const [metadata, setMetadata] = React.useState<ShareMetadata | null>(null);
    const [accessCode, setAccessCode] = React.useState('');
    const [imageUrl, setImageUrl] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isUnlocking, setIsUnlocking] = React.useState(false);
    const imageUrlRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        let active = true;
        const loadMetadata = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await fetch(`/api/shares/${token}`);
                const body = await response.json();
                if (!response.ok) {
                    throw new Error(body.error || t('share.loadFailed'));
                }
                if (active) {
                    const nextMetadata = body as ShareMetadata;
                    setMetadata(nextMetadata);
                    if (!nextMetadata.expired && !nextMetadata.accessCodeRequired) {
                        const imageResponse = await fetch(`/api/shares/${token}/content`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({})
                        });
                        if (!imageResponse.ok) {
                            const imageBody = await imageResponse.json().catch(() => ({}));
                            throw new Error(imageBody.error || t('share.unlockFailed'));
                        }
                        if (!imageResponse.headers.get('content-type')?.startsWith('image/')) {
                            throw new Error(t('share.unlockFailed'));
                        }
                        const blob = await imageResponse.blob();
                        const nextUrl = URL.createObjectURL(blob);
                        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
                        imageUrlRef.current = nextUrl;
                        setImageUrl(nextUrl);
                    }
                }
            } catch (err) {
                if (active) setError(err instanceof Error ? err.message : t('share.loadFailed'));
            } finally {
                if (active) setIsLoading(false);
            }
        };

        void loadMetadata();
        return () => {
            active = false;
        };
    }, [token, t]);

    React.useEffect(() => {
        return () => {
            if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        };
    }, []);

    const loadImage = React.useCallback(async () => {
        setIsUnlocking(true);
        setError(null);
        try {
            const response = await fetch(`/api/shares/${token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(accessCode.trim() ? { accessCode: accessCode.trim() } : {})
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || t('share.unlockFailed'));
            }
            if (!response.headers.get('content-type')?.startsWith('image/')) {
                throw new Error(t('share.unlockFailed'));
            }
            const blob = await response.blob();
            const nextUrl = URL.createObjectURL(blob);
            if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
            imageUrlRef.current = nextUrl;
            setImageUrl(nextUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('share.unlockFailed'));
        } finally {
            setIsUnlocking(false);
        }
    }, [accessCode, t, token]);

    return (
        <main className='bg-background text-foreground flex min-h-screen items-center justify-center p-6'>
            <section className='w-full max-w-3xl space-y-4'>
                <div>
                    <h1 className='text-2xl font-semibold'>{t('share.pageTitle')}</h1>
                    {metadata ? <p className='text-muted-foreground mt-2 text-sm'>{metadata.sourceFilename}</p> : null}
                </div>
                {isLoading ? <p className='text-muted-foreground'>{t('share.loading')}</p> : null}
                {error ? <p className='text-destructive text-sm'>{error}</p> : null}
                {metadata?.expired ? <p className='text-destructive text-sm'>{t('share.expired')}</p> : null}
                {metadata && metadata.accessCodeRequired && !imageUrl && !metadata.expired ? (
                    <form
                        className='flex max-w-sm gap-2'
                        onSubmit={(event) => {
                            event.preventDefault();
                            void loadImage();
                        }}>
                        <Input
                            value={accessCode}
                            onChange={(event) => setAccessCode(event.target.value)}
                            placeholder={t('share.accessCodePlaceholder')}
                            type='password'
                        />
                        <Button type='submit' disabled={isUnlocking || accessCode.trim().length === 0}>
                            {t('share.unlock')}
                        </Button>
                    </form>
                ) : null}
                {imageUrl ? (
                    <div className='relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted'>
                        <Image src={imageUrl} alt={metadata?.sourceFilename || t('share.imageAlt')} fill className='object-contain' unoptimized />
                    </div>
                ) : null}
            </section>
        </main>
    );
}
