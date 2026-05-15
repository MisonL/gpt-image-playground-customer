import { appLogger, readAppLogEntries, subscribeAppLogs, type AppLogEntry } from '@/lib/app-logger';
import { verifyPasswordHash } from '@/lib/server-runtime';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) return false;

    const authorization = request.headers.get('authorization') || '';
    const [scheme, passwordHash] = authorization.split(/\s+/, 2);
    if (scheme.toLowerCase() !== 'bearer') return false;
    return typeof passwordHash === 'string' && verifyPasswordHash(passwordHash, appPassword);
}

function encodeSseEvent(encoder: TextEncoder, entry: AppLogEntry): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(entry)}\n\n`);
}

function encodeSseComment(encoder: TextEncoder, value: string): Uint8Array {
    return encoder.encode(`: ${value}\n\n`);
}

export async function GET(request: NextRequest) {
    if (!process.env.APP_PASSWORD) {
        return NextResponse.json({ error: '日志查看需要先配置 APP_PASSWORD。' }, { status: 403 });
    }

    if (!isAuthorized(request)) {
        return NextResponse.json({ error: '未授权：缺少或无效的密码哈希。' }, { status: 401 });
    }

    appLogger.info('日志查看器已连接。');

    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const readableStream = new ReadableStream({
        start(controller) {
            controller.enqueue(encodeSseComment(encoder, 'connected'));
            const sendEntry = (entry: AppLogEntry) => {
                try {
                    controller.enqueue(encodeSseEvent(encoder, entry));
                } catch (error) {
                    appLogger.warn('日志查看器发送实时日志失败。', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    unsubscribe();
                }
            };

            readAppLogEntries().forEach((entry) => {
                try {
                    controller.enqueue(encodeSseEvent(encoder, entry));
                } catch (error) {
                    appLogger.warn('日志查看器发送历史日志失败。', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    unsubscribe();
                }
            });
            unsubscribe = subscribeAppLogs(sendEntry);

            request.signal.addEventListener(
                'abort',
                () => {
                    unsubscribe();
                    try {
                        controller.close();
                    } catch {
                        // 连接可能已由客户端关闭。
                    }
                },
                { once: true }
            );
        },
        cancel() {
            unsubscribe();
        }
    });

    return new Response(readableStream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
        }
    });
}
