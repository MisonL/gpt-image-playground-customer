#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { isMainModule, parseJsonPayload, printJson, runCommand } from './command-center-utils.mjs';

const HF_DOCTOR_SCRIPT = fileURLToPath(new URL('./doctor-hf-space.mjs', import.meta.url));
const DOCTOR_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
    const unknown = argv.find((arg) => !['--help', '-h', '--skip-remote'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        skipRemote: argv.includes('--skip-remote')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run doctor
  npm run doctor -- --skip-remote

Options:
  --skip-remote  Skip read-only Hugging Face remote checks.
  --help         Show this help.`);
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const args = [HF_DOCTOR_SCRIPT, ...(options.skipRemote ? ['--skip-remote'] : [])];
    const result = runCommand(process.execPath, args, { timeoutMs: DOCTOR_TIMEOUT_MS });
    const child = result.stdout ? parseJsonPayload(result.stdout, 'doctor:hf-space') : {};
    const ok = result.ok && child.ok !== false;
    printJson({
        ok,
        profile: 'local-and-hf-space',
        checks: child.checks || [],
        nextActions: child.nextActions || [],
        ...(ok ? {} : { error: child.error || result.stderr || result.error || 'doctor failed' })
    });
    if (!ok) process.exit(1);
}

try {
    if (isMainModule(import.meta.url, process.argv[1])) main();
} catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}
