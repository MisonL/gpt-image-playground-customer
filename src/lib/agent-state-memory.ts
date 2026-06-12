import {
    discardArtifactFiles,
    isArtifactFilepathAllowed,
    moveArtifactFilesForDeletion,
    restoreArtifactFiles
} from './agent-file-utils';
import crypto from 'crypto';
import {
    addMilliseconds,
    addSeconds,
    buildRecoveredResponse,
    computeRetryAfterSeconds,
    createRequestId,
    isoDate,
    type AgentArtifactRecord,
    type AgentRequestRecord,
    type AgentStateStore,
    type BeginAgentRequestInput,
    type BeginAgentRequestResult,
    type CompleteAgentRequestInput,
    type FailAgentRequestInput
} from './agent-state-store';
import type {
    FeedbackDeleteOptions,
    FeedbackRecord,
    FeedbackStateStore,
    FeedbackTarget,
    FeedbackTargetType
} from './feedback-store';
import type { ImageShareRecord, ImageShareStateStore } from './share-store';

type RecoveryEvent = {
    id: string;
    eventType: string;
    details: unknown;
    createdAt: string;
};

export class MemoryAgentStateStore implements AgentStateStore, ImageShareStateStore, FeedbackStateStore {
    private readonly requestsByIdempotencyKey = new Map<string, AgentRequestRecord>();
    private readonly artifactsById = new Map<string, AgentArtifactRecord>();
    private readonly sharesByToken = new Map<string, ImageShareRecord>();
    private readonly feedbackByTarget = new Map<string, FeedbackRecord>();
    private readonly recoveryEvents: RecoveryEvent[] = [];

    async init(): Promise<void> {}

    async recoverExpiredRequests(now = new Date()): Promise<number> {
        const nowIso = isoDate(now);
        const expired = [...this.requestsByIdempotencyKey.values()].filter(
            (record) => record.status === 'running' && record.lockedUntil !== undefined && record.lockedUntil < nowIso
        );
        for (const record of expired) {
            const artifacts = this.listArtifactsForRequestSync(record.requestId);
            if (artifacts.length > 0) {
                this.replaceRequest(record.idempotencyKey, {
                    ...record,
                    status: 'succeeded',
                    responseJson: buildRecoveredResponse(record, artifacts),
                    errorJson: undefined,
                    lockedUntil: undefined,
                    updatedAt: nowIso
                });
            } else if (record.errorJson) {
                this.replaceRequest(record.idempotencyKey, {
                    ...record,
                    status: 'failed',
                    lockedUntil: undefined,
                    updatedAt: nowIso
                });
            } else {
                this.replaceRequest(record.idempotencyKey, {
                    ...record,
                    status: 'orphaned',
                    lockedUntil: undefined,
                    updatedAt: nowIso
                });
            }
        }
        if (expired.length > 0) {
            this.recoveryEvents.push({
                id: crypto.randomUUID(),
                eventType: 'expired_running_requests',
                details: { count: expired.length },
                createdAt: nowIso
            });
        }
        return expired.length;
    }

    async purgeExpiredRequests(now = new Date()): Promise<number> {
        const nowIso = isoDate(now);
        const expired = [...this.requestsByIdempotencyKey.values()].filter(
            (record) =>
                record.expiresAt < nowIso &&
                (record.status === 'succeeded' || record.status === 'failed' || record.status === 'orphaned')
        );
        const artifactFilepaths = [
            ...new Set(
                expired
                    .flatMap((record) => this.listArtifactsForRequestSync(record.requestId))
                    .map((artifact) => artifact.filepath)
                    .filter((filepath): filepath is string => isArtifactFilepathAllowed(filepath))
            )
        ];
        const movedFiles = await moveArtifactFilesForDeletion(artifactFilepaths);
        try {
            for (const record of expired) {
                for (const artifact of this.listArtifactsForRequestSync(record.requestId)) {
                    this.artifactsById.delete(artifact.id);
                    this.feedbackByTarget.delete(feedbackKey('agent_artifact', artifact.id));
                }
                this.requestsByIdempotencyKey.delete(record.idempotencyKey);
                this.feedbackByTarget.delete(feedbackKey('agent_request', record.requestId));
            }
        } catch (error) {
            await restoreArtifactFiles(movedFiles);
            throw error;
        }
        await discardArtifactFiles(movedFiles);
        return expired.length;
    }

