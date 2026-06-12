import {
    RESULT_FEEDBACK_NOTE_MAX_LENGTH,
    type HistoryMetadata,
    type ResultFeedbackValue
} from './history-metadata';

const HISTORY_FEEDBACK_TARGET_ID_MAX_LENGTH = 200;

export type HistoryFeedbackTarget = {
    type: 'page_request';
    id: string;
    filename?: string;
};

export type HistoryFeedbackSyncInput = {
    item: HistoryMetadata;
    value: ResultFeedbackValue;
    updatedAt: number;
    note?: string;
};

export type HistoryFeedbackSyncPayload = {
    key: string;
    itemTimestamp?: number;
    targets: HistoryFeedbackTarget[];
    value: ResultFeedbackValue;
    updatedAt: number;
    note?: string;
};

export type HistoryFeedbackDeletePayload = {
    key: string;
    targets: HistoryFeedbackTarget[];
    deletedAt?: number;
};

export function buildHistoryFeedbackTargets(item: HistoryMetadata): HistoryFeedbackTarget[] {
    const targets = new Map<string, HistoryFeedbackTarget>();
    for (const clientRequestId of item.clientRequestIds ?? []) {
        addTarget(targets, clientRequestId);
    }
    for (const image of item.images) {
        addTarget(targets, image.clientRequestId, image.filename);
    }
    return Array.from(targets.values());
}

export function buildHistoryFeedbackSyncPayload(input: HistoryFeedbackSyncInput): HistoryFeedbackSyncPayload | undefined {
    const targets = buildHistoryFeedbackTargets(input.item);
    if (targets.length === 0 || !isSerializableDateMillis(input.updatedAt)) return undefined;
    const note = normalizeHistoryFeedbackSyncNote(input.note);
    return {
        key: buildHistoryFeedbackSyncKeyFromParts({
            itemTimestamp: input.item.timestamp,
            targets,
            value: input.value,
            updatedAt: input.updatedAt,
            note
        }),
        itemTimestamp: input.item.timestamp,
        targets,
        value: input.value,
        updatedAt: input.updatedAt,
        ...(note ? { note } : {})
    };
}

export function buildHistoryFeedbackSyncInputs(history: HistoryMetadata[]): HistoryFeedbackSyncInput[] {
    return history.flatMap((item) => {
        const feedback = item.resultFeedback;
        if (!feedback || !isSerializableDateMillis(feedback.updatedAt) || buildHistoryFeedbackTargets(item).length === 0) {
            return [];
        }
        return [
            {
                item,
                value: feedback.value,
                updatedAt: feedback.updatedAt,
                ...(feedback.note ? { note: feedback.note } : {})
            }
        ];
    });
}

export function buildHistoryFeedbackSyncPayloads(history: HistoryMetadata[]): HistoryFeedbackSyncPayload[] {
    return buildHistoryFeedbackSyncInputs(history)
        .map(buildHistoryFeedbackSyncPayload)
        .filter((payload): payload is HistoryFeedbackSyncPayload => payload !== undefined);
}

export function buildHistoryFeedbackDeleteTargets(history: HistoryMetadata[]): HistoryFeedbackTarget[] {
    const targets = new Map<string, HistoryFeedbackTarget>();
    for (const item of history) {
        for (const target of buildHistoryFeedbackTargets(item)) {
            addTarget(targets, target.id, target.filename);
        }
    }
    return Array.from(targets.values());
}

export function buildHistoryFeedbackDeletePayload(
    targets: HistoryFeedbackTarget[],
    deletedAt?: number
): HistoryFeedbackDeletePayload | undefined {
    const normalizedTargets = normalizeHistoryFeedbackTargets(targets);
    if (normalizedTargets.length === 0) return undefined;
    if (deletedAt !== undefined && !isSerializableDateMillis(deletedAt)) return undefined;
    return {
        key: buildHistoryFeedbackDeleteKey(normalizedTargets),
        targets: normalizedTargets,
        ...(deletedAt !== undefined ? { deletedAt } : {})
    };
}

export function buildHistoryFeedbackDeleteKey(targets: HistoryFeedbackTarget[]): string {
    return JSON.stringify(buildHistoryFeedbackTargetKeyIds(targets));
}

