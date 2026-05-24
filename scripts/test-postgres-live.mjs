#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const testFiles = ['src/lib/agent-state-postgres.test.ts', 'src/app/api/agent/agent-routes.test.ts'];
const POSTGRES_READY_ATTEMPTS = 30;
const POSTGRES_READY_INTERVAL_MS = 1000;

class CommandFailedError extends Error {
  constructor(command, args, status) {
    super(`${command} ${args.join(' ')} failed with exit code ${status}`);
    this.status = status;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : options.silent ? 'ignore' : 'inherit',
    encoding: 'utf8',
    env: options.env || process.env
  });
  if (options.capture) {
    return result;
  }
  if (result.status !== 0) {
    throw new CommandFailedError(command, args, result.status || 1);
  }
  return result;
}

function runTests(databaseUrl) {
  run('node', ['--test', '--import', 'tsx', ...testFiles], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AGENT_POSTGRES_TEST_DATABASE_URL: databaseUrl
    }
  });
}

async function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < POSTGRES_READY_ATTEMPTS; attempt += 1) {
    const result = spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'agent_test', '-d', 'agent_test'], {
      stdio: 'ignore'
    });
    if (result.status === 0) return;
    await delay(POSTGRES_READY_INTERVAL_MS);
  }
  throw new Error('临时 PostgreSQL 容器未就绪');
}

function readMappedPort(containerName) {
  const result = run('docker', ['port', containerName, '5432/tcp'], { capture: true });
  if (result.status !== 0) {
    throw new Error(result.stderr || '读取 PostgreSQL 映射端口失败');
  }
  const line = result.stdout.trim().split('\n')[0] || '';
  const match = line.match(/:(\d+)$/);
  if (!match) {
    throw new Error(`docker port 输出不符合预期：${line}`);
  }
  return match[1];
}

if (process.env.AGENT_POSTGRES_TEST_DATABASE_URL) {
  runTests(process.env.AGENT_POSTGRES_TEST_DATABASE_URL);
  process.exit(0);
}

const containerName = `gpt-image-agent-test-pg-${Date.now()}`;

try {
  run('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '-e',
    'POSTGRES_DB=agent_test',
    '-e',
    'POSTGRES_USER=agent_test',
    '-e',
    'POSTGRES_PASSWORD=agent_test',
    '-p',
    '127.0.0.1::5432',
    'postgres:16-alpine'
  ], { silent: true });
  await waitForPostgres(containerName);
  const port = readMappedPort(containerName);
  runTests(`postgres://agent_test:agent_test@127.0.0.1:${port}/agent_test`);
} catch (error) {
  process.exitCode = error instanceof CommandFailedError ? error.status : 1;
  if (!(error instanceof CommandFailedError)) {
    console.error(error instanceof Error ? error.message : String(error));
  }
} finally {
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
}
