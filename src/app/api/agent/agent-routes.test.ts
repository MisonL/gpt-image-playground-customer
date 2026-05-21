import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';
import { Pool } from 'pg';

const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

let originalEnv: NodeJS.ProcessEnv;
let originalCwd = '';
let tempDir = '';

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv) {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) {
            delete process.env[key];
        }
    }

    for (const [key, value] of Object.entries(snapshot)) {
        process.env[key] = value;
    }
}

beforeEach(async () => {
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-routes-'));
    process.chdir(tempDir);
    process.env.AGENT_STATE_BACKEND = 'sqlite';
    process.env.AGENT_SQLITE_PATH = path.join(tempDir, 'agent.sqlite');
    process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE = 'fs';
    delete process.env.APP_PASSWORD;
    delete process.env.AGENT_API_TOKEN;
    delete process.env.OPENAI_CHANNEL_1_API_KEYS;
    delete process.env.OPENAI_CHANNEL_1_BASE_URL;
});

afterEach(async () => {
    const { resetAgentStateStoreForTests, setAgentStateStoreFactoryForTests } = await import('@/lib/agent-state-runtime');
    const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
    restoreProcessEnv(originalEnv);
    process.chdir(originalCwd);
    setAgentStateStoreFactoryForTests(undefined);
    resetAgentStateStoreForTests();
    resetServerChannelStateForTests();
    await rm(tempDir, { recursive: true, force: true });
});

