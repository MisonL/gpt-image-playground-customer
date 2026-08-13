export const AGENT_ENDPOINTS = Object.freeze({
    capabilities: '/api/agent/capabilities',
    openapi: '/api/agent/openapi.json',
    create_image_request: '/api/agent/image-requests',
    generate: '/api/agent/images/generate',
    edit: '/api/agent/images/edit',
    create_generate_job: '/api/agent/jobs/images/generate',
    job: '/api/agent/jobs/{id}',
    job_result: '/api/agent/jobs/{id}/result',
    artifact_metadata: '/api/agent/artifacts/{id}',
    artifact_content: '/api/agent/artifacts/{id}/content',
    artifact_share: '/api/agent/artifacts/{id}/share',
    artifact_delete: '/api/agent/artifacts/{id}',
    page_request_feedback_batch: '/api/agent/page-requests/feedback',
    page_request_feedback: '/api/agent/page-requests/{id}/feedback',
    channel_health_diagnostics: '/api/agent/diagnostics/channel-health',
    agent_request_diagnostics_lookup: '/api/agent/diagnostics/requests',
    agent_request_diagnostics: '/api/agent/diagnostics/requests/{id}',
    page_request_diagnostics_batch: '/api/agent/diagnostics/page-requests',
    page_request_diagnostics: '/api/agent/diagnostics/page-requests/{id}'
});

export const AGENT_JOB_ENDPOINTS = Object.freeze({
    create_generate_job: AGENT_ENDPOINTS.create_generate_job,
    get_job: AGENT_ENDPOINTS.job,
    get_job_result: AGENT_ENDPOINTS.job_result
});

export function buildAgentJobPath(jobId) {
    return AGENT_ENDPOINTS.job.replace('{id}', encodePathValue(jobId));
}

export function buildAgentJobResultPath(jobId) {
    return AGENT_ENDPOINTS.job_result.replace('{id}', encodePathValue(jobId));
}

export function buildAgentPageRequestFeedbackPath(pageRequestId) {
    return AGENT_ENDPOINTS.page_request_feedback.replace('{id}', encodePathValue(pageRequestId));
}

export function buildAgentPageRequestDiagnosticsPath(pageRequestId) {
    return AGENT_ENDPOINTS.page_request_diagnostics.replace('{id}', encodePathValue(pageRequestId));
}

export function buildAgentRequestDiagnosticsPath(requestId) {
    return AGENT_ENDPOINTS.agent_request_diagnostics.replace('{id}', encodePathValue(requestId));
}

export function buildAgentArtifactSharePath(artifactId) {
    return AGENT_ENDPOINTS.artifact_share.replace('{id}', encodePathValue(artifactId));
}

function encodePathValue(value) {
    return encodeURIComponent(String(value));
}
