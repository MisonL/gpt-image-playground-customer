#!/usr/bin/env node

import { setTimeout as delay } from 'node:timers/promises';

import { fetchJsonWithTimeout, isMainModule, pickFailureOutput, printJson, runCommand } from './command-center-utils.mjs';

const CONTAINER_NAME = 'gpt-image-playground-customer';
const IMAGE_REPOSITORY = 'gpt-image-playground-customer';
const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_HOST_PORT = '4783';
const PROBE_PATHS = ['/api/auth-status', '/api/runtime-capabilities', '/api/agent/capabilities'];
const PROBE_ATTEMPTS = 30;
const PROBE_INTERVAL_MS = 2000;
const PROBE_TIMEOUT_MS = 5000;
const DOCKER_COMPOSE_TIMEOUT_MS = 10 * 60 * 1000;
const DOCKER_COMPOSE_WAIT_TIMEOUT_SECONDS = 120;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/i;

export function buildDockerComposeArgs(options = {}) {
    assertSingleDeploymentMode(options);
    const files = ['-f', 'docker-compose.yml'];
    if (options.memory) files.push('-f', 'docker-compose.memory.yml');
    if (options.postgres) files.push('-f', 'docker-compose.postgres.yml');
    return [
        'compose',
        ...files,
        'up',
        '-d',
        '--build',
        '--force-recreate',
        '--remove-orphans',
        '--wait',
        '--wait-timeout',
        String(DOCKER_COMPOSE_WAIT_TIMEOUT_SECONDS)
    ];
}

function assertSingleDeploymentMode(options = {}) {
    if (options.memory && options.postgres) {
        throw new Error('--memory 和 --postgres 不能同时使用。');
    }
}

export function buildDockerComposeEnv(env = process.env, deployment) {
    return {
        ...env,
        COMPOSE_PROGRESS: 'plain',
        ...(deployment
            ? {
                  GIP_IMAGE_REVISION: deployment.revision,
                  GIP_IMAGE_TAG: deployment.imageTag
              }
            : {})
    };
}

export function buildDeploymentImageTag(revision) {
    const normalized = revision?.trim().toLowerCase();
    if (!GIT_REVISION_PATTERN.test(normalized || '')) throw new Error('Git revision 必须是完整的 40 位 SHA。');
    return `local-${normalized}`;
}

export function buildDeploymentImageReference(revision) {
    return `${IMAGE_REPOSITORY}:${buildDeploymentImageTag(revision)}`;
}

export function buildLocalBaseUrl(bindHost = DEFAULT_BIND_HOST, hostPort = DEFAULT_HOST_PORT) {
    const host = bindHost.trim();
    const port = hostPort.trim();
    if (!host) throw new Error('GIP_BIND_HOST 不能为空。');
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        throw new Error(`GIP_PORT 必须是 1 到 65535 的整数，收到：${hostPort}`);
    }

    const probeHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `http://${probeHost}:${port}`;
}

export function parsePublishedContainerPortBindings(output) {
    let bindings;
    try {
        bindings = JSON.parse(output);
    } catch {
        throw new Error('无法解析 Docker 容器端口映射。');
    }
    if (!Array.isArray(bindings) || bindings.length === 0) {
        throw new Error('Docker 容器未发布 4783/tcp 端口。');
    }

    const binding = bindings.find((entry) => typeof entry?.HostIp === 'string' && !entry.HostIp.includes(':')) || bindings[0];
    const bindHost = typeof binding?.HostIp === 'string' && binding.HostIp.trim() ? binding.HostIp.trim() : '0.0.0.0';
    const hostPort = typeof binding?.HostPort === 'string' ? binding.HostPort.trim() : '';
    return { bindHost, hostPort, baseUrl: buildLocalBaseUrl(bindHost, hostPort) };
}

export function assertDeploymentImageIdentity(identity, deployment) {
    const expectedImage = buildDeploymentImageReference(deployment.revision);
    if (identity.image !== expectedImage) {
        throw new Error(`运行容器镜像不匹配：expected ${expectedImage}, received ${identity.image || '<missing>'}。`);
    }
    if (identity.revision !== deployment.revision) {
        throw new Error(
            `运行镜像 revision 不匹配：expected ${deployment.revision}, received ${identity.revision || '<missing>'}。`
        );
    }
}

