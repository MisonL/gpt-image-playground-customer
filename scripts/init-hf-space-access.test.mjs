import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(new URL('./init-hf-space-access.mjs', import.meta.url));
const SCRIPT_URL = new URL('./init-hf-space-access.mjs', import.meta.url).href;

function runInit(args) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function makeTempDir() {
    return mkdtempSync(join(tmpdir(), 'gpt-image-playground-access-'));
}

describe('HF Space access initializer', () => {
    it('can be imported without executing the CLI', async () => {
        await assert.doesNotReject(import(`${SCRIPT_URL}?import-smoke=${Date.now()}`));
    });

    it('rejects unknown options before writing an access file', () => {
        const dir = makeTempDir();
        const accessFile = join(dir, 'access.txt');
        const result = runInit([
            '--space-id',
            'example/demo',
            '--space-url',
            'https://example-demo.hf.space',
            '--unknown',
            '--access-file',
            accessFile
        ]);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unknown option/);
        assert.equal(existsSync(accessFile), false);
        rmSync(dir, { force: true, recursive: true });
    });

    it('rejects invalid Space ids before writing an access file', () => {
        const dir = makeTempDir();
        const accessFile = join(dir, 'access.txt');
        const result = runInit([
            '--space-id',
            'bad',
            '--space-url',
            'https://example-demo.hf.space',
            '--access-file',
            accessFile
        ]);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /namespace\/space/);
        assert.equal(existsSync(accessFile), false);
        rmSync(dir, { force: true, recursive: true });
    });

    it('rejects non-Hugging Face Space URLs before writing an access file', () => {
        const dir = makeTempDir();
        const accessFile = join(dir, 'access.txt');
        const result = runInit([
            '--space-id',
            'example/demo',
            '--space-url',
            'https://example.com',
            '--access-file',
            accessFile
        ]);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /\.hf\.space/);
        assert.equal(existsSync(accessFile), false);
        rmSync(dir, { force: true, recursive: true });
    });

    it('writes an access file without leaking generated secrets to stdout', () => {
        const dir = makeTempDir();
        const accessFile = join(dir, 'access.txt');
        const result = runInit([
            '--space-id',
            'example/demo',
            '--space-url',
            'https://example-demo.hf.space',
            '--access-file',
            accessFile
        ]);

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /APP_PASSWORD=|AGENT_API_TOKEN=/);

        const content = readFileSync(accessFile, 'utf8');
        assert.match(content, /^HF_SPACE_ID=example\/demo$/m);
        assert.match(content, /^HF_SPACE_URL=https:\/\/example-demo\.hf\.space$/m);
        assert.match(content, /^HF_SPACE_SECRET_KEYS=APP_PASSWORD,AGENT_API_TOKEN$/m);
        if (process.platform !== 'win32') {
            assert.equal(statSync(accessFile).mode & 0o777, 0o600);
        }

        rmSync(dir, { force: true, recursive: true });
    });
});
