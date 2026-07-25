#!/usr/bin/env node
import { fetchJsonWithTimeout, parseJsonPayload, runCommandStrict } from './command-center-utils.mjs';
import { assertKnownOptions, HF_SPACE_ID, HF_SPACE_URL, isMainModule } from './hf-space-doctor-utils.mjs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const STATUS_POLL_ATTEMPTS = 40;
const STATUS_POLL_INTERVAL_MS = 10_000;
const PUBLIC_ENDPOINT_TIMEOUT_MS = 10_000;
const HF_CLI_TIMEOUT_MS = 120_000;
const DEPLOY_MARKER_REPO_PATH = 'public/hf-space-deploy-marker.json';
const DEPLOY_MARKER_API_ROUTE_PATH = 'src/app/api/deploy-marker/route.ts';
const DEPLOY_MARKER_SERVICE_PATH = '/api/deploy-marker';
const HF_SPACE_GIT_REMOTE_URL = `https://huggingface.co/spaces/${HF_SPACE_ID}`;
const GIT_DEPLOY_AUTHOR_NAME = 'gpt-image-playground deploy';
const GIT_DEPLOY_AUTHOR_EMAIL = 'deploy@localhost';
export const GIT_ARCHIVE_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const SPACE_DEPLOY_EXCLUDED_PATH_PREFIXES = ['readme-images/'];

