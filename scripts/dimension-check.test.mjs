import {
    DimensionCheckError,
    assertImageDimensions,
    buildDimensionCheckFailureBody,
    isDimensionCheckError,
    parseExpectedDimensions,
    sanitizeImageResponse
} from '../skills/visual-journal-agent/scripts/lib/dimension-check.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

test('assertImageDimensions records dimensions for inline base64 images', async () => {
    const response = {
        images: [{ id: 'ok', b64_json: pngBase64(320, 240) }]
    };

    const checked = await assertImageDimensions({
        response,
        expected: { width: 320, height: 240 },
        baseUrl: 'http://127.0.0.1:1',
        authHeaders: {}
    });

    assert.deepEqual(checked.images[0].dimensions, { width: 320, height: 240 });
    assert.equal(checked.images[0].b64_json, response.images[0].b64_json);
});

test('assertImageDimensions rejects mismatched dimensions with sanitized response', async () => {
    await assert.rejects(
        () =>
            assertImageDimensions({
                response: { images: [{ id: 'bad', b64_json: pngBase64(512, 512) }] },
                expected: { width: 1024, height: 1024 },
                baseUrl: 'http://127.0.0.1:1',
                authHeaders: {}
            }),
        (error) => {
            assert.equal(error instanceof DimensionCheckError, true);
            assert.equal(error.code, 'dimension_check_failed');
            assert.deepEqual(error.expectedDimensions, { width: 1024, height: 1024 });
            assert.deepEqual(error.actualDimensions, { width: 512, height: 512 });
            assert.equal(error.response.images[0].b64_json, undefined);
            assert.equal(Object.prototype.hasOwnProperty.call(error.response.images[0], 'b64_json'), false);
            assert.equal(error.response.images[0].b64_json_length, pngBase64(512, 512).length);
            assert.deepEqual(error.response.images[0].dimensions, { width: 512, height: 512 });
            return true;
        }
    );
});

test('assertImageDimensions rejects missing and empty image lists', async () => {
    for (const response of [{}, { images: [] }]) {
        await assert.rejects(
            () =>
                assertImageDimensions({
                    response,
                    expected: { width: 1024, height: 1024 },
                    baseUrl: 'http://127.0.0.1:1',
                    authHeaders: {}
                }),
            /响应中没有可验收的图片/
        );
    }
});

test('assertImageDimensions reads same-origin content URLs with auth headers', async () => {
    const requests = [];
    await withServer(
        (request, response) => {
            requests.push({ url: request.url, authorization: request.headers.authorization });
            response.writeHead(200, { 'content-type': 'image/png' });
            response.end(pngBuffer(640, 360));
        },
        async (baseUrl) => {
            const checked = await assertImageDimensions({
                response: { images: [{ id: 'url-image', content_url: '/artifact/url-image.png' }] },
                expected: { width: 640, height: 360 },
                baseUrl,
                authHeaders: () => ({ Authorization: 'Bearer test-token' })
            });

            assert.deepEqual(checked.images[0].dimensions, { width: 640, height: 360 });
            assert.equal(requests[0].url, '/artifact/url-image.png');
            assert.equal(requests[0].authorization, 'Bearer test-token');
        }
    );
});

test('assertImageDimensions rejects path fields unless callers opt in explicitly', async () => {
    await assert.rejects(
        () =>
            assertImageDimensions({
                response: { images: [{ path: '/artifact/from-path.png' }] },
                expected: { width: 1, height: 1 },
                baseUrl: 'http://127.0.0.1:1',
                authHeaders: {}
            }),
        /dimension-check 需要 b64_json 或 absolute_content_url 或 content_url/
    );

    await assert.rejects(
        () =>
            assertImageDimensions({
                response: { images: [{}] },
                expected: { width: 1, height: 1 },
                baseUrl: 'http://127.0.0.1:1',
                authHeaders: {},
                readUrlFields: ['absolute_path', 'path']
            }),
        /dimension-check 需要 b64_json 或 absolute_path 或 path/
    );
});

test('assertImageDimensions converts download failures and cross-origin URLs to dimension failures', async () => {
    await withServer(
        (_request, response) => {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'missing' }));
        },
        async (baseUrl) => {
            await assert.rejects(
                () =>
                    assertImageDimensions({
                        response: { images: [{ content_url: '/missing.png' }] },
                        expected: { width: 1, height: 1 },
                        baseUrl,
                        authHeaders: {}
                    }),
                /下载产物失败，状态码 404/
            );
        }
    );

    await assert.rejects(
        () =>
            assertImageDimensions({
                response: { images: [{ content_url: 'https://evil.example.test/image.png' }] },
                expected: { width: 1, height: 1 },
                baseUrl: 'https://space.example.test',
                authHeaders: {}
            }),
        /不同 origin/
    );

    await assert.rejects(
        () =>
            assertImageDimensions({
                response: { images: [{ absolute_content_url: 'https://evil.example.test/image.png' }] },
                expected: { width: 1, height: 1 },
                baseUrl: 'https://space.example.test',
                authHeaders: {}
            }),
        /absolute_content_url 指向不同 origin/
    );
});

