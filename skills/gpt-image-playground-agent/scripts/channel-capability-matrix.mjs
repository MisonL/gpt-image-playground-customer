#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, chmodSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCapabilityMatrix,
  buildChannelEnvConfig,
  buildRedactedChannelEnvPreview,
  createDefaultChannelId,
  redactKnownSecrets,
  resolveUpstreamApiKey,
  validateChannelApiKey,
  validateChannelId
} from './lib/channel-capability-matrix.mjs';
import {
  errorMessage,
  loadPrivateAgentEnvFile,
  normalizeBaseUrl,
  readConfiguredPositiveInteger,
  readOptionValue
} from './lib/script-utils.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROBE_SCRIPT_PATH = join(SCRIPT_DIRECTORY, 'probe-upstream-image.mjs');
const DEFAULT_UPSTREAM_BASE_URL = 'https://api.openai.com/v1';

loadPrivateAgentEnvFile();

let options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  validateOptions(options);
} catch (error) {
  console.error(errorMessage(error));
  printUsage();
  process.exit(2);
}

try {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl || process.env.GPT_IMAGE_UPSTREAM_BASE_URL || process.env.OPENAI_API_BASE_URL || DEFAULT_UPSTREAM_BASE_URL
  );
  const upstream = new URL(baseUrl);
  const apiKey = resolveUpstreamApiKey();
  const apiKeyValidation = validateChannelApiKey(apiKey.value);
  const channelId = options.channelId || createDefaultChannelId(upstream.hostname, options.channelIndex);
  const channelIdValidation = validateChannelId(channelId);
  if (!channelIdValidation.ok) throw new Error('--channel-id 只能包含字母、数字、点、下划线和连字符，且长度不超过 64。');
  if (options.writeEnvFile && !apiKeyValidation.ok) {
    throw new Error('生成私有配置需要设置有效的 GPT_IMAGE_UPSTREAM_API_KEY 或 OPENAI_API_KEY。');
  }
  if (options.writeEnvFile) {
    const target = inspectPrivateEnvTarget(options.writeEnvFile, options.overwrite);
    if (!target.ok) throw new Error(target.message);
  }

  await runCapabilityMatrix({ baseUrl, upstream, apiKey, apiKeyValidation, channelId });
} catch (error) {
  console.error(errorMessage(error));
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: undefined,
    model: 'gpt-image-2',
    responsesModel: undefined,
    prompt: 'channel capability matrix probe',
    size: '1024x1024',
    quality: 'low',
    format: 'webp',
    outputCompression: undefined,
    timeoutMs: undefined,
    channelIndex: 1,
    channelId: undefined,
    writeEnvFile: undefined,
    overwrite: false,
    allowBillable: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') parsed.baseUrl = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--model') parsed.model = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--responses-model') parsed.responsesModel = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--prompt') parsed.prompt = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--size') parsed.size = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--quality') parsed.quality = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--format' || arg === '--output-format') parsed.format = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--output-compression') parsed.outputCompression = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--channel-index') parsed.channelIndex = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--channel-id') parsed.channelId = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--write-env-file') parsed.writeEnvFile = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--overwrite') parsed.overwrite = true;
    else if (arg === '--allow-billable') parsed.allowBillable = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error('包含未知参数。');
  }

  return parsed;
}

function validateOptions(parsed) {
  if (!/^[1-9]\d*$/.test(String(parsed.channelIndex))) {
    throw new Error('--channel-index 必须是正整数。');
  }
  parsed.channelIndex = Number(parsed.channelIndex);
  if (!Number.isSafeInteger(parsed.channelIndex)) throw new Error('--channel-index 必须是正整数。');
  if (parsed.overwrite && !parsed.writeEnvFile) throw new Error('--overwrite 必须和 --write-env-file 一起使用。');
  if (parsed.writeEnvFile && !parsed.allowBillable) {
    throw new Error('--write-env-file 需要同时使用 --allow-billable。');
  }
  if (parsed.timeoutMs !== undefined) readConfiguredPositiveInteger(parsed.timeoutMs, '--timeout-ms', 30000);
}

