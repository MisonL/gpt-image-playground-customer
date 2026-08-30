import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    allowedDevOrigins: ['127.0.0.1'],
    output: 'standalone',
    outputFileTracingExcludes: {
        '*': ['./generated-images/**/*', './artifacts/**/*', './dist/**/*', './.next/cache/**/*']
    },
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
                ]
            }
        ];
    }
};

export default nextConfig;
