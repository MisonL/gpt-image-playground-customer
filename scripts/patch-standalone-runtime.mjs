#!/usr/bin/env node
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const requiredFiles = [
  'app-route-turbo.runtime.prod.js',
  'app-route-turbo.runtime.prod.js.map'
];

const root = process.cwd();
const sourceDir = path.join(root, 'node_modules', 'next', 'dist', 'compiled', 'next-server');
const targetDir = path.join(
  root,
  '.next',
  'standalone',
  'node_modules',
  'next',
  'dist',
  'compiled',
  'next-server'
);

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

try {
  console.info(`准备补齐 standalone runtime：${targetDir}`);
  await mkdir(targetDir, { recursive: true });

  for (const filename of requiredFiles) {
    const source = path.join(sourceDir, filename);
    const target = path.join(targetDir, filename);
    console.info(`复制 standalone runtime 文件：${source} -> ${target}`);
    await assertFile(source);
    await copyFile(source, target);
  }
  console.info('standalone runtime 文件补齐完成。');
} catch (error) {
  console.error('补齐 standalone runtime 文件失败。', error);
  process.exit(1);
}
