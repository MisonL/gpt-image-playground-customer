import { assertAgentAuthorized } from '@/lib/agent-auth';
import { createRequestId } from '@/lib/agent-state-store';
import { agentErrorResponse, normalizeAgentError } from '@/lib/api-error-response';
import type { ChannelHealthSnapshot, PublicChannelFailureReason } from '@/lib/channel-router';
import { getExistingServerChannelState } from '@/lib/server-channel-router';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const requestId = createRequestId();
    try {
        assertAgentAuthorized(request.headers);
        const serverChannelState = getExistingServerChannelState();
        const router = serverChannelState?.router;
        const snapshot = router?.getHealthSnapshot() ?? { at: Date.now(), channels: [] };
        return NextResponse.json(
            {
                ok: true,
                billable: false,
                source: 'in_process_channel_router',
                state_scope: 'process_local',
                state_initialized: Boolean(serverChannelState),
                snapshot: toPublicChannelHealthSnapshot(snapshot)
            },
            { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } }
        );
    } catch (error) {
        return agentErrorResponse(normalizeAgentError(error), requestId);
    }
}

function toPublicChannelHealthSnapshot(snapshot: ChannelHealthSnapshot) {
    return {
        observed_at: snapshot.at,
        channels: snapshot.channels.map((channel) => ({
            channel_id: channel.channelId,
            credential_count: channel.credentialCount,
            healthy_credential_count: channel.healthyCredentialCount,
            unhealthy_credential_count: channel.unhealthyCredentialCount,
            state: channel.state,
            probe_required: channel.probeRequired,
            credentials: channel.credentials.map((credential) => ({
                credential_id: credential.credentialId,
                state: credential.state,
                ...(credential.cooldownUntil === undefined ? {} : { cooldown_until: credential.cooldownUntil }),
                probe_required: credential.probeRequired,
                ...(credential.lastFailure ? { last_failure: toPublicFailure(credential.lastFailure) } : {}),
                request_modes: credential.requestModes.map((requestMode) => ({
                    mode: requestMode.mode,
                    state: requestMode.state,
                    ...(requestMode.cooldownUntil === undefined ? {} : { cooldown_until: requestMode.cooldownUntil }),
                    probe_required: requestMode.probeRequired
                }))
            }))
        }))
    };
}

function toPublicFailure(failure: PublicChannelFailureReason) {
    return {
        at: failure.at,
        scope: failure.scope,
        ...(failure.status === undefined ? {} : { status: failure.status }),
        ...(failure.code === undefined ? {} : { code: failure.code }),
        ...(failure.requestId === undefined ? {} : { request_id: failure.requestId }),
        ...(failure.requestMode === undefined ? {} : { request_mode: failure.requestMode })
    };
}
