import { asRecord, type JsonRecord } from './json-record';
import type OpenAI from 'openai';

type ImageUsage = OpenAI.Images.ImagesResponse['usage'];

export type ImageStreamProviderDialect =
    | 'official_image_event'
    | 'responses_image_event'
    | 'otokapi_image_event'
    | 'sdk_parsed_fallback'
    | 'unknown_ignored_event';

export type NormalizedImageStreamEvent =
    | {
          type: 'partial_image';
          b64Json: string;
          partialImageIndex?: number;
      }
    | {
          type: 'completed';
          b64Json: string;
          usage?: ImageUsage;
          dedupeKey?: string;
      };

export type ImageStreamEventNormalizationResult = {
    events: NormalizedImageStreamEvent[];
    providerDialect: ImageStreamProviderDialect;
    upstreamEventType?: string;
};

class UpstreamImageStreamEventError extends Error {
    readonly status = 502;

    constructor(message: string) {
        super(message);
        this.name = 'UpstreamImageStreamEventError';
    }
}

const PARTIAL_EVENT_TYPES = new Set([
    'image_generation.partial_image',
    'image_edit.partial_image',
    'image.generation.chunk',
    'response.image_generation_call.partial_image'
]);

const COMPLETED_EVENT_TYPES = new Set([
    'image_generation.completed',
    'image_edit.completed',
    'image.generation.result',
    'response.image_generation_call.completed',
    'response.output_item.done',
    'response.completed'
]);

const OFFICIAL_EVENT_TYPES = new Set([
    'image_generation.partial_image',
    'image_edit.partial_image',
    'image_generation.completed',
    'image_edit.completed'
]);

const RESPONSES_EVENT_TYPES = new Set([
    'response.image_generation_call.partial_image',
    'response.image_generation_call.completed',
    'response.output_item.done',
    'response.completed',
    'response.failed',
    'error'
]);

const OTOKAPI_EVENT_TYPES = new Set(['image.generation.chunk', 'image.generation.result']);

function readString(record: JsonRecord, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
}

function readNumber(record: JsonRecord, ...keys: string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}

function readUsage(record: JsonRecord): ImageUsage | undefined {
    const usage = record.usage;
    if (typeof usage === 'object' && usage !== null && !Array.isArray(usage)) {
        return usage as ImageUsage;
    }
    return undefined;
}

function extractBase64FromDataUrl(value: string | undefined): string | undefined {
    if (!value || !value.startsWith('data:')) {
        return undefined;
    }
    const separator = value.indexOf(',');
    if (separator < 0) {
        return undefined;
    }
    const payload = value.slice(separator + 1).trim();
    return payload || undefined;
}

function isRemoteHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function readImageGenerationResultBase64(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const dataUrlPayload = extractBase64FromDataUrl(value);
    if (dataUrlPayload) return dataUrlPayload;
    if (isRemoteHttpUrl(value)) return undefined;
    return value;
}

function readImageBase64(record: JsonRecord): string | undefined {
    return (
        readString(record, 'b64_json', 'b64Json', 'partial_image_b64', 'partialImageB64') ||
        extractBase64FromDataUrl(readString(record, 'url'))
    );
}

function readDataItems(record: JsonRecord): JsonRecord[] {
    const data = record.data;
    if (Array.isArray(data)) {
        return data.flatMap((item) => {
            const itemRecord = asRecord(item);
            return itemRecord ? [itemRecord] : [];
        });
    }

    const dataRecord = asRecord(data);
    if (!dataRecord) {
        return [];
    }

    return [dataRecord];
}

function readFirstNestedUsage(record: JsonRecord): ImageUsage | undefined {
    for (const item of readDataItems(record)) {
        const usage = readUsage(item);
        if (usage) {
            return usage;
        }
    }
    return undefined;
}

function readResponseUsage(record: JsonRecord): ImageUsage | undefined {
    const response = asRecord(record.response);
    return response ? readUsage(response) : undefined;
}

function readErrorMessage(record: JsonRecord): string | undefined {
    const direct = readString(record, 'message', 'error_description', 'error');
    if (direct) {
        return direct;
    }
    const error = asRecord(record.error);
    return error ? readString(error, 'message', 'code') : undefined;
}

function readResponsesFailureMessage(record: JsonRecord): string {
    const response = asRecord(record.response);
    const message = (response ? readErrorMessage(response) : undefined) || readErrorMessage(record);
    return message || '上游未提供错误信息。';
}

function readFailedResponsesImageMessage(record: JsonRecord): string | undefined {
    for (const item of readResponsesImageGenerationItems(record)) {
        if (readString(item, 'status') === 'failed') {
            return readErrorMessage(item) || '上游未提供错误信息。';
        }
    }
    return undefined;
}