describe('Agent route integration', () => {
    it('reports configured Agent auth without exposing secret values', async () => {
        const { getCapabilities } = await loadAgentRoutes();
        process.env.AGENT_STATE_BACKEND = 'memory';
        process.env.AGENT_API_TOKEN = 'capability-token';
        process.env.APP_PASSWORD = 'page-access-code';

        const response = await getCapabilities();
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.auth.required, true);
        assert.deepEqual(body.auth.schemes, ['bearer']);
        assert.equal(JSON.stringify(body).includes('capability-token'), false);
        assert.equal(JSON.stringify(body).includes('page-access-code'), false);
        assert.equal(body.defaults.state_backend, 'memory');
    });

    it('does not report auth as required for blank Agent auth settings', async () => {
        const { getCapabilities } = await loadAgentRoutes();
        process.env.AGENT_API_TOKEN = '   ';
        process.env.APP_PASSWORD = '   ';

        const response = await getCapabilities();
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.auth.required, false);
        assert.deepEqual(body.auth.schemes, []);
    });

    it('generates through a compatible upstream once and replays the cached response for the same idempotency key', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            return {
                data: [{ b64_json: PNG_BASE64 }],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
            };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        const first = await generateImage(agentJsonRequest('route-cache-key', { prompt: 'agent route success' }));
        assert.equal(first.status, 200);
        const firstBody = await first.json();
        assert.equal(firstBody.cached, false);
        assert.equal(firstBody.images.length, 1);
        assert.ok(firstBody.images[0].content_url);
        assert.equal('b64_json' in firstBody.images[0], false);

        const second = await generateImage(agentJsonRequest('route-cache-key', { prompt: 'agent route success' }));
        assert.equal(second.status, 200);
        const secondBody = await second.json();
        assert.equal(secondBody.cached, true);
        assert.equal(second.headers.get('x-idempotent-replay'), 'true');
        assert.equal(second.headers.get('x-request-id'), firstBody.request_id);
        assert.equal(secondBody.request_id, firstBody.request_id);
        assert.equal(upstreamCalls, 1);

        await upstream.close();
    });

    it('does not send upstream stream parameters when Agent streaming_strategy is off', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamBody = '';
        const upstream = await startImageUpstream((body) => {
            upstreamBody = body;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-upstream-stream-off-key', {
                    prompt: 'agent upstream stream off',
                    streaming_strategy: 'off'
                })
            );

            assert.equal(response.status, 200);
            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, false);
            assert.equal(Object.hasOwn(upstreamJson, 'partial_images'), false);
        } finally {
            await upstream.close();
        }
    });

    it('consumes upstream image SSE internally while keeping the Agent generate response non-streaming', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream((body) => {
            upstreamBody = body;
            return [
                {
                    event: 'image_generation.partial_image',
                    data: { type: 'image_generation.partial_image', b64_json: 'agent-partial-base64' }
                },
                {
                    event: 'image_generation.completed',
                    data: { type: 'image_generation.completed', b64_json: PNG_BASE64 }
                }
            ];
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-upstream-sse-key', {
                    prompt: 'agent upstream sse',
                    response_mode: 'base64',
                    streaming_strategy: 'newapi-keepalive-sse',
                    partial_images: 2
                })
            );

            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            const body = await response.json();
            assert.equal(body.cached, false);
            assert.equal(body.images[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody);
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('uses force-sse for Agent upstream image SSE while keeping the final JSON contract', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream((body) => {
            upstreamBody = body;
            return [
                {
                    event: 'image_generation.completed',
                    data: { type: 'image_generation.completed', b64_json: PNG_BASE64 }
                }
            ];
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-force-sse-key', {
                    prompt: 'agent force sse',
                    response_mode: 'base64',
                    streaming_strategy: 'force-sse',
                    partial_images: 3
                })
            );

            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            const body = await response.json();
            assert.equal(body.images[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 3);
        } finally {
            await upstream.close();
        }
    });

    it('consumes Responses image_generation SSE internally while keeping the Agent generate response non-streaming', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamBody = '';
        const upstream = await startStreamingResponsesImageUpstream((body) => {
            upstreamBody = body;
            return [
                {
                    event: 'response.image_generation_call.partial_image',
                    data: {
                        type: 'response.image_generation_call.partial_image',
                        partial_image_b64: 'agent-responses-partial-base64',
                        partial_image_index: 0
                    }
                },
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        item: {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    }
                }
            ];
        });
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-5.4';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-responses-upstream-sse-key', {
                    prompt: 'agent responses upstream sse',
                    response_mode: 'base64',
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'responses-sse',
                    partial_images: 2
                })
            );

            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            const body = await response.json();
            assert.equal(body.cached, false);
            assert.equal(body.images[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-5.4');
            assert.equal(upstreamJson.stream, true);
            const tools = upstreamJson.tools as Array<Record<string, unknown>>;
            assert.equal(tools[0].type, 'image_generation');
            assert.equal(tools[0].partial_images, 2);
        } finally {
            await upstream.close();
        }
    });

    it('uses force-sse for Agent Responses image_generation SSE while keeping the final JSON contract', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamBody = '';
        const upstream = await startStreamingResponsesImageUpstream((body) => {
            upstreamBody = body;
            return [
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        item: {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    }
                }
            ];
        });
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-5.4';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-responses-force-sse-key', {
                    prompt: 'agent responses force sse',
                    response_mode: 'base64',
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'force-sse',
                    partial_images: 3
                })
            );

            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            const body = await response.json();
            assert.equal(body.images[0].b64_json, PNG_BASE64);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-5.4');
            assert.equal(upstreamJson.stream, true);
            const tools = upstreamJson.tools as Array<Record<string, unknown>>;
            assert.equal(tools[0].type, 'image_generation');
            assert.equal(tools[0].partial_images, 3);
        } finally {
            await upstream.close();
        }
    });

    it('fails Agent Responses upstream SSE requests when partial images arrive without a final image', async () => {
        const { generateImage } = await loadAgentRoutes();
        const upstream = await startStreamingResponsesImageUpstream(() => [
            {
                event: 'response.image_generation_call.partial_image',
                data: {
                    type: 'response.image_generation_call.partial_image',
                    partial_image_b64: 'agent-responses-partial-only',
                    partial_image_index: 0
                }
            }
        ]);
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-5.4';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-responses-upstream-sse-partial-only-key', {
                    prompt: 'agent responses upstream sse partial only',
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'responses-sse',
                    partial_images: 2
                })
            );

            assert.equal(response.status, 502);
            const body = await response.json();
            assert.equal(body.error.code, 'upstream_unavailable');
            assert.match(body.error.message, /最终图片 b64_json/);
            assert.equal(JSON.stringify(body).includes('agent-responses-partial-only'), false);
        } finally {
            await upstream.close();
        }
    });

    it('fails Agent Responses upstream SSE requests when the image_generation_call fails', async () => {
        const { generateImage } = await loadAgentRoutes();
        const upstream = await startStreamingResponsesImageUpstream(() => [
            {
                event: 'response.output_item.done',
                data: {
                    type: 'response.output_item.done',
                    item: {
                        type: 'image_generation_call',
                        status: 'failed',
                        error: {
                            code: 'content_policy_violation',
                            message: 'blocked by upstream policy'
                        }
                    }
                }
            }
        ]);
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-5.4';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-responses-upstream-sse-failed-call-key', {
                    prompt: 'agent responses upstream sse failed call',
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'responses-sse',
                    partial_images: 2
                })
            );

            assert.equal(response.status, 502);
            const body = await response.json();
            assert.equal(body.error.code, 'upstream_unavailable');
            assert.match(body.error.message, /blocked by upstream policy/);
        } finally {
            await upstream.close();
        }
    });

    it('fails Agent upstream SSE requests when partial images arrive without a final image', async () => {
        const { generateImage } = await loadAgentRoutes();
        const upstream = await startStreamingImageUpstream(() => [
            {
                event: 'image_generation.partial_image',
                data: { type: 'image_generation.partial_image', b64_json: 'agent-partial-only' }
            }
        ]);
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const response = await generateImage(
                agentJsonRequest('agent-upstream-sse-partial-only-key', {
                    prompt: 'agent upstream sse partial only',
                    streaming_strategy: 'newapi-keepalive-sse',
                    partial_images: 2
                })
            );

            assert.equal(response.status, 502);
            const body = await response.json();
            assert.equal(body.error.code, 'upstream_unavailable');
            assert.match(body.error.message, /最终图片 b64_json/);
        } finally {
            await upstream.close();
        }
    });

    it('generates and replays through the memory state backend without creating SQLite state', async () => {
        process.env.AGENT_STATE_BACKEND = 'memory';
        delete process.env.AGENT_SQLITE_PATH;
        const { generateImage } = await loadAgentRoutes();
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const first = await generateImage(agentJsonRequest('route-memory-cache-key', { prompt: 'agent memory route success' }));
            assert.equal(first.status, 200);
            const firstBody = await first.json();
            assert.equal(firstBody.cached, false);

            const second = await generateImage(agentJsonRequest('route-memory-cache-key', { prompt: 'agent memory route success' }));
            assert.equal(second.status, 200);
            const secondBody = await second.json();
            assert.equal(secondBody.cached, true);
            assert.equal(second.headers.get('x-idempotent-replay'), 'true');
            assert.equal(secondBody.request_id, firstBody.request_id);
            assert.equal(upstreamCalls, 1);
            assert.deepEqual(await listAgentStateFiles(), []);
        } finally {
            await upstream.close();
        }
    });

    it('returns explicit base64 without storing complete base64 in the request state', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        const first = await generateImage(
            agentJsonRequest('route-base64-key', {
                prompt: 'agent route base64',
                response_mode: 'base64'
            })
        );
        assert.equal(first.status, 200);
        const firstBody = await first.json();
        assert.equal(firstBody.cached, false);
        assert.equal(firstBody.images[0].b64_json, PNG_BASE64);

        const storedResponse = readStoredResponseJson('route-base64-key');
        assert.equal(storedResponse.includes(PNG_BASE64), false);
        assert.equal(storedResponse.includes('b64_json'), false);

        const second = await generateImage(
            agentJsonRequest('route-base64-key', {
                prompt: 'agent route base64',
                response_mode: 'base64'
            })
        );
        assert.equal(second.status, 200);
        const secondBody = await second.json();
        assert.equal(secondBody.cached, true);
        assert.equal(secondBody.images[0].b64_json, PNG_BASE64);
        assert.equal(upstreamCalls, 1);

        await upstream.close();
    });

    it('returns field-level errors for invalid generate JSON requests', async () => {
        const { generateImage } = await loadAgentRoutes();

        const response = await generateImage(
            agentJsonRequest('route-validation-key', {
                prompt: '',
                n: 99,
                response_mode: 'url'
            })
        );

        assert.equal(response.status, 422);
        const body = await response.json();
        assert.equal(body.error.code, 'validation_error');
        assert.match(body.error.details.fields.prompt, /必填/);
        assert.match(body.error.details.fields.n, /1 到 10/);
        assert.match(body.error.details.fields.response_mode, /path/);
    });

    it('returns validation errors for malformed generate JSON requests', async () => {
        const { generateImage } = await loadAgentRoutes();

        const response = await generateImage(
            new Request('http://localhost/api/agent/images/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': 'route-malformed-json-key'
                },
                body: '{"prompt":'
            })
        );

        assert.equal(response.status, 422);
        const body = await response.json();
        assert.equal(body.error.code, 'validation_error');
        assert.equal(body.error.retryable, false);
    });

    it('returns sanitized upstream diagnostics for failed generate requests', async () => {
        const { generateImage } = await loadAgentRoutes();
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            throw new Error('upstream failed');
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const idempotencyKey = 'route-upstream-diagnostics-key';
            const response = await generateImage(agentJsonRequest(idempotencyKey, { prompt: 'diagnostics' }));
            assert.equal(response.status, 502);
            const body = await response.json();
            assert.equal(body.error.code, 'upstream_unavailable');
            assert.equal(body.error.upstream_status, 500);
            assert.equal(body.error.diagnostics.upstream_status, 500);
            assert.equal(body.error.diagnostics.selected_channel_id, 'default');
            assert.match(body.error.diagnostics.upstream_host, /^127\.0\.0\.1:\d+$/);
            assert.equal(body.error.diagnostics.channel_cooldown_scope, 'channel');
            assert.equal(typeof body.error.diagnostics.elapsed_ms, 'number');
            assert.equal(JSON.stringify(body).includes('test-key'), false);
            const upstreamCallsAfterFirstFailure = upstreamCalls;

            const replay = await generateImage(agentJsonRequest(idempotencyKey, { prompt: 'diagnostics' }));
            assert.equal(replay.status, 502);
            assert.equal(replay.headers.get('x-idempotent-replay'), 'true');
            assert.equal(replay.headers.get('x-request-id'), body.error.request_id);
            const replayBody = await replay.json();
            assert.equal(replayBody.error.code, 'upstream_unavailable');
            assert.equal(replayBody.error.retryable, false);
            assert.equal(replayBody.error.request_id, body.error.request_id);
            assert.equal(upstreamCalls, upstreamCallsAfterFirstFailure);
        } finally {
            await upstream.close();
        }
    });

    it('creates a generate job, exposes running status, and returns the completed result', async () => {
        const { createGenerateJob, getJob, getJobResult } = await loadAgentRoutes();
        let releaseUpstream: (() => void) | undefined;
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(async () => {
            upstreamCalls += 1;
            await new Promise<void>((resolve) => {
                releaseUpstream = resolve;
            });
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const created = await createGenerateJob(agentJobJsonRequest('route-job-key', { prompt: 'agent route job' }));
            assert.equal(created.status, 202);
            const createdBody = await created.json();
            assert.equal(createdBody.job.state, 'running');
            assert.equal(createdBody.job.idempotency_key, 'route-job-key');
            assert.equal(createdBody.job.result_url, `/api/agent/jobs/${createdBody.job.id}/result`);

            await waitFor(() => upstreamCalls === 1);
            const running = await getJob(new Request(`http://localhost/api/agent/jobs/${createdBody.job.id}`), {
                params: Promise.resolve({ id: createdBody.job.id })
            });
            assert.equal(running.status, 200);
            assert.equal((await running.json()).job.state, 'running');

            releaseUpstream?.();
            const result = await waitForJobResult(getJobResult, createdBody.job.id);
            assert.equal(result.status, 200);
            const resultBody = await result.json();
            assert.equal(resultBody.request_id, createdBody.job.id);
            assert.equal(resultBody.cached, false);
            assert.equal(resultBody.images.length, 1);
            assert.equal('b64_json' in resultBody.images[0], false);
        } finally {
            releaseUpstream?.();
            await upstream.close();
        }
    });

    it('creates a generate job that consumes upstream image SSE and saves the final artifact', async () => {
        const { createGenerateJob, getJobResult, getArtifactContent } = await loadAgentRoutes();
        let upstreamBody = '';
        const upstream = await startStreamingImageUpstream((body) => {
            upstreamBody = body;
            return [
                {
                    event: 'image_generation.partial_image',
                    data: { type: 'image_generation.partial_image', b64_json: 'job-partial-base64' }
                },
                {
                    event: 'image_generation.completed',
                    data: { type: 'image_generation.completed', b64_json: PNG_BASE64 }
                }
            ];
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const created = await createGenerateJob(
                agentJobJsonRequest('route-job-upstream-sse-key', {
                    prompt: 'agent job upstream sse',
                    streaming_strategy: 'newapi-keepalive-sse',
                    partial_images: 2
                })
            );
            assert.equal(created.status, 202);
            const createdBody = await created.json();

            const result = await waitForJobResult(getJobResult, createdBody.job.id);
            assert.equal(result.status, 200);
            assert.notEqual(result.headers.get('content-type'), 'text/event-stream');
            const resultBody = await result.json();
            assert.equal(resultBody.request_id, createdBody.job.id);
            assert.equal(resultBody.cached, false);
            assert.equal(resultBody.images.length, 1);
            assert.equal('b64_json' in resultBody.images[0], false);
            assert.match(resultBody.images[0].content_url, /^\/api\/agent\/artifacts\/[^/]+\/content$/);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.stream, true);
            assert.equal(upstreamJson.partial_images, 2);

            const artifactId = resultBody.images[0].content_url.split('/').at(-2);
            assert.equal(typeof artifactId, 'string');
            const content = await getArtifactContent(
                new Request(`http://localhost/api/agent/artifacts/${artifactId}/content`),
                { params: Promise.resolve({ id: artifactId }) }
            );
            assert.equal(content.status, 200);
            assert.equal(Buffer.compare(Buffer.from(await content.arrayBuffer()), Buffer.from(PNG_BASE64, 'base64')), 0);
        } finally {
            await upstream.close();
        }
    });

    it('fails image upstream SSE generate jobs when partial images arrive without a final image', async () => {
        const { createGenerateJob, getJob, getJobResult } = await loadAgentRoutes();
        const upstream = await startStreamingImageUpstream(() => [
            {
                event: 'image_generation.partial_image',
                data: { type: 'image_generation.partial_image', b64_json: 'job-images-partial-only' }
            }
        ]);
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const created = await createGenerateJob(
                agentJobJsonRequest('route-job-images-missing-final-key', {
                    prompt: 'agent job images partial only',
                    streaming_strategy: 'newapi-keepalive-sse',
                    partial_images: 2
                })
            );
            assert.equal(created.status, 202);
            const createdBody = await created.json();

            const result = await waitForJobResult(getJobResult, createdBody.job.id);
            assert.equal(result.status, 502);
            const resultBody = await result.json();
            assert.equal(resultBody.error.code, 'upstream_unavailable');
            assert.match(resultBody.error.message, /最终图片 b64_json/);
            assert.equal(JSON.stringify(resultBody).includes('job-images-partial-only'), false);

            const status = await getJob(new Request(`http://localhost/api/agent/jobs/${createdBody.job.id}`), {
                params: Promise.resolve({ id: createdBody.job.id })
            });
            assert.equal(status.status, 200);
            const statusBody = await status.json();
            assert.equal(statusBody.job.state, 'failed');
            assert.equal(statusBody.job.error.code, 'upstream_unavailable');
            assert.match(statusBody.job.error.message, /最终图片 b64_json/);
            assert.equal(JSON.stringify(statusBody).includes('job-images-partial-only'), false);
        } finally {
            await upstream.close();
        }
    });

    it('creates a generate job that consumes Responses image_generation SSE and saves the final artifact', async () => {
        const { createGenerateJob, getJobResult, getArtifactContent } = await loadAgentRoutes();
        let upstreamBody = '';
        const upstream = await startStreamingResponsesImageUpstream((body) => {
            upstreamBody = body;
            return [
                {
                    event: 'response.image_generation_call.partial_image',
                    data: {
                        type: 'response.image_generation_call.partial_image',
                        partial_image_b64: 'job-responses-partial-base64',
                        partial_image_index: 0
                    }
                },
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        item: {
                            type: 'image_generation_call',
                            status: 'completed',
                            result: PNG_BASE64
                        }
                    }
                }
            ];
        });
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-5.4';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const created = await createGenerateJob(
                agentJobJsonRequest('route-job-responses-upstream-sse-key', {
                    prompt: 'agent job responses upstream sse',
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'responses-sse',
                    partial_images: 2
                })
            );
            assert.equal(created.status, 202);
            const createdBody = await created.json();

            const result = await waitForJobResult(getJobResult, createdBody.job.id);
            assert.equal(result.status, 200);
            assert.notEqual(result.headers.get('content-type'), 'text/event-stream');
            const resultBody = await result.json();
            assert.equal(resultBody.request_id, createdBody.job.id);
            assert.equal(resultBody.cached, false);
            assert.equal(resultBody.images.length, 1);
            assert.equal('b64_json' in resultBody.images[0], false);
            assert.match(resultBody.images[0].content_url, /^\/api\/agent\/artifacts\/[^/]+\/content$/);

            const upstreamJson = JSON.parse(upstreamBody) as Record<string, unknown>;
            assert.equal(upstreamJson.model, 'gpt-5.4');
            assert.equal(upstreamJson.stream, true);
            assert.equal((upstreamJson.tool_choice as Record<string, unknown>).type, 'image_generation');
            const tools = upstreamJson.tools as Array<Record<string, unknown>>;
            assert.equal(tools[0].type, 'image_generation');
            assert.equal(tools[0].partial_images, 2);

            const artifactId = resultBody.images[0].content_url.split('/').at(-2);
            assert.equal(typeof artifactId, 'string');
            const content = await getArtifactContent(
                new Request(`http://localhost/api/agent/artifacts/${artifactId}/content`),
                { params: Promise.resolve({ id: artifactId }) }
            );
            assert.equal(content.status, 200);
            assert.equal(Buffer.compare(Buffer.from(await content.arrayBuffer()), Buffer.from(PNG_BASE64, 'base64')), 0);
        } finally {
            await upstream.close();
        }
    });

    it('fails Responses upstream SSE generate jobs when partial images arrive without a final image', async () => {
        const { createGenerateJob, getJob, getJobResult } = await loadAgentRoutes();
        const upstream = await startStreamingResponsesImageUpstream(() => [
            {
                event: 'response.image_generation_call.partial_image',
                data: {
                    type: 'response.image_generation_call.partial_image',
                    partial_image_b64: 'job-responses-partial-only',
                    partial_image_index: 0
                }
            }
        ]);
        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-5.4';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const created = await createGenerateJob(
                agentJobJsonRequest('route-job-responses-missing-final-key', {
                    prompt: 'agent job responses partial only',
                    image_backend: 'responses-image-generation',
                    streaming_strategy: 'responses-sse',
                    partial_images: 2
                })
            );
            assert.equal(created.status, 202);
            const createdBody = await created.json();

            const result = await waitForJobResult(getJobResult, createdBody.job.id);
            assert.equal(result.status, 502);
            const resultBody = await result.json();
            assert.equal(resultBody.error.code, 'upstream_unavailable');
            assert.match(resultBody.error.message, /最终图片 b64_json/);
            assert.equal(JSON.stringify(resultBody).includes('job-responses-partial-only'), false);

            const status = await getJob(new Request(`http://localhost/api/agent/jobs/${createdBody.job.id}`), {
                params: Promise.resolve({ id: createdBody.job.id })
            });
            assert.equal(status.status, 200);
            const statusBody = await status.json();
            assert.equal(statusBody.job.state, 'failed');
            assert.equal(statusBody.job.error.code, 'upstream_unavailable');
            assert.match(statusBody.job.error.message, /最终图片 b64_json/);
            assert.equal(JSON.stringify(statusBody).includes('job-responses-partial-only'), false);
        } finally {
            await upstream.close();
        }
    });

    it('reuses the running generate job for the same idempotency key', async () => {
        const { createGenerateJob, getJobResult } = await loadAgentRoutes();
        let releaseUpstream: (() => void) | undefined;
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(async () => {
            upstreamCalls += 1;
            await new Promise<void>((resolve) => {
                releaseUpstream = resolve;
            });
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const first = await createGenerateJob(agentJobJsonRequest('route-job-reuse-key', { prompt: 'job reuse' }));
            assert.equal(first.status, 202);
            const firstBody = await first.json();
            await waitFor(() => upstreamCalls === 1);

            const second = await createGenerateJob(agentJobJsonRequest('route-job-reuse-key', { prompt: 'job reuse' }));
            assert.equal(second.status, 202);
            assert.equal(second.headers.get('x-idempotent-replay'), 'true');
            const secondBody = await second.json();
            assert.equal(secondBody.job.id, firstBody.job.id);
            assert.equal(secondBody.job.state, 'running');
            assert.equal(upstreamCalls, 1);

            releaseUpstream?.();
            const result = await waitForJobResult(getJobResult, firstBody.job.id);
            assert.equal(result.status, 200);
        } finally {
            releaseUpstream?.();
            await upstream.close();
        }
    });

    it('rejects generate job idempotency keys reused with a different request body', async () => {
        const { createGenerateJob, getJobResult } = await loadAgentRoutes();
        let releaseUpstream: (() => void) | undefined;
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(async () => {
            upstreamCalls += 1;
            await new Promise<void>((resolve) => {
                releaseUpstream = resolve;
            });
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const first = await createGenerateJob(agentJobJsonRequest('route-job-conflict-key', { prompt: 'first job body' }));
            assert.equal(first.status, 202);
            const firstBody = await first.json();
            await waitFor(() => upstreamCalls === 1);

            const conflict = await createGenerateJob(agentJobJsonRequest('route-job-conflict-key', { prompt: 'different job body' }));
            assert.equal(conflict.status, 409);
            assert.equal((await conflict.json()).error.code, 'idempotency_conflict');
            assert.equal(upstreamCalls, 1);

            releaseUpstream?.();
            const result = await waitForJobResult(getJobResult, firstBody.job.id);
            assert.equal(result.status, 200);
        } finally {
            releaseUpstream?.();
            await upstream.close();
        }
    });

    it('returns stored Agent errors for failed generate jobs', async () => {
        const { createGenerateJob, getJob, getJobResult } = await loadAgentRoutes();
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            throw new Error('job upstream failed');
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const created = await createGenerateJob(agentJobJsonRequest('route-job-failure-key', { prompt: 'job failure' }));
            assert.equal(created.status, 202);
            const createdBody = await created.json();

            const result = await waitForJobResult(getJobResult, createdBody.job.id);
            assert.equal(result.status, 502);
            const resultBody = await result.json();
            assert.equal(resultBody.error.code, 'upstream_unavailable');
            assert.equal(resultBody.error.retryable, false);
            assert.equal(resultBody.error.upstream_status, 500);
            assert.equal(resultBody.error.diagnostics.upstream_status, 500);
            assert.equal(resultBody.error.request_id, createdBody.job.id);
            assert.equal(JSON.stringify(resultBody).includes('test-key'), false);

            const status = await getJob(new Request(`http://localhost/api/agent/jobs/${createdBody.job.id}`), {
                params: Promise.resolve({ id: createdBody.job.id })
            });
            assert.equal(status.status, 200);
            const statusBody = await status.json();
            assert.equal(statusBody.job.state, 'failed');
            assert.equal(statusBody.job.error.code, 'upstream_unavailable');
            assert.equal(statusBody.job.error.retryable, false);
            assert.equal(statusBody.job.error.upstream_status, 500);
            assert.equal(statusBody.job.error.diagnostics.upstream_status, 500);
            assert.equal(upstreamCalls > 0, true);

            const replay = await createGenerateJob(agentJobJsonRequest('route-job-failure-key', { prompt: 'job failure' }));
            assert.equal(replay.status, 202);
            assert.equal(replay.headers.get('x-idempotent-replay'), 'true');
            const replayBody = await replay.json();
            assert.equal(replayBody.job.id, createdBody.job.id);
            assert.equal(replayBody.job.state, 'failed');
        } finally {
            await upstream.close();
        }
    });

    it('marks generate jobs as failed when completion state persistence fails', async () => {
        const { createGenerateJob, getJob } = await loadAgentRoutes();
        const { setAgentStateStoreFactoryForTests } = await import('@/lib/agent-state-runtime');
        const requestId = 'job-completion-failure-request';
        let failErrorCode = '';
        let saveCalls = 0;
        const upstream = await startImageUpstream(() => ({ data: [{ b64_json: PNG_BASE64 }] }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;
        setAgentStateStoreFactoryForTests(() => ({
            async init() {},
            async recoverExpiredRequests() {
                return 0;
            },
            async purgeExpiredRequests() {
                return 0;
            },
            async beginRequest() {
                return {
                    type: 'acquired',
                    record: {
                        requestId,
                        idempotencyKey: 'job-completion-failure-key',
                        requestHash: 'hash',
                        mode: 'generate',
                        status: 'running',
                        requestJson: { prompt: 'job completion persistence failure' },
                        createdAt: '2026-05-12T00:00:00.000Z',
                        updatedAt: '2026-05-12T00:00:00.000Z',
                        expiresAt: '2099-05-13T00:00:00.000Z'
                    }
                };
            },
            async refreshRequestLease() {
                return true;
            },
            async saveArtifacts() {
                saveCalls += 1;
            },
            async completeRequest() {
                throw new Error('job completion persistence failed');
            },
            async failRequest(input: { requestId: string; error: { error: { code: string } } }) {
                assert.equal(input.requestId, requestId);
                failErrorCode = input.error.error.code;
            },
            async getRequest(id: string) {
                if (id !== requestId || !failErrorCode) return undefined;
                return {
                    requestId,
                    idempotencyKey: 'job-completion-failure-key',
                    requestHash: 'hash',
                    mode: 'generate',
                    status: 'failed',
                    requestJson: { prompt: 'job completion persistence failure' },
                    errorJson: {
                        error: {
                            code: failErrorCode,
                            message: '保存请求完成状态失败。',
                            retryable: true,
                            request_id: requestId
                        }
                    },
                    createdAt: '2026-05-12T00:00:00.000Z',
                    updatedAt: '2026-05-12T00:00:01.000Z',
                    expiresAt: '2099-05-13T00:00:00.000Z'
                };
            },
            async getArtifact() {
                return undefined;
            },
            async listArtifactsForRequest() {
                return [];
            },
            async deleteArtifact() {
                return false;
            }
        }));

        const originalConsoleError = console.error;
        console.error = () => {};
        try {
            const created = await createGenerateJob(agentJobJsonRequest('job-completion-failure-key', { prompt: 'job completion persistence failure' }));
            assert.equal(created.status, 202);
            await waitFor(() => failErrorCode === 'unexpected_error');
            assert.equal(saveCalls, 1);

            const status = await getJob(new Request(`http://localhost/api/agent/jobs/${requestId}`), {
                params: Promise.resolve({ id: requestId })
            });
            assert.equal(status.status, 200);
            const statusBody = await status.json();
            assert.equal(statusBody.job.state, 'failed');
            assert.equal(statusBody.job.error.code, 'unexpected_error');
            assert.equal(statusBody.job.error.retryable, false);
        } finally {
            console.error = originalConsoleError;
            await upstream.close();
        }
    });

    it('keeps a long-running generate job leased while the upstream call is still active', async () => {
        process.env.AGENT_REQUEST_LEASE_MS = '200';
        process.env.AGENT_RECOVERY_INTERVAL_MS = '50';
        const { createGenerateJob, getJob, getJobResult } = await loadAgentRoutes();
        let releaseUpstream: (() => void) | undefined;
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(async () => {
            upstreamCalls += 1;
            await new Promise<void>((resolve) => {
                releaseUpstream = resolve;
            });
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const created = await createGenerateJob(agentJobJsonRequest('route-job-lease-key', { prompt: 'job lease' }));
            assert.equal(created.status, 202);
            const createdBody = await created.json();
            await waitFor(() => upstreamCalls === 1);
            await new Promise((resolve) => setTimeout(resolve, 350));

            const status = await getJob(new Request(`http://localhost/api/agent/jobs/${createdBody.job.id}`), {
                params: Promise.resolve({ id: createdBody.job.id })
            });
            assert.equal(status.status, 200);
            const statusBody = await status.json();
            assert.equal(statusBody.job.state, 'running');

            releaseUpstream?.();
            const result = await waitForJobResult(getJobResult, createdBody.job.id);
            assert.equal(result.status, 200);
        } finally {
            releaseUpstream?.();
            await upstream.close();
        }
    });

    it('returns structured errors for missing and expired jobs', async () => {
        const { getJob, getJobResult } = await loadAgentRoutes();
        const { resetAgentStateStoreForTests, setAgentStateStoreFactoryForTests } = await import('@/lib/agent-state-runtime');

        const missing = await getJob(new Request('http://localhost/api/agent/jobs/missing-job'), {
            params: Promise.resolve({ id: 'missing-job' })
        });
        assert.equal(missing.status, 404);
        assert.equal((await missing.json()).error.code, 'job_not_found');

        setAgentStateStoreFactoryForTests(() => ({
            async init() {},
            async recoverExpiredRequests() {
                return 0;
            },
            async purgeExpiredRequests() {
                return 0;
            },
            async beginRequest() {
                throw new Error('not used');
            },
            async refreshRequestLease() {
                return false;
            },
            async saveArtifacts() {},
            async completeRequest() {},
            async failRequest() {},
            async getRequest() {
                return {
                    requestId: 'expired-job',
                    idempotencyKey: 'expired-key',
                    requestHash: 'hash',
                    mode: 'generate',
                    status: 'running',
                    requestJson: { prompt: 'expired' },
                    createdAt: '2026-05-12T00:00:00.000Z',
                    updatedAt: '2026-05-12T00:00:00.000Z',
                    expiresAt: '2026-05-12T00:00:01.000Z'
                };
            },
            async getArtifact() {
                return undefined;
            },
            async listArtifactsForRequest() {
                return [];
            },
            async deleteArtifact() {
                return false;
            }
        }));
        resetAgentStateStoreForTests();

        const expired = await getJobResult(new Request('http://localhost/api/agent/jobs/expired-job/result'), {
            params: Promise.resolve({ id: 'expired-job' })
        });
        assert.equal(expired.status, 410);
        assert.equal((await expired.json()).error.code, 'job_expired');
    });

    it('edits through multipart input and replays the cached response for the same idempotency key', async () => {
        const { editImage } = await loadAgentRoutes();
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        const first = await editImage(agentEditRequest('route-edit-key', 'agent edit success'));
        assert.equal(first.status, 200);
        const firstBody = await first.json();
        assert.equal(firstBody.cached, false);
        assert.equal(firstBody.images[0].output_format, 'png');
        assert.equal('b64_json' in firstBody.images[0], false);

        const second = await editImage(agentEditRequest('route-edit-key', 'agent edit success'));
        assert.equal(second.status, 200);
        const secondBody = await second.json();
        assert.equal(secondBody.cached, true);
        assert.equal(second.headers.get('x-idempotent-replay'), 'true');
        assert.equal(second.headers.get('x-request-id'), firstBody.request_id);
        assert.equal(secondBody.request_id, firstBody.request_id);
        assert.equal(upstreamCalls, 1);

        await upstream.close();
    });

    it('returns field-level errors for invalid edit multipart requests', async () => {
        const { editImage } = await loadAgentRoutes();
        const upstream = await startImageUpstream(() => ({ data: [{ b64_json: PNG_BASE64 }] }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        const response = await editImage(agentEditRequest('route-edit-validation-key', 'agent edit invalid', {}, 'url'));

        assert.equal(response.status, 422);
        const body = await response.json();
        assert.equal(body.error.code, 'validation_error');
        assert.match(body.error.details.fields.response_mode, /path/);

        await upstream.close();
    });

    it('returns validation errors for non-multipart edit requests', async () => {
        const { editImage } = await loadAgentRoutes();

        const response = await editImage(
            new Request('http://localhost/api/agent/images/edit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': 'route-edit-non-multipart-key'
                },
                body: JSON.stringify({ prompt: 'not multipart' })
            })
        );

        assert.equal(response.status, 415);
        const body = await response.json();
        assert.equal(body.error.code, 'validation_error');
        assert.equal(body.error.retryable, false);
    });

    it('returns validation errors for malformed edit multipart requests', async () => {
        const { editImage } = await loadAgentRoutes();

        const response = await editImage(
            new Request('http://localhost/api/agent/images/edit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'multipart/form-data; boundary=broken-boundary',
                    'Idempotency-Key': 'route-edit-malformed-multipart-key'
                },
                body: '--not-the-declared-boundary\r\n'
            })
        );

        assert.equal(response.status, 422);
        const body = await response.json();
        assert.equal(body.error.code, 'validation_error');
        assert.equal(body.error.retryable, false);
    });

    it('returns sanitized upstream diagnostics for failed edit requests', async () => {
        const { editImage } = await loadAgentRoutes();
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            throw new Error('edit upstream failed');
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const idempotencyKey = 'route-edit-upstream-diagnostics-key';
            const response = await editImage(agentEditRequest(idempotencyKey, 'edit diagnostics'));
            assert.equal(response.status, 502);
            const body = await response.json();
            assert.equal(body.error.code, 'upstream_unavailable');
            assert.equal(body.error.upstream_status, 500);
            assert.equal(body.error.diagnostics.upstream_status, 500);
            assert.equal(body.error.diagnostics.selected_channel_id, 'default');
            assert.match(body.error.diagnostics.upstream_host, /^127\.0\.0\.1:\d+$/);
            assert.equal(body.error.diagnostics.channel_cooldown_scope, 'channel');
            assert.equal(typeof body.error.diagnostics.elapsed_ms, 'number');
            assert.equal(JSON.stringify(body).includes('test-key'), false);
            const upstreamCallsAfterFirstFailure = upstreamCalls;

            const replay = await editImage(agentEditRequest(idempotencyKey, 'edit diagnostics'));
            assert.equal(replay.status, 502);
            assert.equal(replay.headers.get('x-idempotent-replay'), 'true');
            assert.equal(replay.headers.get('x-request-id'), body.error.request_id);
            const replayBody = await replay.json();
            assert.equal(replayBody.error.code, 'upstream_unavailable');
            assert.equal(replayBody.error.retryable, false);
            assert.equal(replayBody.error.request_id, body.error.request_id);
            assert.equal(upstreamCalls, upstreamCallsAfterFirstFailure);
        } finally {
            await upstream.close();
        }
    });

    it('does not mark a real upstream success as failed when edit state completion fails', async () => {
        const { editImage } = await loadAgentRoutes();
        const { setAgentStateStoreFactoryForTests } = await import('@/lib/agent-state-runtime');
        let upstreamCalls = 0;
        let failCalls = 0;
        let saveCalls = 0;
        const requestId = 'edit-completion-failure-request';
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;
        setAgentStateStoreFactoryForTests(() => ({
            async init() {},
            async recoverExpiredRequests() {
                return 0;
            },
            async purgeExpiredRequests() {
                return 0;
            },
            async beginRequest() {
                return {
                    type: 'acquired',
                    record: {
                        requestId,
                        idempotencyKey: 'edit-completion-failure-key',
                        requestHash: 'hash',
                        mode: 'edit',
                        status: 'running',
                        requestJson: { fields: { prompt: 'state completion failure' } },
                        createdAt: '2026-05-12T00:00:00.000Z',
                        updatedAt: '2026-05-12T00:00:00.000Z',
                        expiresAt: '2026-05-13T00:00:00.000Z'
                    }
                };
            },
            async refreshRequestLease() {
                return false;
            },
            async saveArtifacts() {
                saveCalls += 1;
            },
            async completeRequest() {
                throw new Error('state completion failed');
            },
            async failRequest() {
                failCalls += 1;
            },
            async getRequest() {
                return undefined;
            },
            async getArtifact() {
                return undefined;
            },
            async listArtifactsForRequest() {
                return [];
            },
            async deleteArtifact() {
                return false;
            }
        }));

        const originalConsoleError = console.error;
        console.error = () => {};
        try {
            const response = await editImage(agentEditRequest('edit-completion-failure-key', 'state completion failure'));

            assert.equal(response.status, 500);
            const body = await response.json();
            assert.equal(body.error.code, 'unexpected_error');
            assert.equal(body.error.retryable, true);
            assert.equal(body.error.request_id, requestId);
            assert.equal(upstreamCalls, 1);
            assert.equal(saveCalls, 1);
            assert.equal(failCalls, 0);
        } finally {
            console.error = originalConsoleError;
            await upstream.close();
        }
    });

    it('requires artifact content authorization and returns image bytes when authorized', async () => {
        const { generateImage, getArtifact, getArtifactContent, deleteArtifact } = await loadAgentRoutes();
        const upstream = await startImageUpstream(() => ({ data: [{ b64_json: PNG_BASE64 }] }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;
        process.env.AGENT_API_TOKEN = 'artifact-token';

        const generated = await generateImage(
            agentJsonRequest('artifact-auth-key', { prompt: 'artifact auth' }, { Authorization: 'Bearer artifact-token' })
        );
        const body = await generated.json();
        const artifactId = body.images[0].id;

        const denied = await getArtifactContent(new Request(`http://localhost/api/agent/artifacts/${artifactId}/content`), {
            params: Promise.resolve({ id: artifactId })
        });
        assert.equal(denied.status, 401);
        assert.equal((await denied.json()).error.code, 'unauthorized');

        const allowed = await getArtifactContent(
            new Request(`http://localhost/api/agent/artifacts/${artifactId}/content`, {
                headers: { Authorization: 'Bearer artifact-token' }
            }),
            { params: Promise.resolve({ id: artifactId }) }
        );
        assert.equal(allowed.status, 200);
        assert.equal(allowed.headers.get('content-type'), 'image/png');
        assert.ok((await allowed.arrayBuffer()).byteLength > 0);

        const metadata = await getArtifact(
            new Request(`http://localhost/api/agent/artifacts/${artifactId}`, {
                headers: { Authorization: 'Bearer artifact-token' }
            }),
            { params: Promise.resolve({ id: artifactId }) }
        );
        assert.equal(metadata.status, 200);
        const metadataBody = await metadata.json();
        assert.equal(metadataBody.artifact.id, artifactId);
        assert.equal('filepath' in metadataBody.artifact, false);

        const deleted = await deleteArtifact(
            new Request(`http://localhost/api/agent/artifacts/${artifactId}`, {
                method: 'DELETE',
                headers: { Authorization: 'Bearer artifact-token' }
            }),
            { params: Promise.resolve({ id: artifactId }) }
        );
        assert.equal(deleted.status, 200);
        assert.equal((await deleted.json()).deleted, true);

        const replayAfterDelete = await generateImage(
            agentJsonRequest('artifact-auth-key', { prompt: 'artifact auth' }, { Authorization: 'Bearer artifact-token' })
        );
        assert.equal(replayAfterDelete.status, 404);
        assert.equal((await replayAfterDelete.json()).error.code, 'artifact_not_found');

        await upstream.close();
    });

    it('returns not found when artifact metadata exists but content file is missing', async () => {
        const { generateImage, getArtifactContent } = await loadAgentRoutes();
        const upstream = await startImageUpstream(() => ({ data: [{ b64_json: PNG_BASE64 }] }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            const generated = await generateImage(agentJsonRequest('artifact-missing-content-key', { prompt: 'missing content' }));
            const body = await generated.json();
            const image = body.images[0];
            await rm(readStoredArtifactFilepath(image.id), { force: true });

            const missing = await getArtifactContent(
                new Request(`http://localhost/api/agent/artifacts/${image.id}/content`),
                { params: Promise.resolve({ id: image.id }) }
            );

            assert.equal(missing.status, 404);
            assert.equal((await missing.json()).error.code, 'artifact_not_found');
        } finally {
            await upstream.close();
        }
    });

    it('does not mark a real upstream success as failed when state completion fails', async () => {
        const { generateImage } = await loadAgentRoutes();
        const { setAgentStateStoreFactoryForTests } = await import('@/lib/agent-state-runtime');
        let upstreamCalls = 0;
        let failCalls = 0;
        let saveCalls = 0;
        const requestId = 'completion-failure-request';
        const upstream = await startImageUpstream(() => {
            upstreamCalls += 1;
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;
        setAgentStateStoreFactoryForTests(() => ({
            async init() {},
            async recoverExpiredRequests() {
                return 0;
            },
            async purgeExpiredRequests() {
                return 0;
            },
            async beginRequest() {
                return {
                    type: 'acquired',
                    record: {
                        requestId,
                        idempotencyKey: 'completion-failure-key',
                        requestHash: 'hash',
                        mode: 'generate',
                        status: 'running',
                        requestJson: { prompt: 'state completion failure' },
                        createdAt: '2026-05-12T00:00:00.000Z',
                        updatedAt: '2026-05-12T00:00:00.000Z',
                        expiresAt: '2026-05-13T00:00:00.000Z'
                    }
                };
            },
            async refreshRequestLease() {
                return false;
            },
            async saveArtifacts() {
                saveCalls += 1;
            },
            async completeRequest() {
                throw new Error('state completion failed');
            },
            async failRequest() {
                failCalls += 1;
            },
            async getRequest() {
                return undefined;
            },
            async getArtifact() {
                return undefined;
            },
            async listArtifactsForRequest() {
                return [];
            },
            async deleteArtifact() {
                return false;
            }
        }));

        const originalConsoleError = console.error;
        console.error = () => {};
        try {
            const response = await generateImage(agentJsonRequest('completion-failure-key', { prompt: 'state completion failure' }));

            assert.equal(response.status, 500);
            const body = await response.json();
            assert.equal(body.error.code, 'unexpected_error');
            assert.equal(body.error.retryable, true);
            assert.equal(body.error.request_id, requestId);
            assert.equal(upstreamCalls, 1);
            assert.equal(saveCalls, 1);
            assert.equal(failCalls, 0);
        } finally {
            console.error = originalConsoleError;
        }

        await upstream.close();
    });

    it('does not return artifact URLs when artifact metadata persistence fails', async () => {
        const { generateImage } = await loadAgentRoutes();
        const { setAgentStateStoreFactoryForTests } = await import('@/lib/agent-state-runtime');
        const requestId = 'artifact-save-failure-request';
        const upstream = await startImageUpstream(() => ({ data: [{ b64_json: PNG_BASE64 }] }));
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;
        setAgentStateStoreFactoryForTests(() => ({
            async init() {},
            async recoverExpiredRequests() {
                return 0;
            },
            async purgeExpiredRequests() {
                return 0;
            },
            async beginRequest() {
                return {
                    type: 'acquired',
                    record: {
                        requestId,
                        idempotencyKey: 'artifact-save-failure-key',
                        requestHash: 'hash',
                        mode: 'generate',
                        status: 'running',
                        requestJson: { prompt: 'artifact save failure' },
                        createdAt: '2026-05-12T00:00:00.000Z',
                        updatedAt: '2026-05-12T00:00:00.000Z',
                        expiresAt: '2026-05-13T00:00:00.000Z'
                    }
                };
            },
            async refreshRequestLease() {
                return false;
            },
            async saveArtifacts() {
                throw new Error('artifact metadata save failed');
            },
            async completeRequest() {},
            async failRequest(input: { requestId: string; error: { error: { retryable: boolean } } }) {
                assert.equal(input.requestId, requestId);
                assert.equal(input.error.error.retryable, true);
            },
            async getRequest() {
                return undefined;
            },
            async getArtifact() {
                return undefined;
            },
            async listArtifactsForRequest() {
                return [];
            },
            async deleteArtifact() {
                return false;
            }
        }));

        const originalConsoleError = console.error;
        console.error = () => {};
        try {
            const response = await generateImage(agentJsonRequest('artifact-save-failure-key', { prompt: 'artifact save failure' }));

            assert.equal(response.status, 500);
            const body = await response.json();
            assert.equal(body.error.code, 'unexpected_error');
            assert.equal(body.error.retryable, true);
            assert.equal(body.error.request_id, requestId);
            assert.deepEqual(await listGeneratedImageFiles(), []);
        } finally {
            console.error = originalConsoleError;
            await upstream.close();
        }
    });
});

const livePostgresUrl = process.env.AGENT_POSTGRES_TEST_DATABASE_URL;

describe('Agent route PostgreSQL integration', { skip: livePostgresUrl ? false : 'AGENT_POSTGRES_TEST_DATABASE_URL is not set' }, () => {
    it('allows only one upstream winner for concurrent identical idempotency requests', async () => {
        assert.ok(livePostgresUrl);
        const { generateImage } = await loadAgentRoutes();
        const schemaName = `agent_route_${Date.now().toString(36)}`;
        const pool = new Pool({ connectionString: livePostgresUrl });
        process.env.AGENT_STATE_BACKEND = 'postgres';
        process.env.AGENT_DATABASE_URL = `${livePostgresUrl}${livePostgresUrl.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schemaName}`;
        process.env.AGENT_REQUEST_LEASE_MS = '60000';
        const admin = await pool.connect();
        let releaseUpstream: (() => void) | undefined;
        let upstreamCalls = 0;
        const upstream = await startImageUpstream(async () => {
            upstreamCalls += 1;
            await new Promise<void>((resolve) => {
                releaseUpstream = resolve;
            });
            return { data: [{ b64_json: PNG_BASE64 }] };
        });
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_API_BASE_URL = upstream.baseUrl;

        try {
            await admin.query(`CREATE SCHEMA "${schemaName}"`);
            const firstRequest = generateImage(agentJsonRequest('pg-route-concurrent-key', { prompt: 'pg concurrent' }));
            await waitFor(() => upstreamCalls === 1);

            const second = await generateImage(agentJsonRequest('pg-route-concurrent-key', { prompt: 'pg concurrent' }));
            assert.equal(second.status, 409);
            const secondBody = await second.json();
            assert.equal(secondBody.error.code, 'request_in_progress');
            assert.equal(secondBody.error.retryable, true);
            assert.equal(second.headers.has('retry-after'), true);

            releaseUpstream?.();
            const first = await firstRequest;
            assert.equal(first.status, 200);

            const replay = await generateImage(agentJsonRequest('pg-route-concurrent-key', { prompt: 'pg concurrent' }));
            assert.equal(replay.status, 200);
            assert.equal((await replay.json()).cached, true);
            assert.equal(upstreamCalls, 1);
        } finally {
            releaseUpstream?.();
            await upstream.close();
            await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
            admin.release();
            await pool.end();
        }
    });
});

async function loadAgentRoutes() {
    const { resetAgentStateStoreForTests } = await import('@/lib/agent-state-runtime');
    const { resetServerChannelStateForTests } = await import('@/lib/server-channel-router');
    resetAgentStateStoreForTests();
    resetServerChannelStateForTests();
    const generateRoute = await import('./images/generate/route');
    const editRoute = await import('./images/edit/route');
    const artifactRoute = await import('./artifacts/[id]/route');
    const artifactContentRoute = await import('./artifacts/[id]/content/route');
    const capabilitiesRoute = await import('./capabilities/route');
    const createGenerateJobRoute = await import('./jobs/images/generate/route');
    const jobRoute = await import('./jobs/[id]/route');
    const jobResultRoute = await import('./jobs/[id]/result/route');
    return {
        getCapabilities: () => capabilitiesRoute.GET(),
        generateImage: (request: Request) => generateRoute.POST(asNextRequest(request)),
        editImage: (request: Request) => editRoute.POST(asNextRequest(request)),
        createGenerateJob: (request: Request) => createGenerateJobRoute.POST(asNextRequest(request)),
        getJob: (request: Request, context: AgentRouteContext) => jobRoute.GET(asNextRequest(request), context),
        getJobResult: (request: Request, context: AgentRouteContext) => jobResultRoute.GET(asNextRequest(request), context),
        getArtifact: (request: Request, context: AgentRouteContext) => artifactRoute.GET(asNextRequest(request), context),
        deleteArtifact: (request: Request, context: AgentRouteContext) =>
            artifactRoute.DELETE(asNextRequest(request), context),
        getArtifactContent: (request: Request, context: AgentRouteContext) =>
            artifactContentRoute.GET(asNextRequest(request), context)
    };
}

type AgentRouteContext = { params: Promise<{ id: string }> };

function asNextRequest(request: Request): NextRequest {
    return request as unknown as NextRequest;
}

function agentJsonRequest(idempotencyKey: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/agent/images/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            ...headers
        },
        body: JSON.stringify(body)
    });
}

function agentJobJsonRequest(idempotencyKey: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/agent/jobs/images/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            ...headers
        },
        body: JSON.stringify(body)
    });
}

