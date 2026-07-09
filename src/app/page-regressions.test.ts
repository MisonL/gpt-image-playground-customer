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

    it('prevents narrow mobile layouts from creating horizontal overflow', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(source, /min-h-screen overflow-x-hidden/);
        assert.match(source, /w-full max-w-\[1760px\] min-w-0/);
        assert.match(source, /flex min-w-0 flex-wrap items-center gap-2/);
        assert.match(source, /order-1 flex min-h-\[380px\] min-w-0/);
        assert.match(source, /order-3 min-h-\[420px\] min-w-0/);
    });

    it('keeps the mobile title readable instead of truncating the brand', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(source, /flex-1 flex-wrap items-baseline gap-x-3 gap-y-1/);
        assert.match(source, /editorial-title shrink-0 text-3xl/);
        assert.match(source, /text-muted-foreground min-w-0 text-sm/);
        assert.doesNotMatch(source, /editorial-title truncate text-3xl/);
    });

    it('keeps preview paper decoration inside very narrow screens', async () => {
        const source = await readFile(new URL('./globals.css', import.meta.url), 'utf8');

        assert.match(source, /\.photo-paper \{\s*min-width: 0;/);
        assert.match(source, /@media \(max-width: 380px\) \{/);
        assert.match(source, /\.photo-paper::before \{[\s\S]*?width: min\(6rem, 40%\);/);
        assert.match(source, /\.preview-gallery-board::before \{[\s\S]*?inset: 0\.5rem;/);
    });

    it('keeps the pro dock adjacent to the empty preview state', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(source, /const shouldExpandOutputStage =/);
        assert.match(source, /Boolean\(latestImageBatch\)/);
        assert.match(source, /Boolean\(outputFailureMessage\)/);
        assert.match(source, /mode === 'edit' && Boolean\(editSourceImagePreviewUrls\[0\]\)/);
        assert.match(source, /shouldExpandOutputStage \? 'min-h-0 flex-1' : 'min-h-0 shrink-0'/);
        assert.doesNotMatch(source, /<div className='min-h-0 flex-1'>\s*<ImageOutput/);
    });
});