test('assertImageDimensions times out stalled streamed downloads', async () => {
    await withServer(
        (_request, response) => {
            response.writeHead(200, { 'content-type': 'image/png' });
            response.write(pngBuffer(1, 1).subarray(0, 8));
        },
        async (baseUrl) => {
            await assert.rejects(
                () =>
                    assertImageDimensions({
                        response: { images: [{ content_url: '/stalled.png' }] },
                        expected: { width: 1, height: 1 },
                        baseUrl,
                        authHeaders: {},
                        timeoutMs: 25
                    }),
                /下载产物超时，已等待 25ms/
            );
        }
    );
});

test('assertImageDimensions falls back to default URL fields for invalid readUrlFields', async () => {
    await withServer(
        (_request, response) => {
            response.writeHead(200, { 'content-type': 'image/png' });
            response.end(pngBuffer(16, 9));
        },
        async (baseUrl) => {
            const checked = await assertImageDimensions({
                response: { images: [{ content_url: '/default-field.png' }] },
                expected: { width: 16, height: 9 },
                baseUrl,
                authHeaders: {},
                readUrlFields: null
            });

            assert.deepEqual(checked.images[0].dimensions, { width: 16, height: 9 });
        }
    );
});

test('assertImageDimensions enforces the max image byte limit', async () => {
    await assert.rejects(
        () =>
            assertImageDimensions({
                response: { images: [{ b64_json: pngBase64(1, 1) }] },
                expected: { width: 1, height: 1 },
                baseUrl: 'http://127.0.0.1:1',
                authHeaders: {},
                maxImageBytes: 8
            }),
        /图片数据超过 8 字节限制/
    );

    await withServer(
        (_request, response) => {
            response.writeHead(200, {
                'content-type': 'image/png',
                'content-length': String(pngBuffer(1, 1).length)
            });
            response.end(pngBuffer(1, 1));
        },
        async (baseUrl) => {
            await assert.rejects(
                () =>
                    assertImageDimensions({
                        response: { images: [{ content_url: '/large.png' }] },
                        expected: { width: 1, height: 1 },
                        baseUrl,
                        authHeaders: {},
                        maxImageBytes: 8
                    }),
                /图片数据超过 8 字节限制/
            );
        }
    );
});

test('dimension-check helpers expose stable structured failure bodies', () => {
    const sanitized = sanitizeImageResponse({ images: [{ id: 'secret', b64_json: pngBase64(1, 1) }] });
    assert.equal(sanitized.images[0].b64_json, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(sanitized.images[0], 'b64_json'), false);
    assert.equal(sanitized.images[0].b64_json_length, pngBase64(1, 1).length);
    assert.deepEqual(parseExpectedDimensions('1024x768'), { width: 1024, height: 768 });
    assert.equal(parseExpectedDimensions('auto'), undefined);
    assert.equal(isDimensionCheckError(new Error('plain')), false);

    const error = new DimensionCheckError('bad size', {
        expected: { width: 10, height: 10 },
        actual: { width: 8, height: 8 },
        response: { images: [{ id: 'bad', b64_json: pngBase64(8, 8) }] },
        nextStep: 'inspect'
    });
    const body = buildDimensionCheckFailureBody(error, { transport: 'agent_json' });
    assert.equal(body.billable, true);
    assert.equal(body.error.code, 'dimension_check_failed');
    assert.deepEqual(body.error.expected_dimensions, { width: 10, height: 10 });
    assert.deepEqual(body.error.actual_dimensions, { width: 8, height: 8 });
    assert.equal(body.validation_failure_kind, 'generated_artifact_failed_dimension_check');
    assert.deepEqual(body.routing, { transport: 'agent_json' });
    assert.equal(body.response.images[0].b64_json, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(body.response.images[0], 'b64_json'), false);
    assert.equal(body.next_step, 'inspect');

    const malformed = buildDimensionCheckFailureBody(
        new DimensionCheckError('bad metadata', {
            expected: { width: 'wide', height: 10 },
            actual: { width: 8, height: 0 }
        }),
        undefined
    );
    assert.equal(malformed.error.expected_dimensions, null);
    assert.equal(malformed.error.actual_dimensions, null);
});

function pngBase64(width, height) {
    return pngBuffer(width, height).toString('base64');
}

function pngBuffer(width, height) {
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

async function withServer(handler, run) {
    const server = createServer(handler);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}
