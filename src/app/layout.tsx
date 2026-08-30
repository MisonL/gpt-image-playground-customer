import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { I18nProvider } from '@/lib/i18n';
import type { Metadata } from 'next';
import { headers } from 'next/headers';

export const metadata: Metadata = {
    title: '图像手记 | AI 图像创作工作台',
    description: '图像手记是用于生成、编辑和管理图像的 AI 图像创作工作台。',
    icons: {
        icon: '/favicon.svg'
    }
};

export default async function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    const nonce = (await headers()).get('x-nonce') ?? undefined;
    return (
        <html lang='zh-CN' suppressHydrationWarning>
            <body className='antialiased'>
                <ThemeProvider
                    attribute='class'
                    defaultTheme='light'
                    enableSystem={false}
                    disableTransitionOnChange
                    nonce={nonce}>
                    <I18nProvider>{children}</I18nProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