export function buildHistoryFeedbackSyncKey(input: HistoryFeedbackSyncInput): string {
    return buildHistoryFeedbackSyncKeyFromParts({
        itemTimestamp: input.item.timestamp,
        targets: buildHistoryFeedbackTargets(input.item),
        value: input.value,
        updatedAt: input.updatedAt,
        note: normalizeHistoryFeedbackSyncNote(input.note)
    });
}

export function parseHistoryFeedbackSyncQueue(value: string | null): HistoryFeedbackSyncPayload[] {
    if (!value) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce((queue, item) => {
        if (!isHistoryFeedbackSyncPayload(item)) return queue;
        const payload = normalizeHistoryFeedbackSyncPayload(item);
        return payload ? upsertHistoryFeedbackSyncQueue(queue, payload) : queue;
    }, [] as HistoryFeedbackSyncPayload[]);
}

export function serializeHistoryFeedbackSyncQueue(queue: HistoryFeedbackSyncPayload[]): string {
    return JSON.stringify(
        queue
            .map(normalizeHistoryFeedbackSyncPayload)
            .filter((payload): payload is HistoryFeedbackSyncPayload => payload !== undefined)
    );
}

export function parseHistoryFeedbackDeleteQueue(value: string | null): HistoryFeedbackDeletePayload[] {
    if (!value) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const legacyTargets: HistoryFeedbackTarget[] = [];
    const payloads: HistoryFeedbackDeletePayload[] = [];
    for (const item of parsed) {
        if (isHistoryFeedbackDeletePayload(item)) {
            const payload = buildHistoryFeedbackDeletePayload(item.targets, item.deletedAt);
            if (payload) payloads.push(payload);
            continue;
        }
        if (isHistoryFeedbackTarget(item)) legacyTargets.push(item);
    }
    const legacyPayload = buildHistoryFeedbackDeletePayload(legacyTargets);
    const normalizedPayloads = legacyPayload ? [legacyPayload, ...payloads] : payloads;
    return normalizedPayloads.reduce(
        (queue, payload) => upsertHistoryFeedbackDeleteQueue(queue, payload),
        [] as HistoryFeedbackDeletePayload[]
    );
}

export function serializeHistoryFeedbackDeleteQueue(queue: HistoryFeedbackDeletePayload[]): string {
    return JSON.stringify(
        queue
            .map((payload) => buildHistoryFeedbackDeletePayload(payload.targets, payload.deletedAt))
            .filter((payload): payload is HistoryFeedbackDeletePayload => payload !== undefined)
    );
}

export function upsertHistoryFeedbackSyncQueue(
    queue: HistoryFeedbackSyncPayload[],
    payload: HistoryFeedbackSyncPayload,
    maxItems = 100
): HistoryFeedbackSyncPayload[] {
    const normalizedPayload = normalizeHistoryFeedbackSyncPayload(payload);
    if (!normalizedPayload) return queue;
    let shouldAppend = true;
    const pruned = queue.filter((item) => {
        if (item.key === normalizedPayload.key) return false;
        if (!hasTargetOverlap(item, normalizedPayload)) return true;
        if (item.updatedAt > normalizedPayload.updatedAt) {
            shouldAppend = false;
            return true;
        }
        if (item.updatedAt === normalizedPayload.updatedAt) {
            shouldAppend = false;
            return true;
        }
        return false;
    });
    return (shouldAppend ? [...pruned, normalizedPayload] : pruned).slice(-maxItems);
}

