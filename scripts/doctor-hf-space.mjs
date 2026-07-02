#!/usr/bin/env node

import { existsSync } from 'node:fs';
import {
    assertKnownOptions,
    buildNextActions,
    classifyRequiredAndRecommendedNames,
    HF_SPACE_ID,
    HF_SPACE_URL,
    getJsonKeyValues,
    getJsonNames,
    isMainModule,
    runDoctorCommand,
    validateSpaceUrl
} from './hf-space-doctor-utils.mjs';

const MIN_NODE_VERSION = '>=20.9.0';
const REQUIRED_SPACE_VARIABLES = ['AGENT_STATE_BACKEND', 'NEXT_PUBLIC_IMAGE_STORAGE_MODE'];
const RECOMMENDED_SPACE_VARIABLES = ['APP_LOG_LEVEL'];
const REQUIRED_SPACE_VARIABLE_VALUES = new Map([
    ['AGENT_STATE_BACKEND', 'memory'],
    ['NEXT_PUBLIC_IMAGE_STORAGE_MODE', 'indexeddb']
]);
const REQUIRED_SPACE_SECRETS = ['APP_PASSWORD', 'AGENT_API_TOKEN'];
const OPTIONAL_GENERATION_SECRETS = ['OPENAI_API_KEY', 'OPENAI_CHANNEL_1_API_KEYS'];

