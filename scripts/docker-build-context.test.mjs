import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('Docker build context', () => {
    it('keeps the tracked real-upstream smoke template available to containerized tests', async () => {
        const [dockerignore, dockerfile, gitignore, realSmokeTemplate] = await Promise.all([
            readFile(new URL('../.dockerignore', import.meta.url), 'utf8'),
            readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
            readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
            readFile(new URL('../.env.real-smoke.example', import.meta.url), 'utf8')
        ]);

        assert.match(dockerignore, /^\.gitignore$/m);
        assert.match(dockerignore, /^!\.gitignore$/m);
        assert.match(dockerignore, /^\.env\.\*$/m);
        assert.match(dockerignore, /^!\.env\.real-smoke\.example$/m);
        assert.match(dockerfile, /^COPY \. \.$/m);
        assert.match(dockerfile, /^COPY vendor\/brace-expansion-compat \.\/vendor\/brace-expansion-compat$/m);
        assert.match(gitignore, /^!\.env\.real-smoke\.example$/m);
        assert.match(realSmokeTemplate, /^IMAGE_REAL_SMOKE_TIMEOUT_MS=240000$/m);
    });
});
