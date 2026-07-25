#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NPM_INSTALL_POLICY_CHECK_COMMAND } from './npm-install-policy.mjs';

export const LOCAL_DEPENDENCY_INSTALL_COMMAND =
    `npm run install-scripts:check && ${NPM_INSTALL_POLICY_CHECK_COMMAND} && npm ci --strict-allow-scripts && npm run dependencies:check`;

export function inspectDependencyInstallation(cwd = process.cwd()) {
    const root = resolve(cwd);
    const nodeModulesPath = join(root, 'node_modules');
    const rootLockfilePath = join(root, 'package-lock.json');
    const hiddenLockfilePath = join(nodeModulesPath, '.package-lock.json');
    if (!existsSync(nodeModulesPath)) return buildFailure('node_modules_missing');

    const rootLockfile = readLockfile(rootLockfilePath, true);
    if (!rootLockfile.ok) return buildFailure(rootLockfile.reason);
    const hiddenLockfile = readLockfile(hiddenLockfilePath, false);
    if (!hiddenLockfile.ok) return buildFailure(hiddenLockfile.reason);

    const directDependencies = collectDirectDependencies(rootLockfile.value.packages['']);
    const rootLockMismatches = collectRootLockMismatches(directDependencies, rootLockfile.value.packages);
    if (rootLockMismatches.length) return buildFailure('root_lockfile_direct_package_missing', { directDependencies, rootLockMismatches });

    const hiddenLockMismatches = collectHiddenLockMismatches(
        directDependencies,
        rootLockfile.value.packages,
        hiddenLockfile.value.packages
    );
    if (hiddenLockMismatches.length) {
        return buildFailure('hidden_lockfile_package_mismatch', { directDependencies, hiddenLockMismatches });
    }

    const installedPackages = inspectDirectPackageManifests(nodeModulesPath, directDependencies, rootLockfile.value.packages);
    if (installedPackages.missingPackages.length) {
        return buildFailure('direct_package_missing', { directDependencies, ...installedPackages });
    }
    if (installedPackages.invalidPackages.length) {
        return buildFailure('direct_package_manifest_invalid', { directDependencies, ...installedPackages });
    }
    if (installedPackages.nameMismatches.length) {
        return buildFailure('direct_package_name_mismatch', { directDependencies, ...installedPackages });
    }
    if (installedPackages.versionMismatches.length) {
        return buildFailure('direct_package_version_mismatch', { directDependencies, ...installedPackages });
    }
    return { ok: true, directDependencies };
}

function readLockfile(path, isRootLockfile) {
    if (!existsSync(path)) return { ok: false, reason: isRootLockfile ? 'root_lockfile_missing' : 'hidden_lockfile_missing' };
    try {
        const value = JSON.parse(readFileSync(path, 'utf8'));
        if (!isLockfile(value, isRootLockfile)) {
            return { ok: false, reason: isRootLockfile ? 'root_lockfile_invalid' : 'hidden_lockfile_invalid' };
        }
        return { ok: true, value };
    } catch {
        return { ok: false, reason: isRootLockfile ? 'root_lockfile_invalid' : 'hidden_lockfile_invalid' };
    }
}

function isLockfile(value, requiresRootPackage) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (!Number.isInteger(value.lockfileVersion) || !value.packages || typeof value.packages !== 'object') return false;
    return !requiresRootPackage || Boolean(value.packages[''] && typeof value.packages[''] === 'object');
}

function collectDirectDependencies(rootPackage) {
    const names = new Set();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const dependencies = rootPackage?.[field];
        if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
        for (const name of Object.keys(dependencies)) names.add(name);
    }
    return [...names].sort();
}

function collectRootLockMismatches(directDependencies, packages) {
    return directDependencies.filter((name) => !readPackageVersion(packages, `node_modules/${name}`));
}

function collectHiddenLockMismatches(directDependencies, rootPackages, hiddenPackages) {
    return directDependencies.flatMap((name) => {
        const expected = readPackageVersion(rootPackages, `node_modules/${name}`);
        const actual = readPackageVersion(hiddenPackages, `node_modules/${name}`);
        return actual === expected ? [] : [{ name, expected, actual }];
    });
}

function inspectDirectPackageManifests(nodeModulesPath, directDependencies, rootPackages) {
    const missingPackages = [];
    const invalidPackages = [];
    const nameMismatches = [];
    const versionMismatches = [];
    for (const name of directDependencies) {
        const manifestPath = join(nodeModulesPath, name, 'package.json');
        if (!existsSync(manifestPath)) {
            missingPackages.push(name);
            continue;
        }
        const manifest = readPackageManifest(manifestPath);
        if (!manifest) {
            invalidPackages.push(name);
            continue;
        }
        if (manifest.name !== name) nameMismatches.push({ expected: name, actual: manifest.name });
        const expected = readPackageVersion(rootPackages, `node_modules/${name}`);
        if (manifest.version !== expected) versionMismatches.push({ name, expected, actual: manifest.version });
    }
    return { missingPackages, invalidPackages, nameMismatches, versionMismatches };
}

function readPackageManifest(path) {
    try {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        if (!manifest || typeof manifest !== 'object' || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
            return undefined;
        }
        return manifest;
    } catch {
        return undefined;
    }
}

function readPackageVersion(packages, packagePath, visited = new Set()) {
    if (visited.has(packagePath)) return undefined;
    visited.add(packagePath);
    const manifest = packages[packagePath];
    if (typeof manifest?.version === 'string' && manifest.version.length > 0) return manifest.version;
    if (!manifest?.link || typeof manifest.resolved !== 'string') return undefined;
    return readPackageVersion(packages, manifest.resolved, visited);
}

function buildFailure(reason, details = {}) {
    return {
        ok: false,
        reason,
        directDependencies: details.directDependencies || [],
        missingPackages: details.missingPackages || [],
        invalidPackages: details.invalidPackages || [],
        nameMismatches: details.nameMismatches || [],
        versionMismatches: details.versionMismatches || [],
        rootLockMismatches: details.rootLockMismatches || [],
        hiddenLockMismatches: details.hiddenLockMismatches || []
    };
}

function main() {
    const result = inspectDependencyInstallation();
    if (result.ok) return;
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
