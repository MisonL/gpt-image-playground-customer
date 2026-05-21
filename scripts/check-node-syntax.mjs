#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_DIRS = ['scripts', 'skills'];

function listMjsFiles() {
    return CHECK_DIRS.flatMap((dir) => listMjsFilesUnder(join(REPO_ROOT, dir))).sort((a, b) => a.label.localeCompare(b.label));
}

function listMjsFilesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return listMjsFilesUnder(path);
        if (!entry.isFile() || !entry.name.endsWith('.mjs')) return [];
        return {
            path,
            label: relative(REPO_ROOT, path).replaceAll('\\', '/')
        };
    });
}

let failed = false;
for (const file of listMjsFiles()) {
    const result = spawnSync(process.execPath, ['--check', file.path], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status === 0) continue;
    failed = true;
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    console.error(output || `Syntax check failed: ${file.label}`);
}

if (failed) process.exit(1);