    async beginRequest(input: BeginAgentRequestInput): Promise<BeginAgentRequestResult> {
        const now = input.now ?? new Date();
        const nowIso = isoDate(now);
        const lockedUntil = isoDate(addMilliseconds(now, input.leaseMs));
        const expiresAt = isoDate(addSeconds(now, input.ttlSeconds));
        const existing = this.requestsByIdempotencyKey.get(input.idempotencyKey);
        if (!existing) {
            const record: AgentRequestRecord = {
                requestId: createRequestId(),
                idempotencyKey: input.idempotencyKey,
                requestHash: input.requestHash,
                mode: input.mode,
                status: 'running',
                requestJson: input.requestJson,
                lockedUntil,
                createdAt: nowIso,
                updatedAt: nowIso,
                expiresAt
            };
            this.replaceRequest(input.idempotencyKey, record);
            return { type: 'acquired', record };
        }

        if (existing.requestHash !== input.requestHash) {
            return { type: 'conflict', record: existing };
        }
        if (existing.status === 'succeeded' && existing.responseJson) {
            return { type: 'replay', record: existing, response: existing.responseJson };
        }
        if (existing.status === 'failed' && existing.errorJson) {
            return { type: 'failed', record: existing, error: existing.errorJson };
        }
        if ((existing.status === 'running' || existing.status === 'pending') && existing.lockedUntil && existing.lockedUntil > nowIso) {
            return { type: 'in_progress', record: existing, retryAfterSeconds: computeRetryAfterSeconds(existing.lockedUntil, now) };
        }

        const reacquired = {
            ...existing,
            status: 'running' as const,
            lockedUntil,
            updatedAt: nowIso,
            expiresAt
        };
        this.replaceRequest(input.idempotencyKey, reacquired);
        return { type: 'acquired', record: reacquired };
    }

    async refreshRequestLease(input: { requestId: string; leaseMs: number; now?: Date }): Promise<boolean> {
        const now = input.now ?? new Date();
        const nowIso = isoDate(now);
        const lockedUntil = isoDate(addMilliseconds(now, input.leaseMs));
        let refreshed = false;
        this.updateRequestById(input.requestId, (record) => {
            if (record.status !== 'running' && record.status !== 'pending') return record;
            refreshed = true;
            return {
                ...record,
                lockedUntil,
                updatedAt: nowIso
            };
        });
        return refreshed;
    }

    async saveArtifacts(artifacts: AgentArtifactRecord[]): Promise<void> {
        this.insertArtifacts(artifacts);
    }

    async completeRequest(input: CompleteAgentRequestInput): Promise<void> {
        const nowIso = isoDate(input.now ?? new Date());
        this.insertArtifacts(input.artifacts);
        this.updateRequestById(input.requestId, (record) => ({
            ...record,
            status: 'succeeded',
            responseJson: input.response,
            errorJson: undefined,
            lockedUntil: undefined,
            updatedAt: nowIso
        }));
    }

    async failRequest(input: FailAgentRequestInput): Promise<void> {
        const nowIso = isoDate(input.now ?? new Date());
        this.updateRequestById(input.requestId, (record) => ({
            ...record,
            status: 'failed',
            responseJson: undefined,
            errorJson: input.error,
            lockedUntil: undefined,
            updatedAt: nowIso
        }));
    }

    async getRequest(requestId: string): Promise<AgentRequestRecord | undefined> {
        return [...this.requestsByIdempotencyKey.values()].find((record) => record.requestId === requestId);
    }

    async getRequestByIdempotencyKey(idempotencyKey: string): Promise<AgentRequestRecord | undefined> {
        return this.requestsByIdempotencyKey.get(idempotencyKey);
    }

    async getArtifact(id: string): Promise<AgentArtifactRecord | undefined> {
        return this.artifactsById.get(id);
    }

    async listArtifactsForRequest(requestId: string): Promise<AgentArtifactRecord[]> {
        return this.listArtifactsForRequestSync(requestId);
    }

    async deleteArtifact(id: string): Promise<boolean> {
        const deleted = this.artifactsById.delete(id);
        if (deleted) this.feedbackByTarget.delete(feedbackKey('agent_artifact', id));
        return deleted;
    }

    async upsertFeedback(record: FeedbackRecord): Promise<void> {
        const existing = await this.readFeedback(record.targetType, record.targetId);
        if (existing && existing.updatedAt > record.updatedAt) return;
        this.feedbackByTarget.set(feedbackKey(record.targetType, record.targetId), withoutUndefined(record));
    }

    async upsertFeedbackBatch(records: FeedbackRecord[]): Promise<void> {
        for (const record of records) {
            await this.upsertFeedback(record);
        }
    }

    async readFeedback(targetType: FeedbackTargetType, targetId: string): Promise<FeedbackRecord | undefined> {
        return this.feedbackByTarget.get(feedbackKey(targetType, targetId));
    }

