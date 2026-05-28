import fs from 'node:fs';
import path from 'node:path';

export const PAGE_SSE_ENDPOINT = '/api/images';
export const DEFAULT_PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH = 128;

export function readPageSseClientRequestIdMaxLength(capabilities) {
  const maxLength = capabilities?.agent_streaming?.page_sse?.client_request_id?.max_length;
  if (Number.isSafeInteger(maxLength) && maxLength > 0) return maxLength;
  return DEFAULT_PAGE_SSE_CLIENT_REQUEST_ID_MAX_LENGTH;
}

export function assertPageSseReady({ capabilities, passwordHash, idempotencyKey }) {
  const pageSse = capabilities?.agent_streaming?.page_sse;
  if (pageSse?.supported !== true) {
    throw createPageSseScriptError(
      'page_sse_unavailable',
      '当前路由需要 agent_streaming.page_sse.supported=true；capabilities 未声明时不能静默降级。'
    );
  }
  if (pageSse?.auth?.required === true && !passwordHash) {
    throw createPageSseScriptError(
      'page_sse_auth_required',
      '页面 SSE 路径需要表单字段 passwordHash；请设置 GPT_IMAGE_APP_PASSWORD_HASH 后重试。'
    );
  }
  const maxLength = readPageSseClientRequestIdMaxLength(capabilities);
  if (idempotencyKey.length > maxLength) {
    throw createPageSseScriptError(
      'page_sse_client_request_id_too_long',
      `页面 SSE 的 clientRequestId 不能超过 ${maxLength} 个字符；请缩短 Idempotency-Key。`
    );
  }
}

