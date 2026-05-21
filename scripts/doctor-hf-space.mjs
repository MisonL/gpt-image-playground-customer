#!/usr/bin/env node

import { existsSync, statSync } from 'node:fs';
import {
    assertKnownOptions,
    buildNextActions,
    classifyRequiredAndRecommendedNames,
    DEFAULT_ACCESS_FILE,
    getJsonNames,
    isMainModule,
    missingKeys,
    parseAccessFile,
    readEnvValue,
    readOptionValue,
    runCommand,
    validateSpaceId,
    validateSpaceUrl
} from './hf-space-doctor-utils.mjs';

const MIN_NODE_MAJOR = 20;
const REQUIRED_ACCESS_KEYS = ['HF_SPACE_ID', 'HF_SPACE_URL', 'HF_SPACE_SECRET_KEYS', 'APP_PASSWORD', 'AGENT_API_TOKEN'];
const FORBIDDEN_ACCESS_KEYS = ['HF_TOKEN', 'HUGGINGFACE_TOKEN', 'HF_PASSWORD', 'HUGGINGFACE_PASSWORD'];
const REQUIRED_SPACE_VARIABLES = ['AGENT_STATE_BACKEND', 'NEXT_PUBLIC_IMAGE_STORAGE_MODE'];
const RECOMMENDED_SPACE_VARIABLES = ['APP_LOG_LEVEL'];
const REQUIRED_SPACE_SECRETS = ['APP_PASSWORD', 'AGENT_API_TOKEN'];
const OPTIONAL_GENERATION_SECRETS = ['OPENAI_API_KEY', 'OPENAI_CHANNEL_1_API_KEYS'];

