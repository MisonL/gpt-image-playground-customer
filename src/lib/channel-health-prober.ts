import {
    isCredentialFailure,
    type ChannelCredential,
    type ChannelFailureReason,
    type ChannelRecoveryProbeCandidate,
    type ChannelRouter
} from './channel-router';
import { mergeUpstreamHeadersWithFixed } from './image-upstream-profile';
import { fetchOpenAIUpstream } from './openai-image-transport';

type ProbeFetch = (input: URL, init: RequestInit) => Promise<Response>;
type ProbeResult = {
    ok: boolean;
    status?: number;
    code?: string;
};

export type ChannelHealthProberSummary = {
    enabled: boolean;
    intervalMs: number;
    timeoutMs: number;
    maxPerTick: number;
    running: boolean;
    pendingProbeCount: number;
    dueCandidateCount: number;
    estimatedMinimumDrainTickCount: number;
    estimatedMinimumDrainMs: number;
    lastTickAt?: number;
    lastCheckedCount: number;
    lastRecoveredCount: number;
    lastFailedCount: number;
    lastProbe?: ChannelHealthProbeRecord;
};

export type ChannelHealthProbeRecord = {
    at: number;
    scope: 'credential' | 'channel';
    channelId: string;
    credentialId: string;
    requestMode?: ChannelRecoveryProbeCandidate['requestMode'];
    ok: boolean;
    status?: number;
    code?: string;
};

export type ChannelHealthProber = {
    runDueTick(): Promise<{ checked: number; recovered: number; failed: number }>;
    summary(): ChannelHealthProberSummary;
};

type ChannelHealthProberOptions = {
    router: ChannelRouter;
    enabled: boolean;
    intervalMs: number;
    timeoutMs: number;
    maxPerTick: number;
    now?: () => number;
    probe?: (candidate: ChannelRecoveryProbeCandidate, timeoutMs: number) => Promise<ProbeResult>;
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const INVALID_MODELS_RESPONSE_CODE = 'invalid_models_response';
const PROBE_TRANSPORT_ERROR_CODE = 'probe_transport_error';

export async function probeChannelModelsEndpoint(input: {
    credential: ChannelCredential;
    timeoutMs: number;
    fetchImpl?: ProbeFetch;
}): Promise<ProbeResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), input.timeoutMs);
    try {
        const requestInit = {
            method: 'GET',
            headers: mergeUpstreamHeadersWithFixed(input.credential.upstreamHeaders, {
                Authorization: `Bearer ${input.credential.apiKey}`,
                Accept: 'application/json'
            }),
            signal: abortController.signal
        } satisfies RequestInit;
        const targetUrl = buildModelsUrl(input.credential.baseUrl);
        const response = input.fetchImpl
            ? await input.fetchImpl(targetUrl, requestInit)
            : await fetchOpenAIUpstream(targetUrl, requestInit, input.credential.upstreamProxyUrl);
        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                ...readProbeErrorCode(await readJsonSafely(response))
            };
        }
        const body = await readJsonSafely(response);
        if (!hasModelsDataArray(body)) {
            return { ok: false, status: response.status, code: INVALID_MODELS_RESPONSE_CODE };
        }
        return { ok: true, status: response.status };
    } catch {
        return { ok: false, code: PROBE_TRANSPORT_ERROR_CODE };
    } finally {
        clearTimeout(timeout);
    }
}

