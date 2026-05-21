#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
    assertKnownOptions,
    assertSpaceTargetConfig,
    DEFAULT_ACCESS_FILE,
    isMainModule,
    parseAccessFile
} from './hf-space-doctor-utils.mjs';

const DEFAULT_SPACE_ID = 'misonL/gpt-image-playground-customer';
const DEFAULT_SPACE_URL = 'https://misonl-gpt-image-playground-customer.hf.space';
const DEFAULT_SECRET_KEYS = ['APP_PASSWORD'];
const FORBIDDEN_ACCESS_KEYS = ['HF_TOKEN', 'HUGGINGFACE_TOKEN', 'HF_PASSWORD', 'HUGGINGFACE_PASSWORD'];
const STATUS_POLL_ATTEMPTS = 20;
const STATUS_POLL_INTERVAL_MS = 5_000;
const VERIFY_ATTEMPTS = 6;
const VERIFY_INTERVAL_MS = 3_000;

class NonRetryableHfError extends Error {}

function parseArgs(argv) {
    assertKnownOptions(argv, ['--help', '-h', '--no-restart', '--skip-verify', '--use-default-target']);
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        restart: !argv.includes('--no-restart'),
        useDefaultTarget: argv.includes('--use-default-target'),
        verify: !argv.includes('--skip-verify')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run sync-secret:hf-space

Options:
  --no-restart         Sync secrets without restarting the Space.
  --skip-verify        Skip APP_PASSWORD access-code verification.
  --use-default-target Allow the built-in default Space target.
  --help               Show this help.

Environment overrides:
  HF_SPACE_ACCESS_FILE
  HF_SPACE_ID
  HF_SPACE_URL
  HF_SPACE_SECRET_KEYS`);
}

function readRequiredEnv(name, fallback) {
    const value = process.env[name]?.trim() || fallback;
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function readConfigValue(name, secrets, fallback) {
    const value = process.env[name]?.trim() || secrets.get(name)?.trim() || fallback;
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function readSecretKeys(secrets) {
    const rawValue = process.env.HF_SPACE_SECRET_KEYS?.trim() || secrets.get('HF_SPACE_SECRET_KEYS')?.trim();
    if (!rawValue) return DEFAULT_SECRET_KEYS;
    const keys = rawValue
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    if (!keys.length) throw new Error('HF_SPACE_SECRET_KEYS does not contain any keys');
    return keys;
}

function validateSecretValues(secretKeys, secrets) {
    const forbidden = FORBIDDEN_ACCESS_KEYS.filter((key) => secrets.has(key));
    if (forbidden.length) {
        throw new Error(`Access file must not contain Hugging Face credentials: ${forbidden.join(', ')}.`);
    }
    const secretValues = new Map();
    for (const key of secretKeys) {
        const value = secrets.get(key);
        if (!value?.trim()) throw new Error(`${key} is missing or blank in access file`);
        secretValues.set(key, value);
    }
    return secretValues;
}

function redactSensitiveText(text, secretValues = []) {
    let redactedText = text;
    for (const secretValue of secretValues) {
        if (secretValue) redactedText = redactedText.split(secretValue).join('[redacted]');
    }
    return redactedText.replace(/([A-Z0-9_]*(?:PASSWORD|TOKEN|KEY)[A-Z0-9_]*=)[^\s]+/g, '$1[redacted]');
}

function runHf(args, options = {}) {
    const commandLabel = redactSensitiveText(`hf ${args.join(' ')}`, options.secretValues);
    const result = spawnSync('hf', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.error) {
        throw new NonRetryableHfError(`${commandLabel} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        const safeOutput = redactSensitiveText(output || `${commandLabel} failed`, options.secretValues);
        throw new Error(safeOutput);
    }
    return result.stdout || '';
}

function assertHfAuthenticated() {
    try {
        runHf(['auth', 'whoami']);
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Hugging Face CLI is not authenticated. Run "hf auth login" with an access token that can manage the target Space. Cause: ${cause}`);
    }
}

function assertSpaceReadable(spaceId) {
    try {
        runHf(['spaces', 'info', spaceId, '--format', 'json']);
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot read Hugging Face Space "${spaceId}". Check HF_SPACE_ID and the logged-in token permissions. Cause: ${cause}`);
    }
}

