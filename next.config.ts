import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    allowedDevOrigins: ['127.0.0.1'],
    output: 'standalone',
    outputFileTracingExcludes: {
        '*': ['./generated-images/**/*', './artifacts/**/*', './dist/**/*', './.next/cache/**/*']
    }
};

export default nextConfig;