export function upsertHistoryFeedbackDeleteQueue(
    queue: HistoryFeedbackDeletePayload[],
    payload: HistoryFeedbackDeletePayload,
    maxItems = 100
): HistoryFeedbackDeletePayload[] {
    const normalizedPayload = buildHistoryFeedbackDeletePayload(payload.targets, payload.deletedAt);
    if (!normalizedPayload) return queue;
    let remainingTargets = normalizedPayload.targets;
    const pruned: HistoryFeedbackDeletePayload[] = [];
    for (const item of queue) {
        if (!haveTargetOverlap(item.targets, remainingTargets)) {
            pruned.push(item);
            continue;
        }
        if (shouldReplaceHistoryFeedbackDeletePayload(item, normalizedPayload)) {
            pruned.push(...removeHistoryFeedbackTargetsFromPayload(item, remainingTargets));
            continue;
        }
        pruned.push(item);
        remainingTargets = removeHistoryFeedbackTargets(remainingTargets, item.targets);
    }
    const remainingPayload = buildHistoryFeedbackDeletePayload(remainingTargets, normalizedPayload.deletedAt);
    return (remainingPayload ? [...pruned, remainingPayload] : pruned).slice(-maxItems);
}

export function shouldReplaceHistoryFeedbackDeletePayload(
    existing: HistoryFeedbackDeletePayload,
    incoming: HistoryFeedbackDeletePayload
): boolean {
    if (incoming.deletedAt === undefined) return false;
    if (existing.deletedAt === undefined) return true;
    return incoming.deletedAt > existing.deletedAt;
}

export function removeHistoryFeedbackSyncQueueItem(
    queue: HistoryFeedbackSyncPayload[],
    key: string
): HistoryFeedbackSyncPayload[] {
    return queue.filter((item) => item.key !== key);
}

export function removeHistoryFeedbackSyncQueueTargets(
    queue: HistoryFeedbackSyncPayload[],
    targets: HistoryFeedbackTarget[]
): HistoryFeedbackSyncPayload[] {
    const targetIds = buildHistoryFeedbackTargetIdSet(targets);
    return queue.flatMap((item) => {
        const remainingTargets = item.targets.filter((target) => !targetIds.has(target.id));
        const updated = rebuildHistoryFeedbackSyncPayloadWithTargets(item, remainingTargets);
        return updated ? [updated] : [];
    });
}

export function removeHistoryFeedbackSyncQueueTargetsForDelete(
    queue: HistoryFeedbackSyncPayload[],
    deletePayload: HistoryFeedbackDeletePayload
): HistoryFeedbackSyncPayload[] {
    return queue.flatMap((item) => {
        if (!shouldFeedbackDeleteClearSync(deletePayload, item)) return [item];
        const deleteIds = buildHistoryFeedbackTargetIdSet(deletePayload.targets);
        const remainingTargets = item.targets.filter((target) => !deleteIds.has(target.id));
        const updated = rebuildHistoryFeedbackSyncPayloadWithTargets(item, remainingTargets);
        return updated ? [updated] : [];
    });
}

export function removeHistoryFeedbackDeleteQueueTargets(
    queue: HistoryFeedbackDeletePayload[],
    targets: HistoryFeedbackTarget[]
): HistoryFeedbackDeletePayload[] {
    return queue.flatMap((item) => removeHistoryFeedbackTargetsFromPayload(item, targets));
}

export function removeHistoryFeedbackDeleteQueuePayload(
    queue: HistoryFeedbackDeletePayload[],
    payload: HistoryFeedbackDeletePayload
): HistoryFeedbackDeletePayload[] {
    return queue.flatMap((item) => {
        if (item.deletedAt !== payload.deletedAt) return [item];
        return removeHistoryFeedbackTargetsFromPayload(item, payload.targets);
    });
}

export function pruneHistoryFeedbackDeleteQueueForSyncQueue(
    deleteQueue: HistoryFeedbackDeletePayload[],
    syncQueue: HistoryFeedbackSyncPayload[]
): HistoryFeedbackDeletePayload[] {
    return deleteQueue.flatMap((deletePayload) => {
        const targetsToRemove = syncQueue
            .filter((syncPayload) => shouldFeedbackSyncClearDelete(syncPayload, deletePayload))
            .flatMap((syncPayload) => syncPayload.targets);
        return removeHistoryFeedbackTargetsFromPayload(deletePayload, targetsToRemove);
    });
}

export function shouldFeedbackDeleteClearSync(
    deletePayload: HistoryFeedbackDeletePayload,
    syncPayload: HistoryFeedbackSyncPayload
): boolean {
    if (!haveTargetOverlap(deletePayload.targets, syncPayload.targets)) return false;
    if (deletePayload.deletedAt === undefined) return true;
    return syncPayload.updatedAt <= deletePayload.deletedAt;
}

