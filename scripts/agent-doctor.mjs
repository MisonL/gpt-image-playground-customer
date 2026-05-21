#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { isMainModule, parseJsonPayload, pickFailureOutput, printJson, runCommand } from './command-center-utils.mjs';

const GENERATE_SCRIPT = fileURLToPath(new URL('../skills/gpt-image-playground-agent/scripts/generate-image.mjs', import.meta.url));
const AGENT_DOCTOR_TIMEOUT_MS = 75_000;

export function buildAgentDoctorArgs() {
    return [GENERATE_SCRIPT, '--contract-check', '--timeout-ms', '60000', 'contract check'];
}

function parseArgs(argv) {
    const unknown = argv.find((arg) => !['--help', '-h'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    return {
        help: argv.includes('--help') || argv.includes('-h')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run agent:doctor

Environment:
  GPT_IMAGE_PLAYGROUND_URL       Service base URL, defaults to http://localhost:4783.
  GPT_IMAGE_AGENT_TOKEN          Bearer token when capabilities require bearer auth.
  GPT_IMAGE_APP_PASSWORD_HASH    Password hash when capabilities require page password auth.`);
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const result = runCommand(process.execPath, buildAgentDoctorArgs(), {
        env: { ...process.env, GPT_IMAGE_AGENT_CONTRACT_CHECK: '1' },
        timeoutMs: AGENT_DOCTOR_TIMEOUT_MS
    });
    if (!result.ok) {
        printJson({ ok: false, command: 'agent:doctor', output: pickFailureOutput(result) });
        process.exit(1);
    }

    const body = result.stdout ? parseJsonPayload(result.stdout, 'agent contract check') : {};
    printJson({ ok: true, command: 'agent:doctor', contract: body });
}

try {
    if (isMainModule(import.meta.url, process.argv[1])) main();
} catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}