function assertNotExplicitFailureEvent(record: JsonRecord, eventType: string | undefined) {
    if (eventType === 'response.failed' || eventType === 'error') {
        throw new UpstreamImageStreamEventError(`Responses API 流式响应失败：${readResponsesFailureMessage(record)}`);
    }
    if (eventType && RESPONSES_EVENT_TYPES.has(eventType)) {
        const failedImageMessage = readFailedResponsesImageMessage(record);
        if (failedImageMessage) {
            throw new UpstreamImageStreamEventError(`Responses API image_generation_call 失败：${failedImageMessage}`);
        }
    }
}

function readNestedCompletedItems(record: JsonRecord): JsonRecord[] {
    const items: JsonRecord[] = [];
    const visit = (current: JsonRecord) => {
        for (const item of readDataItems(current)) {
            items.push(item);
            visit(item);
        }
    };
    visit(record);
    return items;
}

function readOutputItems(record: JsonRecord): JsonRecord[] {
    const { output } = record;
    if (!Array.isArray(output)) {
        return [];
    }
    return output.flatMap((item) => {
        const itemRecord = asRecord(item);
        return itemRecord ? [itemRecord] : [];
    });
}

function readResponsesImageGenerationItems(record: JsonRecord): JsonRecord[] {
    const items: JsonRecord[] = [];
    const visit = (current: JsonRecord) => {
        const currentType = readString(current, 'type');
        if (currentType === 'image_generation_call') {
            items.push(current);
        }
        if (
            currentType === 'response.image_generation_call.completed' &&
            (readString(current, 'result', 'url') || readImageBase64(current))
        ) {
            items.push({ ...current, type: 'image_generation_call' });
        }

        const item = asRecord(current.item);
        if (item) {
            visit(item);
        }

        const response = asRecord(current.response);
        if (response) {
            visit(response);
        }

        for (const outputItem of readOutputItems(current)) {
            visit(outputItem);
        }
    };
    visit(record);
    return items;
}

function readResponsesImageBase64(record: JsonRecord): string | undefined {
    if (readString(record, 'type') !== 'image_generation_call') {
        return undefined;
    }
    const result = readString(record, 'result');
    return readImageGenerationResultBase64(result) || readImageBase64(record);
}

function readResponsesImageDedupeKey(record: JsonRecord, b64Json?: string): string | undefined {
    if (readString(record, 'type') !== 'image_generation_call') {
        return undefined;
    }
    const id = readString(record, 'id', 'item_id', 'itemId', 'call_id', 'callId');
    if (id) return `responses:${id}`;
    return b64Json ? `responses:result:${b64Json}` : undefined;
}

function hasRemoteOnlyResponsesImageResult(record: JsonRecord): boolean {
    return readResponsesImageGenerationItems(record).some((item) => {
        const result = readString(item, 'result');
        const url = readString(item, 'url');
        return Boolean(((result && isRemoteHttpUrl(result)) || (url && isRemoteHttpUrl(url))) && !readImageBase64(item));
    });
}

function hasCompletedResponsesImageItem(record: JsonRecord): boolean {
    return readResponsesImageGenerationItems(record).some((item) => {
        const status = readString(item, 'status');
        return status === 'completed' || Boolean(readString(item, 'result', 'url'));
    });
}

function hasCompletedImagePayload(record: JsonRecord): boolean {
    return (
        readNestedCompletedItems(record).some((item) => Boolean(readImageBase64(item))) ||
        readResponsesImageGenerationItems(record).some((item) => Boolean(readResponsesImageBase64(item)))
    );
}

function normalizePartialEvent(record: JsonRecord): NormalizedImageStreamEvent[] {
    const b64Json = readImageBase64(record);
    if (!b64Json) {
        return [];
    }
    const partialImageIndex = readNumber(record, 'partial_image_index', 'partialImageIndex', 'index');
    return [
        {
            type: 'partial_image',
            b64Json,
            ...(partialImageIndex !== undefined ? { partialImageIndex } : {})
        }
    ];
}

type CompletedImageSource = {
    b64Json: string;
    dedupeKey?: string;
};

function appendCompletedSource(completed: CompletedImageSource[], sourceValues: CompletedImageSource[]) {
    const previousKeys = new Set(completed.flatMap((item) => (item.dedupeKey ? [item.dedupeKey] : [])));
    for (const value of sourceValues) {
        if (value.dedupeKey && previousKeys.has(value.dedupeKey)) {
            continue;
        }
        completed.push(value);
        if (value.dedupeKey) previousKeys.add(value.dedupeKey);
    }
}

