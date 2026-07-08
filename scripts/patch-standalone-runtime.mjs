#!/usr/bin/env node
import { copyFile, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredFiles = [
  'app-route-turbo.runtime.prod.js',
  'app-route-turbo.runtime.prod.js.map'
];
const sharpRuntimePackages = ['sharp', 'semver', 'detect-libc'];

const root = process.cwd();

function isSharpBindingPackage(packageName) {
  return packageName.startsWith('sharp-') && !packageName.startsWith('sharp-libvips-');
}

function isSharpPlatformRuntimePackage(packageName) {
  return packageName === 'colour' || packageName.startsWith('sharp-');
}

async function assertFile(filepath) {
  let info;
  try {
    info = await stat(filepath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`文件不存在：${filepath}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取文件状态失败：${filepath}。${message}`);
  }
  if (!info.isFile()) {
    throw new Error(`预期是文件，但实际不是文件路径：${filepath}`);
  }
}

async function directoryExists(dirpath) {
  try {
    const info = await stat(dirpath);
    return info.isDirectory();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertDirectory(dirpath, description) {
  if (await directoryExists(dirpath)) return;
  throw new Error(`${description}缺失：${dirpath}`);
}

async function copyDirectory(source, target) {
  await rm(target, { force: true, recursive: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

async function isSharpExternalModule(sourceDir) {
  try {
    const rawPackageJson = await readFile(path.join(sourceDir, 'package.json'), 'utf8');
    const packageJson = JSON.parse(rawPackageJson);
    return packageJson && typeof packageJson === 'object' && packageJson.name === 'sharp';
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 Turbopack sharp 外部模块 package.json 失败：${sourceDir}。${message}`);
  }
}

export async function copySharpRuntime(rootDir = process.cwd()) {
  const standaloneDir = path.join(rootDir, '.next', 'standalone');
  for (const packageName of sharpRuntimePackages) {
    const sourcePackageDir = path.join(rootDir, 'node_modules', packageName);
    await assertDirectory(sourcePackageDir, 'standalone sharp 运行依赖');
    const targetPackageDir = path.join(standaloneDir, 'node_modules', packageName);
    console.info(`复制 standalone sharp 运行依赖：${sourcePackageDir} -> ${targetPackageDir}`);
    await copyDirectory(sourcePackageDir, targetPackageDir);
  }

  const sourceImgDir = path.join(rootDir, 'node_modules', '@img');
  await assertDirectory(sourceImgDir, 'standalone sharp 平台依赖目录');
  await assertDirectory(path.join(sourceImgDir, 'colour'), 'standalone sharp colour 依赖');
  const targetImgDir = path.join(standaloneDir, 'node_modules', '@img');
  const entries = await readdir(sourceImgDir, { withFileTypes: true });
  let copiedSharpBindingPackages = 0;
  let copiedSharpLibvipsPackages = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSharpPlatformRuntimePackage(entry.name)) continue;
    const source = path.join(sourceImgDir, entry.name);
    const target = path.join(targetImgDir, entry.name);
    console.info(`复制 standalone sharp 平台包：${source} -> ${target}`);
    await copyDirectory(source, target);
    if (isSharpBindingPackage(entry.name)) copiedSharpBindingPackages += 1;
    if (entry.name.startsWith('sharp-libvips-')) copiedSharpLibvipsPackages += 1;
  }
  if (copiedSharpBindingPackages === 0) {
    throw new Error(`standalone sharp native binding 依赖缺失：${sourceImgDir} 没有可复制的 @img/sharp-* binding 包`);
  }
  if (copiedSharpLibvipsPackages === 0) {
    throw new Error(`standalone sharp libvips 依赖缺失：${sourceImgDir} 没有可复制的 @img/sharp-libvips-* 包`);
  }

  const externalNodeModulesDir = path.join(rootDir, '.next', 'node_modules');
  if (!(await directoryExists(externalNodeModulesDir))) return;
  const externalEntries = await readdir(externalNodeModulesDir, { withFileTypes: true });
  const sourceSharpDir = path.join(rootDir, 'node_modules', 'sharp');
  if (!(await directoryExists(sourceSharpDir))) return;
  for (const entry of externalEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sharp-')) continue;
    const externalSource = path.join(externalNodeModulesDir, entry.name);
    if (!(await isSharpExternalModule(externalSource))) continue;
    const target = path.join(standaloneDir, '.next', 'node_modules', entry.name);
    console.info(`复制 standalone Turbopack sharp 外部模块：${sourceSharpDir} -> ${target}`);
    await copyDirectory(sourceSharpDir, target);
  }
}

export async function validateStandaloneSharpRuntime(rootDir = process.cwd()) {
  const standaloneDir = path.join(rootDir, '.next', 'standalone');
  const requireFromStandalone = createRequire(path.join(standaloneDir, 'runtime-check.cjs'));
  let sharpModule;
  try {
    const resolvedSharp = requireFromStandalone.resolve('sharp');
    const sharpPackageDir = path.join(standaloneDir, 'node_modules', 'sharp');
    for (const cachedPath of Object.keys(requireFromStandalone.cache)) {
      if (cachedPath === resolvedSharp || cachedPath.startsWith(`${sharpPackageDir}${path.sep}`)) {
        delete requireFromStandalone.cache[cachedPath];
      }
    }
    sharpModule = requireFromStandalone('sharp');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`standalone sharp 运行时加载失败：${message}`);
  }
  const sharp = sharpModule?.default ?? sharpModule;
  if (typeof sharp !== 'function') {
    throw new Error('standalone sharp 运行时加载失败：sharp 模块没有导出函数。');
  }
  try {
    const buffer = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .webp()
      .toBuffer();
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('sharp self-check returned an empty result');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`standalone sharp 运行时自检失败：${message}`);
  }
}

export async function patchStandaloneRuntime(rootDir = process.cwd()) {
  const sourceDir = path.join(rootDir, 'node_modules', 'next', 'dist', 'compiled', 'next-server');
  const targetDir = path.join(
    rootDir,
    '.next',
    'standalone',
    'node_modules',
    'next',
    'dist',
    'compiled',
    'next-server'
  );
  console.info(`准备补齐 standalone runtime：${targetDir}`);
  await mkdir(targetDir, { recursive: true });

  for (const filename of requiredFiles) {
    const source = path.join(sourceDir, filename);
    const target = path.join(targetDir, filename);
    console.info(`复制 standalone runtime 文件：${source} -> ${target}`);
    await assertFile(source);
    await copyFile(source, target);
  }
  await copySharpRuntime(rootDir);
  await validateStandaloneSharpRuntime(rootDir);
  console.info('standalone runtime 文件补齐完成。');
}

async function main() {
  try {
    await patchStandaloneRuntime(root);
  } catch (error) {
    console.error('补齐 standalone runtime 文件失败。', error);
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