function parseArgs(argv) {
    assertKnownOptions(argv, ['--help', '-h']);
    return {
        help: argv.includes('--help') || argv.includes('-h')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run deploy:hf-space

Deploys the current clean git HEAD to ${HF_SPACE_ID}.

Existing Docker Spaces use an authenticated Git push. Other Space types try the
official hf CLI first. The script waits for the Space to run the new commit and
performs read-only public endpoint checks.`);
}

function runText(command, args, options = {}) {
    return runCommandStrict(command, args, {
        input: options.input,
        timeoutMs: options.timeoutMs || HF_CLI_TIMEOUT_MS
    }).trim();
}

function readRepositorySlug() {
    const envSlug = process.env.REPO_SLUG?.trim();
    if (envSlug) return envSlug;
    try {
        return parseRepositorySlug(runText('git', ['remote', 'get-url', 'origin']));
    } catch (error) {
        throw new Error(
            `Unable to detect repository slug from git origin. Set REPO_SLUG=owner/repo. ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export function parseRepositorySlug(remoteUrl) {
    const text = String(remoteUrl || '').trim();
    const httpsMatch = text.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
    const sshMatch = text.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
    throw new Error('Unable to detect repository slug from git origin URL. Set REPO_SLUG=owner/repo.');
}

function runBinary(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'buffer',
        maxBuffer: GIT_ARCHIVE_MAX_BUFFER_BYTES,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.error) throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
    if (result.status !== 0) {
        const output = result.stderr.toString('utf8').trim();
        throw new Error(output || `${command} ${args.join(' ')} failed`);
    }
    return result.stdout;
}

function assertCleanGitWorktree() {
    const status = runText('git', ['status', '--porcelain']);
    if (status) {
        throw new Error('Refusing to deploy a dirty worktree. Commit or revert local changes first.');
    }
}

export function isSpaceDeployPath(filePath) {
    const normalized = String(filePath || '')
        .replaceAll('\\', '/')
        .replace(/^\.\//, '');
    return (
        normalized.length > 0 && !SPACE_DEPLOY_EXCLUDED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    );
}

export function rewriteSpaceReadmeImageSources(readme, repoSlug, localSha) {
    if (!repoSlug?.trim()) throw new Error('repoSlug is required when rewriting Space README image sources.');
    if (!/^[0-9a-f]{40}$/.test(String(localSha || ''))) {
        throw new Error('localSha must be a full git commit SHA when rewriting Space README image sources.');
    }
    return String(readme).replace(/(['"])(?:\.\/)?(readme-images\/[^'"]+)\1/g, (_, quote, imagePath) => {
        return `${quote}https://raw.githubusercontent.com/${repoSlug}/${localSha}/${imagePath}${quote}`;
    });
}

function prepareSourceTree(repoSlug, localSha) {
    const sourceDir = mkdtempSync(join(tmpdir(), 'gpt-image-hf-space-'));
    const archive = runBinary('git', ['archive', '--format=tar', 'HEAD']);
    runText('tar', ['-x', '-C', sourceDir], { input: archive });
    rmSync(join(sourceDir, 'readme-images'), { force: true, recursive: true });
    const readmePath = join(sourceDir, 'README.md');
    writeFileSync(
        readmePath,
        rewriteSpaceReadmeImageSources(readFileSync(readmePath, 'utf8'), repoSlug, localSha),
        'utf8'
    );
    return sourceDir;
}

export function extractUploadCommitSha(output) {
    const payload = parseJsonPayload(output, 'hf upload');
    const directSha = [payload.sha, payload.commit, payload.commitSha, payload.commit_sha].find((value) =>
        /^[0-9a-f]{40}$/.test(String(value || ''))
    );
    if (directSha) return directSha;

    const match = String(payload.url || '').match(/\/commit\/([0-9a-f]{40})$/);
    if (!match) throw new Error('hf upload output did not include a Space commit SHA or commit URL.');
    return match[1];
}

export function isHfUploadExistingSpacePolicyError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return (
        /\b402 Payment Required\b/i.test(message) &&
        /huggingface\.co\/api\/repos\/create/i.test(message) &&
        /Docker Spaces?.*(?:PRO|subscription)/is.test(message)
    );
}

export function shouldUseGitPushForSpace(spaceInfo) {
    return spaceInfo?.sdk === 'docker';
}

export function buildUploadArgs({ sourceDir, localSha, repoSlug, deletePaths = [] }) {
    if (!repoSlug?.trim()) throw new Error('REPO_SLUG is required for deploy metadata.');
    const args = [
        'upload',
        HF_SPACE_ID,
        sourceDir,
        '.',
        '--repo-type',
        'space',
        '--commit-message',
        `Deploy ${localSha.slice(0, 7)} to Docker Space`,
        '--commit-description',
        `Source: ${repoSlug}@${localSha}`,
        '--json'
    ];
    for (const deletePath of deletePaths) {
        if (!deletePath?.trim() || deletePath.includes('\n') || deletePath.includes('\r')) {
            throw new Error('deletePaths must contain non-empty single-line repository paths.');
        }
        args.push('--delete', deletePath);
    }
    return args;
}

function readLocalGitFiles() {
    const output = runText('git', ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', 'HEAD']);
    return new Set(output.split('\0').filter(isSpaceDeployPath));
}

function readRemoteFilePaths(info) {
    return (info.siblings || [])
        .map((sibling) => sibling.rfilename)
        .filter((filename) => typeof filename === 'string' && filename.length > 0);
}

export function findRemoteDeletePaths(localFiles, remoteFiles) {
    return [...remoteFiles].filter((filename) => !localFiles.has(filename)).sort();
}

export function buildDeployMarker(localSha, createdAt = new Date(), deployId = randomUUID()) {
    if (!/^[0-9a-f]{40}$/.test(String(localSha || ''))) throw new Error('localSha must be a full git commit SHA.');
    if (typeof deployId !== 'string' || !deployId.trim() || /[\r\n]/.test(deployId)) {
        throw new Error('deployId must be a non-empty single-line string.');
    }
    return {
        schema_version: 1,
        local_sha: localSha,
        created_at: createdAt.toISOString(),
        deploy_id: deployId
    };
}

export function assertDeployMarkerMatches(marker, expectedMarker) {
    if (!marker || typeof marker !== 'object') throw new Error('deploy marker response was not an object.');
    if (marker?.schema_version !== expectedMarker.schema_version)
        throw new Error('deploy marker schema_version mismatch.');
    if (marker.local_sha !== expectedMarker.local_sha) {
        throw new Error(
            `deploy marker local_sha mismatch: expected ${expectedMarker.local_sha}, received ${marker.local_sha || 'missing'}.`
        );
    }
    if (marker.created_at !== expectedMarker.created_at) {
        throw new Error(
            `deploy marker created_at mismatch: expected ${expectedMarker.created_at}, received ${marker.created_at || 'missing'}.`
        );
    }
    if (marker.deploy_id !== expectedMarker.deploy_id) {
        throw new Error(
            `deploy marker deploy_id mismatch: expected ${expectedMarker.deploy_id}, received ${marker.deploy_id || 'missing'}.`
        );
    }
    return marker;
}

export function buildDeployMarkerRouteSource(marker) {
    const markerJson = JSON.stringify(marker);
    return `import { NextResponse } from 'next/server';

const deployMarker = ${markerJson} as const;

export const dynamic = 'force-dynamic';

export function GET() {
    return NextResponse.json(deployMarker, {
        headers: {
            'Cache-Control': 'no-store'
        }
    });
}
`;
}

function writeDeployMarker(sourceDir, marker) {
    const markerPath = join(sourceDir, DEPLOY_MARKER_REPO_PATH);
    const routePath = join(sourceDir, DEPLOY_MARKER_API_ROUTE_PATH);
    mkdirSync(join(sourceDir, 'public'), { recursive: true });
    mkdirSync(join(sourceDir, 'src', 'app', 'api', 'deploy-marker'), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    writeFileSync(routePath, buildDeployMarkerRouteSource(marker), 'utf8');
}

function readLocalGitFilesWithDeployMarker() {
    const files = readLocalGitFiles();
    files.add(DEPLOY_MARKER_REPO_PATH);
    files.add(DEPLOY_MARKER_API_ROUTE_PATH);
    return files;
}

function uploadSourceTree(sourceDir, deployMarker, repoSlug) {
    writeDeployMarker(sourceDir, deployMarker);
    const remoteSpace = readSpaceInfo();
    const deletePaths = findRemoteDeletePaths(readLocalGitFilesWithDeployMarker(), readRemoteFilePaths(remoteSpace));
    if (shouldUseGitPushForSpace(remoteSpace)) {
        console.log('Deploying the existing Docker Space via an authenticated Git push.');
        return {
            spaceCommitSha: uploadSourceTreeWithGit(sourceDir, deployMarker),
            transport: 'git_push_existing_docker_space'
        };
    }
    try {
        const output = runText(
            'hf',
            buildUploadArgs({ sourceDir, localSha: deployMarker.local_sha, repoSlug, deletePaths })
        );
        return { spaceCommitSha: extractUploadCommitSha(output), transport: 'hf_upload' };
    } catch (error) {
        if (!isHfUploadExistingSpacePolicyError(error)) throw error;
        console.warn(
            'hf upload was blocked by the existing Docker Space create policy; falling back to an authenticated Git push.'
        );
        return { spaceCommitSha: uploadSourceTreeWithGit(sourceDir, deployMarker), transport: 'git_push_fallback' };
    }
}

function uploadSourceTreeWithGit(sourceDir, deployMarker) {
    const worktreeDir = mkdtempSync(join(tmpdir(), 'gpt-image-hf-space-git-'));
    try {
        runText('git', ['clone', '--depth', '1', HF_SPACE_GIT_REMOTE_URL, worktreeDir]);
        replaceGitWorktreeContents(worktreeDir, sourceDir);
        runText('git', ['-C', worktreeDir, 'add', '--all']);
        runText('git', [
            '-C',
            worktreeDir,
            '-c',
            `user.name=${GIT_DEPLOY_AUTHOR_NAME}`,
            '-c',
            `user.email=${GIT_DEPLOY_AUTHOR_EMAIL}`,
            'commit',
            '--no-gpg-sign',
            '--message',
            `Deploy ${deployMarker.local_sha.slice(0, 7)} to Docker Space`
        ]);
        const spaceCommitSha = runText('git', ['-C', worktreeDir, 'rev-parse', 'HEAD']);
        if (!/^[0-9a-f]{40}$/.test(spaceCommitSha)) {
            throw new Error('Git fallback did not create a full Space commit SHA.');
        }
        runText('git', ['-C', worktreeDir, 'push', 'origin', 'HEAD:main']);
        return spaceCommitSha;
    } finally {
        rmSync(worktreeDir, { force: true, recursive: true });
    }
}

function replaceGitWorktreeContents(worktreeDir, sourceDir) {
    for (const entry of readdirSync(worktreeDir)) {
        if (entry === '.git') continue;
        rmSync(join(worktreeDir, entry), { force: true, recursive: true });
    }
    for (const entry of readdirSync(sourceDir)) {
        cpSync(join(sourceDir, entry), join(worktreeDir, entry), { force: true, recursive: true });
    }
}

function readSpaceInfo() {
    const output = runText('hf', ['spaces', 'info', HF_SPACE_ID, '--format', 'json']);
    return parseJsonPayload(output, 'hf spaces info');
}

export function isRetryableSpaceInfoReadError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return [
        /\b(?:httpcore|httpx)\.(?:ConnectError|ReadError|ReadTimeout|ConnectTimeout|RemoteProtocolError)\b/i,
        /\bSSL:\s*(?:UNEXPECTED_EOF_WHILE_READING|SYSCALL)\b/i,
        /\bEOF occurred in violation of protocol\b/i,
        /\b(?:connection reset by peer|connection aborted|network is unreachable|temporary failure in name resolution)\b/i
    ].some((pattern) => pattern.test(message));
}

export async function waitForRunning(spaceCommitSha, deployMarker, options = {}) {
    const attempts = options.attempts || STATUS_POLL_ATTEMPTS;
    const intervalMs = options.intervalMs ?? STATUS_POLL_INTERVAL_MS;
    const readInfo = options.readInfo || readSpaceInfo;
    const verifyMarker = options.verifyMarker || verifyDeployMarker;
    const sleep = options.sleep || delay;
    const log = options.log || console.log;
    let lastStage = 'unknown';
    let lastSha = 'unknown';
    let lastMarkerError = 'unknown';
    let lastManagementError = 'none';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let info;
        try {
            info = await readInfo();
        } catch (error) {
            lastManagementError = error instanceof Error ? error.message : String(error);
            if (!isRetryableSpaceInfoReadError(error)) throw error;
            log(`attempt=${attempt} management_status=unavailable error=${lastManagementError}`);
            await sleep(intervalMs);
            continue;
        }
        lastStage = info.runtime?.stage || 'unknown';
        lastSha = info.sha || info.runtime?.raw?.sha || 'unknown';
        log(`attempt=${attempt} stage=${lastStage} sha=${lastSha}`);
        if (lastStage === 'RUNNING' && lastSha === spaceCommitSha) {
            try {
                const marker = await verifyMarker(deployMarker);
                return { stage: lastStage, sha: lastSha, service_marker_verified: true, marker };
            } catch (error) {
                lastMarkerError = error instanceof Error ? error.message : String(error);
                log(`attempt=${attempt} marker_status=not_ready error=${lastMarkerError}`);
            }
        }
        await sleep(intervalMs);
    }
    const marker = await verifyMarker(deployMarker);
    return {
        stage: lastStage,
        sha: lastSha,
        management_status: 'runtime_stage_not_running',
        service_marker_verified: true,
        warning: `Space did not reach RUNNING with a matching service marker for ${spaceCommitSha}; last stage=${lastStage} sha=${lastSha} marker_error=${lastMarkerError} management_error=${lastManagementError}`,
        marker
    };
}

async function fetchJson(path) {
    return fetchJsonWithTimeout(new URL(path, HF_SPACE_URL), { timeoutMs: PUBLIC_ENDPOINT_TIMEOUT_MS });
}

async function verifyDeployMarker(expectedMarker) {
    const marker = await fetchJson(`${DEPLOY_MARKER_SERVICE_PATH}?t=${Date.now()}`);
    return assertDeployMarkerMatches(marker, expectedMarker);
}

async function verifyPublicEndpoints() {
    const authStatus = await fetchJson('/api/auth-status');
    const capabilities = await fetchJson('/api/agent/capabilities');
    const runtime = await fetchJson('/api/runtime-capabilities');

    if (authStatus.passwordRequired !== true) {
        throw new Error('/api/auth-status did not report passwordRequired=true.');
    }
    if (capabilities.defaults?.state_backend !== 'memory') {
        throw new Error('/api/agent/capabilities did not report state_backend=memory.');
    }
    if (capabilities.storage?.image_storage_mode !== 'indexeddb') {
        throw new Error('/api/agent/capabilities did not report image_storage_mode=indexeddb.');
    }
    return {
        passwordRequired: authStatus.passwordRequired,
        agentAuth: capabilities.auth,
        stateBackend: capabilities.defaults.state_backend,
        imageStorageMode: capabilities.storage.image_storage_mode,
        streamingBatch: runtime.streamingBatch
    };
}

async function deploy() {
    assertCleanGitWorktree();
    runText('hf', ['auth', 'whoami']);
    const localSha = runText('git', ['rev-parse', 'HEAD']);
    const repoSlug = readRepositorySlug();
    const deployMarker = buildDeployMarker(localSha);
    const sourceDir = prepareSourceTree(repoSlug, localSha);
    try {
        const { spaceCommitSha, transport } = uploadSourceTree(sourceDir, deployMarker, repoSlug);
        const runtime = await waitForRunning(spaceCommitSha, deployMarker);
        const verification = await verifyPublicEndpoints();
        console.log(
            JSON.stringify(
                {
                    ok: true,
                    spaceId: HF_SPACE_ID,
                    spaceUrl: HF_SPACE_URL,
                    localSha,
                    spaceCommitSha,
                    transport,
                    runtime,
                    verification
                },
                null,
                2
            )
        );
    } finally {
        rmSync(sourceDir, { force: true, recursive: true });
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    await deploy();
}

if (isMainModule(import.meta.url, process.argv[1])) {
    main().catch((error) => {
        console.error(
            JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)
        );
        process.exit(1);
    });
}
