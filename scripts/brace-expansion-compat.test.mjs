import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

test('brace expansion compatibility facade supports legacy CommonJS consumers', () => {
    const braceExpansion = require('brace-expansion');

    assert.equal(typeof braceExpansion, 'function');
    assert.equal(typeof braceExpansion.expand, 'function');
    assert.deepEqual(braceExpansion('image-{a,b}.png'), ['image-a.png', 'image-b.png']);
    assert.deepEqual(braceExpansion.expand('image-{a,b}.png'), ['image-a.png', 'image-b.png']);
});

test('brace expansion compatibility facade supports current ESM consumers', async () => {
    const braceExpansion = await import('brace-expansion');

    assert.equal(typeof braceExpansion.default, 'function');
    assert.equal(typeof braceExpansion.expand, 'function');
    assert.ok(braceExpansion.EXPANSION_MAX > 0);
    assert.deepEqual(braceExpansion.expand('image-{a,b}.png', { max: 1 }), ['image-a.png']);
});

test('brace expansion compatibility facade supports installed minimatch consumer versions', () => {
    const legacyMinimatch = require('minimatch');
    const sortImportsRequire = createRequire(require.resolve('@trivago/prettier-plugin-sort-imports/package.json'));
    const typeScriptEstreeRequire = createRequire(require.resolve('@typescript-eslint/typescript-estree/package.json'));
    const sortImportsMinimatch = sortImportsRequire('minimatch');
    const typeScriptEstreeMinimatch = typeScriptEstreeRequire('minimatch');

    assert.equal(legacyMinimatch('src/image.ts', 'src/*.{ts,tsx}'), true);
    assert.equal(sortImportsMinimatch.minimatch('src/image.ts', 'src/*.{ts,tsx}'), true);
    assert.equal(typeScriptEstreeMinimatch.minimatch('src/image.ts', 'src/*.{ts,tsx}'), true);
});
