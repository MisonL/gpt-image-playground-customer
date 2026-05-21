import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ACCESS_FILE = join(process.env.HOME || '', '.cache/gpt-image-playground-customer/hf-space-access.txt');

export function readEnvValue(name) {
    return process.env[name]?.trim() || undefined;
}

export function readOptionValue(argv, name) {
    const prefix = `${name}=`;
    const inlineValue = argv.find((arg) => arg.startsWith(prefix));
    if (inlineValue !== undefined) {
        const value = inlineValue.slice(prefix.length).trim();
        if (!value) throw new Error(`${name} requires a value`);
        return value;
    }

    const index = argv.indexOf(name);
    if (index === -1) return undefined;
    const value = argv[index + 1]?.trim();
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
}

export function assertKnownOptions(argv, knownOptions) {
    const known = new Set(knownOptions);
    for (const arg of argv) {
        if (!arg.startsWith('-')) continue;
        const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
        if (!known.has(name)) throw new Error(`Unknown option: ${name}`);
    }
}

export function runCommand(command, args = []) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.error) return { ok: false, error: result.error.message };
    if (result.status !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        return { ok: false, error: output || `${command} ${args.join(' ')} failed` };
    }
    return { ok: true, stdout: result.stdout.trim() };
}

export function parseAccessFile(accessFile) {
    const values = new Map();
    const text = readFileSync(accessFile, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith('#')) continue;
        const separatorIndex = rawLine.indexOf('=');
        if (separatorIndex <= 0) continue;
        const key = rawLine.slice(0, separatorIndex).trim();
        const value = rawLine.slice(separatorIndex + 1);
        if (key) values.set(key, value);
    }
    return values;
}

export function getJsonNames(text) {
    const parsed = JSON.parse(extractJsonPayload(text));
    const names = new Set();
    const visit = (value) => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (!value || typeof value !== 'object') return;
        for (const key of ['name', 'key', 'id']) {
            if (typeof value[key] === 'string') names.add(value[key]);
        }
    };
    visit(parsed);
    return names;
}

function extractJsonPayload(text) {
    const trimmedText = text.trim();
    if (!trimmedText) return '[]';

    const lines = trimmedText.split(/\r?\n/);
    const jsonLineIndex = lines.findIndex((line) => {
        const trimmedLine = line.trimStart();
        return trimmedLine.startsWith('{') || trimmedLine.startsWith('[');
    });
    if (jsonLineIndex === -1) return trimmedText;
    return lines.slice(jsonLineIndex).join('\n');
}

export function missingKeys(keys, values) {
    return keys.filter((key) => !values.has(key) || !String(values.get(key)).trim());
}

export function classifyRequiredAndRecommendedNames(names, requiredNames, recommendedNames = []) {
    return {
        missingRequired: requiredNames.filter((key) => !names.has(key)),
        missingRecommended: recommendedNames.filter((key) => !names.has(key))
    };
}

const NEXT_ACTIONS = new Map([
    ['node', 'Install Node.js 20 or newer, then reopen the terminal.'],
    ['npm', 'Install Node.js 20 or newer with npm.'],
    ['hf-cli', 'Install the Hugging Face CLI from the official documentation; avoid piping remote install scripts directly to a shell.'],
    ['hf-auth', 'Check network/proxy access to Hugging Face, then run hf auth login if the token is missing or expired.'],
    ['node-modules', 'Run npm install.'],
    [
        'access-file-keys',
        'Regenerate or update the access file with npm run init-access:hf-space -- --space-id <namespace>/<space-name> --space-url https://<user>-<space>.hf.space'
    ],
    [
        'generated-secrets',
        'Regenerate weak or blank project secrets with npm run init-access:hf-space -- --space-id <namespace>/<space-name> --space-url https://<user>-<space>.hf.space --force'
    ],
    ['remote-variables', 'Configure the required and recommended Space Variables in Hugging Face Settings before syncing secrets.'],
    ['remote-secrets', 'Run npm run sync-secret:hf-space after hf auth login succeeds.'],
    ['remote-generation-secret', 'Configure OPENAI_API_KEY or OPENAI_CHANNEL_1_API_KEYS in Space Secrets before real image generation.']
]);

export function buildNextActions(checks) {
    const actions = new Set();
    for (const check of checks) {
        if (check.status === 'pass' || check.status === 'skip') continue;
        if (check.action) actions.add(check.action);
        const mappedAction = NEXT_ACTIONS.get(check.name);
        if (mappedAction) actions.add(mappedAction);
    }
    return [...actions];
}

export function validateSpaceId(spaceId) {
    if (!spaceId?.trim()) return 'HF Space id is required.';
    if (!/^[^/\s]+\/[^/\s]+$/.test(spaceId)) return 'HF Space id must use namespace/space format.';
    return undefined;
}

export function validateSpaceUrl(spaceUrl) {
    if (!spaceUrl?.trim()) return 'HF Space URL is required.';
    let parsedUrl;
    try {
        parsedUrl = new URL(spaceUrl);
    } catch {
        return 'HF Space URL is not a valid URL.';
    }
    if (parsedUrl.protocol !== 'https:') return 'HF Space URL must use https.';
    if (!parsedUrl.hostname.endsWith('.hf.space')) return 'HF Space URL must be a Hugging Face .hf.space URL.';
    if (parsedUrl.username || parsedUrl.password || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
        return 'HF Space URL must be a plain Space origin without credentials, path, query, or fragment.';
    }
    return undefined;
}

export function assertSpaceTargetConfig({ spaceId, spaceUrl }) {
    const spaceIdError = validateSpaceId(spaceId);
    if (spaceIdError) throw new Error(spaceIdError);
    const spaceUrlError = validateSpaceUrl(spaceUrl);
    if (spaceUrlError) throw new Error(spaceUrlError);
}

export function isMainModule(moduleUrl, argvPath) {
    return Boolean(argvPath) && moduleUrl === pathToFileURL(resolve(argvPath)).href;
}
