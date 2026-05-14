import fs from 'node:fs';
import path from 'node:path';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const MAX_LOG_ENTRIES = 300;
const DEFAULT_LOG_FILE = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    'generated-images',
    '.app-logs',
    'app.log.jsonl'
);
const TEST_LOG_FILE = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    'generated-images',
    '.app-logs',
    'app-test.log.jsonl'
);

type LogLevel = (typeof LOG_LEVELS)[number];
type LogContext = string | number | boolean | null | Record<string, unknown> | unknown[];

export type AppLogEntry = {
    id: number;
    at: string;
    level: LogLevel;
    message: string;
    context?: string;
    clientRequestId?: string;
    filenames?: string[];
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
let hydratedLogFile: string | undefined;
let persistenceEnabledForTest = false;

function resolveLogFile(): string {
    return process.env.NODE_ENV === 'test' ? TEST_LOG_FILE : DEFAULT_LOG_FILE;
}

function shouldPersistEntries(): boolean {
    return process.env.NODE_ENV !== 'test' || persistenceEnabledForTest;
}

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

function readClientRequestId(context: unknown): string | undefined {
    if (!context || typeof context !== 'object' || Array.isArray(context) || context instanceof Error) {
        return undefined;
    }
    const value = (context as Record<string, unknown>).clientRequestId;
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function readFilenames(context: unknown): string[] | undefined {
    if (!context || typeof context !== 'object' || Array.isArray(context) || context instanceof Error) {
        return undefined;
    }
    const value = (context as Record<string, unknown>).filenames;
    if (!Array.isArray(value)) return undefined;
    const filenames = Array.from(
        new Set(value.filter((filename): filename is string => typeof filename === 'string' && filename.trim().length > 0))
    );
    return filenames.length > 0 ? filenames : undefined;
}

function parsePersistedEntry(line: string): AppLogEntry | undefined {
    try {
        const parsed = JSON.parse(line) as Partial<AppLogEntry>;
        if (
            typeof parsed.id !== 'number' ||
            typeof parsed.at !== 'string' ||
            !LOG_LEVELS.includes(parsed.level as LogLevel) ||
            typeof parsed.message !== 'string'
        ) {
            return undefined;
        }
        return {
            id: parsed.id,
            at: parsed.at,
            level: parsed.level as LogLevel,
            message: parsed.message,
            ...(typeof parsed.context === 'string' ? { context: parsed.context } : {}),
            ...(typeof parsed.clientRequestId === 'string' ? { clientRequestId: parsed.clientRequestId } : {}),
            ...(Array.isArray(parsed.filenames)
                ? { filenames: parsed.filenames.filter((filename): filename is string => typeof filename === 'string') }
                : {})
        };
    } catch {
        return undefined;
    }
}

function serializePersistedEntries(entries: AppLogEntry[]): string {
    return entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : '');
}

function compactEntries() {
    if (logEntries.length > MAX_LOG_ENTRIES) {
        logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
    }
}

function hydratePersistedEntries() {
    if (!shouldPersistEntries()) return;
    const logFile = resolveLogFile();
    if (hydratedLogFile === logFile) return;
    hydratedLogFile = logFile;

    let fileContent: string;
    try {
        fileContent = fs.readFileSync(logFile, 'utf8');
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return;
        }
        console.error('读取持久化日志失败。', error);
        return;
    }

    const persistedEntries = fileContent
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map(parsePersistedEntry)
        .filter((entry): entry is AppLogEntry => entry !== undefined)
        .slice(-MAX_LOG_ENTRIES);

    logEntries.length = 0;
    logEntries.push(...persistedEntries);
    nextLogId = Math.max(0, ...persistedEntries.map((entry) => entry.id)) + 1;
}

function persistEntries(rewrite: boolean) {
    if (!shouldPersistEntries()) return;
    const logFile = resolveLogFile();
    try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        if (rewrite) {
            fs.writeFileSync(logFile, serializePersistedEntries(logEntries), 'utf8');
            return;
        }
        fs.appendFileSync(logFile, JSON.stringify(logEntries[logEntries.length - 1]) + '\n', 'utf8');
    } catch (error) {
        console.error('写入持久化日志失败。', error);
    }
}

function appendLogEntry(level: LogLevel, message: string, context?: unknown) {
    hydratePersistedEntries();
    const clientRequestId = readClientRequestId(context);
    const filenames = readFilenames(context);
    const entry: AppLogEntry = {
        id: nextLogId++,
        at: new Date().toISOString(),
        level,
        message,
        ...(context === undefined ? {} : { context: serializeContext(context) }),
        ...(clientRequestId ? { clientRequestId } : {}),
        ...(filenames ? { filenames } : {})
    };
    logEntries.push(entry);
    const needsRewrite = logEntries.length > MAX_LOG_ENTRIES;
    compactEntries();
    persistEntries(needsRewrite);
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
    hydratePersistedEntries();
    return [...logEntries];
}

export function subscribeAppLogs(subscriber: (entry: AppLogEntry) => void): () => void {
    hydratePersistedEntries();
    logSubscribers.add(subscriber);
    return () => {
        logSubscribers.delete(subscriber);
    };
}

export function clearAppLogEntriesForTest(options: { preservePersistedFile?: boolean } = {}) {
    logEntries.length = 0;
    logSubscribers.clear();
    nextLogId = 1;
    const logFile = hydratedLogFile || resolveLogFile();
    hydratedLogFile = undefined;
    if (!options.preservePersistedFile) {
        try {
            fs.rmSync(logFile, { force: true });
        } catch {
            // 测试清理不影响生产路径。
        }
    }
}

export function setAppLogPersistenceForTest(enabled: boolean) {
    persistenceEnabledForTest = enabled;
    hydratedLogFile = undefined;
}

export async function readPersistedAppLogEntriesForTest(): Promise<AppLogEntry[]> {
    const logFile = resolveLogFile();
    try {
        const fileContent = await fs.promises.readFile(logFile, 'utf8');
        return fileContent
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
            .map(parsePersistedEntry)
            .filter((entry): entry is AppLogEntry => entry !== undefined);
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
