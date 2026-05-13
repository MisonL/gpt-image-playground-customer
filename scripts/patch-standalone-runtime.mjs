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
  const info = await stat(filepath);
  if (!info.isFile()) {
    throw new Error(`预期是文件，但实际不是文件路径：${filepath}`);
  }
}

await mkdir(targetDir, { recursive: true });

for (const filename of requiredFiles) {
  const source = path.join(sourceDir, filename);
  const target = path.join(targetDir, filename);
  await assertFile(source);
  await copyFile(source, target);
}
