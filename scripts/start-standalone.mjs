#!/usr/bin/env node
import { cp, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');
const serverPath = path.join(standaloneDir, 'server.js');

async function exists(filepath) {
  try {
    await stat(filepath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfPresent(source, destination) {
  if (!(await exists(source))) return;
  await cp(source, destination, { recursive: true, force: true });
}

if (!(await exists(serverPath))) {
  console.error('[ERROR] Standalone build was not found. Run npm run build before npm run start.');
  process.exit(1);
}

await copyIfPresent(path.join(root, 'public'), path.join(standaloneDir, 'public'));
await copyIfPresent(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'));

const child = spawn(process.execPath, [serverPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    IMAGE_OUTPUT_DIR: process.env.IMAGE_OUTPUT_DIR || path.join(root, 'generated-images'),
    AGENT_SQLITE_PATH: process.env.AGENT_SQLITE_PATH || path.join(root, 'generated-images', '.agent-state', 'agent.sqlite'),
    PORT: process.env.PORT || '4783',
    HOSTNAME: process.env.HOSTNAME || '0.0.0.0'
  }
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
