import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseDockerEnvOutput, parseEnvContent, summarizeEnvEntries, summarizeEnvFile } from './env-summary.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./env-summary.mjs', import.meta.url));

describe('env-summary', () => {
    it('summarizes env files without exposing secret values', () => {
        const entries = parseEnvContent(
            [
                'OPENAI_API_KEY=sk-real-looking-secret-value',
                'OPENAI_CHANNEL_1_API_KEYS=key-one,key-two',
                'OPENAI_API_BASE_URL=https://api.example.com/v1',
                'OPENAI_UPSTREAM_PROXY_URL=http://proxy.internal.example:8080',
                'REDIS_HOST=localhost:6379',
                'PUBLIC_NAME=value # deployment note',
                'ENABLE_STREAMING_BATCH=true',
                'EMPTY_VALUE='
            ].join('\n')
        );

        const summary = summarizeEnvEntries(entries);
        const serialized = JSON.stringify(summary);

        assert.equal(serialized.includes('sk-real-looking-secret-value'), false);
        assert.equal(serialized.includes('key-one'), false);
        assert.equal(serialized.includes('key-two'), false);
        assert.equal(serialized.includes('proxy.internal.example'), false);
        assert.equal(serialized.includes('8080'), false);
        assert.equal(serialized.includes('deployment note'), false);
        assert.deepEqual(summary.find((item) => item.name === 'OPENAI_API_KEY'), {
            name: 'OPENAI_API_KEY',
            set: true,
            sensitive: true,
            value_kind: 'non_empty',
            item_count: 1
        });
        assert.equal(summary.find((item) => item.name === 'OPENAI_CHANNEL_1_API_KEYS')?.item_count, 2);
        assert.deepEqual(summary.find((item) => item.name === 'OPENAI_UPSTREAM_PROXY_URL'), {
            name: 'OPENAI_UPSTREAM_PROXY_URL',
            set: true,
            sensitive: true,
            value_kind: 'url',
            item_count: 1
        });
        assert.deepEqual(summary.find((item) => item.name === 'OPENAI_API_BASE_URL')?.url, {
            valid: true,
            protocol: 'https',
            host: 'api.example.com',
            has_path: true,
            has_query: false,
            has_fragment: false,
            has_credentials: false,
            kind: 'url'
        });
        assert.deepEqual(summary.find((item) => item.name === 'REDIS_HOST')?.url, {
            valid: true,
            protocol: null,
            host: 'localhost:6379',
            has_path: false,
            has_query: false,
            has_fragment: false,
            has_credentials: false,
            kind: 'host'
        });
        assert.equal(summary.find((item) => item.name === 'PUBLIC_NAME')?.value_kind, 'non_empty');
    });

    it('summarizes files and missing files with stable JSON fields', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gpt-image-env-summary-'));
        const envFile = join(dir, '.env.local');
        writeFileSync(envFile, 'APP_PASSWORD=super-secret-access-code\nPORT=4783\n');

        try {
            const present = summarizeEnvFile(envFile);
            const missing = summarizeEnvFile(join(dir, '.env.missing'));

            assert.equal(present.exists, true);
            assert.equal(present.variable_count, 2);
            assert.equal(JSON.stringify(present).includes('super-secret-access-code'), false);
            assert.equal(missing.exists, false);
            assert.deepEqual(missing.variables, []);
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('parses docker env arrays without leaking values', () => {
        const entries = parseDockerEnvOutput(JSON.stringify(['OPENAI_API_KEY=sk-docker-secret', 'OPENAI_API_BASE_URL=https://upstream.example/v1']));
        const summary = summarizeEnvEntries(entries);
        const serialized = JSON.stringify(summary);

        assert.equal(serialized.includes('sk-docker-secret'), false);
        assert.equal(summary.find((item) => item.name === 'OPENAI_API_KEY')?.sensitive, true);
        assert.equal(summary.find((item) => item.name === 'OPENAI_API_BASE_URL')?.url.host, 'upstream.example');
    });

    it('CLI output is redacted for env files', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gpt-image-env-summary-cli-'));
        const envFile = join(dir, '.env.local');
        writeFileSync(envFile, 'GPT_IMAGE_AGENT_TOKEN=agent-token-value\nOPENAI_API_BASE_URL=https://api.example.com/v1\n');

        try {
            const result = spawnSync(process.execPath, [SCRIPT_PATH, '--file', envFile], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout.includes('agent-token-value'), false);
            const body = JSON.parse(result.stdout);
            assert.equal(body.ok, true);
            assert.equal(body.redacted, true);
            assert.equal(body.sources[0].variables.some((item) => item.name === 'GPT_IMAGE_AGENT_TOKEN'), true);
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('skips missing optional files from CLI sources', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gpt-image-env-summary-optional-'));
        const envFile = join(dir, '.env.local');
        writeFileSync(envFile, 'OPENAI_API_BASE_URL=https://api.example.com/v1\n');

        try {
            const result = spawnSync(process.execPath, [SCRIPT_PATH, '--file-if-exists', join(dir, '.env.missing'), '--file-if-exists', envFile], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
            assert.equal(result.status, 0, result.stderr);
            const body = JSON.parse(result.stdout);
            assert.equal(body.ok, true);
            assert.equal(body.sources.length, 1);
            assert.equal(body.sources[0].path, envFile);
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('does not expose docker inspect stdout or stderr on failure', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gpt-image-env-summary-docker-'));
        const dockerBin = join(dir, process.platform === 'win32' ? 'docker.cmd' : 'docker');
        writeFileSync(
            dockerBin,
            buildDockerMockScript([
                'OPENAI_API_KEY=sk-stdout-secret',
                'AGENT_API_TOKEN=stderr-secret'
            ])
        );
        chmodSync(dockerBin, 0o700);

        try {
            const result = spawnSync(process.execPath, [SCRIPT_PATH, '--container', 'demo'], {
                encoding: 'utf8',
                env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH || ''}` },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            assert.equal(result.status, 1);
            assert.equal(result.stdout.includes('sk-stdout-secret'), false);
            assert.equal(result.stdout.includes('stderr-secret'), false);
            const body = JSON.parse(result.stdout);
            assert.equal(body.ok, false);
            assert.equal(body.redacted, true);
            assert.deepEqual(body.sources[0].error, {
                message: 'docker inspect failed',
                status: 7
            });
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });
});

function buildDockerMockScript([stdoutLine, stderrLine]) {
    const nodePath = JSON.stringify(process.execPath);
    const scriptBody = [
        `console.log(${JSON.stringify(stdoutLine)});`,
        `console.error(${JSON.stringify(stderrLine)});`,
        'process.exit(7);'
    ].join('');
    if (process.platform === 'win32') {
        return `@echo off\r\n${nodePath} -e ${JSON.stringify(scriptBody)}\r\nexit /b %ERRORLEVEL%\r\n`;
    }
    return `#!/usr/bin/env node\n${scriptBody}\n`;
}
