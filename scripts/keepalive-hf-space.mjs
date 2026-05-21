#!/usr/bin/env node

import { validateSpaceUrl } from './hf-space-doctor-utils.mjs';

const DEFAULT_SPACE_URL = 'https://misonl-gpt-image-playground-customer.hf.space';
const DEFAULT_KEEPALIVE_PATH = '/api/auth-status';
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;

function readPositiveIntegerEnv(name, fallback) {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;
    if (!/^\d+$/.test(rawValue)) {
        throw new Error(`${name} must be an integer greater than or equal to ${MIN_TIMEOUT_MS}`);
    }
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS) {
        throw new Error(`${name} must be an integer greater than or equal to ${MIN_TIMEOUT_MS}`);
    }
    return value;
}

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

async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Keepalive endpoint returned non-JSON body: ${text.slice(0, 200)}`);
    }
}

async function pingKeepaliveEndpoint() {
    const spaceUrl = process.env.HF_SPACE_KEEPALIVE_URL?.trim() || DEFAULT_SPACE_URL;
    const path = process.env.HF_SPACE_KEEPALIVE_PATH?.trim() || DEFAULT_KEEPALIVE_PATH;
    const timeoutMs = readPositiveIntegerEnv('HF_SPACE_KEEPALIVE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
    const expectedPasswordRequired = readExpectedPasswordRequired();
    const url = normalizeUrl(spaceUrl, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'gpt-image-playground-keepalive/1.0'
            },
            signal: controller.signal
        });
        const elapsedMs = Date.now() - startedAt;
        const body = await readJsonResponse(response);

        if (!response.ok) {
            throw new Error(`Keepalive endpoint failed with HTTP ${response.status}`);
        }
        if (expectedPasswordRequired !== undefined && body?.passwordRequired !== expectedPasswordRequired) {
            throw new Error(`passwordRequired expected ${expectedPasswordRequired}, got ${body?.passwordRequired}`);
        }

        console.log(
            JSON.stringify(
                {
                    ok: true,
                    url,
                    status: response.status,
                    elapsedMs,
                    passwordRequired: body?.passwordRequired
                },
                null,
                2
            )
        );
    } finally {
        clearTimeout(timeout);
    }
}

pingKeepaliveEndpoint().catch((error) => {
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
