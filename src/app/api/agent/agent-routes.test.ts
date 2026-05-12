import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { Pool } from 'pg';

const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

let originalEnv: NodeJS.ProcessEnv;
let originalCwd = '';
let tempDir = '';

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
    process.env = originalEnv;
    process.chdir(originalCwd);
    setAgentStateStoreFactoryForTests(undefined);
    resetAgentStateStoreForTests();
    resetServerChannelStateForTests();
    await rm(tempDir, { recursive: true, force: true });
});

describe('Agent route integration', () => {
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
        assert.equal(secondBody.request_id, firstBody.request_id);
        assert.equal(upstreamCalls, 1);

        await upstream.close();
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
        assert.match(body.error.details.fields.prompt, /required/);
        assert.match(body.error.details.fields.n, /between 1 and 10/);
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
            async saveArtifacts() {
                saveCalls += 1;
            },
            async completeRequest() {
                throw new Error('state completion failed');
            },
            async failRequest() {
                failCalls += 1;
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
            async saveArtifacts() {
                throw new Error('artifact metadata save failed');
            },
            async completeRequest() {},
            async failRequest(input: { requestId: string; error: { error: { retryable: boolean } } }) {
                assert.equal(input.requestId, requestId);
                assert.equal(input.error.error.retryable, true);
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
    return {
        generateImage: generateRoute.POST,
        editImage: editRoute.POST,
        getArtifact: artifactRoute.GET,
        deleteArtifact: artifactRoute.DELETE,
        getArtifactContent: artifactContentRoute.GET
    };
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

async function startImageUpstream(handler: () => unknown | Promise<unknown>): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(async (request, response) => {
        if (
            request.method !== 'POST' ||
            (!request.url?.endsWith('/images/generations') && !request.url?.endsWith('/images/edits'))
        ) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        request.resume();
        try {
            const body = await handler();
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(body));
        } catch (error) {
            response.writeHead(500, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'upstream failure' } }));
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

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('condition was not met in time');
}
