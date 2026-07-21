#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const STRICT_ALLOW_SCRIPTS_CONFIG_KEY = 'strict-allow-scripts';
export const NPM_INSTALL_POLICY_CHECK_COMMAND = 'npm run npm-install-policy:check';
const NPM_HELP_TIMEOUT_MS = 10_000;

function npmCommand(platform = process.platform) {
    return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpmHelp(platform) {
    return spawnSync(npmCommand(platform), ['ci', '--help'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: NPM_HELP_TIMEOUT_MS
    });
}

export function inspectNpmInstallPolicy(options = {}) {
    const command = options.runNpmHelp || runNpmHelp;
    const result = command(options.platform);
    if (result?.error) {
        return {
            ok: false,
            reason: 'npm_config_check_failed',
            error: result.error.message
        };
    }
    if (result?.status !== 0) {
        return {
            ok: false,
            reason: 'npm_config_check_failed',
            ...(typeof result?.stderr === 'string' && result.stderr.trim() ? { error: result.stderr.trim() } : {})
        };
    }

    const output = [result.stdout, result.stderr].filter((value) => typeof value === 'string').join('\n');
    if (output.includes(`--${STRICT_ALLOW_SCRIPTS_CONFIG_KEY}`)) {
        return { ok: true };
    }
    return {
        ok: false,
        reason: 'npm_strict_allow_scripts_unsupported'
    };
}

function main() {
    const result = inspectNpmInstallPolicy();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
