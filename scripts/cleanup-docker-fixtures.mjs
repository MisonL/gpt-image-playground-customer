#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule, pickFailureOutput, printJson, runCommand } from './command-center-utils.mjs';

const LEGACY_FIXTURE_CONTAINER = 'gipc-local-image-fixture';
const LEGACY_FIXTURE_DESTINATION = '/workspace';
const DOCKER_TIMEOUT_MS = 30_000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function hasLegacyFixtureRepoMount(mounts, repoRoot = REPO_ROOT) {
    const resolvedRepoRoot = resolve(repoRoot);
    return mounts.some(
        (mount) =>
            mount?.Type === 'bind' &&
            typeof mount.Source === 'string' &&
            resolve(mount.Source) === resolvedRepoRoot &&
            mount.Destination === LEGACY_FIXTURE_DESTINATION
    );
}

export function parseDockerInspectContainer(output) {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed) || !parsed[0] || typeof parsed[0] !== 'object') {
        throw new Error('docker inspect did not return a container object');
    }
    return parsed[0];
}

export function summarizeDockerMounts(mounts) {
    return mounts.map((mount) => ({
        type: mount.Type,
        source: mount.Source,
        destination: mount.Destination,
        mode: mount.Mode,
        writable: mount.RW
    }));
}

function parseArgs(argv) {
    const options = {
        dryRun: false,
        help: false,
        containerName: LEGACY_FIXTURE_CONTAINER
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--container') {
            const value = argv[index + 1];
            if (!value) throw new Error('--container requires a value');
            options.containerName = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

function printHelp() {
    console.log(`用法：npm run docker:cleanup-fixtures -- [--dry-run] [--container <name>]

清理遗留的本地图片上游 Docker fixture 容器。该脚本只会删除同时满足以下条件的容器：

- 容器名匹配，默认 ${LEGACY_FIXTURE_CONTAINER}
- 存在 ${REPO_ROOT} -> ${LEGACY_FIXTURE_DESTINATION} 的整仓 bind mount

推荐使用 npm run smoke:image-upstream-local 启动本地 fixture。不要用 docker run -v "$PWD:${LEGACY_FIXTURE_DESTINATION}" 启动 fixture。`);
}

function isMissingContainer(result) {
    const output = `${result.stdout}\n${result.stderr}`;
    return /No such object|No such container/i.test(output);
}

export function buildAbsentReport(containerName) {
    return {
        ok: true,
        command: 'docker:cleanup-fixtures',
        container: containerName,
        present: false,
        unsafe_repo_mount: false,
        removed: false
    };
}

export function buildSkippedReport(containerName, mounts) {
    return {
        ok: true,
        command: 'docker:cleanup-fixtures',
        container: containerName,
        present: true,
        unsafe_repo_mount: false,
        removed: false,
        mounts: summarizeDockerMounts(mounts)
    };
}

function cleanupLegacyFixtureContainer(options) {
    const inspect = runCommand('docker', ['inspect', options.containerName], { timeoutMs: DOCKER_TIMEOUT_MS });
    if (!inspect.ok) {
        if (isMissingContainer(inspect)) return buildAbsentReport(options.containerName);
        return {
            ok: false,
            command: 'docker:cleanup-fixtures',
            phase: 'inspect',
            container: options.containerName,
            error: pickFailureOutput(inspect)
        };
    }

    let container;
    try {
        container = parseDockerInspectContainer(inspect.stdout);
    } catch (error) {
        return {
            ok: false,
            command: 'docker:cleanup-fixtures',
            phase: 'parse-inspect',
            container: options.containerName,
            error: error instanceof Error ? error.message : String(error)
        };
    }

    const mounts = Array.isArray(container.Mounts) ? container.Mounts : [];
    if (!hasLegacyFixtureRepoMount(mounts, REPO_ROOT)) return buildSkippedReport(options.containerName, mounts);
    if (options.dryRun) {
        return {
            ok: true,
            command: 'docker:cleanup-fixtures',
            container: options.containerName,
            present: true,
            unsafe_repo_mount: true,
            removed: false,
            dry_run: true,
            mounts: summarizeDockerMounts(mounts)
        };
    }

    const remove = runCommand('docker', ['rm', '-f', options.containerName], { timeoutMs: DOCKER_TIMEOUT_MS });
    return {
        ok: remove.ok,
        command: 'docker:cleanup-fixtures',
        container: options.containerName,
        present: true,
        unsafe_repo_mount: true,
        removed: remove.ok,
        mounts: summarizeDockerMounts(mounts),
        ...(remove.ok ? {} : { phase: 'remove', error: pickFailureOutput(remove) })
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    const report = cleanupLegacyFixtureContainer(options);
    printJson(report);
    if (!report.ok) process.exitCode = 1;
}

if (isMainModule(import.meta.url, process.argv[1])) main();
