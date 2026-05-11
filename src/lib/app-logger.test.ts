import { appLogger } from './app-logger';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const originalLogLevel = process.env.APP_LOG_LEVEL;
const originalNodeEnv = process.env.NODE_ENV;
const originalDebug = console.debug;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;
const nodeEnvKey: string = 'NODE_ENV';

beforeEach(() => {
    process.env[nodeEnvKey] = 'test';
});

afterEach(() => {
    if (originalLogLevel === undefined) {
        delete process.env.APP_LOG_LEVEL;
    } else {
        process.env.APP_LOG_LEVEL = originalLogLevel;
    }
    if (originalNodeEnv === undefined) {
        delete process.env[nodeEnvKey];
    } else {
        process.env[nodeEnvKey] = originalNodeEnv;
    }
    console.debug = originalDebug;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
});

describe('appLogger', { concurrency: false }, () => {
    it('uses warn as the production default log level', () => {
        const calls: string[] = [];
        delete process.env.APP_LOG_LEVEL;
        process.env[nodeEnvKey] = 'production';
        console.info = (message?: unknown) => {
            calls.push(`info:${String(message)}`);
        };
        console.warn = (message?: unknown) => {
            calls.push(`warn:${String(message)}`);
        };

        appLogger.info('hidden info');
        appLogger.warn('visible warning');

        assert.deepEqual(calls, ['warn:visible warning']);
    });

    it('normalizes configured log level before filtering messages', () => {
        const calls: string[] = [];
        process.env.APP_LOG_LEVEL = ' ERROR ';
        console.warn = (message?: unknown) => {
            calls.push(`warn:${String(message)}`);
        };
        console.error = (message?: unknown) => {
            calls.push(`error:${String(message)}`);
        };

        appLogger.warn('hidden warning');
        appLogger.error('visible error');

        assert.deepEqual(calls, ['error:visible error']);
    });

    it('falls back to the default level for invalid configured values', () => {
        const calls: string[] = [];
        process.env.APP_LOG_LEVEL = 'verbose';
        process.env[nodeEnvKey] = 'production';
        console.info = (message?: unknown) => {
            calls.push(`info:${String(message)}`);
        };
        console.warn = (message?: unknown) => {
            calls.push(`warn:${String(message)}`);
        };

        appLogger.info('hidden info');
        appLogger.warn('visible warning');

        assert.deepEqual(calls, ['warn:visible warning']);
    });

    it('passes context only when it is provided', () => {
        const calls: unknown[][] = [];
        process.env.APP_LOG_LEVEL = 'debug';
        console.info = (...args: unknown[]) => {
            calls.push(args);
        };

        appLogger.info('plain message');
        appLogger.info('context message', { requestId: 'req-1' });

        assert.deepEqual(calls, [['plain message'], ['context message', { requestId: 'req-1' }]]);
    });

    it('allows debug messages at debug level', () => {
        const calls: unknown[][] = [];
        process.env.APP_LOG_LEVEL = 'debug';
        console.debug = (...args: unknown[]) => {
            calls.push(args);
        };

        appLogger.debug('debug message', { requestId: 'req-2' });

        assert.deepEqual(calls, [['debug message', { requestId: 'req-2' }]]);
    });
});
