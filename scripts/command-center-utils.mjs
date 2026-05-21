import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 5000;

export function isMainModule(moduleUrl, argvPath) {
    return Boolean(argvPath) && moduleUrl === pathToFileURL(resolve(argvPath)).href;
}

export function runCommand(command, args = [], options = {}) {
    const startedAt = Date.now();
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: options.encoding || 'utf8',
        env: options.env,
        input: options.input,
        maxBuffer: options.maxBuffer || DEFAULT_MAX_BUFFER,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeoutMs
    });
    const elapsedMs = Date.now() - startedAt;
    if (result.error) {
        return {
            ok: false,
            command,
            args,
            status: result.status,
            stdout: String(result.stdout || ''),
            stderr: String(result.stderr || ''),
            elapsed_ms: elapsedMs,
            error: result.error.message,
            signal: result.signal
        };
    }
    return {
        ok: result.status === 0,
        command,
        args,
        status: result.status,
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
        elapsed_ms: elapsedMs,
        signal: result.signal
    };
}

export function runCommandStrict(command, args = [], options = {}) {
    const result = runCommand(command, args, options);
    if (!result.ok) throw new Error(commandFailureMessage(result));
    return result.stdout;
}

export function commandFailureMessage(result) {
    return pickFailureOutput(result) || `${result.command} ${result.args.join(' ')} failed`;
}

export function printJson(payload) {
    console.log(JSON.stringify(payload, null, 2));
}

export function parseJsonPayload(output, label = 'command') {
    const lines = output.split(/\r?\n/);
    let lastError;
    let sawCandidate = false;
    for (let start = 0; start < lines.length; start += 1) {
        const trimmed = lines[start].trimStart();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
        sawCandidate = true;
        for (let end = lines.length; end > start; end -= 1) {
            try {
                return JSON.parse(lines.slice(start, end).join('\n'));
            } catch (error) {
                lastError = error;
            }
        }
    }
    if (!sawCandidate) throw new Error(`${label} did not return JSON output.`);
    throw new Error(`${label} returned invalid JSON: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function fetchJsonWithTimeout(url, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS;
    const pathname = safeUrlPathname(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        const bodySnippet = formatResponseBodySnippet(text);
        if (!response.ok) throw new Error(`${pathname} failed with HTTP ${response.status}${bodySnippet}`);
        try {
            return JSON.parse(text);
        } catch (error) {
            if (error instanceof SyntaxError) throw new Error(`${pathname} did not return JSON${bodySnippet}`);
            throw error;
        }
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error(`${pathname} timed out after ${timeoutMs}ms.`);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function formatResponseBodySnippet(text) {
    if (!text || process.env.NODE_ENV === 'production') return '';
    return `: ${text.slice(0, 100)}`;
}

function safeUrlPathname(url) {
    try {
        return new URL(url).pathname;
    } catch {
        return String(url);
    }
}

export function pickFailureOutput(result, maxLength = 4000) {
    const output = [
        result.stdout,
        result.stderr,
        result.status !== undefined && result.status !== null ? `status: ${result.status}` : '',
        result.error ? `error: ${result.error}` : '',
        result.signal ? `signal: ${result.signal}` : ''
    ]
        .filter(Boolean)
        .join('\n')
        .trim();
    return output.length > maxLength ? `${output.slice(0, maxLength)}...` : output;
}
