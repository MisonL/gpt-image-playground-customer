#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AGENT_ENDPOINTS } from './lib/agent-api-paths.mjs';
import { errorMessage, loadPrivateAgentEnvFile, readOptionValue, resolvePlaygroundBaseUrl } from './lib/script-utils.mjs';

const MAX_CLIENT_REQUEST_IDS = 50;
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
let clientRequestIds;
let agentLookups;
let baseUrlInfo;
try {
  baseUrlInfo = resolvePlaygroundBaseUrl(options.baseUrl, process.env);
  baseUrl = baseUrlInfo.baseUrl;
  clientRequestIds = readClientRequestIds(options);
  agentLookups = readAgentLookups(options);
  if (!clientRequestIds.length && !agentLookups.length) {
    throw new Error('--client-request-id、--agent-request-id、--idempotency-key 或 --manifest 必填。');
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exit(2);
}

try {
  const capabilities = await readCapabilities();
  const pageDiagnostics = clientRequestIds.length
    ? await readPageRequestDiagnostics(capabilities, clientRequestIds)
    : { requests: [], diagnosticsRetention: undefined };
  const agentRequests = agentLookups.length ? await readAgentRequestDiagnostics(capabilities, agentLookups) : [];
  const requests = pageDiagnostics.requests;
  const body = {
    ok: true,
    billable: false,
    service_base_url: baseUrl,
    service_base_url_source: baseUrlInfo.source,
    interactive_confirmation_required: baseUrlInfo.interactive_confirmation_required,
    page_request_query_count: clientRequestIds.length,
    page_request_found_count: requests.filter((request) => request.found).length,
    page_request_count: requests.length,
    agent_request_count: agentRequests.length,
    request_count: requests.length,
    ...(pageDiagnostics.diagnosticsRetention ? { diagnostics_retention: pageDiagnostics.diagnosticsRetention } : {}),
    requests,
    ...(agentRequests.length ? { agent_requests: agentRequests } : {})
  };
  if (requests.length === 1) {
    Object.assign(body, {
      client_request_id: requests[0].client_request_id,
      found: requests[0].found,
      feedback: requests[0].feedback,
      diagnostics: requests[0].diagnostics,
      ...(requests[0].diagnostics_note ? { diagnostics_note: requests[0].diagnostics_note } : {})
    });
  }
  if (agentRequests.length === 1) {
    Object.assign(body, {
      agent_lookup: agentRequests[0].lookup,
      agent_found: agentRequests[0].found,
      agent_diagnostics: agentRequests[0].diagnostics
    });
  }
  const output = JSON.stringify(body, null, 2);
  if (options.output) writeOutputFile(options.output, output);
  console.log(output);
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    clientRequestIds: [],
    agentRequestIds: [],
    idempotencyKeys: [],
    filenames: [],
    manifests: [],
    output: '',
    baseUrl: undefined,
    help: false
  };
  const envClientRequestId = process.env.GPT_IMAGE_AGENT_CLIENT_REQUEST_ID?.trim();
  if (envClientRequestId) parsed.clientRequestIds.push(envClientRequestId);
  const envAgentRequestId = process.env.GPT_IMAGE_AGENT_REQUEST_ID?.trim();
  if (envAgentRequestId) parsed.agentRequestIds.push(envAgentRequestId);
  const envAgentIdempotencyKey = process.env.GPT_IMAGE_AGENT_IDEMPOTENCY_KEY?.trim();
  if (envAgentIdempotencyKey) parsed.idempotencyKeys.push(envAgentIdempotencyKey);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') {
      parsed.baseUrl = readOptionValue(argv, (index += 1), arg);
    } else if (arg === '--client-request-id' || arg === '--request-id') {
      parsed.clientRequestIds.push(readOptionValue(argv, (index += 1), arg));
    } else if (arg === '--agent-request-id') {
      parsed.agentRequestIds.push(readOptionValue(argv, (index += 1), arg));
    } else if (arg === '--idempotency-key') {
      parsed.idempotencyKeys.push(readOptionValue(argv, (index += 1), arg));
    } else if (arg === '--manifest') {
      parsed.manifests.push(readOptionValue(argv, (index += 1), arg));
    } else if (arg === '--filename') {
      parsed.filenames.push(readOptionValue(argv, (index += 1), arg));
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

function readClientRequestIds(parsed) {
  const ids = [];
  for (const id of parsed.clientRequestIds) ids.push(id);
  for (const manifestPath of parsed.manifests) ids.push(...readManifestClientRequestIds(manifestPath));
  const deduped = Array.from(new Set(ids.map((id) => normalizeClientRequestId(id))));
  if (deduped.length > MAX_CLIENT_REQUEST_IDS) {
    throw new Error(`一次最多诊断 ${MAX_CLIENT_REQUEST_IDS} 个请求。`);
  }
  return deduped;
}

function readAgentLookups(parsed) {
  const lookups = [];
  for (const requestId of parsed.agentRequestIds) {
    lookups.push({ type: 'request_id', value: normalizeAgentLookupValue(requestId, 'agent request id') });
  }
  for (const idempotencyKey of parsed.idempotencyKeys) {
    lookups.push({ type: 'idempotency_key', value: normalizeAgentLookupValue(idempotencyKey, 'idempotency key') });
  }
  const deduped = [];
  const seen = new Set();
  for (const lookup of lookups) {
    const key = `${lookup.type}:${lookup.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(lookup);
  }
  if (deduped.length > MAX_CLIENT_REQUEST_IDS) {
    throw new Error(`一次最多诊断 ${MAX_CLIENT_REQUEST_IDS} 个 Agent 请求。`);
  }
  return deduped;
}

function readManifestClientRequestIds(manifestPath) {
  const text = readFileSync(manifestPath, 'utf8');
  const ids = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error(`${manifestPath}:${index + 1} 不是有效 JSONL。`);
    }
    const id = extractClientRequestId(entry);
    if (id) ids.push(id);
  }
  return ids;
}

function extractClientRequestId(value) {
  if (!value || typeof value !== 'object') return undefined;
  const candidates = [
    value.client_request_id,
    value.clientRequestId,
    value.idempotency_key,
    value.idempotencyKey,
    value.request_id,
    value.requestId
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  if (value.response && typeof value.response === 'object') {
    if (typeof value.response.client_request_id === 'string') return value.response.client_request_id;
    if (Array.isArray(value.response.images)) {
      for (const image of value.response.images) {
        const imageId = extractClientRequestId(image);
        if (imageId) return imageId;
      }
    }
  }
  return undefined;
}

async function readCapabilities() {
  const { response, result, text } = await fetchJsonWithResponse(`${baseUrl}${AGENT_ENDPOINTS.capabilities}`);
  if (!response.ok) {
    throw new Error(`capabilities 请求失败，状态码 ${response.status}：${text}`);
  }
  return result;
}

async function readPageRequestDiagnostics(capabilities, ids) {
  const feedbackBatchPath = resolveEndpointPath(
    capabilities?.endpoints?.page_request_feedback_batch,
    AGENT_ENDPOINTS.page_request_feedback_batch,
    'page_request_feedback_batch'
  );
  const diagnosticsPath = resolveEndpointTemplate(
    capabilities?.endpoints?.page_request_diagnostics,
    AGENT_ENDPOINTS.page_request_diagnostics,
    'page_request_diagnostics'
  );
  const diagnosticsBatchPath = resolveOptionalEndpointPath(capabilities?.endpoints?.page_request_diagnostics_batch);
  const diagnosticsCapabilities = readDiagnosticsCapabilities(capabilities);
  const feedbackById = await fetchFeedbackById(feedbackBatchPath, ids);
  const diagnosticsResult = diagnosticsBatchPath
    ? await fetchDiagnosticsBatchById(diagnosticsBatchPath, ids)
    : await fetchDiagnosticsById(diagnosticsPath, ids);
  const diagnosticsById = diagnosticsResult.diagnosticsById;
  const diagnosticsRetention = readDiagnosticsRetention(diagnosticsCapabilities, diagnosticsResult);
  const requests = await Promise.all(
    ids.map((clientRequestId) =>
      buildDiagnosedRequest({
        clientRequestId,
        feedback: feedbackById.get(clientRequestId) ?? null,
        diagnostics: diagnosticsById.get(clientRequestId) ?? null,
        diagnosticsCapabilities,
        diagnosticsRetention
      })
    )
  );
  return { requests, diagnosticsRetention };
}

async function readAgentRequestDiagnostics(capabilities, lookups) {
  const singlePath = resolveEndpointTemplate(
    capabilities?.endpoints?.agent_request_diagnostics,
    AGENT_ENDPOINTS.agent_request_diagnostics,
    'agent_request_diagnostics'
  );
  const lookupPath = resolveEndpointPath(
    capabilities?.endpoints?.agent_request_diagnostics_lookup,
    AGENT_ENDPOINTS.agent_request_diagnostics_lookup,
    'agent_request_diagnostics_lookup'
  );
  return Promise.all(
    lookups.map(async (lookup) => {
      const result =
        lookup.type === 'request_id'
          ? await fetchAgentDiagnostics(resolvePath(singlePath, lookup.value))
          : await fetchAgentDiagnostics(appendQuery(lookupPath, 'idempotency_key', lookup.value));
      return {
        lookup,
        found: result.found,
        diagnostics: result.diagnostics
      };
    })
  );
}

async function fetchFeedbackById(pathValue, ids) {
  const result = await postJson(pathValue, { ids });
  const feedback = readRequiredArray(result, 'feedback', '批量反馈响应缺少 feedback 数组。');
  return new Map(feedback.map((item) => [readFeedbackTargetId(item), item]));
}

async function fetchDiagnosticsBatchById(batchPath, ids) {
  const result = await postJson(batchPath, { ids, filenames: options.filenames });
  const diagnostics = readRequiredArray(result, 'diagnostics', '批量诊断响应缺少 diagnostics 数组。');
  const diagnosticsById = new Map(diagnostics.map((item) => [readDiagnosticsClientRequestId(item), item]));
  const missingIds = ids.filter((id) => !diagnosticsById.has(id));
  if (missingIds.length > 0) {
    throw new Error(`批量诊断响应缺少请求 ID：${missingIds.join(',')}`);
  }
  return {
    diagnosticsById,
    diagnosticsRetention: readObject(result.diagnostics_retention)
  };
}

async function fetchDiagnosticsById(singlePath, ids) {
  const diagnosticsById = new Map();
  let diagnosticsRetention;
  for (const id of ids) {
    const diagnostics = await fetchJson(appendFilenameFilters(resolvePath(singlePath, id), options.filenames));
    diagnosticsById.set(id, diagnostics);
    diagnosticsRetention = diagnosticsRetention ?? readObject(diagnostics.diagnostics_retention);
  }
  return { diagnosticsById, diagnosticsRetention };
}

async function fetchAgentDiagnostics(pathValue) {
  const url = new URL(pathValue, `${baseUrl}/`).toString();
  const { response, result, text } = await fetchJsonWithResponse(url);
  if (response.status === 404 && result?.found === false) {
    return { found: false, diagnostics: null };
  }
  if (!response.ok) {
    throw new Error(`Agent 请求诊断失败，状态码 ${response.status}：${text}`);
  }
  if (!result || typeof result !== 'object' || typeof result.found !== 'boolean') {
    throw new Error('Agent 请求诊断响应缺少 found 字段。');
  }
  return {
    found: result.found,
    diagnostics: result.found ? readObject(result.diagnostics) ?? null : null
  };
}

function readDiagnosticsCapabilities(capabilities) {
  const value = capabilities?.page_request_diagnostics;
  if (!value || typeof value !== 'object') return undefined;
  return value;
}

function readDiagnosticsRetention(diagnosticsCapabilities, diagnosticsResult) {
  return readObject(diagnosticsCapabilities?.retention) ?? readObject(diagnosticsResult?.diagnosticsRetention);
}

function readObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value;
}

function readRequiredArray(value, field, message) {
  if (!value || typeof value !== 'object' || !Array.isArray(value[field])) {
    throw new Error(message);
  }
  return value[field];
}

function readFeedbackTargetId(value) {
  if (!value || typeof value !== 'object' || typeof value.target_id !== 'string' || !value.target_id.trim()) {
    throw new Error('批量反馈响应包含无效 target_id。');
  }
  return value.target_id;
}

function readDiagnosticsClientRequestId(value) {
  if (!value || typeof value !== 'object' || typeof value.client_request_id !== 'string' || !value.client_request_id.trim()) {
    throw new Error('批量诊断响应包含无效 client_request_id。');
  }
  return value.client_request_id;
}

function buildDiagnosedRequest({ clientRequestId, feedback, diagnostics, diagnosticsCapabilities, diagnosticsRetention }) {
  const diagnosticsNote = buildDiagnosticsNoMatchNote(diagnostics, diagnosticsCapabilities, diagnosticsRetention);
  const found = Boolean(feedback || (diagnostics && diagnostics.matched_log_count > 0));
  return {
    client_request_id: clientRequestId,
    found,
    feedback,
    diagnostics,
    ...(diagnosticsNote ? { diagnostics_note: diagnosticsNote } : {})
  };
}

function buildDiagnosticsNoMatchNote(diagnostics, diagnosticsCapabilities, diagnosticsRetention) {
  if (!diagnostics || diagnostics.matched_log_count !== 0) return undefined;
  if (diagnostics.diagnostics_note && typeof diagnostics.diagnostics_note === 'object') {
    return diagnostics.diagnostics_note;
  }
  const retention = readObject(diagnostics.diagnostics_retention) ?? readObject(diagnosticsCapabilities?.retention) ?? diagnosticsRetention;
  return {
    code: 'no_matching_logs_in_retention_window',
    message: buildDiagnosticsNoMatchMessage(retention),
    ...(retention ? { retention } : {})
  };
}

function buildDiagnosticsNoMatchMessage(retention) {
  const windowText =
    retention && Number.isInteger(retention.max_entries) ? `最近 ${retention.max_entries} 条本地应用日志` : '当前本地应用日志保留窗口';
  return `没有匹配到页面请求日志；诊断只覆盖${windowText}，日志可能已被保留条数淘汰、被日志级别过滤，或本地日志文件被清理。`;
}

async function fetchJson(pathOrUrl) {
  const url = new URL(pathOrUrl, `${baseUrl}/`).toString();
  const { response, result, text } = await fetchJsonWithResponse(url);
  if (!response.ok) {
    throw new Error(`请求失败，状态码 ${response.status}：${text}`);
  }
  return result;
}

async function postJson(pathOrUrl, body) {
  const url = new URL(pathOrUrl, `${baseUrl}/`).toString();
  const { response, result, text } = await fetchJsonWithResponse(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`请求失败，状态码 ${response.status}：${text}`);
  }
  return result;
}

async function fetchJsonWithResponse(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, headers: { ...authHeaders(), ...init.headers } });
  } catch (error) {
    throw new Error(`请求失败：${url}。${errorMessage(error)}`);
  }
  const text = await response.text();
  return { response, text, result: parseJson(text) };
}

function authHeaders() {
  if (token) return { Authorization: `Bearer ${token}` };
  if (passwordHash) return { 'X-App-Password-Hash': passwordHash };
  return {};
}

function resolveEndpointTemplate(value, fallback, name) {
  const template = resolveEndpointPath(value, fallback, name);
  if (!template.includes('{id}')) {
    throw new Error(`capabilities endpoints.${name} 缺少 {id} 占位符。`);
  }
  return template;
}

function resolveEndpointPath(value, fallback, name) {
  const template = typeof value === 'string' && value.trim() ? value : fallback;
  if (!template || typeof template !== 'string') {
    throw new Error(`capabilities endpoints.${name} 无效。`);
  }
  return template;
}

function resolveOptionalEndpointPath(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function resolvePath(template, id) {
  return template.replace('{id}', encodeURIComponent(id));
}

function appendFilenameFilters(pathValue, filenames) {
  if (!filenames.length) return pathValue;
  const url = new URL(pathValue, `${baseUrl}/`);
  for (const filename of filenames) {
    const normalized = filename.trim();
    if (normalized) url.searchParams.append('filename', normalized);
  }
  return `${url.pathname}${url.search}`;
}

function appendQuery(pathValue, name, value) {
  const url = new URL(pathValue, `${baseUrl}/`);
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
}

function normalizeClientRequestId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('client request id 不能为空。');
  }
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw new Error('client request id 不能超过 200 个字符。');
  }
  return normalized;
}

function normalizeAgentLookupValue(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 不能为空。`);
  }
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw new Error(`${label} 不能超过 200 个字符。`);
  }
  return normalized;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`响应不是有效 JSON：${text.slice(0, 500)}`);
  }
}

function writeOutputFile(filepath, text) {
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, `${text}\n`, 'utf8');
}

function printUsage() {
  console.error('用法：diagnose-request.mjs [--base-url <url>] [--client-request-id <id>] [--agent-request-id <id>] [--idempotency-key <key>] [--manifest <jsonl>] [--filename <name>] [--output <json>]');
  console.error('只读查询页面反馈/日志诊断或 Agent state 请求诊断，不触发生图计费。');
}
