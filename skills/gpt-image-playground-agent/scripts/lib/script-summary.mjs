export function startScriptTiming(now = Date.now()) {
  return {
    startedAtMs: now,
    startedAt: new Date(now).toISOString()
  };
}

export function completeScriptTiming(started, now = Date.now()) {
  return {
    started_at: started.startedAt,
    completed_at: new Date(now).toISOString(),
    elapsed_ms: Math.max(0, now - started.startedAtMs)
  };
}

export function buildSuccessSummary({ result, routing, timing, idempotencyKey, billable = true, nextAction }) {
  const serverTiming = readObject(result?.timing);
  const execution = readObject(result?.execution);
  const images = Array.isArray(result?.images) ? result.images : [];
  const timingSummary = buildTimingSummary({ clientTiming: timing, serverTiming });
  return stableSummary({
    ok: true,
    billable,
    request_id: readString(result?.request_id) || null,
    idempotency_key: readString(result?.idempotency_key) || idempotencyKey,
    artifact_ids: images.map((image) => image?.id).filter((value) => typeof value === 'string' && value),
    content_urls: readImageUrls(images, ['content_url', 'path']),
    absolute_content_urls: readImageUrls(images, ['absolute_content_url', 'absolute_path']),
    cached: typeof result?.cached === 'boolean' ? result.cached : undefined,
    started_at: timingSummary.started_at,
    completed_at: timingSummary.completed_at,
    elapsed_ms: timingSummary.elapsed_ms,
    server_elapsed_ms: timingSummary.server_elapsed_ms,
    elapsed_source: timingSummary.elapsed_source,
    elapsed_breakdown: timingSummary.elapsed_breakdown,
    transport: readString(execution?.transport) || readString(routing?.transport),
    endpoint: readString(execution?.endpoint) || readString(routing?.endpoint),
    route_mode: readString(execution?.route_mode) || readRouteMode(routing),
    image_backend: readString(execution?.image_backend) || readString(routing?.image_backend) || null,
    stream_mode: readString(execution?.stream_mode) || readString(routing?.stream_mode) || null,
    streaming_strategy: readString(execution?.streaming_strategy) || readString(routing?.streaming_strategy) || null,
    selected_channel_id: readString(execution?.selected_channel_id) || null,
    upstream_host: readString(execution?.upstream_host) || null,
    request_headers: readObject(execution?.request_headers),
    retryable: false,
    next_action: nextAction || 'done'
  });
}

export function buildFailureSummary({ errorBody, routing, timing, idempotencyKey, billable, nextAction }) {
  const error = readObject(errorBody?.error) || readObject(errorBody);
  const errorMessage = readString(error?.message) || readString(errorBody?.error);
  const diagnostics = readObject(error?.diagnostics);
  const timingSummary = buildTimingSummary({ clientTiming: timing, diagnostics });
  return stableSummary({
    ok: false,
    billable,
    request_id: readString(error?.request_id) || null,
    idempotency_key: idempotencyKey,
    artifact_ids: [],
    content_urls: [],
    absolute_content_urls: [],
    started_at: timingSummary.started_at,
    completed_at: timingSummary.completed_at,
    elapsed_ms: timingSummary.elapsed_ms,
    server_elapsed_ms: timingSummary.server_elapsed_ms,
    elapsed_source: timingSummary.elapsed_source,
    elapsed_breakdown: timingSummary.elapsed_breakdown,
    transport: readString(routing?.transport),
    endpoint: readString(routing?.endpoint),
    route_mode: readRouteMode(routing),
    image_backend: readString(routing?.image_backend) || null,
    stream_mode: readString(routing?.stream_mode) || null,
    streaming_strategy: readString(routing?.streaming_strategy) || null,
    selected_channel_id: readString(diagnostics?.selected_channel_id) || null,
    upstream_host: readString(diagnostics?.upstream_host) || null,
    transport_error_kind: readString(diagnostics?.transport_error_kind),
    retryable: typeof error?.retryable === 'boolean' ? error.retryable : undefined,
    retry_after_seconds: readNonNegativeNumber(errorBody?.retry_after ?? diagnostics?.retry_after_seconds),
    retry_after_ms: readNonNegativeNumber(diagnostics?.retry_after_ms),
    cooldown_until: readString(diagnostics?.cooldown_until),
    cooldown_target: readObject(diagnostics?.cooldown_target),
    next_action: nextAction || buildFailureNextAction(error),
    error_code: readString(error?.code),
    error_message: errorMessage
  });
}

