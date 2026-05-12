import { buildAgentCapabilities } from '@/lib/agent-api-contracts';
import { NextResponse } from 'next/server';

export async function GET() {
    // Kept unauthenticated so agents can discover contract and auth requirements before making tool calls.
    return NextResponse.json(buildAgentCapabilities(process.env));
}
