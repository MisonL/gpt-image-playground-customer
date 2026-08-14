import { apply, internals } from '../lib/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';

function registerTools() {
    const tools = new Map();
    apply(
        {
            tools: {
                register(definition) {
                    tools.set(definition.name, definition);
                    return () => tools.delete(definition.name);
                }
            }
        },
        { baseUrl: 'http://localhost:4783', timeoutMs: 1000 }
    );
    return tools;
}

test('registers the three Visual Journal tools with strict billable guardrails', () => {
    const tools = registerTools();
    assert.deepEqual(
        [...tools.keys()],
        ['visual_journal_capabilities', 'visual_journal_generate', 'visual_journal_diagnose']
    );
    assert.equal(tools.get('visual_journal_generate').parameters.properties.allow_billable.type, 'boolean');
    assert.equal(Object.hasOwn(tools.get('visual_journal_generate').parameters.properties, 'base_url'), false);
    assert.equal(Object.hasOwn(tools.get('visual_journal_diagnose').parameters.properties, 'base_url'), false);
    assert.equal(typeof tools.get('visual_journal_generate').output.render, 'function');
    assert.deepEqual(tools.get('visual_journal_generate').output.schema, {});
});

test('dry-run never calls fetch and keeps the request body explicit', async () => {
    const tools = registerTools();
    const generate = tools.get('visual_journal_generate');
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
        called = true;
        throw new Error('fetch must not run for dry-run');
    };
    try {
        const result = await generate.execute(
            { prompt: 'test prompt', output_compression: 80 },
            { signal: new AbortController().signal }
        );
        assert.equal(called, false);
        assert.equal(result.dry_run, true);
        assert.equal(result.billable, false);
        assert.deepEqual(result.request, { prompt: 'test prompt', output_compression: 80 });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('allows billable requests when the service has no auth configured', async () => {
    const tools = registerTools();
    const generate = tools.get('visual_journal_generate');
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.GPT_IMAGE_AGENT_TOKEN;
    const originalPasswordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH;
    let requestHeaders;
    delete process.env.GPT_IMAGE_AGENT_TOKEN;
    delete process.env.GPT_IMAGE_APP_PASSWORD_HASH;
    globalThis.fetch = async (_input, init) => {
        requestHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    };
    try {
        const result = await generate.execute(
            { prompt: 'test prompt', allow_billable: true, idempotency_key: 'test-key' },
            { signal: new AbortController().signal }
        );
        assert.equal(result.response.accepted, true);
        assert.equal(requestHeaders.has('authorization'), false);
        assert.equal(requestHeaders.has('x-app-password-hash'), false);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.GPT_IMAGE_AGENT_TOKEN;
        else process.env.GPT_IMAGE_AGENT_TOKEN = originalToken;
        if (originalPasswordHash === undefined) delete process.env.GPT_IMAGE_APP_PASSWORD_HASH;
        else process.env.GPT_IMAGE_APP_PASSWORD_HASH = originalPasswordHash;
    }
});

test('tool arguments cannot redirect requests away from the configured service', async () => {
    const tools = registerTools();
    const generate = tools.get('visual_journal_generate');
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.GPT_IMAGE_AGENT_TOKEN;
    const urls = [];
    process.env.GPT_IMAGE_AGENT_TOKEN = 'test-token';
    globalThis.fetch = async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    try {
        await generate.execute(
            {
                prompt: 'test prompt',
                allow_billable: true,
                idempotency_key: 'test-key',
                base_url: 'https://attacker.example'
            },
            { signal: new AbortController().signal }
        );
        assert.deepEqual(urls, ['http://localhost:4783/api/agent/image-requests']);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.GPT_IMAGE_AGENT_TOKEN;
        else process.env.GPT_IMAGE_AGENT_TOKEN = originalToken;
    }
});

test('billable execution requires an explicit idempotency key', async () => {
    const tools = registerTools();
    const generate = tools.get('visual_journal_generate');
    await assert.rejects(
        generate.execute({ prompt: 'test prompt', allow_billable: true }, { signal: new AbortController().signal }),
        /必须提供 idempotency_key/
    );
});

test('diagnostics requires exactly one lookup key', () => {
    assert.throws(() => internals.resolveDiagnosticLookup({}), /必须提供 request_id 或 idempotency_key/);
    assert.throws(() => internals.resolveDiagnosticLookup({ request_id: 'a', idempotency_key: 'b' }), /只能提供一个/);
    assert.deepEqual(internals.resolveDiagnosticLookup({ idempotency_key: 'key-1' }), {
        type: 'idempotency_key',
        value: 'key-1'
    });
});
