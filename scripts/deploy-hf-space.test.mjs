import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildUploadArgs, extractUploadCommitSha, parseRepositorySlug } from './deploy-hf-space.mjs';

describe('HF Space deploy script', () => {
    it('extracts the Space commit SHA from hf upload JSON output', () => {
        const sha = extractUploadCommitSha(
            [
                'Start hashing 189 files.',
                '{"url":"https://huggingface.co/spaces/misonL/gpt-image-playground-customer/commit/32151b6aeaec0e59f14d1aaa87fba160ca8410df"}'
            ].join('\n')
        );

        assert.equal(sha, '32151b6aeaec0e59f14d1aaa87fba160ca8410df');
    });

    it('rejects upload output without a Space commit URL', () => {
        assert.throws(() => extractUploadCommitSha('{"url":"https://huggingface.co/spaces/misonL/demo"}'), /commit SHA or commit URL/);
    });

    it('extracts the Space commit SHA from direct hf upload JSON fields', () => {
        assert.equal(
            extractUploadCommitSha('{"sha":"cccccccccccccccccccccccccccccccccccccccc"}'),
            'cccccccccccccccccccccccccccccccccccccccc'
        );
        assert.equal(
            extractUploadCommitSha('{"commit_sha":"dddddddddddddddddddddddddddddddddddddddd"}'),
            'dddddddddddddddddddddddddddddddddddddddd'
        );
    });

    it('extracts the Space commit SHA when hf prints warning lines before JSON', () => {
        const sha = extractUploadCommitSha(
            [
                '[WARN] retrying upload metadata',
                '{"url":"https://huggingface.co/spaces/misonL/gpt-image-playground-customer/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
                'done'
            ].join('\n')
        );

        assert.equal(sha, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });

    it('builds upload args without embedding newline characters in commit metadata', () => {
        const args = buildUploadArgs({
            sourceDir: '/tmp/source',
            localSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        });

        assert.equal(args.includes('--json'), true);
        assert.equal(args[args.indexOf('--commit-message') + 1], 'Deploy bbbbbbb to Docker Space');
        assert.equal(
            args[args.indexOf('--commit-description') + 1],
            'Source: MisonL/gpt-image-playground-customer@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        );
        assert.equal(args.some((arg) => arg.includes('\n')), false);
    });

    it('uses a provided repository slug in upload commit metadata', () => {
        const args = buildUploadArgs({
            sourceDir: '/tmp/source',
            localSha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            repoSlug: 'owner/repo'
        });

        assert.equal(args[args.indexOf('--commit-description') + 1], 'Source: owner/repo@eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    });

    it('parses GitHub repository slugs from common origin URL formats', () => {
        assert.equal(parseRepositorySlug('https://github.com/MisonL/gpt-image-playground-customer.git'), 'MisonL/gpt-image-playground-customer');
        assert.equal(parseRepositorySlug('git@github.com:MisonL/gpt-image-playground-customer.git'), 'MisonL/gpt-image-playground-customer');
        assert.equal(parseRepositorySlug('not-a-github-url'), 'MisonL/gpt-image-playground-customer');
    });
});
