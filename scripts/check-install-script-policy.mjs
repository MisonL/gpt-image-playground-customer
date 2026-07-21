#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function readJson(path) {
    return JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'));
}

function extractPackageName(lockfilePath) {
    const packagePath = lockfilePath.slice(lockfilePath.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (/^(?:@[^/]+\/)?[^/]+$/.test(packagePath)) return packagePath;
    return undefined;
}

export function collectInstallScriptIdentities(packageLock) {
    const identities = [];
    for (const [lockfilePath, manifest] of Object.entries(packageLock.packages ?? {})) {
        if (!lockfilePath.includes('node_modules/') || manifest?.hasInstallScript !== true) continue;

        const name = extractPackageName(lockfilePath);
        if (!name || typeof manifest.version !== 'string' || manifest.version.length === 0) {
            throw new Error(`Invalid install-script package-lock entry: ${lockfilePath}`);
        }
        identities.push(`${name}@${manifest.version}`);
    }
    return [...new Set(identities)].sort();
}

export function validateInstallScriptPolicy(packageLock, packageJson) {
    const installScriptIdentities = collectInstallScriptIdentities(packageLock);
    const policy = packageJson.allowScripts;
    const entries = policy && typeof policy === 'object' && !Array.isArray(policy) ? Object.entries(policy) : [];
    const invalid = entries
        .filter(([, value]) => typeof value !== 'boolean')
        .map(([identity]) => identity)
        .sort();
    const approved = entries
        .filter(([, value]) => value === true)
        .map(([identity]) => identity)
        .sort();
    const denied = entries
        .filter(([, value]) => value === false)
        .map(([identity]) => identity)
        .sort();
    const configured = entries.map(([identity]) => identity);
    const missing = installScriptIdentities.filter((identity) => !approved.includes(identity));
    const stale = configured.filter((identity) => !installScriptIdentities.includes(identity)).sort();

    return {
        ok: missing.length === 0 && stale.length === 0 && invalid.length === 0,
        installScriptIdentities,
        approved,
        denied,
        missing,
        stale,
        invalid
    };
}

function main() {
    const result = validateInstallScriptPolicy(readJson('package-lock.json'), readJson('package.json'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