export function shouldFeedbackSyncClearDelete(
    syncPayload: HistoryFeedbackSyncPayload,
    deletePayload: HistoryFeedbackDeletePayload
): boolean {
    if (!haveTargetOverlap(syncPayload.targets, deletePayload.targets)) return false;
    return deletePayload.deletedAt !== undefined && syncPayload.updatedAt > deletePayload.deletedAt;
}

function addTarget(targets: Map<string, HistoryFeedbackTarget>, clientRequestId: string | undefined, filename?: string): void {
    const targetId = normalizeHistoryFeedbackTargetId(clientRequestId);
    if (!targetId) return;
    const existing = targets.get(targetId);
    if (existing) {
        if (!existing.filename && filename) {
            targets.set(targetId, { ...existing, filename });
        }
        return;
    }
    targets.set(targetId, {
        type: 'page_request',
        id: targetId,
        ...(filename ? { filename } : {})
    });
}

function normalizeHistoryFeedbackTargets(targets: readonly unknown[]): HistoryFeedbackTarget[] {
    const normalized = new Map<string, HistoryFeedbackTarget>();
    for (const target of targets) {
        const feedbackTarget = normalizeHistoryFeedbackTarget(target);
        if (feedbackTarget) addTarget(normalized, feedbackTarget.id, feedbackTarget.filename);
    }
    return Array.from(normalized.values());
}

function normalizeHistoryFeedbackTarget(value: unknown): HistoryFeedbackTarget | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const target = value as Partial<HistoryFeedbackTarget>;
    const targetId = normalizeHistoryFeedbackTargetId(target.id);
    if (target.type !== 'page_request' || !targetId) return undefined;
    return {
        type: 'page_request',
        id: targetId,
        ...(typeof target.filename === 'string' ? { filename: target.filename } : {})
    };
}

function normalizeHistoryFeedbackTargetId(value: string | undefined): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > HISTORY_FEEDBACK_TARGET_ID_MAX_LENGTH) return undefined;
    return trimmed;
}

function buildHistoryFeedbackTargetKeyIds(targets: HistoryFeedbackTarget[]): string[] {
    return normalizeHistoryFeedbackTargets(targets)
        .map((target) => target.id)
        .sort();
}

function normalizeHistoryFeedbackSyncPayload(
    payload: HistoryFeedbackSyncPayload
): HistoryFeedbackSyncPayload | undefined {
    const targets = normalizeHistoryFeedbackTargets(payload.targets);
    if (targets.length === 0 || !isSerializableDateMillis(payload.updatedAt)) return undefined;
    const itemTimestamp = readHistoryFeedbackSyncItemTimestamp(payload);
    const note = normalizeHistoryFeedbackSyncNote(payload.note);
    const key =
        itemTimestamp === undefined
            ? payload.key
            : buildHistoryFeedbackSyncKeyFromParts({
                  itemTimestamp,
                  targets,
                  value: payload.value,
                  updatedAt: payload.updatedAt,
                  note
              });
    return {
        key,
        ...(itemTimestamp !== undefined ? { itemTimestamp } : {}),
        targets,
        value: payload.value,
        updatedAt: payload.updatedAt,
        ...(note ? { note } : {})
    };
}

function rebuildHistoryFeedbackSyncPayloadWithTargets(
    payload: HistoryFeedbackSyncPayload,
    targets: HistoryFeedbackTarget[]
): HistoryFeedbackSyncPayload | undefined {
    const normalizedTargets = normalizeHistoryFeedbackTargets(targets);
    if (normalizedTargets.length === 0) return undefined;
    const itemTimestamp = readHistoryFeedbackSyncItemTimestamp(payload);
    return normalizeHistoryFeedbackSyncPayload({
        ...payload,
        ...(itemTimestamp !== undefined
            ? {
                  itemTimestamp,
                  key: buildHistoryFeedbackSyncKeyFromParts({
                      itemTimestamp,
                      targets: normalizedTargets,
                      value: payload.value,
                      updatedAt: payload.updatedAt,
                      note: payload.note
                  })
              }
            : {}),
        targets: normalizedTargets
    });
}

