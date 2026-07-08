import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { patchStandaloneRuntime, validateStandaloneSharpRuntime } from './patch-standalone-runtime.mjs';

const tempDirectories = [];
const originalConsoleInfo = console.info;

before(() => {
  console.info = () => {};
});

after(() => {
  console.info = originalConsoleInfo;
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe('standalone runtime patch', () => {
  it('把完整 sharp 运行文件复制到 standalone 和 Turbopack 外部目录', async () => {
    const root = createTempRepo();
    await writeFakeSharpPackage(root);
    await writeFile(join(root, 'node_modules/semver/index.js'), 'module.exports = {};\n');
    await writeFile(join(root, 'node_modules/semver/package.json'), '{"name":"semver"}\n');
    await writeFile(join(root, 'node_modules/detect-libc/lib/detect-libc.js'), 'module.exports = {};\n');
    await writeFile(join(root, 'node_modules/detect-libc/package.json'), '{"name":"detect-libc"}\n');
    await writeFile(join(root, 'node_modules/@img/colour/index.cjs'), 'module.exports = {};\n');
    await writeFile(join(root, 'node_modules/@img/colour/package.json'), '{"name":"@img/colour"}\n');
    await writeFile(join(root, 'node_modules/@img/sharp-linuxmusl-x64/package.json'), '{"name":"@img/sharp-linuxmusl-x64"}\n');
    await writeFile(join(root, 'node_modules/@img/sharp-libvips-linuxmusl-x64/package.json'), '{"name":"@img/sharp-libvips-linuxmusl-x64"}\n');
    await writeFile(join(root, 'node_modules/@img/not-sharp/package.json'), '{"name":"@img/not-sharp"}\n');
    await writeFile(join(root, '.next/node_modules/sharp-hashed/package.json'), '{"name":"sharp"}\n');
    await writeFile(join(root, '.next/node_modules/sharp-unrelated/package.json'), '{"name":"sharp-unrelated"}\n');

    await patchStandaloneRuntime(root);

    assert.equal(existsSync(join(root, '.next/standalone/node_modules/sharp/dist/index.mjs')), true);
    assert.equal(existsSync(join(root, '.next/standalone/node_modules/sharp/dist/index.cjs')), true);
    assert.equal(existsSync(join(root, '.next/standalone/node_modules/semver/index.js')), true);
    assert.equal(existsSync(join(root, '.next/standalone/node_modules/detect-libc/lib/detect-libc.js')), true);
    assert.equal(existsSync(join(root, '.next/standalone/node_modules/@img/colour/index.cjs')), true);
    assert.equal(existsSync(join(root, '.next/standalone/node_modules/@img/sharp-linuxmusl-x64/package.json')), true);
    assert.equal(existsSync(join(root, '.next/standalone/node_modules/@img/sharp-libvips-linuxmusl-x64/package.json')), true);
    assert.equal(existsSync(join(root, '.next/standalone/node_modules/@img/not-sharp/package.json')), false);
    assert.equal(existsSync(join(root, '.next/standalone/.next/node_modules/sharp-hashed/dist/index.mjs')), true);
    assert.equal(existsSync(join(root, '.next/standalone/.next/node_modules/sharp-unrelated/dist/index.mjs')), false);
    assert.equal(
      readFileSync(join(root, '.next/standalone/node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js'), 'utf8'),
      'runtime\n'
    );
  });

  it('在 standalone 布局下真实加载 sharp 并运行自检', async () => {
    const root = createTempRepo();
    await writeFakeSharpPackage(root);
    await patchStandaloneRuntime(root);

    await validateStandaloneSharpRuntime(root);
  });

  it('standalone sharp 运行时无法加载时显式失败', async () => {
    const root = createTempRepo();
    await writeFakeSharpPackage(root);
    await patchStandaloneRuntime(root);
    await writeFile(join(root, '.next/standalone/node_modules/sharp/dist/index.cjs'), 'throw new Error("broken sharp");\n');

    await assert.rejects(
      () => validateStandaloneSharpRuntime(root),
      /standalone sharp 运行时加载失败/
    );
  });

  it('缺少 sharp 核心运行包时显式失败', async () => {
    const root = createTempRepo();
    await writeFakeSharpPackage(root);
    rmSync(join(root, 'node_modules/semver'), { force: true, recursive: true });

    await assert.rejects(
      () => patchStandaloneRuntime(root),
      /standalone sharp 运行依赖缺失/
    );
  });

  it('缺少 sharp native binding 平台包时显式失败', async () => {
    const root = createTempRepo();
    await writeFakeSharpPackage(root);
    rmSync(join(root, 'node_modules/@img/sharp-linuxmusl-x64'), { force: true, recursive: true });

    await assert.rejects(
      () => patchStandaloneRuntime(root),
      /standalone sharp native binding 依赖缺失/
    );
  });

  it('缺少 sharp libvips 平台包时显式失败', async () => {
    const root = createTempRepo();
    await writeFakeSharpPackage(root);
    rmSync(join(root, 'node_modules/@img/sharp-libvips-linuxmusl-x64'), { force: true, recursive: true });

    await assert.rejects(
      () => patchStandaloneRuntime(root),
      /standalone sharp libvips 依赖缺失/
    );
  });

  it('缺少 sharp colour 平台包时显式失败', async () => {
    const root = createTempRepo();
    await writeFakeSharpPackage(root);
    rmSync(join(root, 'node_modules/@img/colour'), { force: true, recursive: true });

    await assert.rejects(
      () => patchStandaloneRuntime(root),
      /standalone sharp colour 依赖缺失/
    );
  });
});

function createTempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'standalone-runtime-test-'));
  tempDirectories.push(root);
  const runtimeDir = join(root, 'node_modules/next/dist/compiled/next-server');
  mkdirSyncRecursive(runtimeDir);
  mkdirSyncRecursive(join(root, 'node_modules/sharp/dist'));
  mkdirSyncRecursive(join(root, 'node_modules/semver'));
  mkdirSyncRecursive(join(root, 'node_modules/detect-libc/lib'));
  mkdirSyncRecursive(join(root, 'node_modules/@img/colour'));
  mkdirSyncRecursive(join(root, 'node_modules/@img/sharp-linuxmusl-x64'));
  mkdirSyncRecursive(join(root, 'node_modules/@img/sharp-libvips-linuxmusl-x64'));
  mkdirSyncRecursive(join(root, 'node_modules/@img/not-sharp'));
  mkdirSyncRecursive(join(root, '.next/node_modules/sharp-hashed'));
  mkdirSyncRecursive(join(root, '.next/node_modules/sharp-unrelated'));
  mkdirSyncRecursive(join(root, '.next/standalone'));
  writeFileSync(join(runtimeDir, 'app-route-turbo.runtime.prod.js'), 'runtime\n');
  writeFileSync(join(runtimeDir, 'app-route-turbo.runtime.prod.js.map'), '{}\n');
  return root;
}

async function writeFakeSharpPackage(root) {
  const fakeSharp = `
function sharp() {
  return {
    webp() {
      return this;
    },
    async toBuffer() {
      return Buffer.from('fake-webp');
    }
  };
}
module.exports = sharp;
`;
  await writeFile(join(root, 'node_modules/sharp/dist/index.mjs'), 'export default function sharp() {}\n');
  await writeFile(join(root, 'node_modules/sharp/dist/index.cjs'), fakeSharp);
  await writeFile(join(root, 'node_modules/sharp/package.json'), '{"name":"sharp","main":"dist/index.cjs"}\n');
}

function mkdirSyncRecursive(directory) {
  rmSync(directory, { force: true, recursive: true });
  mkdirSync(directory, { recursive: true });
}
