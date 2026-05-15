import {
    createBatchId,
    createImageFilename,
    createAccessToken,
    buildAccessCookieOptions,
    isHttpsRequest,
    readBooleanEnv,
    readOutputDirEnv,
    readPositiveIntegerEnv,
    readAffinityKey,
    verifyAccessToken,
    verifyPasswordHash,
    type FilenameClock
} from './server-runtime';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('verifyPasswordHash', () => {
    it('accepts only the sha256 hash for the configured password', () => {
        const passwordHash = 'f5366f0ad42a28df559f32cd0bdfc198f67e4cd2f011f3cee4dc80b97cf1a641';

        assert.equal(verifyPasswordHash(passwordHash, 'customer-password'), true);
        assert.equal(verifyPasswordHash(passwordHash, 'other-password'), false);
    });

    it('rejects malformed hex without throwing', () => {
        assert.equal(verifyPasswordHash('not-a-hex-digest', 'customer-password'), false);
    });
});

describe('verifyAccessToken', () => {
    it('accepts only the access token derived from the configured password', () => {
        const accessToken = createAccessToken('test-fixture-access-code');

        assert.equal(verifyAccessToken(accessToken, 'test-fixture-access-code'), true);
        assert.equal(verifyAccessToken(accessToken, 'different-test-fixture-access-code'), false);
    });

    it('allows access when no server password is configured', () => {
        assert.equal(verifyAccessToken(undefined, undefined), true);
    });

    it('rejects missing or malformed tokens when a server password is configured', () => {
        assert.equal(verifyAccessToken(undefined, 'test-fixture-access-code'), false);
        assert.equal(verifyAccessToken('not-a-hex-digest', 'test-fixture-access-code'), false);
    });
});

describe('buildAccessCookieOptions', () => {
    it('does not mark local http cookies as secure in production containers', () => {
        assert.equal(buildAccessCookieOptions(new Headers()).secure, false);
    });

    it('marks cookies as secure behind an https proxy', () => {
        assert.equal(buildAccessCookieOptions(new Headers({ 'x-forwarded-proto': 'https' })).secure, true);
    });
});

describe('isHttpsRequest', () => {
    it('recognizes common forwarded https headers', () => {
        assert.equal(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'https,http' })), true);
        assert.equal(isHttpsRequest(new Headers({ 'x-forwarded-scheme': 'https' })), true);
        assert.equal(isHttpsRequest(new Headers({ 'x-forwarded-ssl': 'on' })), true);
    });
});

describe('readAffinityKey', () => {
    it('prefers the first forwarded IP over other headers', () => {
        const headers = new Headers({
            'x-forwarded-for': '203.0.113.10, 10.0.0.2',
            'x-real-ip': '198.51.100.7',
            'user-agent': 'browser-a'
        });

        assert.equal(readAffinityKey(headers), '203.0.113.10');
    });

    it('falls back to real IP, user agent, then default', () => {
        assert.equal(readAffinityKey(new Headers({ 'x-real-ip': '198.51.100.7' })), '198.51.100.7');
        assert.equal(readAffinityKey(new Headers({ 'user-agent': 'browser-a' })), 'browser-a');
        assert.equal(readAffinityKey(new Headers()), 'default');
    });
});

describe('createImageFilename', () => {
    it('uses the provided clock so filenames can be tested deterministically', () => {
        const clock: FilenameClock = () => 1715400000000;

        assert.equal(createImageFilename('abcdef1234567890', 2, 'webp', clock), '1715400000000-abcdef1234567890-2.webp');
    });
});

describe('createBatchId', () => {
    it('returns a 16-character hex identifier', () => {
        const batchId = createBatchId();

        assert.match(batchId, /^[a-f0-9]{16}$/i);
    });

    it('generates different ids on successive calls', () => {
        const first = createBatchId();
        const second = createBatchId();

        assert.notEqual(first, second);
    });
});

describe('readBooleanEnv', () => {
    it('only enables a feature for explicit true-like values', () => {
        assert.equal(readBooleanEnv({}, 'ENABLE_STREAMING_BATCH'), false);
        assert.equal(readBooleanEnv({ ENABLE_STREAMING_BATCH: 'false' }, 'ENABLE_STREAMING_BATCH'), false);
        assert.equal(readBooleanEnv({ ENABLE_STREAMING_BATCH: '1' }, 'ENABLE_STREAMING_BATCH'), true);
        assert.equal(readBooleanEnv({ ENABLE_STREAMING_BATCH: 'true' }, 'ENABLE_STREAMING_BATCH'), true);
    });
});

describe('readOutputDirEnv', () => {
    it('accepts safe relative output directories', () => {
        assert.equal(readOutputDirEnv({}, 'IMAGE_OUTPUT_DIR'), 'generated-images');
        assert.equal(readOutputDirEnv({ IMAGE_OUTPUT_DIR: 'custom/images_1' }, 'IMAGE_OUTPUT_DIR'), 'custom/images_1');
    });

    it('rejects absolute paths and path traversal', () => {
        assert.throws(() => readOutputDirEnv({ IMAGE_OUTPUT_DIR: '/tmp/generated-images' }, 'IMAGE_OUTPUT_DIR'), /安全的相对路径/);
        assert.throws(() => readOutputDirEnv({ IMAGE_OUTPUT_DIR: '\\tmp\\generated-images' }, 'IMAGE_OUTPUT_DIR'), /安全的相对路径/);
        assert.throws(() => readOutputDirEnv({ IMAGE_OUTPUT_DIR: '../generated-images' }, 'IMAGE_OUTPUT_DIR'), /安全的相对路径/);
        assert.throws(() => readOutputDirEnv({ IMAGE_OUTPUT_DIR: 'generated/../images' }, 'IMAGE_OUTPUT_DIR'), /安全的相对路径/);
    });
});

describe('readPositiveIntegerEnv', () => {
    it('reads a positive integer or falls back to a safe default', () => {
        assert.equal(readPositiveIntegerEnv({}, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1), 1);
        assert.equal(readPositiveIntegerEnv({ OPENAI_MAX_STREAMS_PER_CREDENTIAL: '2' }, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1), 2);
        assert.equal(readPositiveIntegerEnv({ OPENAI_MAX_STREAMS_PER_CREDENTIAL: '0' }, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1), 1);
        assert.equal(readPositiveIntegerEnv({ OPENAI_MAX_STREAMS_PER_CREDENTIAL: 'bad' }, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1), 1);
    });
});
