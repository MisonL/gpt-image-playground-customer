import { buildAgentCapabilities } from '@/lib/agent-api-contracts';
import { NextResponse } from 'next/server';

export async function GET() {
    // 保持未鉴权，便于 Agent 在发起工具调用前发现契约和鉴权要求。
    return NextResponse.json(buildAgentCapabilities(process.env));
}