function agentEditRequest(
    idempotencyKey: string,
    prompt: string,
    headers: Record<string, string> = {},
    responseMode = 'path'
) {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model', 'gpt-image-2');
    formData.append('response_mode', responseMode);
    formData.append('image_0', new File([Buffer.from(PNG_BASE64, 'base64')], 'input.png', { type: 'image/png' }));
    return new Request('http://localhost/api/agent/images/edit', {
        method: 'POST',
        headers: {
            'Idempotency-Key': idempotencyKey,
            ...headers
        },
        body: formData
    });
}

async function startImageUpstream(
    handler: (body: string, url: string) => unknown | Promise<unknown>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        if (
            request.method !== 'POST' ||
            (!request.url?.endsWith('/images/generations') && !request.url?.endsWith('/images/edits'))
        ) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        try {
            const body = await handler(Buffer.concat(chunks).toString('utf8'), request.url || '');
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(body));
        } catch (error) {
            response.writeHead(500, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : '上游失败' } }));
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    return {
        baseUrl,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

async function startStreamingImageUpstream(
    handler: (body: string) => Array<{ event?: string; data: unknown }> | Promise<Array<{ event?: string; data: unknown }>>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/images/generations')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const events = await handler(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const event of events) {
            if (event.event) {
                response.write(`event: ${event.event}\n`);
            }
            response.write(`data: ${JSON.stringify(event.data)}\n\n`);
        }
        response.write('data: [DONE]\n\n');
        response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

async function startStreamingResponsesImageUpstream(
    handler: (body: string) => Array<{ event?: string; data: unknown }> | Promise<Array<{ event?: string; data: unknown }>>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => request.on('end', resolve));
        const events = await handler(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const event of events) {
            if (event.event) {
                response.write(`event: ${event.event}\n`);
            }
            response.write(`data: ${JSON.stringify(event.data)}\n\n`);
        }
        response.write('data: [DONE]\n\n');
        response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    };
}

