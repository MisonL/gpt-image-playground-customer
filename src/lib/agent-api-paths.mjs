export const AGENT_ENDPOINTS = Object.freeze({
    capabilities: '/api/agent/capabilities',
    openapi: '/api/agent/openapi.json',
    generate: '/api/agent/images/generate',
    edit: '/api/agent/images/edit',
    create_generate_job: '/api/agent/jobs/images/generate',
    job: '/api/agent/jobs/{id}',
    job_result: '/api/agent/jobs/{id}/result',
    artifact_metadata: '/api/agent/artifacts/{id}',
    artifact_content: '/api/agent/artifacts/{id}/content',
    artifact_delete: '/api/agent/artifacts/{id}'
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

function encodePathValue(value) {
    return encodeURIComponent(String(value));
}
