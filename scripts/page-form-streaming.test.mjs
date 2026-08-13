import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skillScriptsRoot = join(repoRoot, 'skills/visual-journal-image-agent/scripts');

describe('Page form streaming defaults', () => {
    it('does not force stream=true for page generate JSON responses', async () => {
        let requestBody = '';
        await withServer(
            async (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    writePageCapabilities(response);
                    return;
                }
                if (request.url === '/api/images') {
                    requestBody = await readRequestText(request);
                    writePageImageResult(response, 'generate.webp', 'generate-page-json-key');
                    return;
                }
                writeMissing(response);
            },
            async (baseUrl) => {
                const result = await runSkillScript(
                    'generate-image.mjs',
                    [
                        '--allow-billable',
                        '--page-sse',
                        '--format',
                        'webp',
                        '--idempotency-key',
                        'generate-page-json-key',
                        'generate prompt'
                    ],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                const body = JSON.parse(result.stdout);
                assert.equal(body.images[0].filename, 'generate.webp');
                assert.equal(body.images[0].absolute_path, `${baseUrl}/api/image/generate.webp`);
                assert.doesNotMatch(requestBody, /name="stream"/);
            }
        );
    });

    it('does not force stream=true for default page edit JSON responses', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-page-form-edit-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            let requestBody = '';

            await withServer(
                async (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        writePageCapabilities(response);
                        return;
                    }
                    if (request.url === '/api/images') {
                        requestBody = await readRequestText(request);
                        writePageImageResult(response, 'edit.webp', 'edit-page-json-key');
                        return;
                    }
                    writeMissing(response);
                },
                async (baseUrl) => {
                    const result = await runSkillScript(
                        'edit-image.mjs',
                        [
                            '--allow-billable',
                            '--idempotency-key',
                            'edit-page-json-key',
                            imagePath,
                            'edit prompt'
                        ],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.images[0].filename, 'edit.webp');
                    assert.equal(body.images[0].absolute_path, `${baseUrl}/api/image/edit.webp`);
                    assert.doesNotMatch(requestBody, /name="stream"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('does not force stream=true for batch page edit JSON responses', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-page-form-batch-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'batch-page-json',
                    mode: 'edit',
                    prompt: 'batch edit prompt',
                    image_path: imagePath,
                    size: '1024x1024',
                    idempotency_key: 'batch-page-json-key'
                })
            );
            let requestBody = '';

            await withServer(
                async (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        writePageCapabilities(response);
                        return;
                    }
                    if (request.url === '/api/images') {
                        requestBody = await readRequestText(request);
                        writePageImageResult(response, 'batch.webp', 'batch-page-json-key');
                        return;
                    }
                    writeMissing(response);
                },
                async (baseUrl) => {
                    const result = await runSkillScript(
                        'batch-images.mjs',
                        ['--allow-billable', '--input', inputPath],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.results[0].status, 'succeeded');
                    assert.equal(body.results[0].response.images[0].filename, 'batch.webp');
                    assert.equal(
                        body.results[0].response.images[0].absolute_path,
                        `${baseUrl}/api/image/batch.webp`
                    );
                    assert.doesNotMatch(requestBody, /name="stream"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });
});

function writePageCapabilities(response) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
        JSON.stringify({
            agent_streaming: {
                page_sse: {
                    supported: true,
                    endpoint: '/api/images',
                    auth: { required: false, schemes: [], form_field: 'passwordHash' }
                }
            },
            agent_jobs: { supported: true, mode: 'job_polling' }
        })
    );
}

function writePageImageResult(response, filename, clientRequestId) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
        JSON.stringify({
            images: [
                {
                    filename,
                    path: `/api/image/${filename}`,
                    output_format: 'webp',
                    clientRequestId
                }
            ],
            clientRequestId
        })
    );
}

function writeMissing(response) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'missing' }));
}

function withServer(handler, run) {
    return new Promise((resolve, reject) => {
        const server = createServer((request, response) => {
            Promise.resolve(handler(request, response)).catch(reject);
        });
        server.listen(0, '127.0.0.1', async () => {
            const address = server.address();
            try {
                assert.equal(typeof address, 'object');
                assert.ok(address);
                await run(`http://127.0.0.1:${address.port}`);
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                server.close();
            }
        });
    });
}

function runSkillScript(filename, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(skillScriptsRoot, filename), ...args], {
            cwd: repoRoot,
            env: buildTestEnvironment(env),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => child.kill('SIGTERM'), 30_000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once('close', (status, signal) => {
            clearTimeout(timeout);
            resolve({ status, signal, stdout, stderr });
        });
    });
}

function buildTestEnvironment(overrides) {
    const names = ['HOME', 'PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE'];
    const environment = { GPT_IMAGE_AGENT_LOAD_ENV_FILE: '0' };
    for (const name of names) {
        if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    return { ...environment, ...overrides };
}

function readRequestText(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
}

function fakePngBuffer(width, height) {
    const buffer = Buffer.alloc(24);
    buffer[0] = 0x89;
    buffer.write('PNG', 1, 'ascii');
    buffer[4] = 0x0d;
    buffer[5] = 0x0a;
    buffer[6] = 0x1a;
    buffer[7] = 0x0a;
    buffer.writeUInt32BE(13, 8);
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}
