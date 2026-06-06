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
                assert.equal(body.error.diagnostics.partial_image_count, 0);
                assert.equal(body.error.diagnostics.completed_event_count, 1);
                assert.equal(body.error.diagnostics.done_received, false);
                assert.equal(body.error.diagnostics.final_image_count, 1);
                assert.equal(body.error.diagnostics.last_upstream_event_type, 'completed');
            }
        );
    });

    it('reports page SSE partial image diagnostics when no final image arrives', async () => {
        await withServer(
            (request, response) => {
                if (request.url === '/api/agent/capabilities') {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ agent_streaming: { page_sse: { supported: true, endpoint: '/api/images' } } }));
                    return;
                }
                if (request.url === '/api/images') {
                    response.writeHead(200, { 'content-type': 'text/event-stream' });
                    response.end(
                        [
                            'data: {"type":"image_generation.partial_image","partial_image_b64":"partial-a"}',
                            '',
                            'data: {"type":"done","images":[]}',
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
                    ['--allow-billable', '--page-sse', '--size', '1024x1024', 'prompt'],
                    { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                );

                assert.equal(result.status, 1);
                assert.equal(result.stdout.trim(), '');
                const body = JSON.parse(result.stderr);
                assert.equal(body.error.code, 'page_sse_failed');
                assert.match(body.error.message, /未返回最终图片/);
                assert.equal(body.error.diagnostics.partial_image_count, 1);
                assert.equal(body.error.diagnostics.completed_event_count, 0);
                assert.equal(body.error.diagnostics.done_received, true);
                assert.equal(body.error.diagnostics.final_image_count, 0);
                assert.equal(body.error.diagnostics.last_upstream_event_type, 'done');
            }
        );
    });

    it('saves raw page SSE events when a generate log path is configured', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-sse-log-'));
        try {
            const logPath = join(tempRoot, 'events.jsonl');
            await withServer(
                (request, response) => {
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
                        response.end(
                            [
                                'event: image_generation.partial_image',
                                'data: {"type":"image_generation.partial_image","partial_image_b64":"abc"}',
                                '',
                                'data: {"type":"completed","filename":"image.png","path":"/generated/image.png"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"image.png","path":"/generated/image.png"}]}',
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
                        ['--allow-billable', '--page-sse', '--sse-log', logPath, '--size', '1024x1024', 'prompt'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const logLines = readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
                    assert.equal(logLines.length, 3);
                    assert.match(logLines[0].raw_event, /partial_image/);
                    assert.match(logLines[2].raw_event, /"type":"done"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('keeps generate page SSE successful when the optional raw log path is unwritable', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-sse-log-unwritable-'));
        try {
            await withServer(
                (request, response) => {
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
                        response.end(
                            [
                                'data: {"type":"completed","filename":"image.png","path":"/generated/image.png"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"image.png","path":"/generated/image.png"}]}',
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
                        ['--allow-billable', '--page-sse', '--sse-log', tempRoot, '--size', '1024x1024', 'prompt'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.match(result.stderr, /SSE log write failed/);
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.images.length, 1);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
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

    it('routes GPT2Image-compatible edit options through page SSE dry-runs', () => {
        const result = runSkillScript('edit-image.mjs', [
            '--format',
            'jpeg',
            '--output-compression',
            '85',
            '--moderation',
            'auto',
            '--image-backend',
            'responses',
            '--responses-model',
            'gpt-5.4-mini',
            '--thinking',
            'medium',
            '--prompt-optimization',
            'false',
            '--force-web',
            '/tmp/source.png',
            'prompt'
        ]);

        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), '');
        const body = JSON.parse(result.stdout);
        assert.equal(body.routing_guidance.transport, 'page_sse');
        assert.equal(body.request.output_format, 'jpeg');
        assert.equal(body.request.output_compression, 85);
        assert.equal(body.request.moderation, 'auto');
        assert.equal(body.request.image_backend, 'responses-image-generation');
        assert.equal(body.request.responsesModel, 'gpt-5.4-mini');
        assert.equal(body.request.thinking, 'medium');
        assert.equal(body.request.promptOptimization, false);
        assert.equal(body.request.force_web, true);
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

    it('passes GPT2Image-compatible edit options to page SSE form-data', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-edit-page-sse-fields-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            let pageSseRequestBody = '';

            await withServer(
                async (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ agent_streaming: { page_sse: { supported: true } } }));
                        return;
                    }
                    if (request.url === '/api/images') {
                        pageSseRequestBody = await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                        response.end(
                            [
                                'data: {"type":"completed","filename":"edit.jpg","path":"/generated/edit.jpg"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"edit.jpg","path":"/generated/edit.jpg"}]}',
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
                        'edit-image.mjs',
                        [
                            '--allow-billable',
                            '--format',
                            'jpeg',
                            '--output-compression',
                            '85',
                            '--moderation',
                            'auto',
                            '--image-backend',
                            'responses',
                            '--responses-model',
                            'gpt-5.4-mini',
                            '--thinking',
                            'medium',
                            '--prompt-optimization',
                            'false',
                            '--force-web',
                            imagePath,
                            'prompt'
                        ],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    assert.match(pageSseRequestBody, /name="output_format"\r?\n\r?\njpeg/);
                    assert.match(pageSseRequestBody, /name="output_compression"\r?\n\r?\n85/);
                    assert.match(pageSseRequestBody, /name="moderation"\r?\n\r?\nauto/);
                    assert.match(pageSseRequestBody, /name="image_backend"\r?\n\r?\nresponses-image-generation/);
                    assert.match(pageSseRequestBody, /name="responsesModel"\r?\n\r?\ngpt-5\.4-mini/);
                    assert.match(pageSseRequestBody, /name="thinking"\r?\n\r?\nmedium/);
                    assert.match(pageSseRequestBody, /name="promptOptimization"\r?\n\r?\nfalse/);
                    assert.match(pageSseRequestBody, /name="force_web"\r?\n\r?\ntrue/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('keeps edit page SSE successful when the optional raw log path is unwritable', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-edit-sse-log-unwritable-'));
        try {
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));

            await withServer(
                async (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ agent_streaming: { page_sse: { supported: true } } }));
                        return;
                    }
                    if (request.url === '/api/images') {
                        await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                        response.end(
                            [
                                'data: {"type":"completed","filename":"edit.png","path":"/generated/edit.png"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"edit.png","path":"/generated/edit.png"}]}',
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
                        'edit-image.mjs',
                        ['--allow-billable', '--page-sse', '--sse-log', tempRoot, imagePath, 'prompt'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.match(result.stderr, /SSE log write failed/);
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.images.length, 1);
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
                    JSON.stringify({
                        id: 'first item',
                        prompt: 'first prompt',
                        size: '1024x1024',
                        output_format: 'jpg',
                        output_compression: '80'
                    }),
                    JSON.stringify({
                        mode: 'edit',
                        id: 'edit item',
                        prompt: 'edit prompt',
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
            assert.equal(body.concurrency, 1);
            assert.equal(body.tasks[0].endpoint, '/api/agent/images/generate');
            assert.equal(body.tasks[0].idempotency_key, 'demo-0001-first-item');
            assert.equal(body.tasks[0].request.model, 'gpt-image-2');
            assert.equal(body.tasks[0].request.output_format, 'jpeg');
            assert.equal(body.tasks[0].request.output_compression, 80);
            assert.equal(body.tasks[1].endpoint, '/api/agent/images/edit');
            assert.equal(body.tasks[1].idempotency_key, 'demo-0002-edit-item');
            assert.deepEqual(body.tasks[1].request.image_fields, ['image_0', 'image_1']);
            assert.equal(body.tasks[1].request.mask, 'provided');
            assert.equal('image_path' in body.tasks[1].request, false);
            assert.equal('image_paths' in body.tasks[1].request, false);
            assert.equal('mask_path' in body.tasks[1].request, false);
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects invalid batch concurrency before dry-run output', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-concurrency-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(inputPath, JSON.stringify({ id: 'first', prompt: 'prompt' }));

            const result = runSkillScript('batch-images.mjs', ['--input', inputPath, '--concurrency', '0']);

            assert.equal(result.status, 2);
            assert.match(result.stderr, /--concurrency 必须是正整数/);
            assert.equal(result.stdout.trim(), '');
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects batch concurrency with strict consecutive failure stopping', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-concurrency-stop-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(inputPath, JSON.stringify({ id: 'first', prompt: 'prompt' }));

            const result = runSkillScript('batch-images.mjs', [
                '--input',
                inputPath,
                '--concurrency',
                '2',
                '--max-consecutive-failures',
                '1'
            ]);

            assert.equal(result.status, 2);
            assert.match(result.stderr, /不能同时使用 --max-consecutive-failures/);
            assert.equal(result.stdout.trim(), '');
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

    it('normalizes batch output compression before sending Agent JSON', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-compression-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'compressed',
                    prompt: 'prompt',
                    output_format: 'jpeg',
                    output_compression: '80'
                })
            );

            let agentRequestBody = '';
            await withServer(
                async (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        agentRequestBody = await readRequestText(request);
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ images: [{ id: 'compressed-image', filename: 'compressed.jpg' }] }));
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
                    const requestBody = JSON.parse(agentRequestBody);
                    assert.equal(requestBody.output_format, 'jpeg');
                    assert.equal(requestBody.output_compression, 80);
                }
            );
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

    it('runs batch tasks with the requested concurrency while preserving result order', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-concurrent-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(
                inputPath,
                [
                    JSON.stringify({ id: 'first', prompt: 'first prompt', idempotency_key: 'first-key' }),
                    JSON.stringify({ id: 'second', prompt: 'second prompt', idempotency_key: 'second-key' }),
                    JSON.stringify({ id: 'third', prompt: 'third prompt', idempotency_key: 'third-key' })
                ].join('\n')
            );

            let activeGenerateRequests = 0;
            let maxActiveGenerateRequests = 0;
            let enteredGenerateRequests = 0;
            const requestKeys = [];
            const twoGenerateRequestsEntered = createDeferred();
            const releaseGenerateResponses = createDeferred();
            await withServer(
                async (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        activeGenerateRequests += 1;
                        enteredGenerateRequests += 1;
                        maxActiveGenerateRequests = Math.max(maxActiveGenerateRequests, activeGenerateRequests);
                        requestKeys.push(request.headers['idempotency-key']);
                        if (enteredGenerateRequests === 2) {
                            twoGenerateRequestsEntered.resolve();
                        }
                        await releaseGenerateResponses.promise;
                        activeGenerateRequests -= 1;
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(
                            JSON.stringify({
                                images: [
                                    {
                                        id: request.headers['idempotency-key'],
                                        filename: `${request.headers['idempotency-key']}.png`,
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
                    const resultPromise = runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--input', inputPath, '--concurrency', '2'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl },
                        { timeoutMs: 10_000 }
                    );
                    let result;
                    try {
                        await waitWithTimeout(
                            twoGenerateRequestsEntered.promise,
                            2_000,
                            'expected two generate requests to enter before any response was released'
                        );
                        assert.equal(maxActiveGenerateRequests, 2);
                        releaseGenerateResponses.resolve();
                        result = await resultPromise;
                    } finally {
                        releaseGenerateResponses.resolve();
                        await resultPromise;
                    }

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.concurrency, 2);
                    assert.equal(maxActiveGenerateRequests, 2);
                    assert.deepEqual([...requestKeys].sort(), ['first-key', 'second-key', 'third-key']);
                    assert.deepEqual(
                        body.results.map((item) => item.id),
                        ['first', 'second', 'third']
                    );
                    assert.deepEqual(
                        body.results.map((item) => item.response.images[0].filename),
                        ['first-key.png', 'second-key.png', 'third-key.png']
                    );
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

    it('routes batch generate requests with responsesModel through page SSE', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-responses-model-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'responses-generate',
                    prompt: 'prompt',
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'responses-sse',
                    responsesModel: 'gpt-4.1-responses',
                    idempotency_key: 'batch-responses-model-key'
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
                                'data: {"type":"completed","filename":"responses.png","path":"/generated/responses.png"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"responses.png","path":"/generated/responses.png"}]}',
                                '',
                                ''
                            ].join('\n')
                        );
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected Agent generate call' }));
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
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/images']
                    );
                    assert.match(pageSseRequestBody, /name="image_backend"\r?\n\r?\nresponses/);
                    assert.match(pageSseRequestBody, /name="responsesModel"\r?\n\r?\ngpt-4\.1-responses/);
                    assert.match(pageSseRequestBody, /name="image_streaming_strategy"\r?\n\r?\nresponses-sse/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('passes GPT2Image-compatible edit options to batch page SSE form-data', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-edit-advanced-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            writeFileSync(
                inputPath,
                JSON.stringify({
                    mode: 'edit',
                    id: 'edit-advanced',
                    prompt: 'edit prompt',
                    image_path: imagePath,
                    size: '1024x1024',
                    output_format: 'jpeg',
                    output_compression: 85,
                    moderation: 'auto',
                    image_backend: 'responses',
                    responsesModel: 'gpt-5.4-mini',
                    thinking: 'medium',
                    promptOptimization: false,
                    force_web: true,
                    idempotency_key: 'batch-edit-advanced-key'
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
                                'data: {"type":"completed","filename":"edit.jpg","path":"/generated/edit.jpg"}',
                                '',
                                'data: {"type":"done","images":[{"filename":"edit.jpg","path":"/generated/edit.jpg"}]}',
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
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'POST /api/images']
                    );
                    assert.match(pageSseRequestBody, /name="mode"\r?\n\r?\nedit/);
                    assert.match(pageSseRequestBody, /name="output_format"\r?\n\r?\njpeg/);
                    assert.match(pageSseRequestBody, /name="output_compression"\r?\n\r?\n85/);
                    assert.match(pageSseRequestBody, /name="moderation"\r?\n\r?\nauto/);
                    assert.match(pageSseRequestBody, /name="image_backend"\r?\n\r?\nresponses-image-generation/);
                    assert.match(pageSseRequestBody, /name="responsesModel"\r?\n\r?\ngpt-5\.4-mini/);
                    assert.match(pageSseRequestBody, /name="thinking"\r?\n\r?\nmedium/);
                    assert.match(pageSseRequestBody, /name="promptOptimization"\r?\n\r?\nfalse/);
                    assert.match(pageSseRequestBody, /name="force_web"\r?\n\r?\ntrue/);
                    assert.match(pageSseRequestBody, /name="image_0"/);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('fails batch responsesModel routing when page SSE capability is unavailable', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-responses-model-no-sse-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'responses-no-page-sse',
                    prompt: 'prompt',
                    image_backend: 'responses-image-generation',
                    responsesModel: 'gpt-4.1-responses'
                })
            );

            const requests = [];
            await withServer(
                async (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ agent_streaming: {} }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'unexpected Agent generate call' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync('batch-images.mjs', ['--allow-billable', '--input', inputPath], {
                        GPT_IMAGE_PLAYGROUND_URL: baseUrl
                    });

                    assert.equal(result.status, 1);
                    assert.equal(result.stderr.trim(), '');
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.results[0].ok, false);
                    assert.equal(body.results[0].error.code, 'page_sse_unavailable');
                    assert.equal(body.results[0].routing.transport, 'page_sse');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities']
                    );
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

    it('re-fetches batch page SSE capabilities after a transient capabilities failure', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-page-sse-capability-retry-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            const imagePath = join(tempRoot, 'source.png');
            writeFileSync(imagePath, fakePngBuffer(2, 1));
            writeFileSync(
                inputPath,
                JSON.stringify({
                    mode: 'edit',
                    id: 'edit-large-capability-retry',
                    prompt: 'edit prompt',
                    image_path: imagePath,
                    size: '3072x2048',
                    idempotency_key: 'capability-retry-key'
                })
            );

            let capabilitiesRequests = 0;
            const requests = [];
            await withServer(
                (request, response) => {
                    requests.push({ method: request.method, url: request.url });
                    if (request.url === '/api/agent/capabilities') {
                        capabilitiesRequests += 1;
                        if (capabilitiesRequests === 1) {
                            response.writeHead(503, { 'content-type': 'text/plain' });
                            response.end('capabilities maintenance');
                            return;
                        }
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
                        response.end(
                            [
                                'data: {"type":"completed","filename":"retry-edit.png","path":"/generated/retry-edit.png","output_format":"png"}',
                                '',
                                'data: {"type":"done"}',
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
                        'batch-images.mjs',
                        ['--allow-billable', '--input', inputPath, '--manifest', manifestPath, '--max-attempts', '2'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 0);
                    assert.equal(result.stderr.trim(), '');
                    assert.deepEqual(
                        requests.map((item) => `${item.method} ${item.url}`),
                        ['GET /api/agent/capabilities', 'GET /api/agent/capabilities', 'POST /api/images']
                    );
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.results[0].attempt, 2);
                    assert.equal(body.results[0].root_idempotency_key, 'capability-retry-key');
                    assert.equal(body.results[0].response.images[0].filename, 'retry-edit.png');

                    const manifestLines = readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
                    assert.equal(manifestLines.length, 2);
                    assert.equal(manifestLines[0].status, 'failed');
                    assert.equal(manifestLines[0].idempotency_key, 'capability-retry-key');
                    assert.equal(manifestLines[1].status, 'succeeded');
                    assert.equal(manifestLines[1].idempotency_key, 'capability-retry-key-attempt-2');
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('retries batch failures with fresh attempt idempotency keys and reports a fix list', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-retry-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'retry-generate',
                    prompt: 'prompt',
                    idempotency_key: 'retry-key'
                })
            );

            const idempotencyKeys = [];
            await withServer(
                (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        idempotencyKeys.push(request.headers['idempotency-key']);
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: { message: 'upstream failed', code: 'upstream_failed' } }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--input', inputPath, '--manifest', manifestPath, '--max-attempts', '2'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(result.stderr.trim(), '');
                    assert.deepEqual(idempotencyKeys, ['retry-key', 'retry-key-attempt-2']);
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.failure_summary.count, 1);
                    assert.equal(body.failure_summary.tasks[0].id, 'retry-generate');
                    assert.equal(body.resume_fix_list[0].previous_idempotency_key, 'retry-key');
                    assert.equal(body.resume_fix_list[0].suggested_idempotency_key, 'retry-key-attempt-3');
                    assert.equal(body.results[0].attempt, 2);
                    assert.equal(body.results[0].root_idempotency_key, 'retry-key');

                    const manifestLines = readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
                    assert.equal(manifestLines.length, 2);
                    assert.equal(manifestLines[0].idempotency_key, 'retry-key');
                    assert.equal(manifestLines[0].attempt, 1);
                    assert.equal(manifestLines[1].idempotency_key, 'retry-key-attempt-2');
                    assert.equal(manifestLines[1].root_idempotency_key, 'retry-key');
                    assert.equal(manifestLines[1].attempt, 2);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('preserves the retry suffix when long batch idempotency keys are truncated', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-retry-long-key-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            const longKey = 'k'.repeat(198);
            writeFileSync(
                inputPath,
                JSON.stringify({
                    id: 'retry-generate-long-key',
                    prompt: 'prompt',
                    idempotency_key: longKey
                })
            );

            const idempotencyKeys = [];
            await withServer(
                (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        idempotencyKeys.push(request.headers['idempotency-key']);
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: { message: 'upstream failed', code: 'upstream_failed' } }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--input', inputPath, '--manifest', manifestPath, '--max-attempts', '3'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(idempotencyKeys.length, 3);
                    assert.equal(idempotencyKeys[1].length, 200);
                    assert.equal(idempotencyKeys[1].endsWith('-attempt-2'), true);
                    assert.equal(idempotencyKeys[2].length, 200);
                    assert.equal(idempotencyKeys[2].endsWith('-attempt-3'), true);
                    assert.notEqual(idempotencyKeys[1], idempotencyKeys[2]);
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.resume_fix_list[0].suggested_idempotency_key.endsWith('-attempt-4'), true);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('keeps truncated batch retry idempotency keys distinct when long roots share a prefix', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-retry-collision-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            const sharedPrefix = 'shared-key-'.padEnd(199, 'x');
            const firstKey = `${sharedPrefix}a`;
            const secondKey = `${sharedPrefix}b`;
            writeFileSync(
                inputPath,
                [
                    JSON.stringify({ id: 'first-long-key', prompt: 'first', idempotency_key: firstKey }),
                    JSON.stringify({ id: 'second-long-key', prompt: 'second', idempotency_key: secondKey })
                ].join('\n')
            );

            const idempotencyKeys = [];
            await withServer(
                (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        idempotencyKeys.push(request.headers['idempotency-key']);
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: { message: 'upstream failed', code: 'upstream_failed' } }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        ['--allow-billable', '--input', inputPath, '--manifest', manifestPath, '--max-attempts', '2'],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(idempotencyKeys.length, 4);
                    assert.equal(idempotencyKeys[1].length, 200);
                    assert.equal(idempotencyKeys[3].length, 200);
                    assert.equal(idempotencyKeys[1].endsWith('-attempt-2'), true);
                    assert.equal(idempotencyKeys[3].endsWith('-attempt-2'), true);
                    assert.notEqual(idempotencyKeys[1], idempotencyKeys[3]);
                }
            );
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('stops batch execution after max consecutive failures and leaves later tasks resumable', async () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'gpt-image-batch-circuit-breaker-'));
        try {
            const inputPath = join(tempRoot, 'tasks.jsonl');
            const manifestPath = join(tempRoot, 'manifest.jsonl');
            writeFileSync(
                inputPath,
                [
                    JSON.stringify({ id: 'first-fail', prompt: 'first', idempotency_key: 'first-key' }),
                    JSON.stringify({ id: 'second-skip', prompt: 'second', idempotency_key: 'second-key' })
                ].join('\n')
            );

            const idempotencyKeys = [];
            await withServer(
                (request, response) => {
                    if (request.url === '/api/agent/capabilities') {
                        response.writeHead(200, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (request.url === '/api/agent/images/generate') {
                        idempotencyKeys.push(request.headers['idempotency-key']);
                        response.writeHead(500, { 'content-type': 'application/json' });
                        response.end(JSON.stringify({ error: 'upstream failed' }));
                        return;
                    }
                    response.writeHead(404, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'missing' }));
                },
                async (baseUrl) => {
                    const result = await runSkillScriptAsync(
                        'batch-images.mjs',
                        [
                            '--allow-billable',
                            '--input',
                            inputPath,
                            '--manifest',
                            manifestPath,
                            '--max-consecutive-failures',
                            '1'
                        ],
                        { GPT_IMAGE_PLAYGROUND_URL: baseUrl }
                    );

                    assert.equal(result.status, 1);
                    assert.equal(result.stderr.trim(), '');
                    assert.deepEqual(idempotencyKeys, ['first-key']);
                    const body = JSON.parse(result.stdout);
                    assert.equal(body.failed, 1);
                    assert.equal(body.results[0].status, 'failed');
                    assert.equal(body.results[1].status, 'skipped');
                    assert.equal(body.results[1].skipped_reason, 'max_consecutive_failures');
                    assert.equal(body.results[1].billable, false);
                    assert.equal(body.failure_summary.count, 1);

                    const manifestLines = readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
                    assert.equal(manifestLines.length, 2);
                    assert.equal(manifestLines[0].status, 'failed');
                    assert.equal(manifestLines[1].status, 'skipped');
                    assert.equal(manifestLines[1].skipped_reason, 'max_consecutive_failures');
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

            const invalidModelInputPath = join(tempRoot, 'invalid-model.jsonl');
            writeFileSync(
                invalidModelInputPath,
                JSON.stringify({
                    id: 'invalid-model',
                    prompt: 'prompt',
                    model: 'bad-model',
                    size: '2048x2048'
                })
            );
            const invalidModelResult = runSkillScript('batch-images.mjs', ['--input', invalidModelInputPath]);
            assert.equal(invalidModelResult.status, 2);
            assert.match(invalidModelResult.stderr, /invalid-model\.model 的值无效：bad-model/);
            assert.equal(invalidModelResult.stdout.trim(), '');

            const pngCompressionInputPath = join(tempRoot, 'png-compression.jsonl');
            writeFileSync(
                pngCompressionInputPath,
                JSON.stringify({
                    id: 'png-compression',
                    prompt: 'prompt',
                    output_format: 'png',
                    output_compression: 80
                })
            );
            const pngCompressionResult = runSkillScript('batch-images.mjs', ['--input', pngCompressionInputPath]);
            assert.equal(pngCompressionResult.status, 0);
            assert.equal(pngCompressionResult.stderr.trim(), '');
            const pngCompressionBody = JSON.parse(pngCompressionResult.stdout);
            assert.equal(
                pngCompressionBody.tasks[0].request.normalizations.output_compression_ignored_for_png,
                true
            );
            assert.equal(pngCompressionBody.tasks[0].request.output_compression, undefined);

            const conflictingFormatInputPath = join(tempRoot, 'conflicting-format.jsonl');
            writeFileSync(
                conflictingFormatInputPath,
                JSON.stringify({
                    id: 'conflicting-format',
                    prompt: 'prompt',
                    output_format: 'png',
                    format: 'webp'
                })
            );
            const conflictingFormatResult = runSkillScript('batch-images.mjs', ['--input', conflictingFormatInputPath]);
            assert.equal(conflictingFormatResult.status, 2);
            assert.match(conflictingFormatResult.stderr, /conflicting-format\.output_format 与 format 不能同时设置/);
            assert.equal(conflictingFormatResult.stdout.trim(), '');

            const editFormatInputPath = join(tempRoot, 'edit-format.jsonl');
            writeFileSync(
                editFormatInputPath,
                JSON.stringify({
                    id: 'edit-format',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_path: 'source.png',
                    size: '1024x1024',
                    output_format: 'jpeg'
                })
            );
            const editFormatResult = runSkillScript('batch-images.mjs', ['--input', editFormatInputPath]);
            assert.equal(editFormatResult.status, 0);
            assert.equal(editFormatResult.stderr.trim(), '');
            const editFormatBody = JSON.parse(editFormatResult.stdout);
            assert.equal(editFormatBody.tasks[0].routing.transport, 'page_sse');
            assert.match(editFormatBody.tasks[0].routing.reason, /GPT2Image-compatible edit options/);
            assert.equal(editFormatBody.tasks[0].request.output_format, 'jpeg');

            const editBackendInputPath = join(tempRoot, 'edit-backend.jsonl');
            writeFileSync(
                editBackendInputPath,
                JSON.stringify({
                    id: 'edit-backend',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_path: 'source.png',
                    image_backend: 'responses-image-generation'
                })
            );
            const editBackendResult = runSkillScript('batch-images.mjs', ['--input', editBackendInputPath]);
            assert.equal(editBackendResult.status, 0);
            assert.equal(editBackendResult.stderr.trim(), '');
            const editBackendBody = JSON.parse(editBackendResult.stdout);
            assert.equal(editBackendBody.tasks[0].routing.transport, 'page_sse');
            assert.equal(editBackendBody.tasks[0].request.image_backend, 'responses-image-generation');

            const editBackgroundInputPath = join(tempRoot, 'edit-background.jsonl');
            writeFileSync(
                editBackgroundInputPath,
                JSON.stringify({
                    id: 'edit-background',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_path: 'source.png',
                    background: 'opaque'
                })
            );
            const editBackgroundResult = runSkillScript('batch-images.mjs', ['--input', editBackgroundInputPath]);
            assert.equal(editBackgroundResult.status, 2);
            assert.match(editBackgroundResult.stderr, /edit-background\.background 仅适用于 generate 任务/);
            assert.equal(editBackgroundResult.stdout.trim(), '');

            const editResponsesModelInputPath = join(tempRoot, 'edit-responses-model.jsonl');
            writeFileSync(
                editResponsesModelInputPath,
                JSON.stringify({
                    id: 'edit-responses-model',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_path: 'source.png',
                    responsesModel: 'gpt-4.1'
                })
            );
            const editResponsesModelResult = runSkillScript('batch-images.mjs', ['--input', editResponsesModelInputPath]);
            assert.equal(editResponsesModelResult.status, 2);
            assert.match(
                editResponsesModelResult.stderr,
                /edit-responses-model\.responsesModel 必须同时设置 image_backend=responses-image-generation/
            );
            assert.equal(editResponsesModelResult.stdout.trim(), '');

            const generateImagePathInputPath = join(tempRoot, 'generate-image-path.jsonl');
            writeFileSync(
                generateImagePathInputPath,
                JSON.stringify({
                    id: 'generate-image-path',
                    mode: 'generate',
                    prompt: 'prompt',
                    image_path: 'source.png'
                })
            );
            const generateImagePathResult = runSkillScript('batch-images.mjs', ['--input', generateImagePathInputPath]);
            assert.equal(generateImagePathResult.status, 2);
            assert.match(generateImagePathResult.stderr, /generate-image-path\.image_path 仅适用于 edit 任务/);
            assert.equal(generateImagePathResult.stdout.trim(), '');

            const camelCaseBackendInputPath = join(tempRoot, 'camel-case-backend.jsonl');
            writeFileSync(
                camelCaseBackendInputPath,
                JSON.stringify({
                    id: 'camel-case-backend',
                    prompt: 'prompt',
                    imageBackend: 'responses'
                })
            );
            const camelCaseBackendResult = runSkillScript('batch-images.mjs', ['--input', camelCaseBackendInputPath]);
            assert.equal(camelCaseBackendResult.status, 2);
            assert.match(camelCaseBackendResult.stderr, /camel-case-backend\.imageBackend 不是支持的 batch JSONL 字段/);
            assert.equal(camelCaseBackendResult.stdout.trim(), '');

            const camelCaseResponseModeInputPath = join(tempRoot, 'camel-case-response-mode.jsonl');
            writeFileSync(
                camelCaseResponseModeInputPath,
                JSON.stringify({
                    id: 'camel-case-response-mode',
                    prompt: 'prompt',
                    responseMode: 'both'
                })
            );
            const camelCaseResponseModeResult = runSkillScript('batch-images.mjs', [
                '--input',
                camelCaseResponseModeInputPath
            ]);
            assert.equal(camelCaseResponseModeResult.status, 2);
            assert.match(
                camelCaseResponseModeResult.stderr,
                /camel-case-response-mode\.responseMode 不是支持的 batch JSONL 字段/
            );
            assert.equal(camelCaseResponseModeResult.stdout.trim(), '');

            const numericImagePathInputPath = join(tempRoot, 'numeric-image-path.jsonl');
            writeFileSync(
                numericImagePathInputPath,
                JSON.stringify({
                    id: 'numeric-image-path',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_path: 123
                })
            );
            const numericImagePathResult = runSkillScript('batch-images.mjs', ['--input', numericImagePathInputPath]);
            assert.equal(numericImagePathResult.status, 2);
            assert.match(numericImagePathResult.stderr, /numeric-image-path\.image_path 必须是非空字符串/);
            assert.equal(numericImagePathResult.stdout.trim(), '');

            const emptyImagePathsInputPath = join(tempRoot, 'empty-image-paths.jsonl');
            writeFileSync(
                emptyImagePathsInputPath,
                JSON.stringify({
                    id: 'empty-image-paths',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_paths: []
                })
            );
            const emptyImagePathsResult = runSkillScript('batch-images.mjs', ['--input', emptyImagePathsInputPath]);
            assert.equal(emptyImagePathsResult.status, 2);
            assert.match(emptyImagePathsResult.stderr, /empty-image-paths\.image_paths 必须是非空字符串数组/);
            assert.equal(emptyImagePathsResult.stdout.trim(), '');

            const invalidImagePathsInputPath = join(tempRoot, 'invalid-image-paths.jsonl');
            writeFileSync(
                invalidImagePathsInputPath,
                JSON.stringify({
                    id: 'invalid-image-paths',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_paths: ['source.png', 123]
                })
            );
            const invalidImagePathsResult = runSkillScript('batch-images.mjs', ['--input', invalidImagePathsInputPath]);
            assert.equal(invalidImagePathsResult.status, 2);
            assert.match(invalidImagePathsResult.stderr, /invalid-image-paths\.image_paths\[1\] 必须是非空字符串/);
            assert.equal(invalidImagePathsResult.stdout.trim(), '');

            const conflictingImagePathsInputPath = join(tempRoot, 'conflicting-image-paths.jsonl');
            writeFileSync(
                conflictingImagePathsInputPath,
                JSON.stringify({
                    id: 'conflicting-image-paths',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_path: 'source.png',
                    image_paths: ['source-a.png']
                })
            );
            const conflictingImagePathsResult = runSkillScript('batch-images.mjs', [
                '--input',
                conflictingImagePathsInputPath
            ]);
            assert.equal(conflictingImagePathsResult.status, 2);
            assert.match(
                conflictingImagePathsResult.stderr,
                /conflicting-image-paths\.image_path 与 image_paths 不能同时设置/
            );
            assert.equal(conflictingImagePathsResult.stdout.trim(), '');

            const invalidMaskInputPath = join(tempRoot, 'invalid-mask.jsonl');
            writeFileSync(
                invalidMaskInputPath,
                JSON.stringify({
                    id: 'invalid-mask',
                    mode: 'edit',
                    prompt: 'prompt',
                    image_path: 'source.png',
                    mask_path: {}
                })
            );
            const invalidMaskResult = runSkillScript('batch-images.mjs', ['--input', invalidMaskInputPath]);
            assert.equal(invalidMaskResult.status, 2);
            assert.match(invalidMaskResult.stderr, /invalid-mask\.mask_path 必须是非空字符串/);
            assert.equal(invalidMaskResult.stdout.trim(), '');

            const transparentInputPath = join(tempRoot, 'transparent.jsonl');
            writeFileSync(
                transparentInputPath,
                JSON.stringify({
                    id: 'transparent-background',
                    prompt: 'prompt',
                    background: 'transparent'
                })
            );
            const transparentResult = runSkillScript('batch-images.mjs', ['--input', transparentInputPath]);
            assert.equal(transparentResult.status, 2);
            assert.match(transparentResult.stderr, /transparent-background\.background 对 gpt-image-2 无效/);
            assert.equal(transparentResult.stdout.trim(), '');

            const stringPageSseInputPath = join(tempRoot, 'string-page-sse.jsonl');
            writeFileSync(
                stringPageSseInputPath,
                JSON.stringify({
                    id: 'string-page-sse',
                    prompt: 'prompt',
                    page_sse: 'true'
                })
            );
            const stringPageSseResult = runSkillScript('batch-images.mjs', ['--input', stringPageSseInputPath]);
            assert.equal(stringPageSseResult.status, 2);
            assert.match(stringPageSseResult.stderr, /string-page-sse\.page_sse 必须是布尔值/);
            assert.equal(stringPageSseResult.stdout.trim(), '');

            const stringComplexUiInputPath = join(tempRoot, 'string-complex-ui.jsonl');
            writeFileSync(
                stringComplexUiInputPath,
                JSON.stringify({
                    id: 'string-complex-ui',
                    prompt: 'prompt',
                    complex_ui: 'true'
                })
            );
            const stringComplexUiResult = runSkillScript('batch-images.mjs', ['--input', stringComplexUiInputPath]);
            assert.equal(stringComplexUiResult.status, 2);
            assert.match(stringComplexUiResult.stderr, /string-complex-ui\.complex_ui 必须是布尔值/);
            assert.equal(stringComplexUiResult.stdout.trim(), '');

            const numericResumeInputPath = join(tempRoot, 'numeric-resume.jsonl');
            writeFileSync(
                numericResumeInputPath,
                JSON.stringify({
                    id: 'numeric-resume',
                    prompt: 'prompt',
                    resume_or_recover: 1
                })
            );
            const numericResumeResult = runSkillScript('batch-images.mjs', ['--input', numericResumeInputPath]);
            assert.equal(numericResumeResult.status, 2);
            assert.match(numericResumeResult.stderr, /numeric-resume\.resume_or_recover 必须是布尔值/);
            assert.equal(numericResumeResult.stdout.trim(), '');

            const unsupportedTransportInputPath = join(tempRoot, 'unsupported-transport.jsonl');
            writeFileSync(
                unsupportedTransportInputPath,
                JSON.stringify({
                    id: 'unsupported-transport',
                    prompt: 'prompt',
                    transport: 'agent_json'
                })
            );
            const unsupportedTransportResult = runSkillScript('batch-images.mjs', ['--input', unsupportedTransportInputPath]);
            assert.equal(unsupportedTransportResult.status, 2);
            assert.match(unsupportedTransportResult.stderr, /unsupported-transport\.transport 必须是 page_sse/);
            assert.equal(unsupportedTransportResult.stdout.trim(), '');

            const responsesModelNonStreamInputPath = join(tempRoot, 'responses-model-non-stream.jsonl');
            writeFileSync(
                responsesModelNonStreamInputPath,
                JSON.stringify({
                    id: 'responses-model-non-stream',
                    prompt: 'prompt',
                    image_backend: 'responses-image-generation',
                    responsesModel: 'gpt-4.1',
                    stream_mode: 'non_stream'
                })
            );
            const responsesModelNonStreamResult = runSkillScript('batch-images.mjs', [
                '--input',
                responsesModelNonStreamInputPath
            ]);
            assert.equal(responsesModelNonStreamResult.status, 2);
            assert.match(responsesModelNonStreamResult.stderr, /responses-model-non-stream\.responsesModel 需要页面 SSE 路径/);
            assert.equal(responsesModelNonStreamResult.stdout.trim(), '');

            const responsesModelWithoutBackendInputPath = join(tempRoot, 'responses-model-without-backend.jsonl');
            writeFileSync(
                responsesModelWithoutBackendInputPath,
                JSON.stringify({
                    id: 'responses-model-without-backend',
                    prompt: 'prompt',
                    responsesModel: 'gpt-4.1'
                })
            );
            const responsesModelWithoutBackendResult = runSkillScript('batch-images.mjs', [
                '--input',
                responsesModelWithoutBackendInputPath
            ]);
            assert.equal(responsesModelWithoutBackendResult.status, 2);
            assert.match(
                responsesModelWithoutBackendResult.stderr,
                /responses-model-without-backend\.responsesModel 必须同时设置 image_backend=responses-image-generation/
            );
            assert.equal(responsesModelWithoutBackendResult.stdout.trim(), '');

            const responsesModelImagesBackendInputPath = join(tempRoot, 'responses-model-images-backend.jsonl');
            writeFileSync(
                responsesModelImagesBackendInputPath,
                JSON.stringify({
                    id: 'responses-model-images-backend',
                    prompt: 'prompt',
                    image_backend: 'images-api',
                    responsesModel: 'gpt-4.1'
                })
            );
            const responsesModelImagesBackendResult = runSkillScript('batch-images.mjs', [
                '--input',
                responsesModelImagesBackendInputPath
            ]);
            assert.equal(responsesModelImagesBackendResult.status, 2);
            assert.match(
                responsesModelImagesBackendResult.stderr,
                /responses-model-images-backend\.responsesModel 仅适用于 image_backend=responses-image-generation/
            );
            assert.equal(responsesModelImagesBackendResult.stdout.trim(), '');

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

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

async function waitWithTimeout(promise, timeoutMs, message) {
    let timeout;
    const timeoutPromise = new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
            reject(new Error(message));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeout);
    }
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
