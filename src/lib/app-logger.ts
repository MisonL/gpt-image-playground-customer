const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const MAX_LOG_ENTRIES = 300;

type LogLevel = (typeof LOG_LEVELS)[number];
type LogContext = string | number | boolean | null | Record<string, unknown> | unknown[];

export type AppLogEntry = {
    id: number;
    at: string;
    level: LogLevel;
    message: string;
    context?: string;
};

type CachedLogLevel = {
    configuredLevel: string | undefined;
    nodeEnv: string | undefined;
    level: LogLevel;
};

let cachedLogLevel: CachedLogLevel | undefined;
let nextLogId = 1;
const logEntries: AppLogEntry[] = [];
const logSubscribers = new Set<(entry: AppLogEntry) => void>();

function defaultLogLevel(nodeEnv: string | undefined): LogLevel {
    return nodeEnv === 'production' ? 'warn' : 'info';
}

function resolveLogLevel(configuredLevel: string | undefined, nodeEnv: string | undefined): LogLevel {
    if (!configuredLevel) {
        return defaultLogLevel(nodeEnv);
    }
    const normalizedLevel = configuredLevel.trim().toLowerCase();
    return LOG_LEVELS.includes(normalizedLevel as LogLevel) ? (normalizedLevel as LogLevel) : defaultLogLevel(nodeEnv);
}

function readLogLevel(): LogLevel {
    const configuredLevel = process.env.APP_LOG_LEVEL;
    const nodeEnv = process.env.NODE_ENV;
    if (cachedLogLevel && cachedLogLevel.configuredLevel === configuredLevel && cachedLogLevel.nodeEnv === nodeEnv) {
        return cachedLogLevel.level;
    }
    const level = resolveLogLevel(configuredLevel, nodeEnv);
    cachedLogLevel = { configuredLevel, nodeEnv, level };
    return level;
}

function canLog(level: LogLevel): boolean {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(readLogLevel());
}

function serializeContext(context: unknown): string | undefined {
    if (context === undefined) return undefined;
    if (context instanceof Error) {
        return context.stack || context.message;
    }
    if (typeof context === 'string') return context;
    try {
        return JSON.stringify(context, null, 2);
    } catch {
        return String(context);
    }
}

function appendLogEntry(level: LogLevel, message: string, context?: unknown) {
    const entry: AppLogEntry = {
        id: nextLogId++,
        at: new Date().toISOString(),
        level,
        message,
        ...(context === undefined ? {} : { context: serializeContext(context) })
    };
    logEntries.push(entry);
    if (logEntries.length > MAX_LOG_ENTRIES) {
        logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
    }
    logSubscribers.forEach((subscriber) => {
        try {
            subscriber(entry);
        } catch (error) {
            console.error('Log subscriber processing failed.', error);
        }
    });
}

function writeLog(
    level: LogLevel,
    writer: (message?: unknown, ...optionalParams: unknown[]) => void,
    message: string,
    context?: LogContext | unknown
) {
    if (!canLog(level)) {
        return;
    }
    appendLogEntry(level, message, context);
    if (context === undefined) {
        writer(message);
        return;
    }
    writer(message, context);
}

export const appLogger = {
    debug(message: string, context?: unknown) {
        writeLog('debug', console.debug, message, context);
    },
    info(message: string, context?: unknown) {
        writeLog('info', console.info, message, context);
    },
    warn(message: string, context?: unknown) {
        writeLog('warn', console.warn, message, context);
    },
    error(message: string, context?: unknown) {
        writeLog('error', console.error, message, context);
    }
};

export function readAppLogEntries(): AppLogEntry[] {
    return [...logEntries];
}

export function subscribeAppLogs(subscriber: (entry: AppLogEntry) => void): () => void {
    logSubscribers.add(subscriber);
    return () => {
        logSubscribers.delete(subscriber);
    };
}

export function clearAppLogEntriesForTest() {
    logEntries.length = 0;
    logSubscribers.clear();
    nextLogId = 1;
}
