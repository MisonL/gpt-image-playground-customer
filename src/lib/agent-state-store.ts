import crypto from 'crypto';
import type { AgentImageResponse, AgentImageResponseItem } from './agent-api-contracts';
import type { AgentErrorBody } from './api-error-response';

export type AgentRequestStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'orphaned';

export type AgentRequestRecord = {
    requestId: string;
    idempotencyKey: string;
    requestHash: string;
    mode: 'generate' | 'edit';
    status: AgentRequestStatus;
    requestJson: unknown;
    responseJson?: AgentImageResponse;
    errorJson?: AgentErrorBody;
    lockedUntil?: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
};

export type AgentArtifactRecord = {
    id: string;
    requestId: string;
    filename: string;
    filepath: string;
    contentUrl: string;
    metadataUrl: string;
    outputFormat: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    model: string;
    promptHash: string;
    createdAt: string;
};

export type BeginAgentRequestResult =
    | { type: 'acquired'; record: AgentRequestRecord }
    | { type: 'replay'; record: AgentRequestRecord; response: AgentImageResponse }
    | { type: 'failed'; record: AgentRequestRecord; error: AgentErrorBody }
    | { type: 'conflict'; record: AgentRequestRecord }
    | { type: 'in_progress'; record: AgentRequestRecord; retryAfterSeconds: number };

export type BeginAgentRequestInput = {
    idempotencyKey: string;
    requestHash: string;
    mode: 'generate' | 'edit';
    requestJson: unknown;
    leaseMs: number;
    ttlSeconds: number;
    now?: Date;
};

export type CompleteAgentRequestInput = {
    requestId: string;
    response: AgentImageResponse;
    artifacts: AgentArtifactRecord[];
    now?: Date;
};

export type FailAgentRequestInput = {
    requestId: string;
    error: AgentErrorBody;
    now?: Date;
};

export type RefreshAgentRequestLeaseInput = {
    requestId: string;
    leaseMs: number;
    now?: Date;
};

export type AgentStateStore = {
    init(): Promise<void>;
    recoverExpiredRequests(now?: Date): Promise<number>;
    purgeExpiredRequests(now?: Date): Promise<number>;
    beginRequest(input: BeginAgentRequestInput): Promise<BeginAgentRequestResult>;
    refreshRequestLease(input: RefreshAgentRequestLeaseInput): Promise<boolean>;
    saveArtifacts(artifacts: AgentArtifactRecord[]): Promise<void>;
    completeRequest(input: CompleteAgentRequestInput): Promise<void>;
    failRequest(input: FailAgentRequestInput): Promise<void>;
    getRequest(requestId: string): Promise<AgentRequestRecord | undefined>;
    getArtifact(id: string): Promise<AgentArtifactRecord | undefined>;
    listArtifactsForRequest(requestId: string): Promise<AgentArtifactRecord[]>;
    deleteArtifact(id: string): Promise<boolean>;
};

export function createRequestId(): string {
    return crypto.randomUUID();
}

export function createArtifactId(): string {
    return crypto.randomUUID();
}

export function hashAgentPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(stableJsonStringify(payload)).digest('hex');
}

export function hashText(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function isoDate(value: Date): string {
    return value.toISOString();
}

export function addMilliseconds(value: Date, milliseconds: number): Date {
    return new Date(value.getTime() + milliseconds);
}

export function addSeconds(value: Date, seconds: number): Date {
    return new Date(value.getTime() + seconds * 1000);
}

export function computeRetryAfterSeconds(lockedUntil: string | undefined, now: Date): number {
    if (!lockedUntil) return 5;
    const diffMs = new Date(lockedUntil).getTime() - now.getTime();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return 1;
    return Math.max(1, Math.ceil(diffMs / 1000));
}

export function serializeJson(value: unknown): string {
    return JSON.stringify(value);
}

export function parseJson<T>(value: string | null | undefined): T | undefined {
    if (!value) return undefined;
    return JSON.parse(value) as T;
}

function stableJsonStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableJsonStringify).join(',')}]`;
    }
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(objectValue[key])}`)
        .join(',')}}`;
}

export function artifactRecordToResponseItem(record: AgentArtifactRecord, includeBase64?: string): AgentImageResponseItem {
    return {
        id: record.id,
        filename: record.filename,
        content_url: record.contentUrl,
        metadata_url: record.metadataUrl,
        output_format: record.outputFormat,
        mime_type: record.mimeType,
        size_bytes: record.sizeBytes,
        width: record.width,
        height: record.height,
        ...(includeBase64 ? { b64_json: includeBase64 } : {})
    };
}

export function buildRecoveredResponse(record: AgentRequestRecord, artifacts: AgentArtifactRecord[]): AgentImageResponse {
    const sortedArtifacts = [...artifacts].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return {
        request_id: record.requestId,
        idempotency_key: record.idempotencyKey,
        cached: false,
        images: sortedArtifacts.map((artifact) => artifactRecordToResponseItem(artifact)),
        created_at: sortedArtifacts[0]?.createdAt ?? record.updatedAt
    };
}
