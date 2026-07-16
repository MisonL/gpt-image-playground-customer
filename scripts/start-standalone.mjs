#!/usr/bin/env node
import nextEnv from '@next/env';
import { spawn } from 'node:child_process';
import { cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { loadEnvConfig } = nextEnv;

async function exists(filepath) {
    try {
        await stat(filepath);
        return true;
    } catch {
        return false;
    }
}

async function copyIfPresent(source, destination) {
    if (!(await exists(source))) return;
    await cp(source, destination, { recursive: true, force: true });
}

export function loadStandaloneEnvironment(root = process.cwd()) {
    return loadEnvConfig(root, false);
}

export async function startStandalone(root = process.cwd()) {
    const standaloneDir = path.join(root, '.next', 'standalone');
    const serverPath = path.join(standaloneDir, 'server.js');

    if (!(await exists(serverPath))) {
        throw new Error('未找到 standalone 构建产物。请先运行 npm run build，再运行 npm run start。');
    }

    loadStandaloneEnvironment(root);

    await copyIfPresent(path.join(root, 'public'), path.join(standaloneDir, 'public'));
    await copyIfPresent(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'));
    await copyIfPresent(
        path.join(root, 'node_modules', 'next', 'dist', 'compiled', 'next-server'),
        path.join(standaloneDir, 'node_modules', 'next', 'dist', 'compiled', 'next-server')
    );

    return spawn(process.execPath, [serverPath], {
        stdio: 'inherit',
        env: {
            ...process.env,
            IMAGE_OUTPUT_DIR: process.env.IMAGE_OUTPUT_DIR || 'generated-images',
            AGENT_SQLITE_PATH:
                process.env.AGENT_SQLITE_PATH || path.join(root, 'generated-images', '.agent-state', 'agent.sqlite'),
            PORT: process.env.PORT || '4783',
            HOSTNAME: process.env.HOSTNAME || '0.0.0.0'
        }
    });
}

async function main() {
    let child;
    try {
        child = await startStandalone();
    } catch (error) {
        console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }

    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 0);
    });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    await main();
}
