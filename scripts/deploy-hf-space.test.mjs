import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    GIT_ARCHIVE_MAX_BUFFER_BYTES,
    assertDeployMarkerMatches,
    buildDeployMarker,
    buildDeployMarkerRouteSource,
    isSpaceDeployPath,
    isHfUploadExistingSpacePolicyError,
    buildUploadArgs,
    extractUploadCommitSha,
    findRemoteDeletePaths,
    parseRepositorySlug,
    rewriteSpaceReadmeImageSources,
    waitForRunning
} from './deploy-hf-space.mjs';

describe('HF Space deploy script', () => {
    it('recognizes the existing Docker Space create-policy error for the Git deployment fallback', () => {
        const policyError = [
            'Set HF_DEBUG=1 as environment variable for full traceback.',
            "Error: Client error '402 Payment Required' for url 'https://huggingface.co/api/repos/create'",
            'Static Spaces are free for everyone, but hosting Gradio and Docker Spaces on free cpu-basic requires a PRO subscription.'
        ].join('\n');

        assert.equal(isHfUploadExistingSpacePolicyError(policyError), true);
        assert.equal(isHfUploadExistingSpacePolicyError("Client error '402 Payment Required' for url 'https://huggingface.co/api/models/create'"), false);
        assert.equal(isHfUploadExistingSpacePolicyError("Client error '401 Unauthorized' for url 'https://huggingface.co/api/repos/create'"), false);
    });

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
            localSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            repoSlug: 'MisonL/gpt-image-playground-customer'
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
        assert.throws(() => parseRepositorySlug('not-a-github-url'), /Set REPO_SLUG=owner\/repo/);
    });

    it('requires an explicit repository slug for upload metadata', () => {
        assert.throws(
            () =>
                buildUploadArgs({
                    sourceDir: '/tmp/source',
                    localSha: 'ffffffffffffffffffffffffffffffffffffffff'
                }),
            /REPO_SLUG is required/
        );
    });

    it('keeps enough buffer for repository archives used by Space uploads', () => {
        assert.ok(GIT_ARCHIVE_MAX_BUFFER_BYTES >= 128 * 1024 * 1024);
    });

    it('excludes README documentation binaries from the Space source tree', () => {
        assert.equal(isSpaceDeployPath('README.md'), true);
        assert.equal(isSpaceDeployPath('src/app/page.tsx'), true);
        assert.equal(isSpaceDeployPath('readme-images/interface.jpg'), false);
        assert.equal(isSpaceDeployPath('readme-images/nested/example.jpg'), false);
    });

    it('rewrites local README image sources to immutable GitHub sources for the Space', () => {
        const localSha = '1111111111111111111111111111111111111111';
        const readme = '<img src="./readme-images/interface.jpg?v=123" alt="Interface" />';

        assert.equal(
            rewriteSpaceReadmeImageSources(readme, 'owner/repo', localSha),
            `<img src="https://raw.githubusercontent.com/owner/repo/${localSha}/readme-images/interface.jpg?v=123" alt="Interface" />`
        );
    });

    it('adds delete args for remote files that are no longer in git HEAD', () => {
        const args = buildUploadArgs({
            sourceDir: '/tmp/source',
            localSha: '1111111111111111111111111111111111111111',
            repoSlug: 'owner/repo',
            deletePaths: ['old-file.md', 'scripts/old-script.mjs']
        });

        assert.deepEqual(args.slice(-4), ['--delete', 'old-file.md', '--delete', 'scripts/old-script.mjs']);
    });

    it('rejects unsafe delete path values before invoking hf upload', () => {
        assert.throws(
            () =>
                buildUploadArgs({
                    sourceDir: '/tmp/source',
                    localSha: '2222222222222222222222222222222222222222',
                    repoSlug: 'owner/repo',
                    deletePaths: ['bad\npath']
                }),
            /deletePaths must contain/
        );
    });

    it('finds stale remote files deterministically', () => {
        assert.deepEqual(
            findRemoteDeletePaths(new Set(['README.md', 'src/app.ts']), ['old.md', 'src/app.ts', 'README.md']),
            ['old.md']
        );
    });

    it('builds a non-secret deploy marker for service-side deployment verification', () => {
        const marker = buildDeployMarker(
            '3333333333333333333333333333333333333333',
            new Date('2026-06-20T10:00:00.000Z'),
            'deploy-333'
        );

        assert.deepEqual(marker, {
            schema_version: 1,
            local_sha: '3333333333333333333333333333333333333333',
            created_at: '2026-06-20T10:00:00.000Z',
            deploy_id: 'deploy-333'
        });
        assert.doesNotMatch(JSON.stringify(marker), /key|token|secret|password/i);
    });

    it('builds a unique deploy marker id when none is provided', () => {
        const first = buildDeployMarker('3333333333333333333333333333333333333333', new Date('2026-06-20T10:00:00.000Z'));
        const second = buildDeployMarker('3333333333333333333333333333333333333333', new Date('2026-06-20T10:00:00.000Z'));

        assert.match(first.deploy_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.notEqual(first.deploy_id, second.deploy_id);
    });

    it('rejects short deploy marker commit shas before upload', () => {
        assert.throws(() => buildDeployMarker('3333333'), /full git commit SHA/);
    });

    it('rejects unsafe deploy marker ids before upload', () => {
        assert.throws(
            () =>
                buildDeployMarker(
                    '3333333333333333333333333333333333333333',
                    new Date('2026-06-20T10:00:00.000Z'),
                    'deploy\n333'
                ),
            /deployId must be/
        );
    });

    it('rejects stale deploy markers from an older same-commit deployment', () => {
        const expected = buildDeployMarker(
            '3333333333333333333333333333333333333333',
            new Date('2026-06-20T10:00:00.000Z'),
            'deploy-current'
        );
        const stale = buildDeployMarker(
            '3333333333333333333333333333333333333333',
            new Date('2026-06-20T09:00:00.000Z'),
            'deploy-stale'
        );

        assert.throws(() => assertDeployMarkerMatches(stale, expected), /created_at mismatch/);
        assert.deepEqual(assertDeployMarkerMatches(expected, expected), expected);
    });

    it('rejects deploy markers with a stale deploy id even when the source commit and timestamp match', () => {
        const expected = buildDeployMarker(
            '3333333333333333333333333333333333333333',
            new Date('2026-06-20T10:00:00.000Z'),
            'deploy-current'
        );
        const stale = {
            ...expected,
            deploy_id: 'deploy-stale'
        };

        assert.throws(() => assertDeployMarkerMatches(stale, expected), /deploy_id mismatch/);
    });

    it('waits for the public service marker after management reports the new Space commit running', async () => {
        const marker = buildDeployMarker(
            '5555555555555555555555555555555555555555',
            new Date('2026-06-20T12:00:00.000Z'),
            'deploy-555'
        );
        let verifyCount = 0;

        const runtime = await waitForRunning('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', marker, {
            attempts: 2,
            intervalMs: 0,
            readInfo: () => ({
                runtime: { stage: 'RUNNING' },
                sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            }),
            verifyMarker: async () => {
                verifyCount += 1;
                if (verifyCount === 1) throw new Error('deploy marker deploy_id mismatch');
                return marker;
            },
            sleep: async () => {},
            log: () => {}
        });

        assert.equal(verifyCount, 2);
        assert.deepEqual(runtime, {
            stage: 'RUNNING',
            sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            service_marker_verified: true,
            marker
        });
    });

    it('builds a no-store API route for service-side deploy marker verification', () => {
        const marker = buildDeployMarker(
            '4444444444444444444444444444444444444444',
            new Date('2026-06-20T11:00:00.000Z'),
            'deploy-444'
        );
        const source = buildDeployMarkerRouteSource(marker);

        assert.match(source, /NextResponse\.json/);
        assert.match(source, /Cache-Control/);
        assert.match(source, /no-store/);
        assert.match(source, /4444444444444444444444444444444444444444/);
        assert.match(source, /deploy-444/);
        assert.doesNotMatch(source, /key|token|secret|password/i);
    });

    it('keeps the generated deploy markers from being deleted on upload', () => {
        assert.deepEqual(
            findRemoteDeletePaths(new Set(['README.md', 'public/hf-space-deploy-marker.json', 'src/app/api/deploy-marker/route.ts']), [
                'README.md',
                'public/hf-space-deploy-marker.json',
                'src/app/api/deploy-marker/route.ts',
                'old.md'
            ]),
            ['old.md']
        );
    });
});
