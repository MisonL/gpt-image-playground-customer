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
  const contentUrls = images
    .map((image) => image?.absolute_content_url || image?.content_url || image?.absolute_path || image?.path)
    .filter((value) => typeof value === 'string' && value);
  return compactObject({
    ok: true,
    billable,
    request_id: readString(result?.request_id),
    idempotency_key: readString(result?.idempotency_key) || idempotencyKey,
    artifact_ids: images.map((image) => image?.id).filter((value) => typeof value === 'string' && value),
    content_urls: contentUrls,
    cached: typeof result?.cached === 'boolean' ? result.cached : undefined,
    started_at: readString(serverTiming?.started_at) || timing?.started_at,
    completed_at: readString(serverTiming?.completed_at) || timing?.completed_at,
    elapsed_ms: readNonNegativeNumber(serverTiming?.elapsed_ms) ?? timing?.elapsed_ms,
    server_elapsed_ms: readNonNegativeNumber(serverTiming?.server_elapsed_ms),
    transport: readString(execution?.transport) || readString(routing?.transport),
    endpoint: readString(execution?.endpoint) || readString(routing?.endpoint),
    route_mode: readString(execution?.route_mode),
    image_backend: readString(execution?.image_backend),
    stream_mode: readString(execution?.stream_mode),
    streaming_strategy: readString(execution?.streaming_strategy),
    selected_channel_id: readString(execution?.selected_channel_id),
    upstream_host: readString(execution?.upstream_host),
    request_headers: readObject(execution?.request_headers),
    retryable: false,
    next_action: nextAction || 'done'
  });
}

export function buildFailureSummary({ errorBody, routing, timing, idempotencyKey, billable, nextAction }) {
  const error = readObject(errorBody?.error) || readObject(errorBody);
  const errorMessage = readString(error?.message) || readString(errorBody?.error);
  const diagnostics = readObject(error?.diagnostics);
  return compactObject({
    ok: false,
    billable,
    request_id: readString(error?.request_id),
    idempotency_key: idempotencyKey,
    started_at: timing?.started_at,
    completed_at: timing?.completed_at,
    elapsed_ms: timing?.elapsed_ms,
    transport: readString(routing?.transport),
    endpoint: readString(routing?.endpoint),
    selected_channel_id: readString(diagnostics?.selected_channel_id),
    upstream_host: readString(diagnostics?.upstream_host),
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
