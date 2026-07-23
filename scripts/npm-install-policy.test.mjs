import { inspectNpmInstallPolicy } from './npm-install-policy.mjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

describe('npm install script policy capability', () => {
    it('accepts npm versions that expose strict-allow-scripts in npm ci help', () => {
        const result = inspectNpmInstallPolicy({
            runNpmHelp: () => ({ status: 0, stdout: '[--strict-allow-scripts]\n', stderr: '' })
        });

        assert.deepEqual(result, { ok: true });
    });

    it('rejects npm versions that silently accept an unknown strict-allow-scripts config', () => {
        const result = inspectNpmInstallPolicy({
            runNpmHelp: () => ({ status: 0, stdout: 'Usage: npm ci\n', stderr: '' })
        });

        assert.deepEqual(result, {
            ok: false,
            reason: 'npm_strict_allow_scripts_unsupported'
        });
    });

    it('reports npm command failures without claiming that the policy is supported', () => {
        const result = inspectNpmInstallPolicy({
            runNpmHelp: () => ({ status: 1, stdout: '', stderr: 'npm unavailable' })
        });

        assert.deepEqual(result, {
            ok: false,
            reason: 'npm_config_check_failed',
            error: 'npm unavailable'
        });
    });

    it('keeps install policy enforcement wired into local, Docker, and CI installation paths', async () => {
        const [dockerfile, workflow, linuxLauncher, macosLauncher, windowsLauncher, packageJson, nodeGypPreload] = await Promise.all([
            readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
            readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
            readFile(new URL('../start-linux.sh', import.meta.url), 'utf8'),
            readFile(new URL('../start-macos.sh', import.meta.url), 'utf8'),
            readFile(new URL('../start-windows.bat', import.meta.url), 'utf8'),
            readFile(new URL('../package.json', import.meta.url), 'utf8'),
            readFile(new URL('./node-gyp-local-headers.cjs', import.meta.url), 'utf8')
        ]);

        assert.equal(JSON.parse(packageJson).scripts['npm-install-policy:check'], 'node scripts/npm-install-policy.mjs');
        assert.match(dockerfile, /scripts\/npm-install-policy\.mjs/);
        assert.match(dockerfile, /scripts\/node-gyp-local-headers\.cjs/);
        assert.match(dockerfile, /^ENV NODE_OPTIONS=--require=\/app\/scripts\/node-gyp-local-headers\.cjs$/m);
        assert.match(dockerfile, /^ENV NODE_OPTIONS=$/m);
        assert.match(dockerfile, /npm run npm-install-policy:check && npm ci --strict-allow-scripts/);
        assert.equal((workflow.match(/npm run npm-install-policy:check && npm ci --strict-allow-scripts/g) || []).length, 2);
        assert.match(linuxLauncher, /node scripts\/npm-install-policy\.mjs/);
        assert.match(macosLauncher, /node scripts\/npm-install-policy\.mjs/);
        assert.match(windowsLauncher, /node scripts\\npm-install-policy\.mjs/);
        assert.match(nodeGypPreload, /process\.argv\[1\] === nodeGypPath/);
        assert.match(nodeGypPreload, /process\.env\.npm_config_nodedir = '\/usr\/local'/);
    });
});