function normalizeCompletedEvent(record: JsonRecord, eventType: string | undefined): NormalizedImageStreamEvent[] {
    const usage = readUsage(record) || readResponseUsage(record) || readFirstNestedUsage(record);
    const rootB64 = readImageBase64(record);
    const dataItems = readNestedCompletedItems(record);
    const responsesItems = readResponsesImageGenerationItems(record);
    const completed: CompletedImageSource[] = [];
    appendCompletedSource(completed, rootB64 ? [{ b64Json: rootB64 }] : []);
    appendCompletedSource(
        completed,
        dataItems.flatMap((item) => {
            const b64Json = readImageBase64(item);
            if (!b64Json) return [];
            const dedupeKey = readResponsesImageDedupeKey(item, b64Json);
            return [{ b64Json, ...(dedupeKey ? { dedupeKey } : {}) }];
        })
    );
    appendCompletedSource(
        completed,
        responsesItems.flatMap((item) => {
            const b64Json = readResponsesImageBase64(item);
            if (!b64Json) return [];
            const dedupeKey = readResponsesImageDedupeKey(item, b64Json);
            return [{ b64Json, ...(dedupeKey ? { dedupeKey } : {}) }];
        })
    );

    if (
        completed.length === 0 &&
        eventType &&
        COMPLETED_EVENT_TYPES.has(eventType) &&
        !RESPONSES_EVENT_TYPES.has(eventType)
    ) {
        throw new UpstreamImageStreamEventError(`流式图片完成事件缺少 b64_json。上游事件类型：${eventType}。`);
    }
    if (completed.length === 0 && eventType && RESPONSES_EVENT_TYPES.has(eventType)) {
        if (hasRemoteOnlyResponsesImageResult(record)) {
            throw new UpstreamImageStreamEventError(
                `Responses API 图片完成事件只返回远程 URL，缺少可保存的 base64 result。上游事件类型：${eventType}。`
            );
        }
        if (hasCompletedResponsesImageItem(record)) {
            throw new UpstreamImageStreamEventError(
                `Responses API 图片完成事件缺少 image_generation_call.result。上游事件类型：${eventType}。`
            );
        }
    }

    return completed.map((item) => ({
        type: 'completed' as const,
        b64Json: item.b64Json,
        ...(item.dedupeKey ? { dedupeKey: item.dedupeKey } : {}),
        ...(usage ? { usage } : {})
    }));
}

function classifyProviderDialect(
    eventType: string | undefined,
    events: NormalizedImageStreamEvent[]
): ImageStreamProviderDialect {
    if (eventType && OFFICIAL_EVENT_TYPES.has(eventType)) {
        return 'official_image_event';
    }
    if (eventType && RESPONSES_EVENT_TYPES.has(eventType)) {
        return 'responses_image_event';
    }
    if (eventType && OTOKAPI_EVENT_TYPES.has(eventType)) {
        return 'otokapi_image_event';
    }
    if (!eventType && events.length > 0) {
        return 'sdk_parsed_fallback';
    }
    return 'unknown_ignored_event';
}

export function normalizeUpstreamImageStreamEventWithDiagnostics(event: unknown): ImageStreamEventNormalizationResult {
    const record = asRecord(event);
    if (!record) {
        return { events: [], providerDialect: 'unknown_ignored_event' };
    }

    const eventType = readString(record, 'type');
    assertNotExplicitFailureEvent(record, eventType);
    let events: NormalizedImageStreamEvent[];
    if (eventType && PARTIAL_EVENT_TYPES.has(eventType)) {
        events = normalizePartialEvent(record);
    } else if (!eventType && readImageBase64(record)) {
        events = normalizePartialEvent(record);
    } else if ((eventType && COMPLETED_EVENT_TYPES.has(eventType)) || (!eventType && hasCompletedImagePayload(record))) {
        events = normalizeCompletedEvent(record, eventType);
    } else {
        events = [];
    }

    const providerDialect = classifyProviderDialect(eventType, events);
    return {
        events,
        providerDialect,
        ...(eventType ? { upstreamEventType: eventType } : {})
    };
}

export function normalizeUpstreamImageStreamEvent(event: unknown): NormalizedImageStreamEvent[] {
    return normalizeUpstreamImageStreamEventWithDiagnostics(event).events.map((normalizedEvent) => {
        if (normalizedEvent.type !== 'completed' || !normalizedEvent.dedupeKey) {
            return normalizedEvent;
        }
        return {
            type: 'completed',
            b64Json: normalizedEvent.b64Json,
            ...(normalizedEvent.usage ? { usage: normalizedEvent.usage } : {})
        };
    });
}
