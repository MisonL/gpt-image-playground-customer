import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = fileURLToPath(new URL('./test-postgres-live.mjs', import.meta.url));

describe('live PostgreSQL test launcher cleanup', () => {
    it('removes the temporary PostgreSQL container when the test command fails', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pg-live-launcher-'));
        const logPath = path.join(tempDir, 'docker.log');
        const binDir = path.join(tempDir, 'bin');
        await writeFile(path.join(tempDir, 'noop'), '');
        await writeFile(path.join(tempDir, 'node'), buildFailingNodeShim(), { mode: 0o755 });
        await writeFile(path.join(tempDir, 'docker'), buildDockerShim(logPath), { mode: 0o755 });
        await rm(binDir, { recursive: true, force: true });
        await import('node:fs/promises').then(({ mkdir }) => mkdir(binDir));
        await writeFile(path.join(binDir, 'node'), buildFailingNodeShim(), { mode: 0o755 });
        await writeFile(path.join(binDir, 'docker'), buildDockerShim(logPath), { mode: 0o755 });

        try {
            const result = spawnSync(process.execPath, [scriptPath], {
                cwd: repoRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
                }
            });

            assert.equal(result.status, 37, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
            const dockerLog = await readFile(logPath, 'utf8');
            assert.match(dockerLog, /^run /m);
            assert.match(dockerLog, /^exec /m);
            assert.match(dockerLog, /^port /m);
            assert.match(dockerLog, /^rm -f gpt-image-agent-test-pg-/m);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });
});

function buildFailingNodeShim() {
    return `#!/bin/sh
exit 37
`;
}

function buildDockerShim(logPath) {
    return `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
case "$1" in
  run)
    exit 0
    ;;
  exec)
    exit 0
    ;;
  port)
    printf '127.0.0.1:55432\\n'
    exit 0
    ;;
  rm)
    exit 0
    ;;
  *)
    exit 2
    ;;
esac
`;
}
