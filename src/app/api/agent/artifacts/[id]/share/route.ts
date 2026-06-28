import { assertAgentAuthorized } from '@/lib/agent-auth';
import { readAgentPublicBaseUrl } from '@/lib/agent-api-contracts';
import { AgentApiError, agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import { assertArtifactFilepathAllowed } from '@/lib/agent-file-utils';
import { ensureAgentStateStoreReady } from '@/lib/agent-state-runtime';
import { createRequestId } from '@/lib/agent-state-store';
import { createImageShare } from '@/lib/share-store';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_EXPIRES_MINUTES = 7 * 24 * 60;
const MAX_EXPIRES_MINUTES = 30 * 24 * 60;
const MIN_ACCESS_CODE_LENGTH = 8;
const MAX_ACCESS_CODE_LENGTH = 128;

type ShareRequestBody = {
    expires_in_minutes?: unknown;
    access_code?: unknown;
};

function resolveShareUrl(token: string): string {
    return resolvePublicUrl(`/share/${token}`);
}

function resolveShareContentUrl(token: string): string {
    return resolvePublicUrl(`/api/shares/${token}/content`);
}

function resolvePublicUrl(pathname: string): string {
    const publicBaseUrl = readAgentPublicBaseUrl(process.env);
    if (publicBaseUrl !== '/') {
        const url = new URL(publicBaseUrl);
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`;
    }
    return pathname;
}

function parseExpiresInMinutes(value: unknown): number | null {
    if (value === undefined) return readConfiguredDefaultExpiry();
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new AgentApiError({
            code: 'validation_error',
            message: 'expires_in_minutes 必须是整数或 null。',
            status: 400,
            retryable: false
        });
    }
    const maxExpiry = readConfiguredMaxExpiry();
    if (value < 1 || value > maxExpiry) {
        throw new AgentApiError({
            code: 'validation_error',
            message: `expires_in_minutes 必须是 1 到 ${maxExpiry} 之间的整数，` + '或者 null。',
            status: 400,
            retryable: false
        });
    }
    return value;
}

function readConfiguredDefaultExpiry(): number | null {
    const rawValue = process.env.AGENT_ARTIFACT_SHARE_DEFAULT_EXPIRES_MINUTES?.trim();
    if (!rawValue) return Math.min(DEFAULT_EXPIRES_MINUTES, readConfiguredMaxExpiry());
    if (rawValue.toLowerCase() === 'none') return null;
    return parseConfiguredPositiveInteger(rawValue, 'AGENT_ARTIFACT_SHARE_DEFAULT_EXPIRES_MINUTES', readConfiguredMaxExpiry());
}

function readConfiguredMaxExpiry(): number {
    const rawValue = process.env.AGENT_ARTIFACT_SHARE_MAX_EXPIRES_MINUTES?.trim();
    if (!rawValue) return MAX_EXPIRES_MINUTES;
    return parseConfiguredPositiveInteger(rawValue, 'AGENT_ARTIFACT_SHARE_MAX_EXPIRES_MINUTES', Number.MAX_SAFE_INTEGER);
}

function parseConfiguredPositiveInteger(value: string, name: string, max: number): number {
    if (!/^\d+$/.test(value)) {
        throw new AgentApiError({
            code: 'configuration_error',
            message: `${name} 必须是正整数。`,
            status: 500,
            retryable: false
        });
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
        throw new AgentApiError({
            code: 'configuration_error',
            message: `${name} 必须是 1 到 ${max} 之间的整数。`,
            status: 500,
            retryable: false
        });
    }
    return parsed;
}

function parseAccessCode(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
        throw new AgentApiError({
            code: 'validation_error',
            message: 'access_code 必须是字符串。',
            status: 400,
            retryable: false
        });
    }
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length < MIN_ACCESS_CODE_LENGTH || trimmed.length > MAX_ACCESS_CODE_LENGTH) {
        throw new AgentApiError({
            code: 'validation_error',
            message: 'access_code 长度必须在 8 到 128 个字符之间。',
            status: 400,
            retryable: false
        });
    }
    return trimmed;
}

async function readShareRequestBody(request: Request): Promise<ShareRequestBody> {
    const hasBody =
        request.body !== null || request.headers.has('content-length') || request.headers.has('transfer-encoding');
    if (!hasBody) return {};
    if (!request.headers.get('content-type')?.includes('application/json')) {
        throw new AgentApiError({
            code: 'validation_error',
            message: '分享请求必须使用 application/json。',
            status: 400,
            retryable: false
        });
    }
    const body = (await request.json().catch(() => {
        throw new AgentApiError({
            code: 'validation_error',
            message: '分享请求 JSON 无效。',
            status: 400,
            retryable: false
        });
    })) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new AgentApiError({
            code: 'validation_error',
            message: '分享请求必须是 JSON object。',
            status: 400,
            retryable: false
        });
    }
    return body as ShareRequestBody;
}

function isMissingArtifactFileError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const { id } = await params;
        const body = await readShareRequestBody(request);
        const store = await ensureAgentStateStoreReady();
        const artifact = await store.getArtifact(id);
        if (!artifact) {
            throw new AgentApiError({
                code: 'artifact_not_found',
                message: '产物不存在。',
                status: 404,
                retryable: false
            });
        }
        assertArtifactFilepathAllowed(artifact.filepath);
        let imageBuffer: Buffer;
        try {
            imageBuffer = await fs.readFile(artifact.filepath);
        } catch (error) {
            if (isMissingArtifactFileError(error)) {
                throw new AgentApiError({
                    code: 'artifact_not_found',
                    message: '产物内容不存在。',
                    status: 404,
                    retryable: false
                });
            }
            throw error;
        }
        const share = await createImageShare({
            imageBuffer,
            sourceFilename: artifact.filename,
            mimeType: artifact.mimeType,
            accessCode: parseAccessCode(body.access_code),
            expiresInMinutes: parseExpiresInMinutes(body.expires_in_minutes)
        });
        return NextResponse.json(
            {
                artifact_id: artifact.id,
                token: share.token,
                share_url: resolveShareUrl(share.token),
                direct_content_url: resolveShareContentUrl(share.token),
                expires_at: share.expiresAt ?? null,
                access_code_required: share.accessCodeRequired
            },
            { status: 201, headers: { 'X-Request-Id': requestId } }
        );
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}