function buildHistoryFeedbackSyncKeyFromParts(input: {
    itemTimestamp: number;
    targets: HistoryFeedbackTarget[];
    value: ResultFeedbackValue;
    updatedAt: number;
    note?: string;
}): string {
    const targetIds = buildHistoryFeedbackTargetKeyIds(input.targets).join(',');
    return [input.itemTimestamp, targetIds, input.value, input.updatedAt, input.note ?? ''].join('|');
}

function normalizeHistoryFeedbackSyncNote(note: string | undefined): string | undefined {
    const trimmed = note?.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, RESULT_FEEDBACK_NOTE_MAX_LENGTH);
}

function readHistoryFeedbackSyncItemTimestamp(payload: HistoryFeedbackSyncPayload): number | undefined {
    if (typeof payload.itemTimestamp === 'number' && isSerializableDateMillis(payload.itemTimestamp)) {
        return payload.itemTimestamp;
    }
    const parsed = Number(String(payload.key).split('|')[0]);
    return isSerializableDateMillis(parsed) ? parsed : undefined;
}

function isHistoryFeedbackSyncPayload(value: unknown): value is HistoryFeedbackSyncPayload {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const payload = value as Partial<HistoryFeedbackSyncPayload>;
    return (
        typeof payload.key === 'string' &&
        payload.key.length > 0 &&
        Array.isArray(payload.targets) &&
        payload.targets.length > 0 &&
        (payload.value === 'usable' || payload.value === 'needs_revision') &&
        typeof payload.updatedAt === 'number' &&
        isSerializableDateMillis(payload.updatedAt) &&
        (payload.itemTimestamp === undefined ||
            (typeof payload.itemTimestamp === 'number' && isSerializableDateMillis(payload.itemTimestamp))) &&
        (payload.note === undefined || typeof payload.note === 'string')
    );
}

function isHistoryFeedbackTarget(value: unknown): value is HistoryFeedbackTarget {
    return normalizeHistoryFeedbackTarget(value) !== undefined;
}

function isHistoryFeedbackDeletePayload(value: unknown): value is HistoryFeedbackDeletePayload {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const payload = value as Partial<HistoryFeedbackDeletePayload>;
    return (
        Array.isArray(payload.targets) &&
        payload.targets.length > 0 &&
        (payload.deletedAt === undefined ||
            (typeof payload.deletedAt === 'number' && isSerializableDateMillis(payload.deletedAt)))
    );
}

function isSerializableDateMillis(value: number): boolean {
    if (!Number.isFinite(value)) return false;
    return Number.isFinite(new Date(value).getTime());
}

function hasTargetOverlap(left: HistoryFeedbackSyncPayload, right: HistoryFeedbackSyncPayload): boolean {
    return haveTargetOverlap(left.targets, right.targets);
}

function removeHistoryFeedbackTargetsFromPayload(
    payload: HistoryFeedbackDeletePayload,
    targets: HistoryFeedbackTarget[]
): HistoryFeedbackDeletePayload[] {
    const remainingTargets = removeHistoryFeedbackTargets(payload.targets, targets);
    const updatedPayload = buildHistoryFeedbackDeletePayload(remainingTargets, payload.deletedAt);
    return updatedPayload ? [updatedPayload] : [];
}

function removeHistoryFeedbackTargets(
    targets: HistoryFeedbackTarget[],
    targetsToRemove: HistoryFeedbackTarget[]
): HistoryFeedbackTarget[] {
    const targetIds = buildHistoryFeedbackTargetIdSet(targetsToRemove);
    return targets.filter((target) => !targetIds.has(target.id));
}

function haveTargetOverlap(left: HistoryFeedbackTarget[], right: HistoryFeedbackTarget[]): boolean {
    const rightIds = buildHistoryFeedbackTargetIdSet(right);
    return left.some((target) => rightIds.has(target.id));
}

function buildHistoryFeedbackTargetIdSet(targets: readonly unknown[]): Set<string> {
    return new Set(normalizeHistoryFeedbackTargets(targets).map((target) => target.id));
}
