import { inspectDependencyInstallation } from './dependency-installation.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT_LOCKFILE = {
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
        '': {
            name: 'fixture',
            dependencies: { demo: '1.0.0' },
            devDependencies: { '@scope/tool': '2.0.0' }
        },
        'node_modules/demo': { version: '1.0.0' },
        'node_modules/@scope/tool': { version: '2.0.0' }
    }
};

const LOCAL_LINK_ROOT_LOCKFILE = {
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
        '': {
            name: 'fixture',
            dependencies: { demo: 'file:vendor/demo' }
        },
        'node_modules/demo': {
            resolved: 'vendor/demo',
            link: true
        },
        'vendor/demo': {
            name: 'demo',
            version: '1.0.0'
        }
    }
};

async function createFixture({ rootLockfile = ROOT_LOCKFILE, hiddenLockfile, manifests = {} } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'gipc-dependency-installation-'));
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(rootLockfile));
    if (hiddenLockfile !== undefined) {
        await writeFile(join(root, 'node_modules', '.package-lock.json'), JSON.stringify(hiddenLockfile));
    }
    for (const [name, manifest] of Object.entries(manifests)) {
        const packageDirectory = join(root, 'node_modules', name);
        await mkdir(packageDirectory, { recursive: true });
        await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(manifest));
    }
    return root;
}

function buildHiddenLockfile(packages = ROOT_LOCKFILE.packages) {
    return {
        lockfileVersion: 3,
        packages: Object.fromEntries(Object.entries(packages).filter(([path]) => path !== ''))
    };
}

describe('dependency installation inspection', () => {
    it('detects an interrupted install when only the hidden lockfile remains', async () => {
        const root = await createFixture({ hiddenLockfile: buildHiddenLockfile() });
        try {
            const state = inspectDependencyInstallation(root);

            assert.equal(state.ok, false);
            assert.equal(state.reason, 'direct_package_missing');
            assert.deepEqual(state.missingPackages, ['@scope/tool', 'demo']);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('detects a missing hidden lockfile', async () => {
        const root = await createFixture();
        try {
            const state = inspectDependencyInstallation(root);

            assert.equal(state.ok, false);
            assert.equal(state.reason, 'hidden_lockfile_missing');
            assert.deepEqual(state.missingPackages, []);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('detects a direct dependency version mismatch', async () => {
        const root = await createFixture({
            hiddenLockfile: buildHiddenLockfile(),
            manifests: {
                demo: { name: 'demo', version: '1.1.0' },
                '@scope/tool': { name: '@scope/tool', version: '2.0.0' }
            }
        });
        try {
            const state = inspectDependencyInstallation(root);

            assert.equal(state.ok, false);
            assert.equal(state.reason, 'direct_package_version_mismatch');
            assert.deepEqual(state.versionMismatches, [{ name: 'demo', expected: '1.0.0', actual: '1.1.0' }]);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('accepts direct dependencies matching both lockfiles', async () => {
        const root = await createFixture({
            hiddenLockfile: buildHiddenLockfile(),
            manifests: {
                demo: { name: 'demo', version: '1.0.0' },
                '@scope/tool': { name: '@scope/tool', version: '2.0.0' }
            }
        });
        try {
            const state = inspectDependencyInstallation(root);

            assert.equal(state.ok, true);
            assert.deepEqual(state.directDependencies, ['@scope/tool', 'demo']);
            assert.equal(state.reason, undefined);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('accepts a local file dependency whose link target matches both lockfiles', async () => {
        const root = await createFixture({
            rootLockfile: LOCAL_LINK_ROOT_LOCKFILE,
            hiddenLockfile: buildHiddenLockfile(LOCAL_LINK_ROOT_LOCKFILE.packages),
            manifests: {
                demo: { name: 'demo', version: '1.0.0' }
            }
        });
        try {
            const state = inspectDependencyInstallation(root);

            assert.equal(state.ok, true);
            assert.deepEqual(state.directDependencies, ['demo']);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('detects a local file dependency version mismatch in the hidden lockfile', async () => {
        const hiddenLockfile = buildHiddenLockfile({
            ...LOCAL_LINK_ROOT_LOCKFILE.packages,
            'vendor/demo': { name: 'demo', version: '1.1.0' }
        });
        const root = await createFixture({
            rootLockfile: LOCAL_LINK_ROOT_LOCKFILE,
            hiddenLockfile,
            manifests: {
                demo: { name: 'demo', version: '1.0.0' }
            }
        });
        try {
            const state = inspectDependencyInstallation(root);

            assert.equal(state.ok, false);
            assert.equal(state.reason, 'hidden_lockfile_package_mismatch');
            assert.deepEqual(state.hiddenLockMismatches, [{ name: 'demo', expected: '1.0.0', actual: '1.1.0' }]);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
