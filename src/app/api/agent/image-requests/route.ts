import { createAgentGenerateJobResponse } from '@/lib/agent-generate-job-route';
import { AGENT_ENDPOINTS } from '@/lib/agent-api-paths.mjs';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return createAgentGenerateJobResponse(request, {
        transportEndpoint: AGENT_ENDPOINTS.create_image_request
    });
}