export function attachSummary(output, summary) {
  return summary ? { ...output, summary } : output;
}

function buildFailureNextAction(error) {
  if (!error) return 'diagnose';
  if (error.retryable === true) return 'retry_after_wait';
  return 'diagnose_then_new_idempotency_key';
}

function stableSummary(value) {
  return {
    ...value,
    request_id: value.request_id ?? null,
    idempotency_key: value.idempotency_key ?? null,
    artifact_ids: Array.isArray(value.artifact_ids) ? value.artifact_ids : [],
    content_urls: Array.isArray(value.content_urls) ? value.content_urls : [],
    absolute_content_urls: Array.isArray(value.absolute_content_urls) ? value.absolute_content_urls : [],
    route_mode: value.route_mode ?? null,
    image_backend: value.image_backend ?? null,
    stream_mode: value.stream_mode ?? null,
    streaming_strategy: value.streaming_strategy ?? null,
    selected_channel_id: value.selected_channel_id ?? null,
    upstream_host: value.upstream_host ?? null,
    transport_error_kind: value.transport_error_kind ?? null,
    retry_after_ms: value.retry_after_ms ?? null,
    retry_after_seconds: value.retry_after_seconds ?? null,
    cooldown_until: value.cooldown_until ?? null,
    cooldown_target: value.cooldown_target ?? null
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function readObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function readString(value) {
  return typeof value === 'string' && value ? value : undefined;
}

function readNonNegativeNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function readRouteMode(routing) {
  if (typeof routing?.route_mode === 'string' && routing.route_mode) return routing.route_mode;
  if (routing?.transport === 'page_sse') return 'page_sse';
  if (routing?.transport === 'agent_job_polling') return 'job';
  if (routing?.transport === 'agent_json') return 'agent';
  return undefined;
}

function readImageUrls(images, fields) {
  return images
    .map((image) => {
      for (const field of fields) {
        if (typeof image?.[field] === 'string' && image[field]) return image[field];
      }
      return undefined;
    })
    .filter((value) => typeof value === 'string' && value);
}

function buildTimingSummary({ clientTiming, serverTiming, diagnostics }) {
  const serverTimingElapsedMs = readNonNegativeNumber(serverTiming?.elapsed_ms);
  const diagnosticsElapsedMs = readNonNegativeNumber(diagnostics?.elapsed_ms);
  const serverElapsedMs = readNonNegativeNumber(serverTiming?.server_elapsed_ms ?? serverTimingElapsedMs ?? diagnosticsElapsedMs);
  const clientElapsedMs = readNonNegativeNumber(clientTiming?.elapsed_ms);
  const elapsedMs = serverTimingElapsedMs ?? diagnosticsElapsedMs ?? clientElapsedMs;
  const elapsedSource =
    serverTimingElapsedMs !== undefined || diagnosticsElapsedMs !== undefined ? 'server_timing' : 'client_script';
  const summary = compactObject({
    started_at: readString(serverTiming?.started_at) || clientTiming?.started_at,
    completed_at: readString(serverTiming?.completed_at) || clientTiming?.completed_at,
    elapsed_ms: elapsedMs,
    server_elapsed_ms: serverElapsedMs,
    elapsed_source: elapsedSource,
    elapsed_breakdown: buildElapsedBreakdown(clientElapsedMs, serverElapsedMs)
  });
  return summary;
}

function buildElapsedBreakdown(clientElapsedMs, serverElapsedMs) {
  if (clientElapsedMs === undefined && serverElapsedMs === undefined) return undefined;
  return compactObject({
    client_script_ms: clientElapsedMs,
    upstream_or_server_ms: serverElapsedMs,
    client_overhead_ms:
      clientElapsedMs !== undefined && serverElapsedMs !== undefined ? Math.max(0, clientElapsedMs - serverElapsedMs) : undefined
  });
}
