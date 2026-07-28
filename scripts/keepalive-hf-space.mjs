#!/usr/bin/env node

import { readPositiveIntegerEnv } from './env-utils.mjs';
import { validateSpaceUrl } from './hf-space-doctor-utils.mjs';

const DEFAULT_SPACE_URL = 'https://misonl-visual-journal.hf.space';
const KEEPALIVE_USER_AGENT = 'visual-journal-keepalive/1.0';
const DEFAULT_KEEPALIVE_PATH = '/api/auth-status';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;

function normalizeUrl(rawUrl, path) {
    const urlError = validateSpaceUrl(rawUrl);
    if (urlError) {
        throw new Error(urlError.replace('HF Space URL', 'HF_SPACE_KEEPALIVE_URL'));
    }
    const baseUrl = new URL(rawUrl);
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return new URL(normalizedPath, baseUrl).toString();
}

function readExpectedPasswordRequired() {
    const rawValue = process.env.HF_SPACE_KEEPALIVE_EXPECT_PASSWORD_REQUIRED?.trim();
    if (!rawValue) return undefined;
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;
    throw new Error('HF_SPACE_KEEPALIVE_EXPECT_PASSWORD_REQUIRED must be true or false');
}

function readResponseContentType(response) {
    return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || 'unknown';
}

async function readJsonResponse(response) {
    const contentType = readResponseContentType(response);
    const text = await response.text();
    if (!text) return { body: undefined, contentType, bodyType: 'empty' };
    try {
        return { body: JSON.parse(text), contentType, bodyType: 'json' };
    } catch {
        return { body: undefined, contentType, bodyType: 'non-json' };
    }
}

function readKeepaliveConfig() {
    const spaceUrl = process.env.HF_SPACE_KEEPALIVE_URL?.trim() || DEFAULT_SPACE_URL;
    const path = process.env.HF_SPACE_KEEPALIVE_PATH?.trim() || DEFAULT_KEEPALIVE_PATH;
    const timeoutMs = readPositiveIntegerEnv('HF_SPACE_KEEPALIVE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1_000);
    const maxAttempts = readPositiveIntegerEnv('HF_SPACE_KEEPALIVE_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS);
    const retryDelayMs = readPositiveIntegerEnv('HF_SPACE_KEEPALIVE_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS);
    const retryMaxDelayMs = readPositiveIntegerEnv(
        'HF_SPACE_KEEPALIVE_RETRY_MAX_DELAY_MS',
        Math.max(DEFAULT_RETRY_MAX_DELAY_MS, retryDelayMs),
        retryDelayMs
    );
    const expectedPasswordRequired = readExpectedPasswordRequired();
    const url = normalizeUrl(spaceUrl, path);

    return { url, timeoutMs, maxAttempts, retryDelayMs, retryMaxDelayMs, expectedPasswordRequired };
}

function formatKeepaliveError(error, timeoutMs) {
    if (error?.name === 'AbortError') {
        return `Keepalive request timed out after ${timeoutMs}ms`;
    }
    return error instanceof Error ? error.message : String(error);
}

async function waitBeforeRetry(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(config, completedAttempts) {
    const multiplier = 2 ** Math.min(completedAttempts - 1, 30);
    return Math.min(config.retryDelayMs * multiplier, config.retryMaxDelayMs);
}

async function pingKeepaliveEndpointOnce(config, attemptLabel) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(config.url, {
            headers: {
                'User-Agent': KEEPALIVE_USER_AGENT
            },
            signal: controller.signal
        });
        const elapsedMs = Date.now() - startedAt;
        const result = await readJsonResponse(response);

        if (!response.ok) {
            throw new Error(
                `Keepalive endpoint failed with HTTP ${response.status} (${result.contentType}; ${result.bodyType} body)`
            );
        }
        if (result.bodyType === 'non-json') {
            throw new Error(`Keepalive endpoint returned non-JSON body (${result.contentType})`);
        }
        if (
            config.expectedPasswordRequired !== undefined &&
            result.body?.passwordRequired !== config.expectedPasswordRequired
        ) {
            throw new Error(
                `passwordRequired expected ${config.expectedPasswordRequired}, got ${result.body?.passwordRequired}`
            );
        }

        console.log(
            JSON.stringify(
                {
                    ok: true,
                    url: config.url,
                    status: response.status,
                    elapsedMs,
                    contentType: result.contentType,
                    passwordRequired: result.body?.passwordRequired,
                    attempt: attemptLabel
                },
                null,
                2
            )
        );
    } finally {
        clearTimeout(timeout);
    }
}

async function pingKeepaliveEndpoint() {
    const config = readKeepaliveConfig();
    let lastError;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        try {
            const attemptLabel = `${attempt}/${config.maxAttempts}`;
            await pingKeepaliveEndpointOnce(config, attemptLabel);
            return;
        } catch (error) {
            lastError = error;
            const nextRetryDelayMs =
                attempt < config.maxAttempts ? getRetryDelayMs(config, attempt) : undefined;
            console.error(
                JSON.stringify(
                    {
                        ok: false,
                        attempt: `${attempt}/${config.maxAttempts}`,
                        error: formatKeepaliveError(error, config.timeoutMs),
                        ...(nextRetryDelayMs === undefined ? {} : { nextRetryDelayMs })
                    },
                    null,
                    2
                )
            );
            if (nextRetryDelayMs !== undefined) {
                await waitBeforeRetry(nextRetryDelayMs);
            }
        }
    }

    throw new Error(`Keepalive attempt already reported: ${formatKeepaliveError(lastError, config.timeoutMs)}`);
}

pingKeepaliveEndpoint().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('Keepalive attempt already reported: ')) {
        console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    }
    process.exit(1);
});
