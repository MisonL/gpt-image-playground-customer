import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseRetryAfterValue, resolveSameOriginUrl } from '../skills/gpt-image-playground-agent/scripts/lib/script-utils.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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
        const result = runSkillScript('probe-upstream-image.mjs', ['--base-url', 'https://user:secret@example.test/v1']);

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
            '--streaming-strategy',
            'responses-sse',
            '--partial-images',
            '3',
            'prompt'
        ]);

        assert.equal(result.status, 0);
        const body = JSON.parse(result.stdout);
        assert.equal(body.request.image_backend, 'responses');
        assert.equal(body.request.streaming_strategy, 'responses-sse');
        assert.equal(body.request.partial_images, 3);
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
                    response.end(JSON.stringify({ error: 'size 对 gpt-image-2 无效：宽高必须是 16 的倍数。' }));
                    return;
                }
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'missing' }));
            },
            async (baseUrl) => {
                const result = await runSkillScriptAsync(
                    'generate-image.mjs',
                    ['--allow-billable', '--size', '2049x2048', '--quality', 'high', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.billable, false);
                assert.equal(body.error.code, 'page_sse_request_rejected');
                assert.equal(body.error.status, 400);
                assert.match(body.error.message, /16 的倍数/);
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
                    response.end(JSON.stringify({ agent_streaming: {}, agent_jobs: { supported: true, mode: 'job_polling' } }));
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
                assert.deepEqual(requests.map((item) => `${item.method} ${item.url}`), ['GET /api/agent/capabilities']);
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
                                    auth: { required: true, schemes: ['form-password-hash'], form_field: 'passwordHash' }
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
                assert.deepEqual(requests.map((item) => `${item.method} ${item.url}`), ['GET /api/agent/capabilities']);
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
                    [
                        '--allow-billable',
                        '--page-sse',
                        '--size',
                        '3072x2048',
                        '--quality',
                        'high',
                        'prompt'
                    ],
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
                assert.deepEqual(requests.map((item) => `${item.method} ${item.url}`), ['GET /api/agent/capabilities']);
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
                    ['--allow-billable', '--size', '3072x2048', '--quality', 'high', '--response-mode', 'base64', 'prompt'],
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
                    ['--allow-billable', '--page-sse', '--timeout-ms', '250', '--size', '1024x1024', '--quality', 'high', 'prompt'],
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
                                    auth: { required: true, schemes: ['form-password-hash'], form_field: 'passwordHash' }
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
        assert.equal(body.routing_guidance.strength, 'must_use');
        assert.equal(result.stderr.trim(), '');
    });

    it('blocks billable high-resolution Agent edit requests before reading image files', () => {
        const result = runSkillScript('edit-image.mjs', [
            '--allow-billable',
            '--size',
            '3072x2048',
            '/tmp/missing-source.png',
            'prompt'
        ]);

        assert.equal(result.status, 2);
        const body = JSON.parse(result.stderr);
        assert.equal(body.billable, false);
        assert.equal(body.routing_guidance.recommended_endpoint, '/api/images');
        assert.equal(body.routing_guidance.strength, 'must_use');
        assert.equal(result.stdout.trim(), '');
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

    it('rejects cross-origin job result URLs before sending auth headers', () => {
        assert.throws(
            () => resolveSameOriginUrl('https://space.example.test', 'https://evil.example.test/result', 'job.result_url'),
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
