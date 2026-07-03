import {
    CHANNEL_REQUEST_MODES as SHARED_CHANNEL_REQUEST_MODES,
    CHANNEL_REQUEST_MODE_ADMIN_CONTROL as SHARED_CHANNEL_REQUEST_MODE_ADMIN_CONTROL
} from './channel-request-mode-values.mjs';
import { RequestValidationError } from './image-request-utils';

export const CHANNEL_REQUEST_MODES = SHARED_CHANNEL_REQUEST_MODES as readonly [
    'images-non-stream',
    'images-sse',
    'responses-non-stream',
    'responses-sse'
];

export type ChannelRequestMode = (typeof CHANNEL_REQUEST_MODES)[number];

export type ChannelRequestModeBackend = 'images-api' | 'responses-image-generation';

export type ChannelRequestModeDecision = {
    requested_backend: ChannelRequestModeBackend;
    preferred_channel_request_mode?: ChannelRequestMode;
    fallback_channel_request_mode?: ChannelRequestMode;
    selected_channel_request_mode?: ChannelRequestMode;
    fallback_applied: boolean;
    selected_channel_id?: string;
    upstream_host?: string;
    no_channel_reason?: string;
};

export type ChannelRequestModeHealthSummary = {
    configuredRequestModes: readonly ChannelRequestMode[];
    effectiveRequestModes: readonly ChannelRequestMode[];
    modes: Array<{
        mode: ChannelRequestMode;
        configuredCredentialCount: number;
        healthyCredentialCount: number;
        configuredChannelCount: number;
        healthyChannelCount: number;
    }>;
    effectiveRequestModesByChannel: Array<{
        channelId: string;
        requestModes: readonly ChannelRequestMode[];
    }>;
};

export const DEFAULT_CHANNEL_REQUEST_MODES: readonly ChannelRequestMode[] = ['images-non-stream'];
export const CHANNEL_REQUEST_MODE_ADMIN_CONTROL = SHARED_CHANNEL_REQUEST_MODE_ADMIN_CONTROL as {
    readonly source: 'admin_env_whitelist';
    readonly globalEnv: 'OPENAI_UPSTREAM_REQUEST_MODES';
    readonly channelEnvPattern: 'OPENAI_CHANNEL_N_REQUEST_MODES';
    readonly mutableAtRuntime: false;
    readonly finalGateCommand: string;
    readonly smokeGateCommands: Record<ChannelRequestMode, readonly string[]>;
};

const CHANNEL_REQUEST_MODE_SET = new Set<string>(CHANNEL_REQUEST_MODES);
const CHANNEL_REQUEST_MODE_ALIASES: Record<string, ChannelRequestMode> = {
    'images-api': 'images-non-stream',
    'images-api-non-stream': 'images-non-stream',
    'images-api-json': 'images-non-stream',
    'images-json': 'images-non-stream',
    'images-nonstream': 'images-non-stream',
    'images-api-sse': 'images-sse',
    'images-stream': 'images-sse',
    'images-api-stream': 'images-sse',
    responses: 'responses-non-stream',
    'responses-json': 'responses-non-stream',
    'responses-nonstream': 'responses-non-stream',
    'responses-image-generation': 'responses-non-stream',
    'responses-image-generation-non-stream': 'responses-non-stream',
    'responses-image-generation-sse': 'responses-sse',
    'responses-stream': 'responses-sse'
};

export function parseChannelRequestModes(
    value: string | undefined,
    fieldName: string
): ChannelRequestMode[] | undefined {
    if (!value?.trim()) return undefined;
    const modes: ChannelRequestMode[] = [];
    for (const rawPart of value.split(/[,\s]+/)) {
        const normalized = normalizeChannelRequestMode(rawPart);
        if (!normalized) continue;
        if (!modes.includes(normalized)) {
            modes.push(normalized);
        }
    }
    if (modes.length === 0) {
        throw new RequestValidationError(`${fieldName} 至少需要包含一个请求方式。`, 500);
    }
    return modes;
}

export function getEffectiveChannelRequestModes(input: {
    requestModes?: readonly ChannelRequestMode[];
}): readonly ChannelRequestMode[] {
    return input.requestModes?.length ? input.requestModes : DEFAULT_CHANNEL_REQUEST_MODES;
}

export function channelSupportsRequestMode(
    input: { requestModes?: readonly ChannelRequestMode[] },
    mode: ChannelRequestMode
): boolean {
    return getEffectiveChannelRequestModes(input).includes(mode);
}

export function resolveChannelRequestMode(input: {
    imageBackend: ChannelRequestModeBackend;
    streamEnabled: boolean;
}): ChannelRequestMode {
    if (input.imageBackend === 'responses-image-generation') {
        return input.streamEnabled ? 'responses-sse' : 'responses-non-stream';
    }
    return input.streamEnabled ? 'images-sse' : 'images-non-stream';
}

export function isStreamingChannelRequestMode(mode: ChannelRequestMode): boolean {
    return mode.endsWith('-sse');
}

function normalizeChannelRequestMode(value: string): ChannelRequestMode | undefined {
    const normalized = value.trim().toLowerCase().replace(/_/g, '-');
    if (!normalized) return undefined;
    if (CHANNEL_REQUEST_MODE_SET.has(normalized)) return normalized as ChannelRequestMode;
    const aliased = CHANNEL_REQUEST_MODE_ALIASES[normalized];
    if (aliased) return aliased;
    throw new RequestValidationError(`请求方式 ${value} 无效，必须是 ${CHANNEL_REQUEST_MODES.join(', ')} 之一。`, 500);
}
