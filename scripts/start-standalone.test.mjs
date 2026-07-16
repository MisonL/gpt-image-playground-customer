import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve('scripts/start-standalone.mjs');

async function readLoadedEnvironment(root, env = {}) {
    const source = `
    import { loadStandaloneEnvironment } from ${JSON.stringify(scriptPath)};
    loadStandaloneEnvironment(${JSON.stringify(root)});
    console.log(JSON.stringify({
      shared: process.env.START_STANDALONE_TEST_SHARED,
      production: process.env.START_STANDALONE_TEST_PRODUCTION,
      local: process.env.START_STANDALONE_TEST_LOCAL,
      productionLocal: process.env.START_STANDALONE_TEST_PRODUCTION_LOCAL
    }));
  `;
    const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', source], {
        env: { PATH: process.env.PATH, ...env }
    });
    return JSON.parse(result.stdout.trim());
}

describe('standalone 环境加载', () => {
    it('按照 Next 生产环境优先级加载仓库根目录 env 文件', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'gipc-standalone-env-'));
        try {
            await Promise.all([
                writeFile(
                    path.join(root, '.env'),
                    'START_STANDALONE_TEST_SHARED=env\nSTART_STANDALONE_TEST_LOCAL=env\n'
                ),
                writeFile(
                    path.join(root, '.env.production'),
                    'START_STANDALONE_TEST_SHARED=production\nSTART_STANDALONE_TEST_PRODUCTION=production\n'
                ),
                writeFile(
                    path.join(root, '.env.local'),
                    'START_STANDALONE_TEST_SHARED=local\nSTART_STANDALONE_TEST_LOCAL=local\n'
                ),
                writeFile(
                    path.join(root, '.env.production.local'),
                    'START_STANDALONE_TEST_SHARED=production-local\nSTART_STANDALONE_TEST_PRODUCTION_LOCAL=production-local\n'
                )
            ]);

            assert.deepEqual(await readLoadedEnvironment(root), {
                shared: 'production-local',
                production: 'production',
                local: 'local',
                productionLocal: 'production-local'
            });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('保留启动 shell 中显式设置的环境变量', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'gipc-standalone-env-'));
        try {
            await writeFile(path.join(root, '.env.local'), 'START_STANDALONE_TEST_SHARED=file\n');

            const loaded = await readLoadedEnvironment(root, {
                START_STANDALONE_TEST_SHARED: 'shell'
            });

            assert.equal(loaded.shared, 'shell');
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
