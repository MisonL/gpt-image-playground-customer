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
        const result = await generate.execute({ prompt: 'test prompt' }, { signal: new AbortController().signal });
        assert.equal(called, false);
        assert.equal(result.dry_run, true);
        assert.equal(result.billable, false);
        assert.deepEqual(result.request, { prompt: 'test prompt' });
    } finally {
        globalThis.fetch = originalFetch;
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
