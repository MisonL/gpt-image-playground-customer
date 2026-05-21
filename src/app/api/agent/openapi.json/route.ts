import { buildAgentOpenApiDocument } from '@/lib/agent-openapi';
import { NextResponse } from 'next/server';

export async function GET() {
    // 保持未鉴权，便于 Agent 在发送凭据前获取机器可读契约。
    return NextResponse.json(buildAgentOpenApiDocument(process.env));
}
