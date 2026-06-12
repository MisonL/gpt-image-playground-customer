import {
    feedbackRecordToResponse,
    getFeedbackStore,
    normalizeFeedbackDeletedAt,
    normalizeFeedbackNote,
    normalizeFeedbackTargetId,
    normalizeFeedbackTargetType,
    normalizeFeedbackUpdatedAt,
    normalizeFeedbackValue,
    type FeedbackRecord,
    type FeedbackTarget
} from '@/lib/feedback-store';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { verifyAccessToken } from '@/lib/server-runtime';
import { appLogger } from '@/lib/app-logger';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FEEDBACK_TARGETS = 20;

function jsonError(code: string, message: string, status: number) {
    return NextResponse.json({ error: message, code }, { status });
}

function verifyFeedbackWriter(request: NextRequest) {
    const appPassword = process.env.APP_PASSWORD?.trim();
    if (!appPassword) return undefined;
    const accessToken = request.cookies.get('gptImageAccess')?.value;
    if (verifyAccessToken(accessToken, appPassword)) return undefined;
    const code = accessToken ? PAGE_PASSWORD_AUTH_ERROR_CODES.invalid : PAGE_PASSWORD_AUTH_ERROR_CODES.missing;
    return jsonError(code, '未授权：无效的访问令牌。', 401);
}

function readBodyObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('反馈请求体必须是 JSON 对象。');
    }
    return value as Record<string, unknown>;
}

function readTargets(value: unknown): FeedbackTarget[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FEEDBACK_TARGETS) {
        throw new TypeError('反馈目标数量无效。');
    }
    const targets = new Map<string, FeedbackTarget>();
    for (const target of value) {
        const object = readBodyObject(target);
        const targetType = normalizeFeedbackTargetType(object.type ?? object.targetType ?? object.target_type);
        if (targetType !== 'page_request') {
            throw new TypeError('页面反馈只能写入 page_request 目标。');
        }
        const targetId = normalizeFeedbackTargetId(object.id ?? object.targetId ?? object.target_id);
        targets.set(`${targetType}:${targetId}`, { targetType, targetId });
    }
    return Array.from(targets.values());
}

function buildRecords(body: Record<string, unknown>, now = new Date()): FeedbackRecord[] {
    const value = normalizeFeedbackValue(body.value);
    const note = normalizeFeedbackNote(body.note);
    const updatedAt = normalizeFeedbackUpdatedAt(body.updatedAt ?? body.updated_at, now);
    return readTargets(body.targets).map((target) => ({
        ...target,
        value,
        source: 'webui',
        updatedAt,
        ...(note ? { note } : {})
    }));
}

export async function PUT(request: NextRequest) {
    const authError = verifyFeedbackWriter(request);
    if (authError) return authError;

    let records: FeedbackRecord[];
    try {
        records = buildRecords(readBodyObject(await request.json()));
    } catch (error) {
        const message = error instanceof Error ? error.message : '反馈请求格式无效。';
        return jsonError('invalid_feedback_request', message, 400);
    }

    try {
        const store = await getFeedbackStore();
        await store.upsertFeedbackBatch(records);
        appLogger.info('结果反馈已写入服务端状态。', {
            clientRequestId: records[0]?.targetId,
            feedbackTargets: records.map((record) => `${record.targetType}:${record.targetId}`),
            feedbackValue: records[0]?.value
        });
        return NextResponse.json({ feedback: records.map(feedbackRecordToResponse) });
    } catch (error) {
        appLogger.error('结果反馈写入失败。', error);
        return jsonError('feedback_persist_failed', '结果反馈写入失败。', 500);
    }
}

export async function DELETE(request: NextRequest) {
    const authError = verifyFeedbackWriter(request);
    if (authError) return authError;

    let targets: FeedbackTarget[];
    let deletedAt: string | undefined;
    try {
        const body = readBodyObject(await request.json());
        targets = readTargets(body.targets);
        deletedAt = normalizeFeedbackDeletedAt(body.deletedAt ?? body.deleted_at);
    } catch (error) {
        const message = error instanceof Error ? error.message : '反馈删除请求格式无效。';
        return jsonError('invalid_feedback_delete_request', message, 400);
    }

    try {
        const store = await getFeedbackStore();
        const deleted = await store.deleteFeedbackByTargets(targets, deletedAt ? { deletedAt } : undefined);
        appLogger.info('结果反馈已从服务端状态删除。', {
            feedbackTargets: targets.map((target) => `${target.targetType}:${target.targetId}`),
            ...(deletedAt ? { feedbackDeletedAt: deletedAt } : {}),
            deleted
        });
        return NextResponse.json({ deleted, targets, ...(deletedAt ? { deleted_at: deletedAt } : {}) });
    } catch (error) {
        appLogger.error('结果反馈删除失败。', error);
        return jsonError('feedback_delete_failed', '结果反馈删除失败。', 500);
    }
}
