import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(new URL('./sync-hf-space-secret.mjs', import.meta.url));
const SCRIPT_URL = new URL('./sync-hf-space-secret.mjs', import.meta.url).href;

function makeTempDir() {
    return mkdtempSync(join(tmpdir(), 'gpt-image-playground-sync-'));
}

function runSync(accessFile, env = {}) {
    return spawnSync(process.execPath, [SCRIPT_PATH, '--no-restart', '--skip-verify'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            HF_SPACE_ACCESS_FILE: accessFile,
            ...env
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

describe('HF Space secret sync preflight', () => {
    it('can be imported without executing the CLI', async () => {
        await assert.doesNotReject(import(`${SCRIPT_URL}?import-smoke=${Date.now()}`));
    });

    it('parses verification responses without reading non-JSON bodies twice', async () => {
        const module = await import(`${SCRIPT_URL}?json-body=${Date.now()}`);
        const body = await module.readJsonResponseBody(new Response('not json', { status: 502 }));

        assert.deepEqual(body, { raw: 'not json' });
    });

    it('prints help without requiring an access file or remote auth', () => {
        const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                HF_SPACE_ACCESS_FILE: join(tmpdir(), 'missing-access-file.txt')
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage:/);
        assert.match(result.stdout, /--use-default-target/);
    });

    it('rejects unknown options before remote operations', () => {
        const result = spawnSync(process.execPath, [SCRIPT_PATH, '--unknown'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unknown option/);
        assert.doesNotMatch(result.stderr, /hf auth login|Cannot read Hugging Face Space/);
    });

    it('rejects non-Hugging Face Space URLs before remote operations', () => {
        const dir = makeTempDir();
        const accessFile = join(dir, 'access.txt');
        writeFileSync(
            accessFile,
            [
                'HF_SPACE_ID=example/demo',
                'HF_SPACE_URL=https://example.com',
                'HF_SPACE_SECRET_KEYS=APP_PASSWORD',
                'APP_PASSWORD=abcdefghijklmnopqrstuvwxyz',
                ''
            ].join('\n'),
            { encoding: 'utf8', mode: 0o600 }
        );

        const result = runSync(accessFile);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /\.hf\.space/);
        assert.doesNotMatch(result.stderr, /hf auth login|Cannot read Hugging Face Space/);

        rmSync(dir, { force: true, recursive: true });
    });

    it('rejects Hugging Face account credentials in the access file before remote operations', () => {
        const dir = makeTempDir();
        const accessFile = join(dir, 'access.txt');
        writeFileSync(
            accessFile,
            [
                'HF_SPACE_ID=example/demo',
                'HF_SPACE_URL=https://example-demo.hf.space',
                'HF_SPACE_SECRET_KEYS=APP_PASSWORD',
                'APP_PASSWORD=abcdefghijklmnopqrstuvwxyz',
                'HF_TOKEN=hf_account_token_should_not_be_synced',
                ''
            ].join('\n'),
            { encoding: 'utf8', mode: 0o600 }
        );

        const result = runSync(accessFile);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /must not contain Hugging Face credentials/);
        assert.doesNotMatch(result.stderr, /hf auth login|Cannot read Hugging Face Space/);

        rmSync(dir, { force: true, recursive: true });
    });

    it('redacts secret values if hf fails while syncing a secret', () => {
        const dir = makeTempDir();
        const accessFile = join(dir, 'access.txt');
        const hfPath = join(dir, 'hf');
        const secretValue = 'super-secret-access-code';
        writeFileSync(
            accessFile,
            [
                'HF_SPACE_ID=example/demo',
                'HF_SPACE_URL=https://example-demo.hf.space',
                'HF_SPACE_SECRET_KEYS=APP_PASSWORD',
                `APP_PASSWORD=${secretValue}`,
                ''
            ].join('\n'),
            { encoding: 'utf8', mode: 0o600 }
        );
        writeFileSync(
            hfPath,
            [
                '#!/bin/sh',
                'if [ "$1 $2" = "auth whoami" ]; then exit 0; fi',
                'if [ "$1 $2" = "spaces info" ]; then /bin/chmod 000 "$0"; echo "{}"; exit 0; fi',
                'exit 1',
                ''
            ].join('\n'),
            { encoding: 'utf8', mode: 0o755 }
        );

        const result = runSync(accessFile, { PATH: dir });

        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stderr, new RegExp(secretValue));
        assert.match(result.stderr, /APP_PASSWORD=\[redacted\]/);

        rmSync(dir, { force: true, recursive: true });
    });
});
