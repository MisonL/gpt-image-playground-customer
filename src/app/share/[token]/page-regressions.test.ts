import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('share page regressions', () => {
    it('gives the access-code field a durable accessible label and form semantics', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

        assert.match(source, /<Label\s+htmlFor='share-page-access-code'>/);
        assert.match(source, /id='share-page-access-code'/);
        assert.match(source, /name='accessCode'/);
        assert.match(source, /autoComplete='current-password'/);
        assert.match(source, /share\.accessCodeRequiredHint/);
        assert.match(source, /aria-describedby=\{accessCode\.trim\(\)\.length === 0 \? 'share-page-access-code-hint' : undefined\}/);
        assert.match(source, /id='share-page-access-code-hint'/);
        assert.match(source, /if \(accessCode\.trim\(\)\.length === 0\) \{\s*return;\s*\}/);
    });
});