function parseArgs(argv) {
    assertKnownOptions(argv, ['--help', '-h', '--skip-remote']);
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        skipRemote: argv.includes('--skip-remote')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run doctor:hf-space

Options:
  --skip-remote         Skip read-only Hugging Face remote checks.
  --help                Show this help.`);
}

function addCheck(checks, status, name, message, details = {}) {
    checks.push({ status, name, message, ...details });
}

function checkNode(checks) {
    const match = process.version.match(/^v(\d+)\.(\d+)\./);
    const major = match ? Number(match[1]) : 0;
    const minor = match ? Number(match[2]) : 0;
    if (major > 20 || (major === 20 && minor >= 9)) {
        addCheck(checks, 'pass', 'node', `Node.js ${process.version} is supported.`);
        return;
    }
    addCheck(checks, 'fail', 'node', `Node.js ${process.version} is too old. Install Node.js ${MIN_NODE_VERSION} or newer.`);
}

function checkCommand(checks, name, command, args, failureAction) {
    const result = runDoctorCommand(command, args);
    if (result.ok) {
        addCheck(checks, 'pass', name, `${command} is available.`, { version: result.stdout.split(/\r?\n/)[0] });
        return true;
    }
    addCheck(checks, 'fail', name, failureAction, { error: result.error });
    return false;
}

function checkConfiguredTarget(checks) {
    const spaceUrlError = validateSpaceUrl(HF_SPACE_URL);
    if (spaceUrlError) {
        addCheck(checks, 'fail', 'space-target', spaceUrlError);
        return;
    }
    addCheck(checks, 'pass', 'space-target', `Using fixed Space target ${HF_SPACE_ID}.`, { spaceUrl: HF_SPACE_URL });
}

function checkRemote(checks, skipRemote, hfAvailable, hfAuthenticated) {
    if (skipRemote) {
        addCheck(checks, 'skip', 'remote-space', 'Remote checks were skipped by --skip-remote.');
        return;
    }
    if (!hfAvailable || !hfAuthenticated) {
        addCheck(checks, 'skip', 'remote-space', 'Remote checks require hf CLI and hf auth login.');
        return;
    }

    const info = runDoctorCommand('hf', ['spaces', 'info', HF_SPACE_ID, '--format', 'json']);
    if (!info.ok) {
        addCheck(checks, 'fail', 'remote-space', `Cannot read Space info for ${HF_SPACE_ID}.`, { error: info.error });
        return;
    }
    addCheck(checks, 'pass', 'remote-space', `Space ${HF_SPACE_ID} is accessible.`);
    checkRemoteNames(
        checks,
        HF_SPACE_ID,
        'remote-variables',
        ['spaces', 'variables', 'list', HF_SPACE_ID, '--json'],
        REQUIRED_SPACE_VARIABLES,
        RECOMMENDED_SPACE_VARIABLES
    );
    checkRemoteSecrets(checks, HF_SPACE_ID);
}

function checkRemoteNames(checks, spaceId, name, args, requiredNames, recommendedNames = []) {
    const result = runDoctorCommand('hf', args);
    if (!result.ok) {
        addCheck(checks, 'warn', name, `Cannot list ${name} for ${spaceId}.`, { error: result.error });
        return;
    }
    try {
        const names = getJsonNames(result.stdout);
        const { missingRequired, missingRecommended } = classifyRequiredAndRecommendedNames(
            names,
            requiredNames,
            recommendedNames
        );
        if (missingRequired.length) {
            addCheck(checks, 'fail', name, `${name} missing required names: ${missingRequired.join(', ')}.`);
        } else {
            addCheck(checks, 'pass', name, `${name} contains required names.`);
        }
        if (missingRecommended.length) {
            addCheck(checks, 'warn', name, `${name} missing recommended names: ${missingRecommended.join(', ')}.`);
        }
        checkRemoteVariableValues(checks, result.stdout);
    } catch (error) {
        addCheck(checks, 'warn', name, `Cannot parse ${name} JSON output.`, {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

function checkRemoteVariableValues(checks, jsonText) {
    const values = getJsonKeyValues(jsonText);
    const mismatches = [];
    for (const [key, expected] of REQUIRED_SPACE_VARIABLE_VALUES) {
        const actual = values.get(key);
        if (actual !== expected) mismatches.push(`${key}=${actual ?? '<missing>'} expected ${expected}`);
    }
    if (mismatches.length) {
        addCheck(checks, 'fail', 'remote-variable-values', `Remote variable values are not Space-free compatible: ${mismatches.join(', ')}.`);
        return;
    }
    addCheck(checks, 'pass', 'remote-variable-values', 'Remote variable values match the Space-free runtime contract.');
}

function checkRemoteSecrets(checks, spaceId) {
    const result = runDoctorCommand('hf', ['spaces', 'secrets', 'list', spaceId, '--json']);
    if (!result.ok) {
        addCheck(checks, 'warn', 'remote-secrets', `Cannot list remote secrets for ${spaceId}.`, { error: result.error });
        return;
    }
    try {
        const names = getJsonNames(result.stdout);
        const missing = REQUIRED_SPACE_SECRETS.filter((key) => !names.has(key));
        const hasGenerationSecret = OPTIONAL_GENERATION_SECRETS.some((key) => names.has(key));
        if (missing.length) {
            addCheck(checks, 'fail', 'remote-secrets', `Remote secrets missing: ${missing.join(', ')}.`);
        } else {
            addCheck(checks, 'pass', 'remote-secrets', 'Remote secrets contain APP_PASSWORD and AGENT_API_TOKEN.');
        }
        if (hasGenerationSecret) {
            addCheck(checks, 'pass', 'remote-generation-secret', 'Remote generation credential is configured.');
        } else {
            addCheck(checks, 'warn', 'remote-generation-secret', 'No OPENAI_API_KEY or OPENAI_CHANNEL_1_API_KEYS secret found; server-side generation may be unavailable.');
        }
    } catch (error) {
        addCheck(checks, 'warn', 'remote-secrets', 'Cannot parse remote secrets JSON output.', {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const checks = [];
    checkNode(checks);
    checkCommand(checks, 'npm', 'npm', ['--version'], `npm is missing. Install Node.js ${MIN_NODE_VERSION} or newer with npm.`);
    const hfAvailable = checkCommand(checks, 'hf-cli', 'hf', ['version'], 'hf CLI is missing. Install the Hugging Face CLI.');
    const hfAuth = hfAvailable ? runDoctorCommand('hf', ['auth', 'whoami']) : { ok: false };
    if (hfAvailable && hfAuth.ok) {
        addCheck(checks, 'pass', 'hf-auth', 'hf CLI is authenticated.');
    } else if (hfAvailable) {
        addCheck(checks, 'fail', 'hf-auth', 'hf CLI auth check failed.', {
            action: 'hf auth login',
            error: hfAuth.error
        });
    }
    if (existsSync('node_modules')) {
        addCheck(checks, 'pass', 'node-modules', 'node_modules exists.');
    } else {
        addCheck(checks, 'warn', 'node-modules', 'node_modules is missing; build, lint, test, and smoke commands require npm install.');
    }
    checkCommand(checks, 'git', 'git', ['--version'], 'git is missing; install git before cloning or pushing Space repos.');
    const docker = runDoctorCommand('docker', ['version', '--format', '{{.Server.Version}}']);
    if (docker.ok) {
        addCheck(checks, 'pass', 'docker', 'docker is available.', { version: docker.stdout.split(/\r?\n/)[0] });
    } else {
        addCheck(checks, 'warn', 'docker', 'Docker is unavailable; npm run smoke:hf-space-local will not work.', {
            error: docker.error
        });
        const dockerCli = runDoctorCommand('docker', ['--version']);
        if (dockerCli.ok) addCheck(checks, 'warn', 'docker-daemon', 'Docker CLI exists but the daemon is not reachable.');
    }

    checkConfiguredTarget(checks);
    checkRemote(checks, options.skipRemote, hfAvailable, Boolean(hfAuth.ok));

    const failed = checks.some((check) => check.status === 'fail');
    console.log(JSON.stringify({ ok: !failed, checks, nextActions: buildNextActions(checks) }, null, 2));
    if (failed) process.exit(1);
}

try {
    if (isMainModule(import.meta.url, process.argv[1])) {
        main();
    }
} catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
}
