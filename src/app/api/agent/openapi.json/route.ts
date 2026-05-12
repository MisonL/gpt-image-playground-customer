import { buildAgentOpenApiDocument } from '@/lib/agent-api-contracts';
import { NextResponse } from 'next/server';

export async function GET() {
    // Kept unauthenticated so agents can fetch the machine-readable contract before sending credentials.
    return NextResponse.json(buildAgentOpenApiDocument(process.env));
}
