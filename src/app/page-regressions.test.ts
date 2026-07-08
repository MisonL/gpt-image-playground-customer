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

    it('treats request-level API key as an override while rejecting base URL-only settings', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
        const runtimeStatusCall = source.match(/resolveRuntimeHealthStatus\(\{([\s\S]*?)\n\s*\}\)/)?.[1] ?? '';

        assert.match(source, /const hasRequestApiKey = apiSettings\.apiKey\.trim\(\)\.length > 0;/);
        assert.match(source, /const hasRequestApiOverride = hasRequestApiKey;/);
        assert.match(runtimeStatusCall, /hasRequestApiOverride/);
        assert.match(runtimeStatusCall, /imageBackend: activeWorkbenchBackend/);
        assert.match(
            source,
            /if \(settings\.baseUrl && !settings\.apiKey\) \{\s*throw new Error\(t\('api\.urlPairRequired'\)\);\s*\}/
        );
        assert.match(source, /if \(apiSettings\.baseUrl && apiSettings\.apiKey\) \{/);
        assert.doesNotMatch(source, /hasPairedRequestApiOverride/);
    });

    it('cleans stale local request API overrides that only persisted a base URL', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(
            source,
            /function normalizeStoredApiSettings\(settings: Partial<ApiSettings>\): StoredApiSettingsReadResult/
        );
        assert.match(
            source,
            /if \(!apiKey && baseUrl\) \{\s*return \{ settings: emptyApiSettings, shouldPersist: false, shouldRemove: true \};\s*\}/
        );
        assert.match(source, /const storedApiSettings = readStoredApiSettings\(\);/);
        assert.match(
            source,
            /if \(storedApiSettings\.shouldRemove\) \{\s*window\.localStorage\.removeItem\(apiSettingsLocalStorageKey\);\s*\}/
        );
        assert.match(
            source,
            /else if \(storedApiSettings\.shouldPersist\) \{\s*window\.localStorage\.setItem\(apiSettingsLocalStorageKey, JSON\.stringify\(storedApiSettings\.settings\)\);\s*\}/
        );
    });

    it('shows the current form route in the status strip instead of inferring from server capability modes', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(source, /const activeWorkbenchBackend = usesEditControls \? editImageBackend : genImageBackend;/);
        assert.match(source, /const activeRouteLabel = getWorkbenchRouteLabel\(activeWorkbenchBackend, t\);/);
        assert.match(source, /routeLabel=\{activeRouteLabel\}/);
        assert.doesNotMatch(source, /const activeRequestModeLabel = React\.useMemo/);
    });

    it('reserves mobile viewport space for the fixed action dock and creation drawer', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(source, /\[--mobile-action-dock-height:8\.5rem\]/);
        assert.match(source, /pb-\[calc\(var\(--mobile-action-dock-height\)\+env\(safe-area-inset-bottom\)\)\]/);
        assert.match(source, /bottom-\[calc\(var\(--mobile-action-dock-height\)\+env\(safe-area-inset-bottom\)\)\]/);
        assert.match(source, /scroll-pb-\[calc\(var\(--mobile-action-dock-height\)\+1rem\)\]/);
        assert.match(source, /min-h-\[var\(--mobile-action-dock-height\)\]/);
    });
});
