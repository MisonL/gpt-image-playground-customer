#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_DIRS = ['scripts', 'skills'];
const SCRIPT_SUFFIXES = ['.mjs', '.cjs'];

function listScriptFiles() {
    return CHECK_DIRS.flatMap((dir) => listScriptFilesUnder(join(REPO_ROOT, dir))).sort((a, b) => a.label.localeCompare(b.label));
}

function listScriptFilesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return listScriptFilesUnder(path);
        if (!entry.isFile() || !SCRIPT_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) return [];
        return {
            path,
            label: relative(REPO_ROOT, path).replaceAll('\\', '/')
        };
    });
}

let failed = false;
for (const file of listScriptFiles()) {
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