async function syncSecret({ spaceId, key, value }) {
    let lastError;
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
        try {
            runHf(['spaces', 'secrets', 'add', spaceId, '-s', `${key}=${value}`], {
                secretValues: [value]
            });
            return;
        } catch (error) {
            if (error instanceof NonRetryableHfError) throw error;
            lastError = error;
            await delay(VERIFY_INTERVAL_MS);
        }
    }
    throw lastError;
}

function restartSpace(spaceId) {
    execFileSync('hf', ['spaces', 'restart', spaceId], {
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function readSpaceInfo(spaceId) {
    const stdout = execFileSync('hf', ['spaces', 'info', spaceId, '--format', 'json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return JSON.parse(stdout);
}

async function readSpaceInfoWithRetry(spaceId) {
    let lastError;
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
        try {
            return readSpaceInfo(spaceId);
        } catch (error) {
            lastError = error;
            await delay(VERIFY_INTERVAL_MS);
        }
    }
    throw lastError;
}

async function waitForRunning(spaceId) {
    let lastStage = 'unknown';
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
        try {
            const info = readSpaceInfo(spaceId);
            lastStage = info.runtime?.stage || 'unknown';
            if (lastStage === 'RUNNING') {
                return { stage: lastStage, sha: info.sha };
            }
        } catch {
            lastStage = 'query_failed';
        }
        await delay(STATUS_POLL_INTERVAL_MS);
    }
    throw new Error(`Space did not reach RUNNING, last stage: ${lastStage}`);
}

async function verifyAppPassword({ spaceUrl, appPassword }) {
    const passwordHash = createHash('sha256').update(appPassword).digest('hex');
    let lastError;
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(new URL('/api/auth-verify', spaceUrl), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passwordHash })
            });
            const body = await readJsonResponseBody(response);
            if (!response.ok || body?.authenticated !== true) {
                throw new Error(`APP_PASSWORD access-code verification failed with HTTP ${response.status}`);
            }
            return { status: response.status, authenticated: body.authenticated };
        } catch (error) {
            lastError = error;
            await delay(VERIFY_INTERVAL_MS);
        }
    }
    throw lastError;
}

export async function readJsonResponseBody(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text.slice(0, 200) };
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const accessFile = readRequiredEnv('HF_SPACE_ACCESS_FILE', DEFAULT_ACCESS_FILE);
    const secrets = parseAccessFile(accessFile);
    const fallbackSpaceId = options.useDefaultTarget ? DEFAULT_SPACE_ID : undefined;
    const fallbackSpaceUrl = options.useDefaultTarget ? DEFAULT_SPACE_URL : undefined;
    const spaceId = readConfigValue('HF_SPACE_ID', secrets, fallbackSpaceId);
    const spaceUrl = readConfigValue('HF_SPACE_URL', secrets, fallbackSpaceUrl);
    assertSpaceTargetConfig({ spaceId, spaceUrl });
    const secretKeys = readSecretKeys(secrets);
    const secretValues = validateSecretValues(secretKeys, secrets);
    const syncedKeys = [];

    assertHfAuthenticated();
    assertSpaceReadable(spaceId);

    for (const key of secretKeys) {
        const value = secretValues.get(key);
        await syncSecret({ spaceId, key, value });
        syncedKeys.push(key);
    }

    let runtime;
    if (options.restart) {
        restartSpace(spaceId);
        runtime = await waitForRunning(spaceId);
    } else {
        runtime = await readSpaceInfoWithRetry(spaceId);
        runtime = { stage: runtime.runtime?.stage || 'unknown', sha: runtime.sha };
    }

    let verification;
    if (options.verify && syncedKeys.includes('APP_PASSWORD')) {
        verification = await verifyAppPassword({
            spaceUrl,
            appPassword: secretValues.get('APP_PASSWORD')
        });
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                spaceId,
                syncedKeys,
                restarted: options.restart,
                runtime,
                verification
            },
            null,
            2
        )
    );
}

if (isMainModule(import.meta.url, process.argv[1])) {
    main().catch((error) => {
        console.error(
            JSON.stringify(
                {
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                },
                null,
                2
            )
        );
        process.exit(1);
    });
}
