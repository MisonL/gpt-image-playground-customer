import { ensureAgentStateStoreReady } from './agent-state-runtime';

export const FEEDBACK_NOTE_MAX_LENGTH = 500;
export const FEEDBACK_TARGET_TYPES = ['page_request', 'agent_request', 'agent_artifact'] as const;
export const FEEDBACK_VALUES = ['usable', 'needs_revision'] as const;
export const FEEDBACK_SOURCES = ['webui', 'agent'] as const;

export type FeedbackTargetType = (typeof FEEDBACK_TARGET_TYPES)[number];
export type FeedbackValue = (typeof FEEDBACK_VALUES)[number];
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export type FeedbackTarget = {
    targetType: FeedbackTargetType;
    targetId: string;
};

export type FeedbackRecord = FeedbackTarget & {
    value: FeedbackValue;
    note?: string;
    source: FeedbackSource;
    updatedAt: string;
};

export type FeedbackResponse = {
    target_type: FeedbackTargetType;
    target_id: string;
    value: FeedbackValue;
    source: FeedbackSource;
    updated_at: string;
    note?: string;
};

export type FeedbackDeleteOptions = {
    deletedAt?: string;
};

export class FeedbackValidationError extends TypeError {
    constructor(message: string) {
        super(message);
        this.name = 'FeedbackValidationError';
    }
}

export type FeedbackStateStore = {
    upsertFeedback(record: FeedbackRecord): Promise<void>;
    upsertFeedbackBatch(records: FeedbackRecord[]): Promise<void>;
    readFeedback(targetType: FeedbackTargetType, targetId: string): Promise<FeedbackRecord | undefined>;
    listFeedbackByTargets(targets: FeedbackTarget[]): Promise<FeedbackRecord[]>;
    deleteFeedbackByTargets(targets: FeedbackTarget[], options?: FeedbackDeleteOptions): Promise<number>;
};

export function normalizeFeedbackNote(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
        throw new FeedbackValidationError('反馈备注必须是字符串。');
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, FEEDBACK_NOTE_MAX_LENGTH) : undefined;
}

export function normalizeFeedbackTargetType(value: unknown): FeedbackTargetType {
    if (FEEDBACK_TARGET_TYPES.includes(value as FeedbackTargetType)) return value as FeedbackTargetType;
    throw new FeedbackValidationError('反馈目标类型无效。');
}

export function normalizeFeedbackValue(value: unknown): FeedbackValue {
    if (FEEDBACK_VALUES.includes(value as FeedbackValue)) return value as FeedbackValue;
    throw new FeedbackValidationError('反馈值无效。');
}

export function normalizeFeedbackSource(value: unknown): FeedbackSource {
    if (value === undefined || value === null || value === '') return 'webui';
    if (FEEDBACK_SOURCES.includes(value as FeedbackSource)) return value as FeedbackSource;
    throw new FeedbackValidationError('反馈来源无效。');
}

export function normalizeFeedbackUpdatedAt(value: unknown, now = new Date()): string {
    if (value === undefined || value === null || value === '') return now.toISOString();
    if (typeof value !== 'number' && typeof value !== 'string') throw new FeedbackValidationError('反馈更新时间无效。');
    return normalizeFeedbackTimestamp(value, '反馈更新时间无效。');
}

export function normalizeFeedbackDeletedAt(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'number' && typeof value !== 'string') throw new FeedbackValidationError('反馈删除时间无效。');
    return normalizeFeedbackTimestamp(value, '反馈删除时间无效。');
}

export function normalizeFeedbackTargetId(value: unknown): string {
    if (typeof value !== 'string') throw new FeedbackValidationError('反馈目标 ID 必须是字符串。');
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 200) throw new FeedbackValidationError('反馈目标 ID 长度无效。');
    return trimmed;
}

export function feedbackRecordToResponse(record: FeedbackRecord): FeedbackResponse {
    return {
        target_type: record.targetType,
        target_id: record.targetId,
        value: record.value,
        source: record.source,
        updated_at: record.updatedAt,
        ...(record.note ? { note: record.note } : {})
    };
}

export async function getFeedbackStore(): Promise<FeedbackStateStore> {
    const store = await ensureAgentStateStoreReady();
    if (isFeedbackStateStore(store)) return store;
    throw new Error('当前状态后端不支持结果反馈元数据。');
}

export function isFeedbackStateStore(value: unknown): value is FeedbackStateStore {
    return (
        typeof value === 'object' &&
        value !== null &&
        'upsertFeedback' in value &&
        'upsertFeedbackBatch' in value &&
        'readFeedback' in value &&
        'listFeedbackByTargets' in value &&
        'deleteFeedbackByTargets' in value &&
        typeof value.upsertFeedback === 'function' &&
        typeof value.upsertFeedbackBatch === 'function' &&
        typeof value.readFeedback === 'function' &&
        typeof value.listFeedbackByTargets === 'function' &&
        typeof value.deleteFeedbackByTargets === 'function'
    );
}

function normalizeFeedbackTimestamp(value: string | number, invalidMessage: string): string {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new FeedbackValidationError(invalidMessage);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new FeedbackValidationError(invalidMessage);
    return parsed.toISOString();
}
