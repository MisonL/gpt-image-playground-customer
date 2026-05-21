import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HF_SPACE_ID = 'misonL/gpt-image-playground-customer';
export const HF_SPACE_URL = 'https://misonl-gpt-image-playground-customer.hf.space';
const DOCTOR_COMMAND_TIMEOUT_MS = 30_000;

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

export function runDoctorCommand(command, args = [], options = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeoutMs || DOCTOR_COMMAND_TIMEOUT_MS
    });
    if (result.error) {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        return { ok: false, error: output ? `${result.error.message}\n${output}` : result.error.message };
    }
    if (result.status !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        return { ok: false, error: output || `${command} ${args.join(' ')} failed` };
    }
    return { ok: true, stdout: result.stdout.trim() };
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

export function getJsonKeyValues(text) {
    const parsed = JSON.parse(extractJsonPayload(text));
    const values = new Map();
    const visit = (value) => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (!value || typeof value !== 'object') return;
        if (typeof value.key === 'string' && typeof value.value === 'string') {
            values.set(value.key, value.value);
        }
    };
    visit(parsed);
    return values;
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
    ['remote-variables', 'Configure the required and recommended Space Variables with hf spaces variables add.'],
    ['remote-variable-values', 'Set required Space Variable values with hf spaces variables add.'],
    ['remote-secrets', 'Configure required Space Secrets with hf spaces secrets add.'],
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
    const text = spaceId?.trim();
    if (!text) return 'HF Space id is required.';
    const parts = text.split('/');
    if (parts.length < 1 || parts.length > 2 || parts.some((part) => part.length === 0)) {
        return 'HF Space id must use space_name or namespace/space_name format with 1-96 characters per part.';
    }
    for (const part of parts) {
        if (part.length > 96 || !/^[A-Za-z0-9._-]+$/.test(part)) {
            return 'HF Space id must use space_name or namespace/space_name format with 1-96 characters per part.';
        }
        if (part.startsWith('.') || part.includes('..') || part.includes('--') || part.endsWith('.git')) {
            return 'HF Space id parts cannot start with ".", contain ".." or "--", or end with ".git".';
        }
    }
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
