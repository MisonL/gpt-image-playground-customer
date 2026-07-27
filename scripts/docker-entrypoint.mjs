#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IPV4_LOOPBACK_PATTERN = /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]']);

export function isLoopbackBindHost(value) {
    const host = value?.trim().toLowerCase();
    return Boolean(host) && (LOOPBACK_HOSTS.has(host) || IPV4_LOOPBACK_PATTERN.test(host));
}

export function assertDockerComposeAccessPolicy(env = process.env) {
    if (env.GIP_COMPOSE_DEPLOYMENT?.trim().toLowerCase() !== 'true') return;
    if (isLoopbackBindHost(env.GIP_BIND_HOST)) return;
    if (env.APP_PASSWORD?.trim()) return;

    throw new Error(
        '拒绝以非回环地址发布 Docker 服务：请先在 .env.local 设置 APP_PASSWORD，或将 GIP_BIND_HOST 保持为 127.0.0.1。'
    );
}

async function main() {
    assertDockerComposeAccessPolicy();
    await import('../server.js');
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
