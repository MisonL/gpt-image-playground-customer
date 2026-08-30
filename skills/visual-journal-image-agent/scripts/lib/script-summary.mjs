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
    const imageDimensions = readResponseImageDimensions(images);
    const timingSummary = buildTimingSummary({ clientTiming: timing, serverTiming });
    return stableSummary({
        ok: true,
        billable,
        request_id: readString(result?.request_id) || null,
        idempotency_key: readString(result?.idempotency_key) || idempotencyKey,
        artifact_ids: images.map((image) => image?.id).filter((value) => typeof value === 'string' && value),
        content_urls: readImageUrls(images, ['content_url', 'path']),
        absolute_content_urls: readImageUrls(images, ['absolute_content_url', 'absolute_path']),
        image_dimensions: imageDimensions,
        actual_dimensions: imageDimensions.length === 1 ? imageDimensions[0] : null,
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
        streaming_strategy:
            readString(execution?.streaming_strategy) || readString(routing?.streaming_strategy) || null,
        channel_request_mode: readString(execution?.channel_request_mode) || null,
        channel_request_mode_fallback_applied:
            typeof execution?.channel_request_mode_fallback_applied === 'boolean'
                ? execution.channel_request_mode_fallback_applied
                : null,
        route_decision: readObject(execution?.route_decision) || null,
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
    const details = readObject(error?.details);
    const response = readObject(errorBody?.response);
    const execution = readObject(response?.execution);
    const images = Array.isArray(response?.images) ? response.images : [];
    const imageDimensions = readResponseImageDimensions(images);
    const timingSummary = buildTimingSummary({ clientTiming: timing, diagnostics });
    // Failure bodies may put final routing diagnostics on error.diagnostics even when response.execution is absent.
    return stableSummary({
        ok: false,
        billable,
        request_id: readString(error?.request_id) || null,
        idempotency_key: idempotencyKey,
        artifact_ids: images.map((image) => image?.id).filter((value) => typeof value === 'string' && value),
        content_urls: readImageUrls(images, ['content_url', 'path']),
        absolute_content_urls: readImageUrls(images, ['absolute_content_url', 'absolute_path']),
        image_dimensions: imageDimensions,
        expected_dimensions:
            readDimensionObject(error?.expected_dimensions) || readDimensionObject(details?.expected_dimensions),
        actual_dimensions:
            readDimensionObject(error?.actual_dimensions) || readDimensionObject(details?.actual_dimensions),
        dimension_check_failed:
            error?.code === 'dimension_check_failed' ||
            error?.code === 'image_dimension_mismatch' ||
            details?.dimension_check_failed === true
                ? true
                : undefined,
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
        streaming_strategy:
            readString(execution?.streaming_strategy) || readString(routing?.streaming_strategy) || null,
        channel_request_mode:
            readString(diagnostics?.channel_request_mode) || readString(execution?.channel_request_mode) || null,
        channel_request_mode_fallback_applied:
            typeof diagnostics?.channel_request_mode_fallback_applied === 'boolean'
                ? diagnostics.channel_request_mode_fallback_applied
                : typeof execution?.channel_request_mode_fallback_applied === 'boolean'
                  ? execution.channel_request_mode_fallback_applied
                  : null,
        route_decision: readObject(diagnostics?.route_decision) || readObject(execution?.route_decision) || null,
        selected_channel_id:
            readString(diagnostics?.selected_channel_id) || readString(execution?.selected_channel_id) || null,
        upstream_host: readString(diagnostics?.upstream_host) || readString(execution?.upstream_host) || null,
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
        image_dimensions: Array.isArray(value.image_dimensions) ? value.image_dimensions : [],
        expected_dimensions: value.expected_dimensions ?? null,
        actual_dimensions: value.actual_dimensions ?? null,
        dimension_check_failed: value.dimension_check_failed ?? false,
        route_mode: value.route_mode ?? null,
        image_backend: value.image_backend ?? null,
        stream_mode: value.stream_mode ?? null,
        streaming_strategy: value.streaming_strategy ?? null,
        channel_request_mode: value.channel_request_mode ?? null,
        channel_request_mode_fallback_applied: value.channel_request_mode_fallback_applied ?? null,
        route_decision: value.route_decision ?? null,
        selected_channel_id: value.selected_channel_id ?? null,
        upstream_host: value.upstream_host ?? null,
        transport_error_kind: value.transport_error_kind ?? null,
        retry_after_ms: value.retry_after_ms ?? null,
        retry_after_seconds: value.retry_after_seconds ?? null,
        cooldown_until: value.cooldown_until ?? null,
        cooldown_target: value.cooldown_target ?? null,
        agent_diagnostics_checked: value.agent_diagnostics_checked ?? false,
        agent_diagnostics_found: value.agent_diagnostics_found ?? false,
        agent_diagnostics_unavailable_reason: value.agent_diagnostics_unavailable_reason ?? null,
        agent_diagnostics_http_status: value.agent_diagnostics_http_status ?? null
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
    if (routing?.transport === 'server_orchestrated') return 'orchestrated';
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

function readResponseImageDimensions(images) {
    return images
        .map(
            (image) =>
                readDimensionObject(image?.dimensions) ||
                readDimensionObject(image?.metadata?.dimensions) ||
                readImageTopLevelDimensions(image)
        )
        .filter((value) => value !== undefined);
}

function readImageTopLevelDimensions(image) {
    if (!readObject(image)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(image, 'width')) return undefined;
    if (!Object.prototype.hasOwnProperty.call(image, 'height')) return undefined;
    return readDimensionObject(image);
}

function readDimensionObject(value) {
    if (typeof value === 'string') {
        const match = /^(\d+)x(\d+)$/.exec(value.trim());
        if (!match) return undefined;
        const width = Number(match[1]);
        const height = Number(match[2]);
        return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
            ? { width, height }
            : undefined;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const width = readPositiveInteger(value.width);
    const height = readPositiveInteger(value.height);
    if (width === undefined || height === undefined) return undefined;
    return { width, height };
}

function readPositiveInteger(value) {
    if (!Number.isInteger(value) || value <= 0) return undefined;
    return value;
}

function buildTimingSummary({ clientTiming, serverTiming, diagnostics }) {
    const serverTimingElapsedMs = readNonNegativeNumber(serverTiming?.elapsed_ms);
    const diagnosticsElapsedMs = readNonNegativeNumber(diagnostics?.elapsed_ms);
    const serverElapsedMs = readNonNegativeNumber(
        serverTiming?.server_elapsed_ms ?? serverTimingElapsedMs ?? diagnosticsElapsedMs
    );
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
            clientElapsedMs !== undefined && serverElapsedMs !== undefined
                ? Math.max(0, clientElapsedMs - serverElapsedMs)
                : undefined
    });
}
