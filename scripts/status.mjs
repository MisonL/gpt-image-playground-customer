#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { HF_SPACE_ID, HF_SPACE_URL } from './hf-space-doctor-utils.mjs';
import { isMainModule, parseJsonPayload, printJson, runCommand, runCommandStrict } from './command-center-utils.mjs';

const REMOTE_STATUS_TIMEOUT_MS = 30_000;

export function buildAdminCommands() {
    return {
        doctor: 'npm run doctor',
        status: 'npm run status',
        verify: 'npm run verify',
        deploy_local: 'npm run deploy:local',
        deploy_space: 'npm run deploy:space',
        agent_doctor: 'npm run agent:doctor',
        hf_space_doctor: 'npm run doctor:hf-space',
        hf_space_smoke: 'npm run smoke:hf-space'
    };
}

export function parseGitStatusEntries(output) {
    const entries = output.split('\0').filter(Boolean);
    const paths = [];
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const status = entry.slice(0, 2);
        paths.push(entry.slice(3));
        if (status.includes('R') || status.includes('C')) index += 1;
    }
    return paths;
}

function parseArgs(argv) {
    const unknown = argv.find((arg) => !['--help', '-h', '--remote'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        remote: argv.includes('--remote')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run status
  npm run status -- --remote

Options:
  --remote       Include read-only Hugging Face Space runtime info.
  --help         Show this help.`);
}

function buildLocalStatus() {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const branch = runCommandStrict('git', ['branch', '--show-current']).trim();
    const head = runCommandStrict('git', ['rev-parse', '--short', 'HEAD']).trim();
    const changed = parseGitStatusEntries(runCommandStrict('git', ['status', '--porcelain=v1', '-z']));
    return {
        product: packageJson.name,
        version: packageJson.version,
        branch,
        head,
        dirty: changed.length > 0,
        changed_files: changed,
        node: process.version,
        commands: buildAdminCommands(),
        space: {
            id: HF_SPACE_ID,
            url: HF_SPACE_URL
        },
        agent: {
            capabilities: '/api/agent/capabilities',
            skill: 'skills/gpt-image-playground-agent/SKILL.md'
        }
    };
}

export function readRemoteStatusFromResult(result) {
    if (!result.ok) {
        return { ok: false, error: result.error || result.stderr || result.stdout || 'Cannot read Hugging Face Space info.' };
    }
    let info;
    try {
        info = parseJsonPayload(result.stdout, 'hf spaces info');
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return {
        ok: true,
        stage: info.runtime?.stage || 'unknown',
        sha: info.sha || info.runtime?.raw?.sha || 'unknown',
        hardware: info.runtime?.hardware || info.hardware || 'unknown'
    };
}

function readRemoteStatus() {
    return readRemoteStatusFromResult(
        runCommand('hf', ['spaces', 'info', HF_SPACE_ID, '--format', 'json'], { timeoutMs: REMOTE_STATUS_TIMEOUT_MS })
    );
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const status = buildLocalStatus();
    printJson({
        ok: true,
        ...status,
        ...(options.remote ? { remote: readRemoteStatus() } : {})
    });
}

try {
    if (isMainModule(import.meta.url, process.argv[1])) main();
} catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}