async function runCapabilityMatrix(input) {
  const probeResult = await runProbe(options, input.baseUrl);
  const probeReport = parseProbeReport(probeResult.stdout);
  const redactText = (value) => redactKnownSecrets(value, [input.apiKey.value]);
  const matrix = buildCapabilityMatrix({
    probeReport,
    allowBillable: options.allowBillable,
    apiKeyValid: input.apiKeyValidation.ok,
    apiKeyError: input.apiKeyValidation.reason,
    redactText
  });
  const configuration = {
    ...matrix.configuration,
    channel_index: options.channelIndex,
    channel_id: input.channelId,
    ...(matrix.configuration.ready
      ? {
          env_preview: buildRedactedChannelEnvPreview({
            channelIndex: options.channelIndex,
            channelId: input.channelId,
            baseUrl: input.baseUrl,
            requestModes: matrix.configuration.request_modes,
            requestModePriority: matrix.configuration.request_mode_priority,
            responsesModel: matrix.configuration.responses_model
          })
        }
      : {})
  };

  let write = { requested: Boolean(options.writeEnvFile), attempted: false, written: false, reason: 'not_requested' };
  if (options.writeEnvFile) {
    if (!configuration.ready) {
      write = { requested: true, attempted: false, written: false, reason: 'configuration_not_ready' };
    } else {
      const content = buildChannelEnvConfig({
        channelIndex: options.channelIndex,
        channelId: input.channelId,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey.value,
        requestModes: configuration.request_modes,
        requestModePriority: configuration.request_mode_priority,
        responsesModel: configuration.responses_model
      });
      write = { requested: true, attempted: true, ...writePrivateEnvFile(options.writeEnvFile, content, options.overwrite) };
    }
  }

  const report = {
    ok: configuration.ready && (!options.writeEnvFile || write.written),
    billable: options.allowBillable,
    transport: 'channel_capability_matrix',
    upstream: {
      base_url: input.baseUrl,
      host: input.upstream.host,
      api_key_configured: Boolean(input.apiKey.value)
    },
    probe: {
      completed: probeReport !== undefined,
      exit_code: probeResult.exitCode,
      stderr_present: probeResult.stderr.trim().length > 0
    },
    preflight: matrix.preflight,
    matrix: {
      requested: matrix.requested,
      coverage_complete: matrix.coverage_complete,
      fully_supported: matrix.fully_supported,
      passed: matrix.passed,
      failed: matrix.failed,
      skipped: matrix.skipped,
      modes: matrix.modes
    },
    configuration,
    write,
    summary: {
      ok: configuration.ready && (!options.writeEnvFile || write.written),
      billable: options.allowBillable,
      request_modes: configuration.request_modes,
      blocking_reasons: configuration.blocking_reasons,
      next_action: readNextAction({ configuration, write, writeRequested: Boolean(options.writeEnvFile) })
    }
  };

  console.log(JSON.stringify(redactKnownSecrets(report, [input.apiKey.value]), null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

async function runProbe(parsed, normalizedBaseUrl) {
  const args = [
    PROBE_SCRIPT_PATH,
    '--base-url',
    normalizedBaseUrl,
    '--model',
    parsed.model,
    '--prompt',
    parsed.prompt,
    '--size',
    parsed.size,
    '--quality',
    parsed.quality,
    '--format',
    parsed.format,
    '--request-mode',
    'all'
  ];
  if (parsed.responsesModel) args.push('--responses-model', parsed.responsesModel);
  if (parsed.outputCompression !== undefined) args.push('--output-compression', parsed.outputCompression);
  if (parsed.timeoutMs !== undefined) args.push('--timeout-ms', parsed.timeoutMs);
  if (parsed.allowBillable) args.push('--allow-billable');

  return await new Promise((resolveResult) => {
    const child = spawn(process.execPath, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', () => {
      resolveResult({ exitCode: undefined, stdout, stderr });
    });
    child.once('close', (exitCode) => {
      resolveResult({ exitCode: exitCode ?? undefined, stdout, stderr });
    });
  });
}

function parseProbeReport(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function inspectPrivateEnvTarget(targetPath, overwrite) {
  const absoluteTarget = resolve(targetPath);
  const targetDirectory = dirname(absoluteTarget);
  const targetName = basename(absoluteTarget);
  if (!targetName || targetName === '.') {
    return { ok: false, message: '--write-env-file 必须指定常规文件路径。' };
  }

  try {
    const directoryStat = statSync(targetDirectory);
    if (!directoryStat.isDirectory()) {
      return { ok: false, message: '--write-env-file 的父目录不可用。' };
    }
  } catch {
    return { ok: false, message: '--write-env-file 的父目录不可用。' };
  }

  if (!existsSync(absoluteTarget)) return { ok: true };
  try {
    const targetStat = lstatSync(absoluteTarget);
    if (targetStat.isSymbolicLink()) {
      return { ok: false, message: '--write-env-file 不接受符号链接目标。' };
    }
    if (!targetStat.isFile()) {
      return { ok: false, message: '--write-env-file 只能覆盖常规文件。' };
    }
    if (!overwrite) {
      return { ok: false, message: '目标私有配置文件已存在；确认替换后显式添加 --overwrite。' };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: '--write-env-file 目标不可用。' };
  }
}

function writePrivateEnvFile(targetPath, content, overwrite) {
  const absoluteTarget = resolve(targetPath);
  const targetDirectory = dirname(absoluteTarget);
  const targetName = basename(absoluteTarget);
  let temporaryPath;

  try {
    if (!targetName || targetName === '.') return { written: false, reason: 'invalid_target' };
    const directoryStat = statSync(targetDirectory);
    if (!directoryStat.isDirectory()) return { written: false, reason: 'invalid_target_directory' };

    if (existsSync(absoluteTarget)) {
      const targetStat = lstatSync(absoluteTarget);
      if (targetStat.isSymbolicLink()) return { written: false, reason: 'target_is_symlink' };
      if (!targetStat.isFile()) return { written: false, reason: 'target_not_regular_file' };
      if (!overwrite) return { written: false, reason: 'target_exists' };
    }

    temporaryPath = join(targetDirectory, `.${targetName}.channel-capability-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    const descriptor = openSync(temporaryPath, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }

    if (overwrite) {
      renameSync(temporaryPath, absoluteTarget);
    } else {
      try {
        linkSync(temporaryPath, absoluteTarget);
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'EEXIST') {
          return { written: false, reason: 'target_exists' };
        }
        throw error;
      }
      unlinkSync(temporaryPath);
    }
    chmodSync(absoluteTarget, 0o600);
    temporaryPath = undefined;
    return { written: true, reason: 'written' };
  } catch {
    return { written: false, reason: 'write_failed' };
  } finally {
    if (temporaryPath && existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function readNextAction(input) {
  if (!input.configuration.ready) return 'inspect_capability_matrix';
  if (input.writeRequested && !input.write.written) return 'resolve_private_config_write';
  if (input.writeRequested) return 'apply_private_config_and_restart_explicitly';
  return 'write_private_config_explicitly';
}

function printUsage() {
  console.error('用法：channel-capability-matrix.mjs [options]');
  console.error('固定串行验证 Images/Responses 的 JSON 与 SSE 四种请求方式。');
  console.error('只有 --allow-billable 且至少一个方式返回可消费图片时，才允许写入私有渠道配置。');
  console.error(
    '常用参数：--base-url --model --responses-model --prompt --size --quality --format --output-compression --timeout-ms --channel-index --channel-id --allow-billable --write-env-file --overwrite'
  );
  console.error('不会自动写入 .env.local、重启服务或部署。API Key 仅从 GPT_IMAGE_UPSTREAM_API_KEY 或 OPENAI_API_KEY 读取。');
}