function parseArgs(argv) {
    const unknown = argv.find((arg) => !['--help', '-h', '--memory', '--postgres', '--skip-probe'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    const options = {
        help: argv.includes('--help') || argv.includes('-h'),
        memory: argv.includes('--memory'),
        postgres: argv.includes('--postgres'),
        skipProbe: argv.includes('--skip-probe')
    };
    assertSingleDeploymentMode(options);
    return options;
}

function printHelp() {
    console.log(`Usage:
  npm run deploy:local
  npm run deploy:local -- --memory
  npm run deploy:local -- --postgres

Options:
  --memory       Use docker-compose.memory.yml overlay for HF Space-like memory mode.
  --postgres     Use docker-compose.postgres.yml and require GPT_IMAGE_POSTGRES_PASSWORD.
  --skip-probe   Rebuild and start the container without HTTP endpoint probes.
  --help         Show this help.`);
}

function readCleanGitRevision() {
    const revisionResult = runCommand('git', ['rev-parse', '--verify', 'HEAD']);
    if (!revisionResult.ok) throw new Error(`无法读取当前 Git revision：${pickFailureOutput(revisionResult)}`);

    const revision = revisionResult.stdout.trim().toLowerCase();
    const imageTag = buildDeploymentImageTag(revision);
    const statusResult = runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all']);
    if (!statusResult.ok) throw new Error(`无法检查 Git 工作区状态：${pickFailureOutput(statusResult)}`);
    if (statusResult.stdout) {
        throw new Error('拒绝部署脏工作区。请先提交或清理当前改动，再运行 npm run deploy:local。');
    }

    return { revision, imageTag };
}

async function fetchJson(path, baseUrl) {
    return fetchJsonWithTimeout(new URL(path, baseUrl), { timeoutMs: PROBE_TIMEOUT_MS });
}

export async function waitForLocalEndpoints(baseUrl, options = {}) {
    const attempts = options.attempts ?? PROBE_ATTEMPTS;
    const intervalMs = options.intervalMs ?? PROBE_INTERVAL_MS;
    const requestJson = options.fetchJson || fetchJson;
    const sleep = options.sleep || delay;
    let lastError = '';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const responses = {};
            for (const path of PROBE_PATHS) responses[path] = await requestJson(path, baseUrl);
            return {
                attempts: attempt,
                baseUrl,
                authRequired: responses['/api/auth-status'].passwordRequired,
                stateBackend: responses['/api/agent/capabilities'].defaults?.state_backend,
                imageStorageMode: responses['/api/agent/capabilities'].storage?.image_storage_mode,
                streamingBatch: responses['/api/runtime-capabilities'].streamingBatch
            };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            if (attempt < attempts) await sleep(intervalMs);
        }
    }
    throw new Error(`Local container did not pass HTTP probes: ${lastError}`);
}

export function assertLocalProbeMatchesMode(probe, options = {}) {
    assertSingleDeploymentMode(options);
    const expected = options.memory
        ? { label: 'Memory', stateBackend: 'memory', imageStorageMode: 'indexeddb' }
        : options.postgres
          ? { label: 'PostgreSQL', stateBackend: 'postgres', imageStorageMode: 'fs' }
          : { label: 'SQLite', stateBackend: 'sqlite', imageStorageMode: 'fs' };
    const mismatches = [];
    if (probe.stateBackend !== expected.stateBackend) {
        mismatches.push(`stateBackend=${probe.stateBackend ?? '<missing>'} expected ${expected.stateBackend}`);
    }
    if (probe.imageStorageMode !== expected.imageStorageMode) {
        mismatches.push(`imageStorageMode=${probe.imageStorageMode ?? '<missing>'} expected ${expected.imageStorageMode}`);
    }
    if (mismatches.length) throw new Error(`${expected.label} deployment mode did not take effect: ${mismatches.join(', ')}.`);
}

function inspectDeploymentImage(deployment) {
    const expectedImage = buildDeploymentImageReference(deployment.revision);
    const containerImage = runCommand('docker', ['inspect', '--format', '{{.Config.Image}}', CONTAINER_NAME]);
    if (!containerImage.ok) throw new Error(`无法读取部署容器镜像：${pickFailureOutput(containerImage)}`);

    const imageRevision = runCommand('docker', [
        'image',
        'inspect',
        '--format',
        '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
        expectedImage
    ]);
    if (!imageRevision.ok) throw new Error(`无法读取部署镜像 revision：${pickFailureOutput(imageRevision)}`);

    const identity = { image: containerImage.stdout.trim(), revision: imageRevision.stdout.trim().toLowerCase() };
    assertDeploymentImageIdentity(identity, deployment);
    return identity;
}

function inspectPublishedContainerPort() {
    const result = runCommand('docker', [
        'inspect',
        '--format',
        '{{json (index .NetworkSettings.Ports "4783/tcp")}}',
        CONTAINER_NAME
    ]);
    if (!result.ok) throw new Error(`无法读取部署容器端口映射：${pickFailureOutput(result)}`);
    return parsePublishedContainerPortBindings(result.stdout.trim());
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const deployment = readCleanGitRevision();
    const docker = runCommand('docker', buildDockerComposeArgs(options), {
        env: buildDockerComposeEnv(process.env, deployment),
        timeoutMs: DOCKER_COMPOSE_TIMEOUT_MS
    });
    if (!docker.ok) {
        printJson({ ok: false, phase: 'docker-compose', output: pickFailureOutput(docker) });
        process.exit(1);
    }

    const image = inspectDeploymentImage(deployment);
    const localConfig = inspectPublishedContainerPort();
    if (options.skipProbe) {
        printJson({ ok: true, phase: 'docker-compose', image, probe: 'skipped' });
        return;
    }

    const probe = await waitForLocalEndpoints(localConfig.baseUrl);
    assertLocalProbeMatchesMode(probe, options);
    printJson({ ok: true, phase: 'ready', deployment: { ...deployment, ...localConfig }, image, probe });
}

if (isMainModule(import.meta.url, process.argv[1])) {
    main().catch((error) => {
        printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
        process.exit(1);
    });
}
