import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { I18nProvider } from '@/lib/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: '图像手记 | Visual Journal',
    description: '图像手记（Visual Journal），面向中文创作者的 AI 图像创作工作台。',
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