function readStoredResponseJson(idempotencyKey: string): string {
    const db = new Database(path.join(tempDir, 'agent.sqlite'), { readonly: true });
    try {
        const row = db
            .prepare('SELECT response_json FROM agent_requests WHERE idempotency_key = ?')
            .get(idempotencyKey) as { response_json: string } | undefined;
        assert.ok(row);
        return row.response_json;
    } finally {
        db.close();
    }
}

function readStoredArtifactFilepath(id: string): string {
    const db = new Database(path.join(tempDir, 'agent.sqlite'), { readonly: true });
    try {
        const row = db.prepare('SELECT filepath FROM agent_artifacts WHERE id = ?').get(id) as { filepath: string } | undefined;
        assert.ok(row);
        return row.filepath;
    } finally {
        db.close();
    }
}

async function listGeneratedImageFiles(): Promise<string[]> {
    try {
        return (await readdir(path.join(tempDir, 'generated-images'))).filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry));
    } catch {
        return [];
    }
}

async function listAgentStateFiles(): Promise<string[]> {
    try {
        return await readdir(path.join(tempDir, 'generated-images', '.agent-state'));
    } catch {
        return [];
    }
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('等待条件超时');
}

async function waitForJobResult(
    getJobResult: (
        request: Request,
        context: { params: Promise<{ id: string }> }
    ) => Promise<Response>,
    id: string
): Promise<Response> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const response = await getJobResult(new Request(`http://localhost/api/agent/jobs/${id}/result`), {
            params: Promise.resolve({ id })
        });
        if (response.status !== 409) {
            return response;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('等待 job result 超时');
}
