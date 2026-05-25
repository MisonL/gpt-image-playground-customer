import { NextResponse } from 'next/server';

export async function GET() {
    const appPasswordSet = Boolean(process.env.APP_PASSWORD?.trim());
    return NextResponse.json({ passwordRequired: appPasswordSet });
}
