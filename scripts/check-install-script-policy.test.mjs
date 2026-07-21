import {
    collectInstallScriptIdentities,
    validateInstallScriptPolicy
} from './check-install-script-policy.mjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('install script policy', () => {
    it('collects install-script identities from direct, nested, and scoped lockfile packages', () => {
        const identities = collectInstallScriptIdentities({
            packages: {
                '': { name: 'fixture' },
                'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
                'node_modules/next/node_modules/sharp': { version: '0.34.5', hasInstallScript: true },
                'node_modules/example/node_modules/@scope/native-addon': {
                    version: '1.2.3',
                    hasInstallScript: true
                },
                'node_modules/ignored': { version: '1.0.0' },
                'packages/workspace/node_modules/workspace-native-addon': { version: '2.0.0', hasInstallScript: true }
            }
        });

        assert.deepEqual(identities, [
            '@scope/native-addon@1.2.3',
            'esbuild@0.28.1',
            'sharp@0.34.5',
            'workspace-native-addon@2.0.0'
        ]);
    });

    it('reports missing, stale, and invalid policy entries', () => {
        const result = validateInstallScriptPolicy(
            {
                packages: {
                    'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
                    'node_modules/sharp': { version: '0.34.5', hasInstallScript: true }
                }
            },
            {
                allowScripts: {
                    'esbuild@0.28.1': true,
                    'left-pad@1.3.0': false,
                    'sharp@0.34.5': 'approved'
                }
            }
        );

        assert.deepEqual(result, {
            ok: false,
            installScriptIdentities: ['esbuild@0.28.1', 'sharp@0.34.5'],
            approved: ['esbuild@0.28.1'],
            denied: ['left-pad@1.3.0'],
            missing: ['sharp@0.34.5'],
            stale: ['left-pad@1.3.0'],
            invalid: ['sharp@0.34.5']
        });
    });
});