export function createChannelHealthProber(options: ChannelHealthProberOptions): ChannelHealthProber {
    const now = options.now || Date.now;
    let running = false;
    let lastRunAt = 0;
    let lastTickAt: number | undefined;
    let lastCheckedCount = 0;
    let lastRecoveredCount = 0;
    let lastFailedCount = 0;
    let lastProbe: ChannelHealthProbeRecord | undefined;

    const probe =
        options.probe ||
        ((candidate: ChannelRecoveryProbeCandidate, timeoutMs: number) =>
            probeChannelModelsEndpoint({ credential: candidate.credential, timeoutMs }));

    return {
        async runDueTick() {
            const currentTime = now();
            if (!options.enabled || running || currentTime - lastRunAt < options.intervalMs) {
                return { checked: 0, recovered: 0, failed: 0 };
            }

            running = true;
            lastRunAt = currentTime;
            lastTickAt = currentTime;
            lastCheckedCount = 0;
            lastRecoveredCount = 0;
            lastFailedCount = 0;

            try {
                const maxPerTick = Math.max(1, Math.floor(options.maxPerTick));
                const checkedCandidateKeys = new Set<string>();
                while (lastCheckedCount < maxPerTick) {
                    const candidate = options.router
                        .getRecoveryProbeCandidates()
                        .find((value) => !checkedCandidateKeys.has(toCandidateKey(value)));
                    if (!candidate) break;
                    checkedCandidateKeys.add(toCandidateKey(candidate));
                    const result = await probe(candidate, options.timeoutMs);
                    lastCheckedCount += 1;
                    lastProbe = toProbeRecord(candidate, result, currentTime);
                    if (result.ok) {
                        if (options.router.reportRecoveryProbeSuccess(candidate)) {
                            lastRecoveredCount += 1;
                        }
                    } else {
                        const failureCandidate = toFailureCandidate(candidate, result);
                        options.router.reportRecoveryProbeFailure(
                            failureCandidate,
                            toFailureReason(failureCandidate, result, currentTime)
                        );
                        lastFailedCount += 1;
                    }
                }
                return {
                    checked: lastCheckedCount,
                    recovered: lastRecoveredCount,
                    failed: lastFailedCount
                };
            } finally {
                running = false;
            }
        },
        summary() {
            const maxPerTick = Math.max(1, Math.floor(options.maxPerTick));
            const healthSummary = options.router.getHealthSummary();
            const pendingProbeCount =
                healthSummary.pendingRecoveryProbeCredentialCount + healthSummary.pendingRecoveryProbeChannelCount;
            const dueCandidateCount = options.router.getRecoveryProbeCandidates().length;
            const estimatedMinimumDrainTickCount = Math.ceil(pendingProbeCount / maxPerTick);
            return {
                enabled: options.enabled,
                intervalMs: options.intervalMs,
                timeoutMs: options.timeoutMs,
                maxPerTick: options.maxPerTick,
                running,
                pendingProbeCount,
                dueCandidateCount,
                estimatedMinimumDrainTickCount,
                estimatedMinimumDrainMs: estimatedMinimumDrainTickCount * options.intervalMs,
                ...(lastTickAt === undefined ? {} : { lastTickAt }),
                lastCheckedCount,
                lastRecoveredCount,
                lastFailedCount,
                ...(lastProbe ? { lastProbe } : {})
            };
        }
    };
}

function toCandidateKey(candidate: ChannelRecoveryProbeCandidate): string {
    return `${candidate.scope}:${candidate.credential.id}:${candidate.requestMode ?? ''}:${candidate.unhealthyUntil}`;
}

function toFailureCandidate(
    candidate: ChannelRecoveryProbeCandidate,
    result: ProbeResult
): ChannelRecoveryProbeCandidate {
    if (candidate.scope === 'channel' && isCredentialFailure(result)) {
        return { ...candidate, scope: 'credential' };
    }
    return candidate;
}

function buildModelsUrl(baseUrl: string | undefined): URL {
    const normalizedBase = (baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
    return new URL(`${normalizedBase}/models`);
}

async function readJsonSafely(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return undefined;
    }
}

function hasModelsDataArray(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false;
    return Array.isArray((body as Record<string, unknown>).data);
}

function readProbeErrorCode(body: unknown): { code?: string } {
    if (!body || typeof body !== 'object') return {};
    const error = (body as Record<string, unknown>).error;
    if (error && typeof error === 'object') {
        const code = (error as Record<string, unknown>).code;
        return typeof code === 'string' && code.trim() ? { code: code.trim() } : {};
    }
    const code = (body as Record<string, unknown>).code;
    return typeof code === 'string' && code.trim() ? { code: code.trim() } : {};
}

function toProbeRecord(
    candidate: ChannelRecoveryProbeCandidate,
    result: ProbeResult,
    at: number
): ChannelHealthProbeRecord {
    return {
        at,
        scope: candidate.scope,
        channelId: candidate.credential.channelId,
        credentialId: candidate.credential.id,
        ...(candidate.requestMode ? { requestMode: candidate.requestMode } : {}),
        ok: result.ok,
        ...(result.status === undefined ? {} : { status: result.status }),
        ...(result.code === undefined ? {} : { code: result.code })
    };
}

function toFailureReason(
    candidate: ChannelRecoveryProbeCandidate,
    result: ProbeResult,
    at: number
): ChannelFailureReason {
    return {
        at,
        scope: candidate.scope,
        ...(candidate.requestMode ? { requestMode: candidate.requestMode } : {}),
        ...(result.status === undefined ? {} : { status: result.status }),
        ...(result.code === undefined ? {} : { code: result.code })
    };
}
