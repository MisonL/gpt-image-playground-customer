#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_SPACE_ID = 'misonL/gpt-image-playground-customer';
const DEFAULT_SPACE_URL = 'https://misonl-gpt-image-playground-customer.hf.space';
const DEFAULT_ACCESS_FILE = join(process.env.HOME || '', '.cache/gpt-image-playground-customer/hf-space-access.txt');
const DEFAULT_SECRET_KEYS = ['APP_PASSWORD'];
const STATUS_POLL_ATTEMPTS = 20;
const STATUS_POLL_INTERVAL_MS = 5_000;
const VERIFY_ATTEMPTS = 6;
const VERIFY_INTERVAL_MS = 3_000;

function parseArgs(argv) {
    return {
        restart: !argv.includes('--no-restart'),
        verify: !argv.includes('--skip-verify')
    };
}

function readRequiredEnv(name, fallback) {
    const value = process.env[name]?.trim() || fallback;
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function readSecretKeys() {
    const rawValue = process.env.HF_SPACE_SECRET_KEYS?.trim();
    if (!rawValue) return DEFAULT_SECRET_KEYS;
    const keys = rawValue
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    if (!keys.length) throw new Error('HF_SPACE_SECRET_KEYS does not contain any keys');
    return keys;
}

function readAccessFileSecrets(accessFile) {
    const secrets = new Map();
    const text = readFileSync(accessFile, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith('#')) continue;
        const separatorIndex = rawLine.indexOf('=');
        if (separatorIndex <= 0) continue;
        const key = rawLine.slice(0, separatorIndex).trim();
        const value = rawLine.slice(separatorIndex + 1);
        if (key) secrets.set(key, value);
    }
    return secrets;
}

function redactSensitiveText(text, secretValues = []) {
    let redactedText = text;
    for (const secretValue of secretValues) {
        if (secretValue) redactedText = redactedText.split(secretValue).join('[redacted]');
    }
    return redactedText.replace(/([A-Z0-9_]*(?:PASSWORD|TOKEN|KEY)[A-Z0-9_]*=)[^\s]+/g, '$1[redacted]');
}

function runHf(args, options = {}) {
    const result = spawnSync('hf', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        const safeOutput = redactSensitiveText(output || `hf ${args.join(' ')} failed`, options.secretValues);
        throw new Error(safeOutput);
    }
    return result.stdout || '';
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
            const body = await response.json().catch(async () => ({ raw: await response.text() }));
            if (!response.ok || body?.authenticated !== true) {
                throw new Error(`APP_PASSWORD verification failed with HTTP ${response.status}`);
            }
            return { status: response.status, authenticated: body.authenticated };
        } catch (error) {
            lastError = error;
            await delay(VERIFY_INTERVAL_MS);
        }
    }
    throw lastError;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const spaceId = readRequiredEnv('HF_SPACE_ID', DEFAULT_SPACE_ID);
    const spaceUrl = readRequiredEnv('HF_SPACE_URL', DEFAULT_SPACE_URL);
    const accessFile = readRequiredEnv('HF_SPACE_ACCESS_FILE', DEFAULT_ACCESS_FILE);
    const secretKeys = readSecretKeys();
    const secrets = readAccessFileSecrets(accessFile);
    const syncedKeys = [];

    for (const key of secretKeys) {
        const value = secrets.get(key);
        if (!value?.trim()) throw new Error(`${key} is missing or blank in access file`);
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
            appPassword: secrets.get('APP_PASSWORD')
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
