import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { GIT_DEPLOY_AUTHOR_EMAIL, GIT_DEPLOY_AUTHOR_NAME } from './deploy-hf-space.mjs';
import { FORMAL_PRODUCT_NAME } from './status.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function readRepositoryText(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('product branding', () => {
    it('uses the formal product name in Hugging Face metadata and the browser icon', () => {
        const readme = readRepositoryText('README.md');
        const favicon = readRepositoryText('public/favicon.svg');

        assert.match(
            readme,
            /^---\ntitle: 图像手记 \/ Visual Journal\nshort_description: 本地优先的 AI 图片创作工作台\nsdk: docker\napp_port: 4783\n---/m
        );
        assert.match(favicon, /<title>图像手记 \/ Visual Journal<\/title>/);
    });

    it('offers an isolated private Hugging Face Space copy without sharing production credentials', () => {
        const readme = readRepositoryText('README.md');

        assert.match(
            readme,
            /https:\/\/huggingface\.co\/spaces\/misonL\/gpt-image-playground-customer\?duplicate=true/
        );
        assert.match(readme, /复制流程默认创建私有 Space，不会复制本服务的 API Key、访问码或 Agent token。/);
    });

    it('uses the formal product name in access-code guidance and history downloads', () => {
        const translations = readRepositoryText('src/lib/i18n.tsx');
        const page = readRepositoryText('src/app/page.tsx');

        assert.match(translations, /'password\.entryDescription': '请输入访问码以使用图像手记服务。'/);
        assert.match(translations, /'password\.entryDescription': 'Enter the access code to use Visual Journal.'/);
        assert.match(page, /link\.download = `visual-journal-history-\$\{item\.timestamp\}\.zip`;/);
    });

    it('uses Visual Journal identifiers for automated Space maintenance', () => {
        const keepalive = readRepositoryText('scripts/keepalive-hf-space.mjs');

        assert.match(keepalive, /const KEEPALIVE_USER_AGENT = 'visual-journal-keepalive\/1\.0';/);
        assert.match(keepalive, /'User-Agent': KEEPALIVE_USER_AGENT/);
        assert.equal(GIT_DEPLOY_AUTHOR_NAME, 'Visual Journal deploy');
        assert.equal(GIT_DEPLOY_AUTHOR_EMAIL, 'deploy@visual-journal.local');
    });

    it('uses the formal product name in operational status while retaining the package identifier', () => {
        const status = readRepositoryText('scripts/status.mjs');

        assert.equal(FORMAL_PRODUCT_NAME, '图像手记 / Visual Journal');
        assert.match(status, /product: FORMAL_PRODUCT_NAME,/);
        assert.match(status, /package_name: packageJson\.name,/);
    });
});
