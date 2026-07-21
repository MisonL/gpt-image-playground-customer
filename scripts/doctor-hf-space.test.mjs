import { buildDependencyInstallationCheck, buildNpmInstallPolicyCheck } from './doctor-hf-space.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('HF Space doctor dependency check', () => {
    it('reports an interrupted dependency installation as a node-modules warning', async () => {
        const root = await mkdtemp(join(tmpdir(), 'gipc-hf-doctor-dependencies-'));
        try {
            await mkdir(join(root, 'node_modules'));
            await writeFile(
                join(root, 'package-lock.json'),
                JSON.stringify({
                    lockfileVersion: 3,
                    packages: {
                        '': { dependencies: { demo: '1.0.0' } },
                        'node_modules/demo': { version: '1.0.0' }
                    }
                })
            );
            await writeFile(
                join(root, 'node_modules', '.package-lock.json'),
                JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/demo': { version: '1.0.0' } } })
            );

            assert.deepEqual(buildDependencyInstallationCheck(root), {
                status: 'warn',
                name: 'node-modules',
                message:
                    'node_modules is missing or incomplete; build, lint, test, and smoke commands require npm run install-scripts:check && npm run npm-install-policy:check && npm ci --strict-allow-scripts && npm run dependencies:check.',
                reason: 'direct_package_missing',
                missingPackages: ['demo']
            });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('fails explicitly when npm cannot enforce the allowScripts policy', () => {
        assert.deepEqual(
            buildNpmInstallPolicyCheck({
                ok: false,
                reason: 'npm_strict_allow_scripts_unsupported'
            }),
            {
                status: 'fail',
                name: 'npm-install-policy',
                message: 'Current npm does not support --strict-allow-scripts; upgrade npm before installing dependencies.',
                reason: 'npm_strict_allow_scripts_unsupported'
            }
        );
    });

    it('accepts npm versions that expose strict-allow-scripts in npm ci help', () => {
        assert.deepEqual(buildNpmInstallPolicyCheck({ ok: true }), {
            status: 'pass',
            name: 'npm-install-policy',
            message: 'npm supports strict allowScripts installation policy.'
        });
    });
});
