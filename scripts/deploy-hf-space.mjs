#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { fetchJsonWithTimeout, parseJsonPayload, runCommandStrict } from './command-center-utils.mjs';
import { assertKnownOptions, HF_SPACE_ID, HF_SPACE_URL, isMainModule } from './hf-space-doctor-utils.mjs';

const STATUS_POLL_ATTEMPTS = 40;
const STATUS_POLL_INTERVAL_MS = 10_000;
const PUBLIC_ENDPOINT_TIMEOUT_MS = 10_000;
const HF_CLI_TIMEOUT_MS = 120_000;
const DEPLOY_MARKER_REPO_PATH = 'public/hf-space-deploy-marker.json';
const DEPLOY_MARKER_API_ROUTE_PATH = 'src/app/api/deploy-marker/route.ts';
const DEPLOY_MARKER_SERVICE_PATH = '/api/deploy-marker';
export const GIT_ARCHIVE_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

function parseArgs(argv) {
    assertKnownOptions(argv, ['--help', '-h']);
    return {
        help: argv.includes('--help') || argv.includes('-h')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run deploy:hf-space

Deploys the current clean git HEAD to ${HF_SPACE_ID} with the official hf CLI.

The script uploads a temporary git archive, waits for the Space to run the new
Space commit, and performs read-only public endpoint checks.`);
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

function prepareSourceTree() {
    const sourceDir = mkdtempSync(join(tmpdir(), 'gpt-image-hf-space-'));
    const archive = runBinary('git', ['archive', '--format=tar', 'HEAD']);
    runText('tar', ['-x', '-C', sourceDir], { input: archive });
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
    return new Set(output.split('\0').filter(Boolean));
}

function readRemoteFilePaths() {
    const info = readSpaceInfo();
    return (info.siblings || []).map((sibling) => sibling.rfilename).filter((filename) => typeof filename === 'string' && filename.length > 0);
}

export function findRemoteDeletePaths(localFiles, remoteFiles) {
    return [...remoteFiles].filter((filename) => !localFiles.has(filename)).sort();
}

export function buildDeployMarker(localSha, createdAt = new Date()) {
    if (!/^[0-9a-f]{40}$/.test(String(localSha || ''))) throw new Error('localSha must be a full git commit SHA.');
    return {
        schema_version: 1,
        local_sha: localSha,
        created_at: createdAt.toISOString()
    };
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

function uploadSourceTree(sourceDir, localSha) {
    writeDeployMarker(sourceDir, buildDeployMarker(localSha));
    const deletePaths = findRemoteDeletePaths(readLocalGitFilesWithDeployMarker(), readRemoteFilePaths());
    const output = runText('hf', buildUploadArgs({ sourceDir, localSha, repoSlug: readRepositorySlug(), deletePaths }));
    return extractUploadCommitSha(output);
}

function readSpaceInfo() {
    const output = runText('hf', ['spaces', 'info', HF_SPACE_ID, '--format', 'json']);
    return parseJsonPayload(output, 'hf spaces info');
}

async function waitForRunning(spaceCommitSha, localSha) {
    let lastStage = 'unknown';
    let lastSha = 'unknown';
    for (let attempt = 1; attempt <= STATUS_POLL_ATTEMPTS; attempt += 1) {
        const info = readSpaceInfo();
        lastStage = info.runtime?.stage || 'unknown';
        lastSha = info.sha || info.runtime?.raw?.sha || 'unknown';
        console.log(`attempt=${attempt} stage=${lastStage} sha=${lastSha}`);
        if (lastStage === 'RUNNING' && lastSha === spaceCommitSha) {
            return { stage: lastStage, sha: lastSha };
        }
        await delay(STATUS_POLL_INTERVAL_MS);
    }
    const marker = await verifyDeployMarker(localSha);
    return {
        stage: lastStage,
        sha: lastSha,
        management_status: 'runtime_stage_not_running',
        service_marker_verified: true,
        warning: `Space did not reach RUNNING for ${spaceCommitSha}; last stage=${lastStage} sha=${lastSha}`,
        marker
    };
}

async function fetchJson(path) {
    return fetchJsonWithTimeout(new URL(path, HF_SPACE_URL), { timeoutMs: PUBLIC_ENDPOINT_TIMEOUT_MS });
}

async function verifyDeployMarker(localSha) {
    const marker = await fetchJson(`${DEPLOY_MARKER_SERVICE_PATH}?t=${Date.now()}`);
    if (marker?.schema_version !== 1) throw new Error('deploy marker schema_version was not 1.');
    if (marker.local_sha !== localSha) {
        throw new Error(`deploy marker local_sha mismatch: expected ${localSha}, received ${marker.local_sha || 'missing'}.`);
    }
    if (typeof marker.created_at !== 'string' || !marker.created_at.trim()) {
        throw new Error('deploy marker created_at was missing.');
    }
    return marker;
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
    const sourceDir = prepareSourceTree();
    try {
        const spaceCommitSha = uploadSourceTree(sourceDir, localSha);
        const runtime = await waitForRunning(spaceCommitSha, localSha);
        const verification = await verifyPublicEndpoints();
        console.log(
            JSON.stringify(
                {
                    ok: true,
                    spaceId: HF_SPACE_ID,
                    spaceUrl: HF_SPACE_URL,
                    localSha,
                    spaceCommitSha,
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
        console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
        process.exit(1);
    });
}