export async function postPageSse({ url, formData, timeoutMs, errorMessage, sseLogPath }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
    } catch (error) {
      throw new Error(`请求失败：${url}。${errorMessage(error)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      return await collectPageSseResult(response, controller.signal, errorMessage, sseLogPath);
    }

    const text = await response.text();
    if (!response.ok) {
      throw createPageSseHttpError(response.status, readErrorFromJsonText(text) || text);
    }
    return parseJsonResponse(text, true, url, errorMessage);
  } finally {
    clearTimeout(timeout);
  }
}

export function formatPageSseOutput({ result, baseUrl, responseMode = 'path', defaultOutputFormat = 'png' }) {
  if (!result || !Array.isArray(result.images)) return result;
  return {
    ...result,
    images: result.images.map((image) =>
      formatPageSseImage({ image, baseUrl, responseMode, defaultOutputFormat })
    )
  };
}

export function buildPageSseFailureOutput({ error, fallbackEndpoint, fallbackMode = 'manual_after_diagnosis', errorMessage }) {
  const diagnostics = readPageSseDiagnostics(error);
  if (isPageSseScriptError(error)) {
    return {
      ok: false,
      billable: false,
      error: {
        code: error.scriptCode,
        message: errorMessage(error),
        ...(diagnostics ? { diagnostics } : {})
      },
      routing: buildPageSseRouting(fallbackEndpoint, fallbackMode),
      next_step: '先补齐页面流式 capability 或访问码哈希，再重新执行；不要静默切换到 Agent JSON。'
    };
  }
  if (isPageSseRequestRejected(error)) {
    return {
      ok: false,
      billable: false,
      error: {
        code: 'page_sse_request_rejected',
        status: error.status,
        message: errorMessage(error),
        ...(diagnostics ? { diagnostics } : {})
      },
      routing: buildPageSseRouting(fallbackEndpoint, 'fix_request_before_retry'),
      next_step: '先修正页面端拒绝的请求参数或鉴权，再重新执行；这类本地 4xx 不应按上游计费失败处理。'
    };
  }
  return {
    ok: false,
    billable: true,
    error: {
      code: 'page_sse_failed',
      ...buildPageSseFailureStatus(error),
      message: errorMessage(error),
      ...(diagnostics ? { diagnostics } : {})
    },
    routing: buildPageSseRouting(fallbackEndpoint, fallbackMode),
    next_step: '先诊断页面流式失败原因，再决定是否显式选择备用路径；不要自动重试同一个请求。'
  };
}

export function normalizeImageBackendForPage(value) {
  if (value === 'images') return 'images-api';
  if (value === 'responses') return 'responses-image-generation';
  return value;
}

export function isPageSseDisabledByStreamingOptions(value) {
  return value?.streamMode === 'non_stream' || value?.streamingStrategy === 'off';
}

export function assertPageSseStreamingAllowed(value) {
  if (isPageSseDisabledByStreamingOptions(value)) {
    throw new Error('stream_mode=non_stream 或 streaming_strategy=off 时不能使用页面 SSE。');
  }
}

function buildPageSseRouting(fallbackEndpoint, fallbackMode) {
  return {
    transport: 'page_sse',
    endpoint: PAGE_SSE_ENDPOINT,
    fallback_endpoint: fallbackEndpoint,
    fallback_mode: fallbackMode
  };
}

function createPageSseScriptError(code, message) {
  const error = new Error(message);
  error.scriptCode = code;
  return error;
}

function isPageSseScriptError(error) {
  return Boolean(error && typeof error === 'object' && typeof error.scriptCode === 'string');
}

function isPageSseRequestRejected(error) {
  return Boolean(error && typeof error === 'object' && Number.isInteger(error.status) && error.status >= 400 && error.status < 500);
}

function createPageSseHttpError(status, message) {
  const error = new Error(formatErrorValue(message));
  error.status = status;
  return error;
}

function formatErrorValue(value) {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
    if (typeof value.code === 'string' && value.code.trim()) return value.code;
    try {
      return JSON.stringify(value);
    } catch {
      return '页面 SSE 返回错误。';
    }
  }
  return '页面 SSE 返回错误。';
}

function readErrorFromJsonText(text) {
  try {
    const value = text ? JSON.parse(text) : null;
    if (typeof value?.error === 'string') return value.error;
    return value?.error || value;
  } catch {
    return undefined;
  }
}

function parseJsonResponse(text, allowEmpty, url, errorMessage) {
  if (!text && allowEmpty) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`响应不是有效 JSON：${url}。${errorMessage(error)}`);
  }
}

async function collectPageSseResult(response, signal, errorMessage, sseLogPath) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('页面 SSE 响应缺少 body。');
  const decoder = new TextDecoder();
  const state = createPageSseState();
  let buffer = '';
  while (true) {
    const { done, value } = await readPageSseChunk(reader, signal);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const rawEvent of events) {
      appendPageSseLog(sseLogPath, rawEvent);
      applyPageSseEvent(state, rawEvent, errorMessage);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    appendPageSseLog(sseLogPath, buffer);
    applyPageSseEvent(state, buffer, errorMessage);
  }
  if (state.completedImages.length === 0) {
    throw withPageSseDiagnostics(new Error('页面 SSE 未返回最终图片。'), state);
  }
  if (!state.doneReceived) {
    throw withPageSseDiagnostics(new Error('页面 SSE 缺少最终 done 事件，流式响应可能已提前中断。'), state);
  }
  return { images: state.completedImages, usage: state.usage, actualCost: state.actualCost, sse_diagnostics: buildPageSseDiagnostics(state) };
}

function appendPageSseLog(filePath, rawEvent) {
  if (!filePath || !rawEvent.trim()) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify({ at: new Date().toISOString(), raw_event: rawEvent })}\n`);
  } catch (error) {
    console.warn(`SSE log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createPageSseState() {
  return {
    completedImages: [],
    usage: undefined,
    actualCost: undefined,
    doneReceived: false,
    completedEventCount: 0,
    partialImageCount: 0,
    lastEventType: undefined
  };
}

function readPageSseChunk(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) return Promise.reject(new Error('请求超时。'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('请求超时。'));
    signal.addEventListener('abort', onAbort, { once: true });
    reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
  });
}

function applyPageSseEvent(state, rawEvent, errorMessage) {
  const event = parsePageSseEvent(rawEvent, errorMessage);
  if (!event) return;
  const eventType = readPageSseEventType(event);
  state.lastEventType = eventType;
  if (isPartialPageSseEvent(event, eventType)) state.partialImageCount += 1;
  if (event.type === 'error') {
    throw createPageSseStreamError(event, state);
  }
  if (event.type === 'completed' && event.filename) {
    state.completedEventCount += 1;
    state.completedImages.push(
      normalizePageSseImage(
        {
          filename: event.filename,
          b64_json: event.b64_json,
          path: event.path,
          output_format: event.outputFormat || event.output_format
        },
        readPageSseClientRequestId(event)
      )
    );
    return;
  }
  if (event.type === 'done') {
    state.doneReceived = true;
    const clientRequestId = readPageSseClientRequestId(event);
    state.completedImages = mergePageSseDoneImages(event.images, state.completedImages, clientRequestId);
    state.usage = event.usage;
    state.actualCost = event.actualCost !== undefined ? event.actualCost : event.actual_cost;
  }
}

function readPageSseEventType(event) {
  if (typeof event.type === 'string' && event.type.trim()) return event.type;
  if (typeof event.event === 'string' && event.event.trim()) return event.event;
  return undefined;
}

function isPartialPageSseEvent(event, eventType) {
  if (typeof eventType === 'string' && eventType.includes('partial_image')) return true;
  return Boolean(event.partial_image || event.partialImage || event.partial_image_b64 || event.partialImageB64);
}

function parsePageSseEvent(rawEvent, errorMessage) {
  const lines = rawEvent.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return undefined;
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`页面 SSE 事件不是有效 JSON：${errorMessage(error)}`);
  }
}

function createPageSseStreamError(event, state) {
  const error = new Error(formatErrorValue(event.error));
  const status = readPageSseStreamStatus(event);
  if (Number.isInteger(status)) error.streamStatus = status;
  return withPageSseDiagnostics(error, state);
}

function readPageSseStreamStatus(event) {
  if (Number.isInteger(event.status)) return event.status;
  if (event.error && typeof event.error === 'object' && Number.isInteger(event.error.status)) {
    return event.error.status;
  }
  return undefined;
}

function readPageSseClientRequestId(event) {
  if (typeof event.clientRequestId === 'string') return event.clientRequestId;
  if (typeof event.client_request_id === 'string') return event.client_request_id;
  return undefined;
}

function normalizePageSseImage(image, fallbackClientRequestId) {
  const clientRequestId = image.clientRequestId || image.client_request_id || fallbackClientRequestId;
  return {
    ...image,
    ...(image.output_format ? { output_format: image.output_format } : {}),
    ...(clientRequestId ? { clientRequestId } : {})
  };
}

function mergePageSseDoneImages(doneImages, completedImages, fallbackClientRequestId) {
  if (!Array.isArray(doneImages) || doneImages.length === 0) {
    return completedImages.map((image) => normalizePageSseImage(image, fallbackClientRequestId));
  }
  const imageCount = Math.max(doneImages.length, completedImages.length);
  return Array.from({ length: imageCount }, (_, index) =>
    normalizePageSseImage(
      { ...(completedImages[index] || {}), ...(doneImages[index] || {}) },
      fallbackClientRequestId
    )
  );
}

function formatPageSseImage({ image, baseUrl, responseMode, defaultOutputFormat }) {
  const output = {
    ...image,
    output_format: image.outputFormat || image.output_format || defaultOutputFormat
  };
  if (output.path) {
    output.absolute_path = new URL(output.path, `${baseUrl}/`).toString();
    output.content_url = output.content_url || output.path;
    output.absolute_content_url = output.absolute_content_url || output.absolute_path;
    if (responseMode === 'path') delete output.b64_json;
  }
  return output;
}

function buildPageSseFailureStatus(error) {
  if (error && typeof error === 'object') {
    if (Number.isInteger(error.streamStatus)) return { status: error.streamStatus };
    if (Number.isInteger(error.status)) return { status: error.status };
  }
  return {};
}

function withPageSseDiagnostics(error, state) {
  error.pageSseDiagnostics = buildPageSseDiagnostics(state);
  return error;
}

function readPageSseDiagnostics(error) {
  if (!error || typeof error !== 'object' || !error.pageSseDiagnostics) return undefined;
  return error.pageSseDiagnostics;
}

function buildPageSseDiagnostics(state) {
  return {
    partial_image_count: state.partialImageCount,
    completed_event_count: state.completedEventCount,
    done_received: state.doneReceived,
    final_image_count: state.completedImages.length,
    ...(state.lastEventType ? { last_upstream_event_type: state.lastEventType } : {})
  };
}
