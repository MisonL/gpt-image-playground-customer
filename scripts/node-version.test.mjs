import { isSupportedNodeVersion, MIN_NODE_VERSION_RANGE } from './node-version.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('Node runtime version support', () => {
    it('keeps the declared minimum version aligned with runtime checks', async () => {
        const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
        const customerGuide = await readFile(new URL('../客户使用说明.md', import.meta.url), 'utf8');
        const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
        assert.equal(MIN_NODE_VERSION_RANGE, '>=22.15.0');
        assert.equal(packageJson.engines.node, MIN_NODE_VERSION_RANGE);
        assert.equal(isSupportedNodeVersion('v22.14.99'), false);
        assert.equal(isSupportedNodeVersion('v22.15.0'), true);
        assert.equal(isSupportedNodeVersion('v22.15.0-rc.1'), false);
        assert.equal(isSupportedNodeVersion('v22.15.0-nightly.20260716'), false);
        assert.equal(isSupportedNodeVersion('v22.15.0+build.1'), true);
        assert.equal(isSupportedNodeVersion('v22.15.1'), true);
        assert.equal(isSupportedNodeVersion('v23.0.0'), true);
        assert.equal(isSupportedNodeVersion('v21.99.99'), false);
        assert.equal(isSupportedNodeVersion('invalid'), false);
        assert.equal(customerGuide.match(/Node\.js 22\.15\.0 或更高版本/g)?.length, 2);
        assert.doesNotMatch(customerGuide, /Node\.js 22 或更高版本/);
        assert.match(changelog, /Node\.js 最低版本统一为 `22\.15\.0`/);
        assert.doesNotMatch(changelog, /Node\.js 最低版本统一为 `20\.10\.0`/);
    });

    it('keeps every platform launcher on the shared minimum version check', async () => {
        const launchers = await Promise.all(
            ['start-linux.sh', 'start-macos.sh', 'start-windows.bat'].map(async (filename) => ({
                filename,
                source: await readFile(new URL(`../${filename}`, import.meta.url), 'utf8')
            }))
        );

        for (const launcher of launchers) {
            assert.match(launcher.source, /scripts[\\/]node-version\.mjs/, launcher.filename);
            assert.match(launcher.source, /22\.15\.0/, launcher.filename);
            assert.doesNotMatch(launcher.source, /NODE_MAJOR|split\(['"]\.['"]\)/, launcher.filename);
        }
    });
});
