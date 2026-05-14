import { buildAgentCapabilities } from '@/lib/agent-api-contracts';
import { NextResponse } from 'next/server';

export async function GET() {
    // 保持未鉴权，便于 Agent 在发起工具调用前发现契约和鉴权要求。
    return NextResponse.json(buildAgentCapabilities(readPublicCapabilitiesEnv()));
}

function readPublicCapabilitiesEnv(): Record<string, string | undefined> {
    return {
        AGENT_STATE_BACKEND: process.env.AGENT_STATE_BACKEND,
        AGENT_SQLITE_PATH: process.env.AGENT_SQLITE_PATH,
        AGENT_DATABASE_URL: process.env.AGENT_DATABASE_URL ? 'configured' : undefined,
        AGENT_DB_PASSWORD: process.env.AGENT_DB_PASSWORD ? 'configured' : undefined,
        AGENT_DB_PASSWORD_FILE: process.env.AGENT_DB_PASSWORD_FILE ? 'configured' : undefined,
        AGENT_REQUEST_TTL_SECONDS: process.env.AGENT_REQUEST_TTL_SECONDS,
        AGENT_PUBLIC_BASE_URL: process.env.AGENT_PUBLIC_BASE_URL,
        NEXT_PUBLIC_IMAGE_STORAGE_MODE: process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE,
        VERCEL: process.env.VERCEL
    };
}