    async listFeedbackByTargets(targets: FeedbackTarget[]): Promise<FeedbackRecord[]> {
        return targets
            .map((target) => this.feedbackByTarget.get(feedbackKey(target.targetType, target.targetId)))
            .filter((record): record is FeedbackRecord => record !== undefined);
    }

    async deleteFeedbackByTargets(targets: FeedbackTarget[], options: FeedbackDeleteOptions = {}): Promise<number> {
        let deleted = 0;
        for (const target of targets) {
            const key = feedbackKey(target.targetType, target.targetId);
            const existing = this.feedbackByTarget.get(key);
            if (!existing || (options.deletedAt && existing.updatedAt > options.deletedAt)) continue;
            if (this.feedbackByTarget.delete(key)) {
                deleted += 1;
            }
        }
        return deleted;
    }

    async createImageShareRecord(record: ImageShareRecord): Promise<void> {
        validateImageShareAccessCodeMetadata(record);
        if (this.sharesByToken.has(record.token)) {
            throw new Error('UNIQUE constraint failed: image_shares.token');
        }
        const filenameOwner = [...this.sharesByToken.values()].find(
            (existing) => existing.contentFilename === record.contentFilename
        );
        if (filenameOwner) {
            throw new Error('UNIQUE constraint failed: image_shares.content_filename');
        }
        this.sharesByToken.set(record.token, withoutUndefined(record));
    }

    async readImageShareRecord(token: string): Promise<ImageShareRecord | undefined> {
        return this.sharesByToken.get(token);
    }

    async deleteExpiredImageShareRecords(nowIso: string): Promise<ImageShareRecord[]> {
        const expired = [...this.sharesByToken.values()].filter(
            (record) => record.expiresAt !== undefined && record.expiresAt < nowIso
        );
        for (const record of expired) {
            this.sharesByToken.delete(record.token);
        }
        return expired;
    }

    async listImageShareRecords(): Promise<ImageShareRecord[]> {
        return [...this.sharesByToken.values()];
    }

    private insertArtifacts(artifacts: AgentArtifactRecord[]): void {
        for (const artifact of artifacts) {
            if (!this.hasRequestId(artifact.requestId)) {
                throw new Error('FOREIGN KEY constraint failed: agent_artifacts.request_id');
            }
            const existing = this.artifactsById.get(artifact.id);
            if (existing && !sameArtifactRecord(existing, artifact)) {
                throw new Error('artifact metadata conflict');
            }
            const filenameOwner = [...this.artifactsById.values()].find(
                (existing) => existing.filename === artifact.filename && existing.id !== artifact.id
            );
            if (filenameOwner) {
                throw new Error(`UNIQUE constraint failed: agent_artifacts.filename`);
            }
        }
        for (const artifact of artifacts) {
            this.artifactsById.set(artifact.id, artifact);
        }
    }

    private listArtifactsForRequestSync(requestId: string): AgentArtifactRecord[] {
        return [...this.artifactsById.values()]
            .filter((artifact) => artifact.requestId === requestId)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }

    private replaceRequest(idempotencyKey: string, record: AgentRequestRecord): void {
        this.requestsByIdempotencyKey.set(idempotencyKey, withoutUndefined(record));
    }

    private hasRequestId(requestId: string): boolean {
        return [...this.requestsByIdempotencyKey.values()].some((record) => record.requestId === requestId);
    }

    private updateRequestById(
        requestId: string,
        update: (record: AgentRequestRecord) => AgentRequestRecord
    ): void {
        const record = [...this.requestsByIdempotencyKey.values()].find((item) => item.requestId === requestId);
        if (!record) return;
        this.replaceRequest(record.idempotencyKey, update(record));
    }
}

function withoutUndefined<T extends object>(record: T): T {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function sameArtifactRecord(left: AgentArtifactRecord, right: AgentArtifactRecord): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function feedbackKey(targetType: FeedbackTargetType, targetId: string): string {
    return `${targetType}:${targetId}`;
}

function validateImageShareAccessCodeMetadata(record: ImageShareRecord): void {
    const hasAccessCodeSalt = record.accessCodeSalt !== undefined;
    const hasAccessCodeHash = record.accessCodeHash !== undefined;
    const isValid = record.accessCodeRequired
        ? hasAccessCodeSalt && hasAccessCodeHash
        : !hasAccessCodeSalt && !hasAccessCodeHash;
    if (!isValid) {
        throw new Error('CHECK constraint failed: image_shares.access_code_metadata');
    }
}
