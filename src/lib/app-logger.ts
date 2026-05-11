const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

type CachedLogLevel = {
    configuredLevel: string | undefined;
    nodeEnv: string | undefined;
    level: LogLevel;
};

let cachedLogLevel: CachedLogLevel | undefined;

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

function writeLog(writer: (message?: unknown, ...optionalParams: unknown[]) => void, message: string, context?: unknown) {
    if (context === undefined) {
        writer(message);
        return;
    }
    writer(message, context);
}

export const appLogger = {
    debug(message: string, context?: unknown) {
        if (canLog('debug')) writeLog(console.debug, message, context);
    },
    info(message: string, context?: unknown) {
        if (canLog('info')) writeLog(console.info, message, context);
    },
    warn(message: string, context?: unknown) {
        if (canLog('warn')) writeLog(console.warn, message, context);
    },
    error(message: string, context?: unknown) {
        if (canLog('error')) writeLog(console.error, message, context);
    }
};
