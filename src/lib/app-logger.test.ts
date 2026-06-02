import {
    appLogger,
    clearAppLogEntriesForTest,
    readAppLogEntries,
    readPersistedAppLogEntriesForTest,
    setAppLogPersistenceForTest,
    subscribeAppLogs
} from './app-logger';
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const originalLogLevel = process.env.APP_LOG_LEVEL;
const originalNodeEnv = process.env.NODE_ENV;
const originalTestLogFileName = process.env.APP_LOG_TEST_FILE_NAME;
const originalDebug = console.debug;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;
const nodeEnvKey: string = 'NODE_ENV';
const testLogFileNameKey = 'APP_LOG_TEST_FILE_NAME';

beforeEach(async () => {
    process.env[nodeEnvKey] = 'test';
    process.env[testLogFileNameKey] =
        `app-logger-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`;
    setAppLogPersistenceForTest(true);
    clearAppLogEntriesForTest();
});

afterEach(async () => {
    clearAppLogEntriesForTest();
    setAppLogPersistenceForTest(false);
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
    if (originalTestLogFileName === undefined) {
        delete process.env[testLogFileNameKey];
    } else {
        process.env[testLogFileNameKey] = originalTestLogFileName;
    }
    console.debug = originalDebug;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
});

it('keeps the test log override scoped to the fixed app log directory', () => {
    process.env[testLogFileNameKey] = path.join('..', 'outside.jsonl');
    clearAppLogEntriesForTest();

    appLogger.info('scoped test log override');

    assert.equal(readAppLogEntries().at(-1)?.message, 'scoped test log override');
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

    it('stores emitted entries for live log subscribers', () => {
        const received: string[] = [];
        process.env.APP_LOG_LEVEL = 'info';
        console.info = () => {};
        const unsubscribe = subscribeAppLogs((entry) => {
            received.push(`${entry.level}:${entry.message}`);
        });

        appLogger.info('visible info', { requestId: 'req-3' });
        unsubscribe();
        appLogger.info('after unsubscribe');

        const entries = readAppLogEntries();
        assert.equal(entries.length, 2);
        const firstEntry = entries[0];
        assert.ok(firstEntry);
        assert.equal(firstEntry.level, 'info');
        assert.equal(firstEntry.message, 'visible info');
        assert.equal(typeof firstEntry.context, 'string');
        assert.equal(firstEntry.clientRequestId, undefined);
        assert.ok(firstEntry.context);
        assert.match(firstEntry.context, /"requestId": "req-3"/);
        assert.deepEqual(received, ['info:visible info']);
    });

    it('promotes client request ids into a structured log field', () => {
        process.env.APP_LOG_LEVEL = 'info';
        console.info = () => {};

        appLogger.info('request scoped message', { clientRequestId: 'client-req-1', requestId: 'upstream-req-1' });

        const [entry] = readAppLogEntries();
        assert.equal(entry.clientRequestId, 'client-req-1');
        assert.match(entry.context || '', /"clientRequestId": "client-req-1"/);
    });

    it('promotes filenames into a structured log field', () => {
        process.env.APP_LOG_LEVEL = 'info';
        console.info = () => {};

        appLogger.info('saved images', {
            clientRequestId: 'client-req-2',
            filenames: ['image-a.png', 'image-b.png']
        });

        const [entry] = readAppLogEntries();
        assert.deepEqual(entry.filenames, ['image-a.png', 'image-b.png']);
    });

    it('hydrates entries from the persisted jsonl log file', async () => {
        process.env.APP_LOG_LEVEL = 'info';
        console.info = () => {};

        appLogger.info('persisted message', {
            clientRequestId: 'client-req-3',
            filenames: ['persisted.png']
        });
        clearAppLogEntriesForTest({ preservePersistedFile: true });

        const entries = readAppLogEntries();

        assert.equal(entries.length, 1);
        assert.equal(entries[0].message, 'persisted message');
        assert.equal(entries[0].clientRequestId, 'client-req-3');
        assert.deepEqual(entries[0].filenames, ['persisted.png']);
    });

    it('keeps only the newest 300 entries in the persisted log file', async () => {
        process.env.APP_LOG_LEVEL = 'info';
        console.info = () => {};

        for (let index = 0; index < 305; index++) {
            appLogger.info(`message ${index}`);
        }

        const entries = await readPersistedAppLogEntriesForTest();
        assert.equal(entries.length, 300);
        assert.equal(entries[0].message, 'message 5');
        assert.equal(entries[299].message, 'message 304');
    });

    it('does not store messages filtered out by the configured log level', () => {
        delete process.env.APP_LOG_LEVEL;
        process.env[nodeEnvKey] = 'production';
        console.info = () => {
            throw new Error('filtered info should not be written');
        };

        appLogger.info('hidden info');

        assert.deepEqual(readAppLogEntries(), []);
    });

    it('continues notifying subscribers when one subscriber throws', () => {
        const received: string[] = [];
        const errors: unknown[][] = [];
        process.env.APP_LOG_LEVEL = 'info';
        console.info = () => {};
        console.error = (...args: unknown[]) => {
            errors.push(args);
        };
        subscribeAppLogs(() => {
            throw new Error('subscriber failed');
        });
        subscribeAppLogs((entry) => {
            received.push(entry.message);
        });

        appLogger.info('visible info');

        assert.deepEqual(received, ['visible info']);
        assert.equal(errors.length, 1);
    });
});
