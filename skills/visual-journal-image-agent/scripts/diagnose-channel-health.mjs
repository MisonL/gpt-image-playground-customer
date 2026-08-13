#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AGENT_ENDPOINTS } from './lib/agent-api-paths.mjs';
import { errorMessage, loadPrivateAgentEnvFile, readOptionValue, resolvePlaygroundBaseUrl } from './lib/script-utils.mjs';

loadPrivateAgentEnvFile();
const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const passwordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH || '';

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(errorMessage(error));
  printUsage();
  process.exit(2);
}
if (options.help) {
  printUsage();
  process.exit(0);
}

let baseUrl;
let baseUrlInfo;
try {
  baseUrlInfo = resolvePlaygroundBaseUrl(options.baseUrl, process.env);
  baseUrl = baseUrlInfo.baseUrl;
} catch (error) {
  console.error(errorMessage(error));
  process.exit(2);
}

try {
  const capabilities = await readCapabilities();
  const endpoint = readDeclaredChannelHealthEndpoint(capabilities);
  const diagnostics = await readChannelHealthDiagnostics(endpoint);
  const output = JSON.stringify(
    {
      ok: diagnostics.ok,
      billable: diagnostics.billable,
      service_base_url: baseUrl,
      service_base_url_source: baseUrlInfo.source,
      interactive_confirmation_required: baseUrlInfo.interactive_confirmation_required,
      endpoint,
      source: diagnostics.source,
      state_scope: diagnostics.state_scope,
      state_initialized: diagnostics.state_initialized,
      snapshot: diagnostics.snapshot
    },
    null,
    2
  );
  if (options.output) writeOutputFile(options.output, output);
  console.log(output);
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { baseUrl: undefined, output: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') {
      parsed.baseUrl = readOptionValue(argv, (index += 1), arg);
    } else if (arg === '--output') {
      parsed.output = readOptionValue(argv, (index += 1), arg);
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return parsed;
}

async function readCapabilities() {
  const { response, result } = await fetchJson(buildServiceUrl(AGENT_ENDPOINTS.capabilities));
  if (!response.ok) {
    throw new Error(`capabilities 请求失败，状态码 ${response.status}。`);
  }
  return result;
}

function readDeclaredChannelHealthEndpoint(capabilities) {
  const declared = readObject(capabilities?.channel_health_diagnostics);
  if (!declared || declared.supported !== true) {
    throw new Error('capabilities.channel_health_diagnostics 未声明 supported=true。');
  }
  if (declared.source !== 'in_process_channel_router') {
    throw new Error('capabilities.channel_health_diagnostics.source 无效。');
  }
  if (declared.state_scope !== 'process_local') {
    throw new Error('capabilities.channel_health_diagnostics.state_scope 无效。');
  }
  if (declared.billable !== false) {
    throw new Error('capabilities.channel_health_diagnostics.billable 必须为 false。');
  }
  const endpoint = readAgentEndpointPath(declared.endpoint, 'capabilities.channel_health_diagnostics.endpoint');
  const listedEndpoint = readAgentEndpointPath(
    capabilities?.endpoints?.channel_health_diagnostics,
    'capabilities.endpoints.channel_health_diagnostics'
  );
  if (endpoint !== listedEndpoint) {
    throw new Error('channel_health_diagnostics 的 capabilities 端点声明不一致。');
  }
  return endpoint;
}

async function readChannelHealthDiagnostics(endpoint) {
  const { response, result } = await fetchJson(buildServiceUrl(endpoint));
  if (!response.ok) {
    throw new Error(`渠道健康诊断请求失败，状态码 ${response.status}。`);
  }
  const diagnostics = readObject(result);
  if (!diagnostics || diagnostics.ok !== true) {
    throw new Error('渠道健康诊断响应缺少 ok=true。');
  }
  if (diagnostics.billable !== false) {
    throw new Error('渠道健康诊断响应 billable 必须为 false。');
  }
  if (diagnostics.source !== 'in_process_channel_router') {
    throw new Error('渠道健康诊断响应 source 无效。');
  }
  if (diagnostics.state_scope !== 'process_local') {
    throw new Error('渠道健康诊断响应 state_scope 无效。');
  }
  if (typeof diagnostics.state_initialized !== 'boolean') {
    throw new Error('渠道健康诊断响应缺少 state_initialized 布尔值。');
  }
  if (!readObject(diagnostics.snapshot) || !Array.isArray(diagnostics.snapshot.channels)) {
    throw new Error('渠道健康诊断响应缺少 snapshot.channels 数组。');
  }
  return diagnostics;
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { headers: authHeaders() });
  } catch (error) {
    throw new Error(`请求失败：${url}。${errorMessage(error)}`);
  }
  const text = await response.text();
  return { response, result: parseJson(text) };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('响应不是有效 JSON。');
  }
}

function buildServiceUrl(endpoint) {
  return `${baseUrl}${readAgentEndpointPath(endpoint, 'Agent endpoint')}`;
}

function readAgentEndpointPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空路径。`);
  }
  const endpoint = value.trim();
  if (!endpoint.startsWith('/') || endpoint.startsWith('//') || endpoint.includes('\\') || endpoint.includes('?') || endpoint.includes('#')) {
    throw new Error(`${label} 必须是同 origin 的绝对路径。`);
  }
  return endpoint;
}

function readObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function authHeaders() {
  if (token) return { Authorization: `Bearer ${token}` };
  if (passwordHash) return { 'X-App-Password-Hash': passwordHash };
  return {};
}

function writeOutputFile(filepath, text) {
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, `${text}\n`, 'utf8');
}

function printUsage() {
  console.error('用法：diagnose-channel-health.mjs [--base-url <url>] [--output <json>]');
  console.error('只读查询当前实例的渠道健康快照，不触发上游探测或图片生成计费。');
}
