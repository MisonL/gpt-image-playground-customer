import {
    parseRetryAfterValue,
    resolveSameOriginUrl
} from '../skills/gpt-image-playground-agent/scripts/lib/script-utils.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skillRoot = join(repoRoot, 'skills/gpt-image-playground-agent');
const skillScriptsRoot = join(repoRoot, 'skills/gpt-image-playground-agent/scripts');

describe('Agent skill script argument validation', () => {
    it('rejects invalid generate numeric options before dry-run output', () => {
        const result = runSkillScript('generate-image.mjs', ['--n', 'abc', 'prompt']);

        assert.equal(result.status, 2);
        assert.match(result.stderr, /--n 必须是正整数/);
        assert.equal(result.stdout.trim(), '');
    });

    it('rejects invalid edit timeout before reading the image path', () => {
        const result = runSkillScript('edit-image.mjs', ['--timeout-ms', 'abc', '/tmp/missing.png', 'prompt']);

        assert.equal(result.status, 2);
        assert.match(result.stderr, /--timeout-ms 必须是正整数/);
        assert.equal(result.stdout.trim(), '');
    });

    it('rejects invalid upstream probe timeout before network checks', () => {
        const result = runSkillScript('probe-upstream-image.mjs', ['--timeout-ms', 'abc']);

        assert.equal(result.status, 2);
        assert.match(result.stderr, /--timeout-ms 必须是正整数/);
        assert.equal(result.stdout.trim(), '');
    });

    it('rejects invalid image size limits before dry-run or network requests', () => {
        const generateResult = runSkillScript('generate-image.mjs', ['--size', '2049x2048', 'prompt']);
        assert.equal(generateResult.status, 2);
        assert.match(generateResult.stderr, /--size 的宽边和高边都必须是 16 的倍数/);
        assert.equal(generateResult.stdout.trim(), '');

        const editResult = runSkillScript('edit-image.mjs', ['--size', '8192x8192', '/tmp/source.png', 'prompt']);
        assert.equal(editResult.status, 2);
        assert.match(editResult.stderr, /--size 的最大单边不能超过 3840px/);
        assert.equal(editResult.stdout.trim(), '');

        const maxPixelsResult = runSkillScript('generate-image.mjs', ['--size', '3840x3840', 'prompt']);
        assert.equal(maxPixelsResult.status, 2);
        assert.match(maxPixelsResult.stderr, /--size 的总像素不能超过 8,294,400/);
        assert.equal(maxPixelsResult.stdout.trim(), '');

        const probeResult = runSkillScript('probe-upstream-image.mjs', ['--size', '512x512']);
        assert.equal(probeResult.status, 2);
        assert.match(probeResult.stderr, /--size 的总像素必须至少为 655,360/);
        assert.equal(probeResult.stdout.trim(), '');
    });

    it('rejects invalid retry attempt env values', () => {
        const result = runSkillScript('generate-image.mjs', ['prompt'], {
            GPT_IMAGE_AGENT_MAX_ATTEMPTS: 'abc'
        });

        assert.equal(result.status, 2);
        assert.match(result.stderr, /GPT_IMAGE_AGENT_MAX_ATTEMPTS 必须是正整数/);
        assert.equal(result.stdout.trim(), '');
    });

    it('rejects service base URLs with embedded credentials before dry-run output', () => {
        const result = runSkillScript('generate-image.mjs', ['prompt'], {
            GPT_IMAGE_PLAYGROUND_URL: 'https://user:secret@example.test'
        });

        assert.equal(result.status, 2);
        assert.match(result.stderr, /base URL/);
        assert.match(result.stderr, /不能包含凭据/);
        assert.doesNotMatch(result.stderr, /secret/);
        assert.equal(result.stdout.trim(), '');
    });

    it('rejects upstream probe base URLs with embedded credentials before network checks', () => {
        const result = runSkillScript('probe-upstream-image.mjs', [
            '--base-url',
            'https://user:secret@example.test/v1'
        ]);

        assert.equal(result.status, 2);
        assert.match(result.stderr, /base URL/);
        assert.match(result.stderr, /不能包含凭据/);
        assert.doesNotMatch(result.stderr, /secret/);
        assert.equal(result.stdout.trim(), '');
    });

    it('does not read prompt files during default generate dry-run', () => {
        const result = runSkillScript('generate-image.mjs', ['--prompt-file', '/tmp/missing-agent-prompt.txt']);

        assert.equal(result.status, 0);
        const body = JSON.parse(result.stdout);
        assert.equal(body.dry_run, true);
        assert.equal(body.billable, false);
        assert.equal(result.stderr.trim(), '');
    });

    it('includes explicit upstream streaming options in generate dry-run requests', () => {
        const result = runSkillScript('generate-image.mjs', [
            '--image-backend',
            'responses',
            '--stream-mode',
            'stream',
            '--streaming-strategy',
            'responses-sse',
            '--partial-images',
            '3',
            'prompt'
        ]);

        assert.equal(result.status, 0);
        const body = JSON.parse(result.stdout);
        assert.equal(body.request.image_backend, 'responses');
        assert.equal(body.request.stream_mode, 'stream');
        assert.equal(body.request.streaming_strategy, 'responses-sse');
        assert.equal(body.request.partial_images, 3);
        assert.equal(result.stderr.trim(), '');
    });

    it('includes explicit upstream streaming options in edit dry-run requests', () => {
        const result = runSkillScript('edit-image.mjs', [
            '--stream-mode',
            'auto',
            '--streaming-strategy',
            'force-sse',
            '--partial-images',
            '2',
            '/tmp/source.png',
            'prompt'
        ]);

        assert.equal(result.status, 0);
        const body = JSON.parse(result.stdout);
        assert.equal(body.request.stream_mode, 'auto');
        assert.equal(body.request.streaming_strategy, 'force-sse');
        assert.equal(body.request.partial_images, 2);
        assert.equal(result.stderr.trim(), '');
    });

    it('prints page SSE routing guidance for high-resolution generate dry-runs', () => {
        const result = runSkillScript('generate-image.mjs', ['--size', '3072x2048', '--quality', 'high', 'prompt']);

        assert.equal(result.status, 0);
        const body = JSON.parse(result.stdout);
        assert.equal(body.endpoint, 'http://localhost:4783/api/images');
        assert.equal(body.routing_guidance.recommended_endpoint, '/api/images');
        assert.equal(body.routing_guidance.transport, 'page_sse');
        assert.equal(body.routing_guidance.fallback_endpoint, '/api/agent/images/generate');
        assert.equal(body.routing_guidance.fallback_mode, 'manual_after_diagnosis');
        assert.equal(body.routing_guidance.reason.includes('max_edge>2048'), true);
        assert.equal(result.stderr.trim(), '');
    });

    it('does not automatically fall back after a billable page SSE generate failure', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end('data: {"type":"error","error":"stream failed","status":502}\n\n');
                    return;
                }
                if (request.url === '/api/agent/images/generate') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected fallback' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_failed');
                assert.match(body.error.message, /stream failed/);
                assert.equal(body.routing.fallback_endpoint, '/api/agent/images/generate');
                assert.equal(body.routing.fallback_mode, 'manual_after_diagnosis');
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities', 'POST /api/images']
                );
            }
        );
    });

    it('reports non-SSE page validation failures as non-billable', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(400, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'quality 对 gpt-image-2 无效。' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'invalid-quality', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.billable, false);
                assert.equal(body.error.code, 'page_sse_request_rejected');
                assert.equal(body.error.status, 400);
                assert.match(body.error.message, /quality/);
                assert.equal(body.routing.fallback_mode, 'fix_request_before_retry');
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities', 'POST /api/images']
                );
            }
        );
    });

    it('reports non-JSON page 4xx failures as non-billable request rejections', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(401, { 'content-type': 'text/plain' });
                    response.end('missing passwordHash');
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.billable, false);
                assert.equal(body.error.code, 'page_sse_request_rejected');
                assert.equal(body.error.status, 401);
                assert.match(body.error.message, /missing passwordHash/);
                assert.equal(body.routing.fallback_mode, 'fix_request_before_retry');
            }
        );
    });

    it('reports non-SSE page server failures as billable page SSE failures', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: { message: 'upstream page failed' } }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.billable, true);
                assert.equal(body.error.code, 'page_sse_failed');
                assert.equal(body.error.status, 500);
                assert.match(body.error.message, /upstream page failed/);
                assert.equal(body.routing.fallback_mode, 'manual_after_diagnosis');
            }
        );
    });

    it('preserves object page SSE error messages', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"error","error":{"message":"bad request from page","code":"validation_error","status":400}}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_failed');
                assert.equal(body.billable, true);
                assert.equal(body.error.status, 400);
                assert.match(body.error.message, /bad request from page/);
                assert.doesNotMatch(body.error.message, /\[object Object\]/);
            }
        );
    });

    it('fails large generate auto routing when page SSE capability is unavailable', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({ agent_streaming: {}, agent_jobs: { supported: true, mode: 'job_polling' } })
                    );
                    return;
                }
                if (request.url === '/api/agent/images/generate') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected fallback' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_unavailable');
                assert.equal(body.routing.fallback_mode, 'manual_after_diagnosis');
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities']
                );
            }
        );
    });

    it('fails page SSE output when the stream ends before the done event', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"image.png","b64_json":"final-base64","path":"/api/image/image.png","output_format":"png"}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_failed');
                assert.match(body.error.message, /缺少最终 done 事件/);
            }
        );
    });

    it('requires page access hash before calling page SSE when capabilities declare page auth', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: {
                                    supported: true,
                                    endpoint: '/api/images',
                                    auth: {
                                        required: true,
                                        schemes: ['form-password-hash'],
                                        form_field: 'passwordHash'
                                    }
                                }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected page call' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_auth_required');
                assert.match(body.error.message, /GPT_IMAGE_APP_PASSWORD_HASH/);
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities']
                );
            }
        );
    });

    it('rejects overlong page SSE client request ids before sending the stream request', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
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
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected page call' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--page-sse', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    {
                        GPT_IMAGE_PLAYGROUND_URL: baseUrl,
                        GPT_IMAGE_AGENT_IDEMPOTENCY_KEY: 'x'.repeat(129)
                    }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_client_request_id_too_long');
                assert.match(body.error.message, /不能超过 128 个字符/);
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities']
                );
            }
        );
    });

    it('uses page SSE client request id max length declared by capabilities', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: {
                                    supported: true,
                                    endpoint: '/api/images',
                                    auth: { required: false, schemes: [], form_field: 'passwordHash' },
                                    client_request_id: { max_length: 12 }
                                }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected page call' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    [
                        '--allow-billable',
                        '--page-sse',
                        '--size',
                        '3072x2048',
                        '--quality',
                        'high',
                        '--idempotency-key',
                        'too-long-page-key',
                        'prompt'
                    ],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_client_request_id_too_long');
                assert.match(body.error.message, /不能超过 12 个字符/);
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities']
                );
            }
        );
    });

    it('strips page SSE base64 from default path-mode output', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
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
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"image.png","b64_json":"final-base64","path":"/api/image/image.png","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"page-request-1","images":[{"filename":"image.png"}]}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                const body = JSON.parse(result.stdout);
                assert.equal(body.images[0].filename, 'image.png');
                assert.equal('b64_json' in body.images[0], false);
                assert.equal(body.images[0].path, '/api/image/image.png');
                assert.equal(body.images[0].absolute_path, `${baseUrl}/api/image/image.png`);
                assert.equal(body.images[0].output_format, 'png');
                assert.equal(body.images[0].clientRequestId, 'page-request-1');
            }
        );
    });

    it('passes response mode through to page SSE form-data requests', async () => {
        let pageRequestBody = '';
        await withServer(
            async (request, response) => {
                if (request.url === '/api/agent/capabilities') {
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
                    return;
                }
                if (request.url === '/api/images') {
                    pageRequestBody = await readRequestText(request);
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"image.png","b64_json":"final-base64","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"page-request-response-mode"}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    [
                        '--allow-billable',
                        '--size',
                        '3072x2048',
                        '--quality',
                        'high',
                        '--response-mode',
                        'base64',
                        'prompt'
                    ],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                assert.match(pageRequestBody, /name="response_mode"\r?\n\r?\nbase64/);
            }
        );
    });

    it('omits page SSE streaming strategy unless explicitly requested', async () => {
        let pageRequestBody = '';
        await withServer(
            async (request, response) => {
                if (request.url === '/api/agent/capabilities') {
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
                    return;
                }
                if (request.url === '/api/images') {
                    pageRequestBody = await readRequestText(request);
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"image.png","b64_json":"final-base64","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"page-request-default-streaming"}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--page-sse', '--size', '1024x1024', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                assert.match(pageRequestBody, /name="stream"\r?\n\r?\ntrue/);
                assert.doesNotMatch(pageRequestBody, /name="image_streaming_strategy"/);
            }
        );
    });

    it('enforces timeout while waiting for page SSE body events', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
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
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.write(': keepalive\n\n');
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    [
                        '--allow-billable',
                        '--page-sse',
                        '--timeout-ms',
                        '250',
                        '--size',
                        '1024x1024',
                        '--quality',
                        'high',
                        'prompt'
                    ],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl },
                    { timeoutMs: 1_200 }
                );

                assert.equal(result.timedOut, false);
                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_failed');
                assert.match(body.error.message, /\/api\/images/);
            }
        );
    });

    it('passes page access hash through to page SSE form-data requests when configured', async () => {
        let pageRequestBody = '';
        await withServer(
            async (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: {
                                    supported: true,
                                    endpoint: '/api/images',
                                    auth: {
                                        required: true,
                                        schemes: ['form-password-hash'],
                                        form_field: 'passwordHash'
                                    }
                                }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    pageRequestBody = await readRequestText(request);
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"image.png","b64_json":"final-base64","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"page-request-password"}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    {
                        GPT_IMAGE_PLAYGROUND_URL: baseUrl,
                        GPT_IMAGE_APP_PASSWORD_HASH: 'hash-for-page-sse'
                    }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                assert.match(pageRequestBody, /name="passwordHash"\r?\n\r?\nhash-for-page-sse/);
            }
        );
    });

    it('keeps page SSE base64 in default path-mode output when no path is returned', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
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
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"image.png","b64_json":"indexeddb-base64","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"page-request-indexeddb"}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                const body = JSON.parse(result.stdout);
                assert.equal(body.images[0].filename, 'image.png');
                assert.equal(body.images[0].b64_json, 'indexeddb-base64');
                assert.equal('absolute_path' in body.images[0], false);
                assert.equal(body.images[0].clientRequestId, 'page-request-indexeddb');
            }
        );
    });

    it('preserves completed page SSE images when the done event lists fewer images', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
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
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"image-a.png","b64_json":"base64-a","path":"/api/image/image-a.png","output_format":"png"}',
                            '',
                            'data: {"type":"completed","filename":"image-b.png","b64_json":"base64-b","path":"/api/image/image-b.png","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"page-request-2","images":[{"filename":"image-a.png"}]}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                const body = JSON.parse(result.stdout);
                assert.equal(body.images.length, 2);
                assert.equal(body.images[0].filename, 'image-a.png');
                assert.equal(body.images[1].filename, 'image-b.png');
                assert.equal(body.images[1].path, '/api/image/image-b.png');
                assert.equal(body.images[1].absolute_path, `${baseUrl}/api/image/image-b.png`);
                assert.equal(body.images[1].clientRequestId, 'page-request-2');
            }
        );
    });

    it('uses Agent JSON for billable large generate requests when streaming strategy is off', async () => {
        const requests = [];
        let agentRequestBody = '';
        await withServer(
            async (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/agent/images/generate') {
                    agentRequestBody = await readRequestText(request);
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            images: [
                                {
                                    filename: 'agent-off.png',
                                    content_url: '/api/agent/artifacts/artifact-off/content',
                                    metadata_url: '/api/agent/artifacts/artifact-off'
                                }
                            ]
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected page SSE call' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    [
                        '--allow-billable',
                        '--size',
                        '3072x2048',
                        '--quality',
                        'high',
                        '--streaming-strategy',
                        'off',
                        'prompt'
                    ],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                const body = JSON.parse(result.stdout);
                assert.equal(body.images[0].filename, 'agent-off.png');
                assert.deepEqual(body.routing, { transport: 'agent_json', endpoint: '/api/agent/images/generate' });
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities', 'POST /api/agent/images/generate']
                );
                const requestBody = JSON.parse(agentRequestBody);
                assert.equal(requestBody.size, '3072x2048');
                assert.equal(requestBody.streaming_strategy, 'off');
            }
        );
    });

    it('uses Agent JSON for billable large generate requests when --agent is explicit', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/agent/images/generate') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            images: [
                                {
                                    filename: 'agent.png',
                                    content_url: '/api/agent/artifacts/artifact-1/content',
                                    metadata_url: '/api/agent/artifacts/artifact-1'
                                }
                            ]
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected page SSE call' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--agent', '--size', '3072x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                const body = JSON.parse(result.stdout);
                assert.equal(body.images[0].filename, 'agent.png');
                assert.equal(body.images[0].absolute_content_url, `${baseUrl}/api/agent/artifacts/artifact-1/content`);
                assert.deepEqual(body.routing, { transport: 'agent_json', endpoint: '/api/agent/images/generate' });
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities', 'POST /api/agent/images/generate']
                );
            }
        );
    });

    it('uses page SSE for billable small generate requests when --page-sse is explicit', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            agent_streaming: {
                                page_sse: { supported: true, endpoint: '/api/images' }
                            },
                            agent_jobs: { supported: true, mode: 'job_polling' }
                        })
                    );
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"completed","filename":"small-page.png","path":"/api/image/small-page.png","output_format":"png"}',
                            '',
                            'data: {"type":"done","client_request_id":"small-page-request","images":[{"filename":"small-page.png"}]}',
                            '',
                            ''
                        ].join('\n')
                    );
                    return;
                }
                if (request.url === '/api/agent/images/generate') {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'unexpected Agent JSON call' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--page-sse', '--size', '1024x1024', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 0);
                assert.equal(result.stderr.trim(), '');
                const body = JSON.parse(result.stdout);
                assert.equal(body.images[0].filename, 'small-page.png');
                assert.equal(body.images[0].absolute_path, `${baseUrl}/api/image/small-page.png`);
                assert.deepEqual(body.routing, { transport: 'page_sse', endpoint: '/api/images' });
                assert.deepEqual(
                    requests.map((item) => `${item.method} ${item.url}`),
                    ['GET /api/agent/capabilities', 'POST /api/images']
                );
            }
        );
    });

    it('rejects explicit page SSE when stream-mode is non_stream before network requests', async () => {
        const requests = [];
        await withServer(
            (request, response) => {
                requests.push({ method: request.method, url: request.url });
                response.writeHead(500, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'unexpected request' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--page-sse', '--stream-mode', 'non_stream', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 2);
                assert.equal(result.stdout.trim(), '');
                assert.match(result.stderr, /stream_mode=non_stream/);
                assert.doesNotMatch(result.stderr, /ModuleJob|at buildGenerateRoutingGuidance/);
                assert.deepEqual(requests, []);
            }
        );
    });

    it('prints page SSE guidance for high-resolution edit dry-runs', () => {
        const result = runSkillScript('edit-image.mjs', [
            '--size',
            '3072x2048',
            '--quality',
            'high',
            '/tmp/source.png',
            'prompt'
        ]);

        assert.equal(result.status, 0);
        const body = JSON.parse(result.stdout);
        assert.equal(body.routing_guidance.recommended_endpoint, '/api/images');
        assert.equal(body.routing_guidance.transport, 'page_sse');
        assert.equal(body.routing_guidance.strength, 'default');
        assert.equal(result.stderr.trim(), '');
    });

    it('uses page SSE for billable high-resolution edit requests', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-edit-page-sse-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            const requests = [];
            let pageSseRequestBody = '';

            await withServer(
                async (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                agent_streaming: {
                                    page_sse: { supported: true, endpoint: '/api/images' }
                                }
                            })
                        );
                        return;
                    }
                    if (request.url === '/api/images') {
                        pageSseRequestBody = await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                        response.end(
                            [
                                'data: {"type":"completed","filename":"edit.png","path":"/generated/edit.png","clientRequestId":"edit-page-sse-key"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"edit.png","path":"/generated/edit.png"}],"clientRequestId":"edit-page-sse-key"}',
                                '',
                                ''
                            ].join('\n')
                        );
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected Agent edit call' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'edit-image.mjs',
                        [
                            '--allow-billable',
                            '--size',
                            '3072x2048',
                            '--idempotency-key',
                            'edit-page-sse-key',
                            imagePath,
                            'prompt'
                        ],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.deepEqual(body.routing, {
                        transport: 'page_sse',
                        endpoint: '/api/images',
                        fallback_endpoint: '/api/agent/images/edit',
                        fallback_mode: 'manual_after_diagnosis'
                    });
                    assert.equal(body.images[0].absolute_path, `${baseUrl}/generated/edit.png`);
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/images']
                    );
                    assert.match(pageSseRequestBody, /name="mode"\r?\n\r?\nedit/);
                    assert.match(pageSseRequestBody, /name="clientRequestId"\r?\n\r?\nedit-page-sse-key/);
                    assert.match(pageSseRequestBody, /name="image_0"; filename="source\.png"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('uses Agent edit for explicit high-resolution edit fallback requests', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-edit-agent-fallback-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            const requests = [];
            let editRequestBody = '';

            await withServer(
                async (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                agent_streaming: {
                                    page_sse: { supported: true, endpoint: '/api/images' }
                                }
                            })
                        );
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        editRequestBody = await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'edit-image', filename: 'edit.png' }] }));
                        return;
                    }
                    if (request.url === '/api/images') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected page SSE call' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'edit-image.mjs',
                        ['--allow-billable', '--agent', '--size', '3072x2048', imagePath, 'prompt'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/agent/images/edit']
                    );
                    assert.match(editRequestBody, /name="size"\r?\n\r?\n3072x2048/);
                    assert.match(editRequestBody, /name="image_0"; filename="source\.png"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('routes high-resolution edit dry-runs to Agent edit when streaming is explicitly disabled', () => {
        const result = runSkillScript('edit-image.mjs', [
            '--size',
            '3072x2048',
            '--stream-mode',
            'non_stream',
            '/tmp/source.png',
            'prompt'
        ]);

        assert.equal(result.status, 0);
        const body = JSON.parse(result.stdout);
        assert.equal(body.endpoint, 'http://localhost:4783/api/agent/images/edit');
        assert.equal(body.routing_guidance.transport, 'agent_json');
        assert.equal(result.stderr.trim(), '');
    });

    it('rejects explicit edit page SSE when stream-mode is non_stream before network requests', () => {
        const result = runSkillScript('edit-image.mjs', [
            '--allow-billable',
            '--page-sse',
            '--stream-mode',
            'non_stream',
            '/tmp/source.png',
            'prompt'
        ]);

        assert.equal(result.status, 2);
        assert.equal(result.stdout.trim(), '');
        assert.match(result.stderr, /stream_mode=non_stream/);
    });

    it('reports high-resolution edit page SSE failures as billable structured failures', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-edit-page-sse-fail-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            const requests = [];

            await withServer(
                (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                agent_streaming: {
                                    page_sse: { supported: true, endpoint: '/api/images' }
                                }
                            })
                        );
                        return;
                    }
                    if (request.url === '/api/images') {
                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                        response.end('data: {"type":"error","error":{"message":"edit stream failed"},"status":502}\n\n');
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected Agent edit call' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'edit-image.mjs',
                        ['--allow-billable', '--size', '3072x2048', imagePath, 'prompt'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(result.stdout.trim(), '');
                    const body = JSON.parse(result.stderr);
                    assert.equal(body.billable, true);
                    assert.equal(body.error.code, 'page_sse_failed');
                    assert.equal(body.error.status, 502);
                    assert.match(body.error.message, /edit stream failed/);
                    assert.deepEqual(body.routing, {
                        transport: 'page_sse',
                        endpoint: '/api/images',
                        fallback_endpoint: '/api/agent/images/edit',
                        fallback_mode: 'manual_after_diagnosis'
                    });
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/images']
                    );
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('reports high-resolution edit page validation failures as non-billable', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-edit-page-sse-reject-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            const requests = [];

            await withServer(
                (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                agent_streaming: {
                                    page_sse: { supported: true, endpoint: '/api/images' }
                                }
                            })
                        );
                        return;
                    }
                    if (request.url === '/api/images') {
                        response.writeHead(400, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'invalid edit request' }));
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected Agent edit call' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'edit-image.mjs',
                        ['--allow-billable', '--size', '3072x2048', imagePath, 'prompt'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(result.stdout.trim(), '');
                    const body = JSON.parse(result.stderr);
                    assert.equal(body.billable, false);
                    assert.equal(body.error.code, 'page_sse_request_rejected');
                    assert.equal(body.error.status, 400);
                    assert.match(body.error.message, /invalid edit request/);
                    assert.equal(body.routing.fallback_endpoint, '/api/agent/images/edit');
                    assert.equal(body.routing.fallback_mode, 'fix_request_before_retry');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/images']
                    );
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('sends upstream streaming fields in billable edit multipart requests', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-edit-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            const requests = [];
            let editRequestBody = '';

            await withServer(
                async (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        editRequestBody = await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'edit-image', filename: 'edit.png' }] }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'edit-image.mjs',
                        [
                            '--allow-billable',
                            '--stream-mode',
                            'stream',
                            '--streaming-strategy',
                            'responses-sse',
                            '--partial-images',
                            '3',
                            imagePath,
                            'prompt'
                        ],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/agent/images/edit']
                    );
                    assert.match(editRequestBody, /name="stream_mode"\r?\n\r?\nstream/);
                    assert.match(editRequestBody, /name="streaming_strategy"\r?\n\r?\nresponses-sse/);
                    assert.match(editRequestBody, /name="partial_images"\r?\n\r?\n3/);
                    assert.match(editRequestBody, /name="image_0"; filename="source\.png"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects invalid generate upstream streaming options before dry-run output', () => {
        const invalidPartialImages = runSkillScript('generate-image.mjs', ['--partial-images', '4', 'prompt']);
        assert.equal(invalidPartialImages.status, 2);
        assert.match(invalidPartialImages.stderr, /--partial-images 必须是 1 到 3 的整数/);
        assert.equal(invalidPartialImages.stdout.trim(), '');

        const invalidBackend = runSkillScript('generate-image.mjs', ['--image-backend', 'unknown-backend', 'prompt']);
        assert.equal(invalidBackend.status, 2);
        assert.match(invalidBackend.stderr, /--image-backend 必须是/);
        assert.equal(invalidBackend.stdout.trim(), '');

        const invalidStrategy = runSkillScript('generate-image.mjs', [
            '--streaming-strategy',
            'unknown-strategy',
            'prompt'
        ]);
        assert.equal(invalidStrategy.status, 2);
        assert.match(invalidStrategy.stderr, /--streaming-strategy 必须是/);
        assert.equal(invalidStrategy.stdout.trim(), '');

        const invalidResponseMode = runSkillScript('generate-image.mjs', ['--response-mode', 'url', 'prompt']);
        assert.equal(invalidResponseMode.status, 2);
        assert.match(invalidResponseMode.stderr, /--response-mode 必须是 path、base64 或 both/);
        assert.equal(invalidResponseMode.stdout.trim(), '');

        const disabledAutoPageSse = runSkillScript('generate-image.mjs', [
            '--size',
            '3072x2048',
            '--streaming-strategy',
            'off',
            'prompt'
        ]);
        assert.equal(disabledAutoPageSse.status, 0);
        const disabledAutoPageSseBody = JSON.parse(disabledAutoPageSse.stdout);
        assert.equal(disabledAutoPageSseBody.endpoint, 'http://localhost:4783/api/agent/images/generate');
        assert.equal(disabledAutoPageSseBody.routing_guidance.recommended_endpoint, '/api/agent/images/generate');
        assert.equal(disabledAutoPageSse.stderr.trim(), '');

        const disabledPageSse = runSkillScript('generate-image.mjs', [
            '--page-sse',
            '--streaming-strategy',
            'off',
            'prompt'
        ]);
        assert.equal(disabledPageSse.status, 2);
        assert.match(disabledPageSse.stderr, /streaming_strategy=off/);
        assert.doesNotMatch(disabledPageSse.stderr, /ModuleJob|at buildGenerateRoutingGuidance/);
        assert.equal(disabledPageSse.stdout.trim(), '');
    });

    it('shows edit help without validating unrelated env values', () => {
        const result = runSkillScript('edit-image.mjs', ['--help'], {
            GPT_IMAGE_AGENT_MAX_ATTEMPTS: 'abc'
        });

        assert.equal(result.status, 0);
        assert.match(result.stderr, /用法：edit-image\.mjs/);
        assert.equal(result.stdout.trim(), '');
    });

    it('shows skill script help without validating service URL env values', () => {
        const env = { GPT_IMAGE_PLAYGROUND_URL: 'https://user:secret@example.test' };
        const generateHelp = runSkillScript('generate-image.mjs', ['--help'], env);
        const editHelp = runSkillScript('edit-image.mjs', ['--help'], env);

        assert.equal(generateHelp.status, 0);
        assert.match(generateHelp.stderr, /用法：generate-image\.mjs/);
        assert.equal(generateHelp.stdout.trim(), '');
        assert.equal(editHelp.status, 0);
        assert.match(editHelp.stderr, /用法：edit-image\.mjs/);
        assert.equal(editHelp.stdout.trim(), '');
    });

    it('keeps the skill package free of machine-specific and shell-specific paths', () => {
        const forbiddenPatterns = [
            /\/Users\/[^`\\s)]+/,
            /\/Volumes\/[^`\\s)]+/,
            /\/home\/[^`\\s)]+/,
            /C:\\\\Users\\\\[^`\\s)]+/i,
            /\.\.\/\.\.\/\.\.\/src\//,
            /\.\.\/\.\.\/\.\.\/\.\.\/src\//,
            /```bash/,
            /(^|\n)[A-Z_][A-Z0-9_]*=.*\s+node\s/,
            /\\\r?\n\s+--/
        ];

        const matches = [];
        for (const filePath of listTextFiles(skillRoot)) {
            const content = readFileSync(filePath, 'utf8');
            for (const pattern of forbiddenPatterns) {
                if (pattern.test(content)) {
                    matches.push(filePath);
                    break;
                }
            }
        }

        assert.deepEqual(matches, []);
    });

    it('tells agents to use bundled scripts instead of ad hoc API callers', () => {
        const skillText = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
        const openAiYaml = readFileSync(join(skillRoot, 'agents/openai.yaml'), 'utf8');
        const apiReference = readFileSync(join(skillRoot, 'references/api.md'), 'utf8');

        assert.match(skillText, /必须优先运行本 Skill 内置 scripts\/generate-image\.mjs/);
        assert.match(skillText, /不要临时编写 Node\/Python\/shell 脚本、curl 命令或手写 fetch\/FormData/);
        assert.match(openAiYaml, /先选择并运行内置脚本/);
        assert.match(openAiYaml, /不要临时编写 API 调用脚本/);
        assert.match(apiReference, /先使用这些内置脚本/);
        assert.match(apiReference, /不要临时编写 Node\/Python\/shell 脚本、curl 命令或手写 fetch\/FormData/);
    });

    it('runs from a copied standalone skill directory outside the repository', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-playground-agent-'));
        const copiedSkillRoot = join(tempRoot, 'gpt-image-playground-agent');
        try {
            cpSync(skillRoot, copiedSkillRoot, { recursive: true });
            const result = spawnSync(
                process.execPath,
                [join(copiedSkillRoot, 'scripts/generate-image.mjs'), '--help'],
                {
                    cwd: tmpdir(),
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        GPT_IMAGE_PLAYGROUND_URL: 'not a url'
                    }
                }
            );

            assert.equal(result.status, 0);
            assert.match(result.stderr, /用法：generate-image\.mjs/);
            assert.equal(result.stdout.trim(), '');
            assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ERR_MODULE_NOT_FOUND|src\/lib/);
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('prints batch dry-run JSONL plans without contacting the service', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(
                inputPath,
                [
                    JSON.stringify({ id: 'first item', prompt: 'first prompt', size: '1024x1024' }),
                    JSON.stringify({
                        mode: 'edit',
                        id: 'edit item',
                        prompt: 'edit prompt',
                        image_path: '/tmp/source.png',
                        image_paths: ['/tmp/source-a.png', '/tmp/source-b.png'],
                        mask_path: '/tmp/mask.png'
                    })
                ].join('\n')
            );

            const result = runSkillScript('batch-images.mjs', ['--input', inputPath, '--ordered-prefix', 'demo']);

            assert.equal(result.status, 0);
            assert.equal(result.stderr.trim(), '');
            const body = JSON.parse(result.stdout);
            assert.equal(body.dry_run, true);
            assert.equal(body.billable, false);
            assert.equal(body.total, 2);
            assert.equal(body.tasks[0].endpoint, '/api/agent/images/generate');
            assert.equal(body.tasks[0].idempotency_key, 'demo-0001-first-item');
            assert.equal(body.tasks[1].endpoint, '/api/agent/images/edit');
            assert.equal(body.tasks[1].idempotency_key, 'demo-0002-edit-item');
            assert.equal('image_path' in body.tasks[1].request, false);
            assert.equal('image_paths' in body.tasks[1].request, false);
            assert.equal('mask_path' in body.tasks[1].request, false);
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('validates present batch fields even when their values are falsy', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(inputPath, JSON.stringify({ id: 'bad-partial', prompt: 'prompt', partial_images: 0 }));

            const result = runSkillScript('batch-images.mjs', ['--input', inputPath]);

            assert.equal(result.status, 2);
            assert.match(result.stderr, /bad-partial\.partial_images 必须是正整数/);
            assert.equal(result.stdout.trim(), '');
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('preserves explicit falsy batch task ids in dry-run plans', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(inputPath, JSON.stringify({ id: 0, prompt: 'prompt' }));

            const result = runSkillScript('batch-images.mjs', ['--input', inputPath, '--ordered-prefix', 'demo']);

            assert.equal(result.status, 0);
            assert.equal(result.stderr.trim(), '');
            const body = JSON.parse(result.stdout);
            assert.equal(body.tasks[0].id, '0');
            assert.equal(body.tasks[0].idempotency_key, 'demo-0001-0');
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('appends batch manifests and skips succeeded tasks during resume', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            writeFileSync(
                inputPath,
                [
                    JSON.stringify({ id: 'first', prompt: 'first prompt', size: '1024x1024' }),
                    JSON.stringify({ id: 'second', prompt: 'second prompt', size: '1024x1024' })
                ].join('\n')
            );
            writeFileSync(
                manifestPath,
                `${JSON.stringify({ id: 'first', idempotency_key: 'batch-0001-first', status: 'succeeded' })}\n`
            );

            const requests = [];
            await withServer(
                (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                images: [
                                    {
                                        id: 'image-second',
                                        filename: 'second.png',
                                        b64_json: fakePngBase64(2, 1)
                                    }
                                ]
                            })
                        );
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--resume', '--input', inputPath, '--manifest', manifestPath],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.results[0].status, 'skipped');
                    assert.equal(body.results[1].status, 'succeeded');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['POST /api/agent/images/generate']
                    );
                    const manifestLines = readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
                    assert.equal(manifestLines.length, 3);
                    assert.equal(manifestLines[1].status, 'skipped');
                    assert.equal(manifestLines[2].status, 'succeeded');
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('does not require capabilities when resume skips every batch task', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-resume-skip-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            writeFileSync(inputPath, JSON.stringify({ id: 'done', prompt: 'already done', size: '1024x1024' }));
            writeFileSync(
                manifestPath,
                `${JSON.stringify({ id: 'done', idempotency_key: 'batch-0001-done', status: 'succeeded' })}\n`
            );

            const result = runSkillScript(
                'batch-images.mjs',
                ['--allow-billable', '--resume', '--input', inputPath, '--manifest', manifestPath],
                { GPT_IMAGE_PLAYGROUND_URL: 'http://127.0.0.1:9' }
            );

            assert.equal(result.status, 0);
            assert.equal(result.stderr.trim(), '');
            const body = JSON.parse(result.stdout);
            assert.equal(body.results[0].status, 'skipped');
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('skips malformed batch manifest lines during resume', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            writeFileSync(inputPath, JSON.stringify({ id: 'first', prompt: 'first prompt', size: '1024x1024' }));
            writeFileSync(
                manifestPath,
                `${JSON.stringify({ id: 'first', idempotency_key: 'batch-0001-first', status: 'succeeded' })}\n{"truncated"`
            );

            await withServer(
                (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected resumed request' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--resume', '--input', inputPath, '--manifest', manifestPath],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.results[0].status, 'skipped');
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('runs batch edit tasks with multipart image input', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            writeFileSync(
                inputPath,
                JSON.stringify({ mode: 'edit', id: 'edit-one', prompt: 'edit prompt', image_path: imagePath, size: '1024x1024' })
            );

            let editRequestBody = '';
            await withServer(
                async (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        editRequestBody = await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'edit-image', filename: 'edit.png', b64_json: fakePngBase64(2, 1) }] }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync('batch-images.mjs', ['--allow-billable', '--input', inputPath], {
                        GPT_IMAGE_PLAYGROUND_URL: baseUrl
                    });

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    assert.match(editRequestBody, /name="prompt"\r?\n\r?\nedit prompt/);
                    assert.match(editRequestBody, /name="image_0"; filename="source\.png"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('routes high-resolution batch edit tasks through page SSE', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-page-sse-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            writeFileSync(
                inputPath,
                JSON.stringify({
                    mode: 'edit',
                    id: 'edit-large',
                    prompt: 'edit prompt',
                    image_path: imagePath,
                    size: '3072x2048',
                    idempotency_key: 'batch-edit-page-sse-key'
                })
            );

            let pageSseRequestBody = '';
            const requests = [];
            await withServer(
                async (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                agent_streaming: {
                                    page_sse: { supported: true, endpoint: '/api/images' }
                                }
                            })
                        );
                        return;
                    }
                    if (request.url === '/api/images') {
                        pageSseRequestBody = await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                        response.end(
                            [
                                'data: {"type":"completed","filename":"batch-edit.png","path":"/generated/batch-edit.png"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"batch-edit.png","path":"/generated/batch-edit.png"}]}',
                                '',
                                ''
                            ].join('\n')
                        );
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected Agent edit call' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync('batch-images.mjs', ['--allow-billable', '--input', inputPath], {
                        GPT_IMAGE_PLAYGROUND_URL: baseUrl
                    });

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.results[0].routing.transport, 'page_sse');
                    assert.equal(body.results[0].routing.strength, 'default');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/images']
                    );
                    assert.match(pageSseRequestBody, /name="mode"\r?\n\r?\nedit/);
                    assert.match(pageSseRequestBody, /name="clientRequestId"\r?\n\r?\nbatch-edit-page-sse-key/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('does not route batch tasks through page SSE when streaming is explicitly disabled', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-disabled-page-sse-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'large-generate-non-stream',
                    prompt: 'prompt',
                    size: '3072x2048',
                    stream_mode: 'non_stream'
                })
            );

            const result = runSkillScript('batch-images.mjs', ['--input', inputPath]);

            assert.equal(result.status, 0);
            const body = JSON.parse(result.stdout);
            assert.equal(body.tasks[0].routing.transport, 'agent_json');
            assert.equal(body.tasks[0].endpoint, '/api/agent/images/generate');
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects explicit batch page SSE when streaming is explicitly disabled', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-disabled-explicit-page-sse-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'large-generate-forced-page-sse',
                    prompt: 'prompt',
                    size: '3072x2048',
                    page_sse: true,
                    stream_mode: 'non_stream'
                })
            );

            const result = runSkillScript('batch-images.mjs', ['--input', inputPath]);

            assert.equal(result.status, 2);
            assert.equal(result.stdout.trim(), '');
            assert.match(result.stderr, /large-generate-forced-page-sse/);
            assert.match(result.stderr, /stream_mode=non_stream/);
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('records structured page SSE failures in batch output and manifest', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-page-sse-fail-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            writeFileSync(
                inputPath,
                JSON.stringify({
                    mode: 'edit',
                    id: 'edit-large-fail',
                    prompt: 'edit prompt',
                    image_path: imagePath,
                    size: '3072x2048',
                    idempotency_key: 'batch-edit-page-sse-fail-key'
                })
            );

            const requests = [];
            await withServer(
                (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                agent_streaming: {
                                    page_sse: { supported: true, endpoint: '/api/images' }
                                }
                            })
                        );
                        return;
                    }
                    if (request.url === '/api/images') {
                        response.writeHead(400, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'invalid edit request' }));
                        return;
                    }
                    if (request.url === '/api/agent/images/edit') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected Agent edit call' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--input', inputPath, '--manifest', manifestPath],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.ok, false);
                    assert.equal(body.failed, 1);
                    assert.equal(body.results[0].billable, false);
                    assert.equal(body.results[0].error.code, 'page_sse_request_rejected');
                    assert.equal(body.results[0].error.status, 400);
                    assert.equal(body.results[0].routing.fallback_endpoint, '/api/agent/images/edit');
                    assert.equal(body.results[0].routing.fallback_mode, 'fix_request_before_retry');
                    assert.match(body.results[0].next_step, /请求参数或鉴权/);

                    const manifestLines = readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
                    assert.equal(manifestLines.length, 1);
                    assert.equal(manifestLines[0].status, 'failed');
                    assert.equal(manifestLines[0].billable, false);
                    assert.equal(manifestLines[0].error.code, 'page_sse_request_rejected');
                    assert.equal(manifestLines[0].routing.transport, 'page_sse');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/images']
                    );
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('checks batch output dimensions from same-origin artifact URLs', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(inputPath, JSON.stringify({ id: 'dim-ok', prompt: 'prompt', size: '1024x1024' }));

            await withServer(
                (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'dim-image', filename: 'dim.png', content_url: '/artifact/dim.png' }] }));
                        return;
                    }
                    if (request.url === '/artifact/dim.png') {
                        response.writeHead(200, { 'content-type': 'image/png' });
                        response.end(fakePngBuffer(1024, 1024));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--dimension-check', '--input', inputPath],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.results[0].status, 'succeeded');
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('fails batch dimension-check mismatches and invalid size parameters', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-'));
        try {
            const invalidInputPath = join(tempRoot, 'invalid.jsonl');
            writeFileSync(invalidInputPath, JSON.stringify({ id: 'bad-size', prompt: 'prompt', size: 'wide' }));
            const invalidResult = runSkillScript('batch-images.mjs', ['--input', invalidInputPath]);
            assert.equal(invalidResult.status, 2);
            assert.match(invalidResult.stderr, /bad-size\.size 必须是 auto 或 WIDTHxHEIGHT/);
            assert.equal(invalidResult.stdout.trim(), '');

            const maxPixelsInputPath = join(tempRoot, 'max-pixels.jsonl');
            writeFileSync(maxPixelsInputPath, JSON.stringify({ id: 'too-many-pixels', prompt: 'prompt', size: '3840x3840' }));
            const maxPixelsResult = runSkillScript('batch-images.mjs', ['--input', maxPixelsInputPath]);
            assert.equal(maxPixelsResult.status, 2);
            assert.match(maxPixelsResult.stderr, /too-many-pixels\.size 的总像素不能超过 8,294,400/);
            assert.equal(maxPixelsResult.stdout.trim(), '');

            const mismatchInputPath = join(tempRoot, 'mismatch.jsonl');
            writeFileSync(mismatchInputPath, JSON.stringify({ id: 'dim-bad', prompt: 'prompt', size: '1024x1024' }));
            await withServer(
                (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'dim-image', filename: 'dim.png', b64_json: fakePngBase64(512, 512) }] }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--dimension-check', '--input', mismatchInputPath],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.ok, false);
                    assert.match(body.results[0].error, /尺寸校验失败/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects cross-origin job result URLs before sending auth headers', () => {
        assert.throws(
            () =>
                resolveSameOriginUrl(
                    'https://space.example.test',
                    'https://evil.example.test/result',
                    'job.result_url'
                ),
            /不同 origin/
        );
        assert.equal(
            resolveSameOriginUrl('https://space.example.test', '/api/agent/jobs/abc/result', 'job.result_url'),
            'https://space.example.test/api/agent/jobs/abc/result'
        );
    });

    it('caps retry-after values before sleeping', () => {
        assert.equal(parseRetryAfterValue('5'), 5);
        assert.equal(parseRetryAfterValue('0'), 1);
        assert.equal(parseRetryAfterValue('999999999999999999999'), 60);
        assert.equal(parseRetryAfterValue('not-a-number', 7), 7);
    });

    it('preserves non-JSON capabilities status and body in generate failures', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(503, { 'content-type': 'text/plain' });
                    response.end('maintenance window');
                    return;
                }
                response.writeHead(404, { 'content-type': 'text/plain' });
                response.end('missing');
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync('generate-image.mjs', ['--allow-billable', 'prompt'], {
                    GPT_IMAGE_PLAYGROUND_URL: baseUrl
                });

                assert.equal(result.status, 1);
                assert.match(result.stderr, /capabilities 请求失败，状态码 503：maintenance window/);
            }
        );
    });

    it('does not duplicate network failure prefixes in generate capability errors', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    return;
                }
                response.writeHead(404, { 'content-type': 'text/plain' });
                response.end('missing');
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--timeout-ms', '50', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const prefixes = result.stderr.match(/请求失败：/g) || [];
                assert.equal(prefixes.length, 1);
                assert.match(result.stderr, /\/api\/agent\/capabilities/);
            }
        );
    });
});

function runSkillScript(filename, args, env = {}) {
    return spawnSync(process.execPath, [join(skillScriptsRoot, filename), ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ...env }
    });
}

function listTextFiles(root) {
    const result = [];
    for (const name of readdirSync(root)) {
        const filePath = join(root, name);
        const stat = statSync(filePath);
        if (stat.isDirectory()) {
            result.push(...listTextFiles(filePath));
        } else if (/\.(md|mjs|yaml)$/.test(name)) {
            result.push(filePath);
        }
    }
    return result;
}

function runSkillScriptAsync(filename, args, env = {}, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [join(skillScriptsRoot, filename), ...args], {
            cwd: repoRoot,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeout = options.timeoutMs
            ? setTimeout(() => {
                  timedOut = true;
                  child.kill('SIGTERM');
              }, options.timeoutMs)
            : undefined;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('close', (status, signal) => {
            if (timeout) clearTimeout(timeout);
            resolve({ status, signal, stdout, stderr, timedOut });
        });
    });
}

async function withServer(handler, run) {
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
        assert.equal(typeof address, 'object');
        assert.ok(address);
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function readRequestText(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
        });
        request.on('end', () => {
            resolve(body);
        });
        request.on('error', reject);
    });
}

function fakePngBuffer(width, height) {
    const buffer = Buffer.alloc(24);
    buffer[0] = 0x89;
    buffer.write('PNG', 1, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

function fakePngBase64(width, height) {
    return fakePngBuffer(width, height).toString('base64');
}
