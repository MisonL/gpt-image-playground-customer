import { AGENT_ENDPOINTS } from './agent-api-paths.mjs';

const DEFAULT_AGENT_DIAGNOSTICS_TIMEOUT_MS = 5000;

export async function enrichFailureWithAgentDiagnostics({
  baseUrl,
  authHeaders,
  idempotencyKey,
  failureOutput,
  summary,
  timeoutMs,
  diagnosticsTimeoutMs,
  fetchFn = fetch
}) {
  const diagnosticsResult = await fetchAgentDiagnosticsByIdempotencyKey({
    baseUrl,
    authHeaders,
    idempotencyKey,
    timeoutMs,
    diagnosticsTimeoutMs,
    fetchFn
  });

  const diagnostics = diagnosticsResult.diagnostics;
  const agentFailureDiagnostics = buildAgentFailureDiagnostics(diagnosticsResult, diagnostics);

  return {
    failureOutput: {
      ...failureOutput,
      ...(agentFailureDiagnostics ? { agent_failure_diagnostics: agentFailureDiagnostics } : {})
    },
    summary: mergeDiagnosticsIntoSummary(summary, diagnosticsResult, diagnostics)
  };
}

async function fetchAgentDiagnosticsByIdempotencyKey({
  baseUrl,
  authHeaders,
  idempotencyKey,
  timeoutMs,
  diagnosticsTimeoutMs,
  fetchFn
}) {
  const url = buildAgentEndpointUrl(baseUrl, AGENT_ENDPOINTS.agent_request_diagnostics_lookup);
  url.searchParams.set('idempotency_key', idempotencyKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveDiagnosticsTimeoutMs(timeoutMs, diagnosticsTimeoutMs));
  try {
    const response = await fetchFn(url, {
      headers: authHeaders(),
      signal: controller.signal
    });
    const text = await response.text();
    if (!isJsonResponse(response) && text) {
      return buildUnavailableDiagnosticsResult('non_json_response', response.status);
    }
    const result = parseJson(text);
    if (response.status === 404 && result?.found === false) {
      return { checked: true, found: false };
    }
    if (!response.ok) {
      return buildUnavailableDiagnosticsResult(`status_${response.status}`, response.status);
    }
    if (!result || typeof result !== 'object' || typeof result.found !== 'boolean') {
      return buildUnavailableDiagnosticsResult('invalid_response', response.status);
    }
    if (result.found === true && !isObject(result.diagnostics)) {
      return buildUnavailableDiagnosticsResult('invalid_response', response.status);
    }
    return {
      checked: true,
      found: result.found,
      diagnostics: result.found ? result.diagnostics : null
    };
  } catch (error) {
    return {
      checked: true,
      found: false,
      unavailable_reason: readFetchErrorKind(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildAgentEndpointUrl(baseUrl, endpoint) {
  return new URL(`${String(baseUrl).replace(/\/+$/, '')}${endpoint}`);
}

function buildUnavailableDiagnosticsResult(unavailableReason, status) {
  return {
    checked: true,
    found: false,
    unavailable_reason: unavailableReason,
    ...(Number.isInteger(status) ? { http_status: status } : {})
  };
}

function resolveDiagnosticsTimeoutMs(timeoutMs, diagnosticsTimeoutMs) {
  return Math.min(
    readPositiveInteger(timeoutMs) || DEFAULT_AGENT_DIAGNOSTICS_TIMEOUT_MS,
    readPositiveInteger(diagnosticsTimeoutMs) || DEFAULT_AGENT_DIAGNOSTICS_TIMEOUT_MS
  );
}

function isJsonResponse(response) {
  const contentType = typeof response?.headers?.get === 'function' ? response.headers.get('content-type') : '';
  return String(contentType || '').toLowerCase().includes('application/json');
}

function buildAgentFailureDiagnostics(result, diagnostics) {
  if (!result?.checked) return undefined;
  if (!result.found) {
    return {
      checked: true,
      found: false,
      unavailable_reason: result.unavailable_reason || null,
      http_status: result.http_status ?? null
    };
  }
  const request = isObject(diagnostics?.request) ? diagnostics.request : undefined;
  const error = isObject(diagnostics?.error) ? diagnostics.error : undefined;
  const errorDiagnostics = isObject(error?.diagnostics) ? error.diagnostics : undefined;
  const response = isObject(diagnostics?.response) ? diagnostics.response : undefined;
  const execution = isObject(response?.execution) ? response.execution : undefined;
  return {
    checked: true,
    found: true,
    request_id: readString(request?.request_id),
    status: readString(request?.status),
    error_code: readString(error?.code),
    retryable: typeof error?.retryable === 'boolean' ? error.retryable : undefined,
    selected_channel_id: readString(errorDiagnostics?.selected_channel_id) || readString(execution?.selected_channel_id),
    upstream_host: readString(errorDiagnostics?.upstream_host) || readString(execution?.upstream_host),
    transport_error_kind: readString(errorDiagnostics?.transport_error_kind)
  };
}

function mergeDiagnosticsIntoSummary(summary, diagnosticsResult, diagnostics) {
  if (!diagnosticsResult?.checked) return summary;
  const request = isObject(diagnostics?.request) ? diagnostics.request : undefined;
  const error = isObject(diagnostics?.error) ? diagnostics.error : undefined;
  const errorDiagnostics = isObject(error?.diagnostics) ? error.diagnostics : undefined;
  const response = isObject(diagnostics?.response) ? diagnostics.response : undefined;
  const execution = isObject(response?.execution) ? response.execution : undefined;
  const diagnosticsRetryable = typeof error?.retryable === 'boolean' ? error.retryable : undefined;
  return {
    ...summary,
    request_id: preferExistingString(summary.request_id, request?.request_id) || null,
    selected_channel_id:
      preferExistingString(summary.selected_channel_id, errorDiagnostics?.selected_channel_id, execution?.selected_channel_id) ||
      null,
    upstream_host: preferExistingString(summary.upstream_host, errorDiagnostics?.upstream_host, execution?.upstream_host) || null,
    transport_error_kind: preferExistingString(summary.transport_error_kind, errorDiagnostics?.transport_error_kind) || null,
    retryable: diagnosticsRetryable ?? summary.retryable,
    agent_diagnostics_checked: true,
    agent_diagnostics_found: diagnosticsResult.found === true,
    agent_diagnostics_unavailable_reason: diagnosticsResult.found ? null : diagnosticsResult.unavailable_reason || null,
    agent_diagnostics_http_status: diagnosticsResult.found ? null : diagnosticsResult.http_status ?? null,
    next_action: readDiagnosticsNextAction(summary.next_action, diagnosticsRetryable)
  };
}

function readDiagnosticsNextAction(currentNextAction, diagnosticsRetryable) {
  if (diagnosticsRetryable === true) return 'retry_after_wait';
  if (diagnosticsRetryable === false) return 'diagnose_then_new_idempotency_key';
  return currentNextAction || 'diagnose_then_new_idempotency_key';
}

function preferExistingString(...values) {
  for (const value of values) {
    const stringValue = readString(value);
    if (stringValue) return stringValue;
  }
  return undefined;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function readFetchErrorKind(error) {
  const name = typeof error?.name === 'string' ? error.name : '';
  if (name === 'AbortError') return 'diagnostics_timeout';
  const causeCode = typeof error?.cause?.code === 'string' ? error.cause.code : '';
  if (causeCode) return causeCode;
  return 'diagnostics_fetch_failed';
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(value) {
  return typeof value === 'string' && value ? value : undefined;
}

function readPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
