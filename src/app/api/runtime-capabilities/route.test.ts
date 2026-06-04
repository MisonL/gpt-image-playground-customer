import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

let originalEnv: NodeJS.ProcessEnv;

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

beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ENABLE_RESPONSES_IMAGE_BACKEND;
    delete process.env.OPENAI_RESPONSES_API_MODEL;
    delete process.env.IMAGE_STREAMING_STRATEGY;
});

afterEach(() => {
    restoreProcessEnv(originalEnv);
});

describe('GET /api/runtime-capabilities', () => {
    it('exposes streaming batch capability by default without the removed env gate', async () => {
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as Record<string, { enabled: boolean; recommendedConcurrency?: number }>;

        assert.equal(body.streamingBatch.enabled, true);
        assert.equal(typeof body.streamingBatch.recommendedConcurrency, 'number');
    });

    it('exposes the runtime default streaming strategy for client-side fanout decisions', async () => {
        process.env.IMAGE_STREAMING_STRATEGY = 'off';
        const { GET } = await import('./route');

        const body = (await (await GET()).json()) as Record<string, { defaultMode?: string; defaultStrategy?: string }>;

        assert.equal(body.streaming.defaultMode, 'non_stream');
        assert.equal(body.streaming.defaultStrategy, 'off');
    });

    it('exposes the experimental Responses image backend when the backend flag is enabled', async () => {
        const { GET } = await import('./route');

        const disabled = (await (await GET()).json()) as Record<
            string,
            {
                enabled: boolean;
                mode?: string;
                requiredEnv?: string[];
                optionalEnv?: string[];
                hasDefaultModel?: boolean;
                missingEnv?: string[];
            }
        >;
        assert.equal(disabled.responsesImageBackend.enabled, false);
        assert.equal(disabled.responsesImageBackend.mode, 'experimental');
        assert.deepEqual(disabled.responsesImageBackend.requiredEnv, ['ENABLE_RESPONSES_IMAGE_BACKEND']);
        assert.deepEqual(disabled.responsesImageBackend.optionalEnv, ['OPENAI_RESPONSES_API_MODEL']);
        assert.equal(disabled.responsesImageBackend.hasDefaultModel, false);
        assert.deepEqual(disabled.responsesImageBackend.missingEnv, ['ENABLE_RESPONSES_IMAGE_BACKEND']);

        process.env.ENABLE_RESPONSES_IMAGE_BACKEND = 'true';
        const requestModelAllowed = (await (await GET()).json()) as Record<
            string,
            { enabled: boolean; mode?: string; hasDefaultModel?: boolean; missingEnv?: string[] }
        >;
        assert.equal(requestModelAllowed.responsesImageBackend.enabled, true);
        assert.equal(requestModelAllowed.responsesImageBackend.hasDefaultModel, false);
        assert.deepEqual(requestModelAllowed.responsesImageBackend.missingEnv, []);

        process.env.OPENAI_RESPONSES_API_MODEL = 'gpt-4.1';
        const enabled = (await (await GET()).json()) as Record<
            string,
            { enabled: boolean; mode?: string; hasDefaultModel?: boolean; missingEnv?: string[] }
        >;
        assert.equal(enabled.responsesImageBackend.enabled, true);
        assert.equal(enabled.responsesImageBackend.mode, 'experimental');
        assert.equal(enabled.responsesImageBackend.hasDefaultModel, true);
        assert.deepEqual(enabled.responsesImageBackend.missingEnv, []);
    });
});