function parseArgs(argv) {
    assertKnownOptions(argv, ['--access-file', '--help', '-h', '--skip-remote']);
    return {
        accessFile: readOptionValue(argv, '--access-file') || readEnvValue('HF_SPACE_ACCESS_FILE') || DEFAULT_ACCESS_FILE,
        help: argv.includes('--help') || argv.includes('-h'),
        skipRemote: argv.includes('--skip-remote')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run doctor:hf-space

Options:
  --access-file <path>  Override the access file path.
  --skip-remote         Skip read-only Hugging Face remote checks.
  --help                Show this help.

Environment overrides:
  HF_SPACE_ACCESS_FILE`);
}

function addCheck(checks, status, name, message, details = {}) {
    checks.push({ status, name, message, ...details });
}

function checkNode(checks) {
    const major = Number.parseInt(process.versions.node.split('.')[0], 10);
    if (major >= MIN_NODE_MAJOR) {
        addCheck(checks, 'pass', 'node', `Node.js ${process.version} is supported.`);
        return;
    }
    addCheck(checks, 'fail', 'node', `Node.js ${process.version} is too old. Install Node.js ${MIN_NODE_MAJOR} or newer.`);
}

function checkCommand(checks, name, command, args, failureAction) {
    const result = runCommand(command, args);
    if (result.ok) {
        addCheck(checks, 'pass', name, `${command} is available.`, { version: result.stdout.split(/\r?\n/)[0] });
        return true;
    }
    addCheck(checks, 'fail', name, failureAction, { error: result.error });
    return false;
}

function checkAccessFile(checks, accessFile) {
    if (!existsSync(accessFile)) {
        addCheck(checks, 'fail', 'access-file', `Access file is missing: ${accessFile}`, {
            action: 'Run npm run init-access:hf-space -- --space-id <namespace>/<space-name> --space-url https://<user>-<space>.hf.space'
        });
        return undefined;
    }

    let values;
    try {
        values = parseAccessFile(accessFile);
    } catch (error) {
        addCheck(checks, 'fail', 'access-file', 'Access file cannot be read.', {
            error: error instanceof Error ? error.message : String(error)
        });
        return undefined;
    }

    addCheck(checks, 'pass', 'access-file', `Access file exists: ${accessFile}`);

    if (process.platform !== 'win32') {
        const mode = statSync(accessFile).mode & 0o777;
        if ((mode & 0o077) === 0) {
            addCheck(checks, 'pass', 'access-file-permissions', `Access file permissions are ${mode.toString(8)}.`);
        } else {
            addCheck(checks, 'fail', 'access-file-permissions', `Access file permissions are ${mode.toString(8)}; expected 600.`, {
                action: `chmod 600 ${accessFile}`
            });
        }
    }

    const missing = missingKeys(REQUIRED_ACCESS_KEYS, values);
    if (missing.length) {
        addCheck(checks, 'fail', 'access-file-keys', `Access file is missing required keys: ${missing.join(', ')}.`);
    } else {
        addCheck(checks, 'pass', 'access-file-keys', 'Access file contains all required non-empty keys.');
    }

    const forbidden = FORBIDDEN_ACCESS_KEYS.filter((key) => values.has(key));
    if (forbidden.length) {
        addCheck(checks, 'fail', 'access-file-forbidden-keys', `Access file must not contain Hugging Face credentials: ${forbidden.join(', ')}.`);
    } else {
        addCheck(checks, 'pass', 'access-file-forbidden-keys', 'Access file does not contain Hugging Face account credentials.');
    }

    validateAccessValues(checks, values);
    return values;
}

function validateAccessValues(checks, values) {
    const spaceId = values.get('HF_SPACE_ID')?.trim();
    const spaceIdError = validateSpaceId(spaceId);
    if (!spaceIdError) {
        addCheck(checks, 'pass', 'space-id', 'HF_SPACE_ID has namespace/space format.');
    } else if (spaceId) {
        addCheck(checks, 'fail', 'space-id', spaceIdError);
    }

    const spaceUrl = values.get('HF_SPACE_URL')?.trim();
    if (spaceUrl) {
        const spaceUrlError = validateSpaceUrl(spaceUrl);
        if (spaceUrlError) {
            addCheck(checks, 'fail', 'space-url', spaceUrlError);
        } else {
            addCheck(checks, 'pass', 'space-url', 'HF_SPACE_URL looks like a Hugging Face Space URL.');
        }
    }

    const appPassword = values.get('APP_PASSWORD') || '';
    const agentToken = values.get('AGENT_API_TOKEN') || '';
    if (appPassword.length >= 16 && agentToken.length >= 24) {
        addCheck(
            checks,
            'pass',
            'generated-secrets',
            'APP_PASSWORD access code and AGENT_API_TOKEN meet the minimum length checks.'
        );
    } else {
        addCheck(
            checks,
            'fail',
            'generated-secrets',
            'APP_PASSWORD access code must be at least 16 chars and AGENT_API_TOKEN at least 24 chars.'
        );
    }
}

function checkRemote(checks, values, skipRemote, hfAvailable, hfAuthenticated) {
    if (skipRemote) {
        addCheck(checks, 'skip', 'remote-space', 'Remote checks were skipped by --skip-remote.');
        return;
    }
    if (!hfAvailable || !hfAuthenticated || !values) {
        addCheck(checks, 'skip', 'remote-space', 'Remote checks require hf CLI, hf auth login, and a valid access file.');
        return;
    }

    const spaceId = values.get('HF_SPACE_ID')?.trim();
    if (!spaceId) {
        addCheck(checks, 'skip', 'remote-space', 'Remote checks require HF_SPACE_ID in the access file.');
        return;
    }
    const info = runCommand('hf', ['spaces', 'info', spaceId, '--format', 'json']);
    if (!info.ok) {
        addCheck(checks, 'fail', 'remote-space', `Cannot read Space info for ${spaceId}.`, { error: info.error });
        return;
    }
    addCheck(checks, 'pass', 'remote-space', `Space ${spaceId} is accessible.`);
    checkRemoteNames(
        checks,
        spaceId,
        'remote-variables',
        ['spaces', 'variables', 'list', spaceId, '--json'],
        REQUIRED_SPACE_VARIABLES,
        RECOMMENDED_SPACE_VARIABLES
    );
    checkRemoteSecrets(checks, spaceId);
}

function checkRemoteNames(checks, spaceId, name, args, requiredNames, recommendedNames = []) {
    const result = runCommand('hf', args);
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
    } catch (error) {
        addCheck(checks, 'warn', name, `Cannot parse ${name} JSON output.`, {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

function checkRemoteSecrets(checks, spaceId) {
    const result = runCommand('hf', ['spaces', 'secrets', 'list', spaceId, '--json']);
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
    checkCommand(checks, 'npm', 'npm', ['--version'], 'npm is missing. Install Node.js 20 or newer with npm.');
    const hfAvailable = checkCommand(checks, 'hf-cli', 'hf', ['version'], 'hf CLI is missing. Install the Hugging Face CLI.');
    const hfAuth = hfAvailable ? runCommand('hf', ['auth', 'whoami']) : { ok: false };
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
    const docker = runCommand('docker', ['version', '--format', '{{.Server.Version}}']);
    if (docker.ok) {
        addCheck(checks, 'pass', 'docker', 'docker is available.', { version: docker.stdout.split(/\r?\n/)[0] });
    } else {
        addCheck(checks, 'warn', 'docker', 'Docker is unavailable; npm run smoke:hf-space will not work.', {
            error: docker.error
        });
        const dockerCli = runCommand('docker', ['--version']);
        if (dockerCli.ok) addCheck(checks, 'warn', 'docker-daemon', 'Docker CLI exists but the daemon is not reachable.');
    }

    const values = checkAccessFile(checks, options.accessFile);
    checkRemote(checks, values, options.skipRemote, hfAvailable, Boolean(hfAuth.ok));

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
