#!/usr/bin/env node

import { setTimeout as delay } from 'node:timers/promises';

import { fetchJsonWithTimeout, isMainModule, pickFailureOutput, printJson, runCommand } from './command-center-utils.mjs';

const LOCAL_BASE_URL = 'http://localhost:4783';
const PROBE_PATHS = ['/api/auth-status', '/api/runtime-capabilities', '/api/agent/capabilities'];
const PROBE_ATTEMPTS = 30;
const PROBE_INTERVAL_MS = 2000;
const PROBE_TIMEOUT_MS = 5000;
const DOCKER_COMPOSE_TIMEOUT_MS = 10 * 60 * 1000;

export function buildDockerComposeArgs(options = {}) {
    const files = ['-f', 'docker-compose.yml'];
    if (options.memory) files.push('-f', 'docker-compose.memory.yml');
    return ['compose', ...files, 'up', '-d', '--build'];
}

export function buildDockerComposeEnv(env = process.env) {
    return { ...env, COMPOSE_PROGRESS: 'plain' };
}

function parseArgs(argv) {
    const unknown = argv.find((arg) => !['--help', '-h', '--memory', '--skip-probe'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        memory: argv.includes('--memory'),
        skipProbe: argv.includes('--skip-probe')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run deploy:local
  npm run deploy:local -- --memory

Options:
  --memory       Use docker-compose.memory.yml overlay for HF Space-like memory mode.
  --skip-probe   Rebuild and start the container without HTTP endpoint probes.
  --help         Show this help.`);
}

async function fetchJson(path) {
    return fetchJsonWithTimeout(new URL(path, LOCAL_BASE_URL), { timeoutMs: PROBE_TIMEOUT_MS });
}

async function waitForLocalEndpoints() {
    let lastError = '';
    for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
        try {
            const responses = {};
            for (const path of PROBE_PATHS) responses[path] = await fetchJson(path);
            return {
                attempts: attempt,
                baseUrl: LOCAL_BASE_URL,
                authRequired: responses['/api/auth-status'].passwordRequired,
                stateBackend: responses['/api/agent/capabilities'].defaults?.state_backend,
                imageStorageMode: responses['/api/agent/capabilities'].storage?.image_storage_mode,
                streamingBatch: responses['/api/runtime-capabilities'].streamingBatch
            };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            await delay(PROBE_INTERVAL_MS);
        }
    }
    throw new Error(`Local container did not pass HTTP probes: ${lastError}`);
}

export function assertLocalProbeMatchesMode(probe, options = {}) {
    if (!options.memory) return;
    const mismatches = [];
    if (probe.stateBackend !== 'memory') mismatches.push(`stateBackend=${probe.stateBackend ?? '<missing>'} expected memory`);
    if (probe.imageStorageMode !== 'indexeddb') {
        mismatches.push(`imageStorageMode=${probe.imageStorageMode ?? '<missing>'} expected indexeddb`);
    }
    if (mismatches.length) throw new Error(`Memory overlay did not take effect: ${mismatches.join(', ')}.`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const docker = runCommand('docker', buildDockerComposeArgs(options), {
        env: buildDockerComposeEnv(),
        timeoutMs: DOCKER_COMPOSE_TIMEOUT_MS
    });
    if (!docker.ok) {
        printJson({ ok: false, phase: 'docker-compose', output: pickFailureOutput(docker) });
        process.exit(1);
    }

    if (options.skipProbe) {
        printJson({ ok: true, phase: 'docker-compose', probe: 'skipped' });
        return;
    }

    const probe = await waitForLocalEndpoints();
    assertLocalProbeMatchesMode(probe, options);
    printJson({ ok: true, phase: 'ready', probe });
}

if (isMainModule(import.meta.url, process.argv[1])) {
    main().catch((error) => {
        printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
        process.exit(1);
    });
}
