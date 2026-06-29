import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('page state regressions', () => {
    it('uses the unified batch prompt setter when mobile random inspiration replaces batch text', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
        const batchBranch = source.match(/if \(workbenchMode === 'batch'\) \{([\s\S]*?)\n\s*\}/)?.[1];

        assert.ok(batchBranch, 'missing mobile random inspiration batch branch');
        assert.match(batchBranch, /handleBatchPromptTextChange\(nextPrompt\)/);
        assert.doesNotMatch(batchBranch, /setGenBatchPromptText\(nextPrompt\)/);
    });

    it('gates explicit Responses controls on the current request context, not only the feature flag', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(
            source,
            /shouldAllowResponsesImageBackend\(\{\s*runtimeCapabilities,\s*hasRequestApiOverride\s*\}\)/
        );
        assert.doesNotMatch(
            source,
            /const allowResponsesImageBackend = isResponsesImageBackendRuntimeEnabled\(runtimeCapabilities \?\? \{\}\)/
        );
    });
});
