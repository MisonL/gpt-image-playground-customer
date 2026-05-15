import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { I18nProvider } from '@/lib/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'GPT Image Playground',
    description: '使用 OpenAI GPT Image 模型生成和编辑图片。',
    icons: {
        icon: '/favicon.svg'
    }
};

export default function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang='zh-CN' suppressHydrationWarning>
            <body className='antialiased'>
                <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
                    <I18nProvider>{children}</I18nProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
