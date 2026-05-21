import {
    createBatchId,
    createImageFilename,
    createAccessToken,
    buildAccessCookie,
    buildAccessCookieOptions,
    isHttpsRequest,
    readBooleanEnv,
    readOutputDirEnv,
    readPositiveIntegerEnv,
    readAffinityKey,
    serializeAccessCookie,
    verifyAccessToken,
    verifyPasswordHash,
    type FilenameClock
} from './server-runtime';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';

const PAGE_PASSWORD_FIXTURE = ['customer', 'access', 'code'].join('-');
const OTHER_PAGE_PASSWORD_FIXTURE = ['other', 'access', 'code'].join('-');
const ACCESS_CODE_FIXTURE = ['test', 'fixture', 'access', 'code'].join('-');
const DIFFERENT_ACCESS_CODE_FIXTURE = ['different', 'test', 'fixture', 'access', 'code'].join('-');

describe('verifyPasswordHash', () => {
    it('accepts only the sha256 hash for the configured access code', () => {
        const passwordHash = crypto.createHash('sha256').update(PAGE_PASSWORD_FIXTURE).digest('hex');

        assert.equal(verifyPasswordHash(passwordHash, PAGE_PASSWORD_FIXTURE), true);
        assert.equal(verifyPasswordHash(passwordHash, OTHER_PAGE_PASSWORD_FIXTURE), false);
    });

    it('rejects malformed hex without throwing', () => {
        assert.equal(verifyPasswordHash('not-a-hex-digest', PAGE_PASSWORD_FIXTURE), false);
    });
});

describe('verifyAccessToken', () => {
    it('accepts only a fresh access token signed with the configured access code', () => {
        const issuedAtMs = 1_715_400_000_000;
        const accessToken = createAccessToken(ACCESS_CODE_FIXTURE, issuedAtMs);

        assert.equal(verifyAccessToken(accessToken, ACCESS_CODE_FIXTURE, issuedAtMs), true);
        assert.equal(verifyAccessToken(accessToken, DIFFERENT_ACCESS_CODE_FIXTURE, issuedAtMs), false);
    });

    it('rejects expired or future-dated access tokens', () => {
        const issuedAtMs = 1_715_400_000_000;
        const accessToken = createAccessToken(ACCESS_CODE_FIXTURE, issuedAtMs);

        assert.equal(verifyAccessToken(accessToken, ACCESS_CODE_FIXTURE, issuedAtMs + 24 * 60 * 60 * 1000), true);
        assert.equal(verifyAccessToken(accessToken, ACCESS_CODE_FIXTURE, issuedAtMs + 24 * 60 * 60 * 1000 + 1), false);
        assert.equal(verifyAccessToken(accessToken, ACCESS_CODE_FIXTURE, issuedAtMs - 60_001), false);
    });

    it('allows access when no server access code is configured', () => {
        assert.equal(verifyAccessToken(undefined, undefined), true);
    });

    it('rejects missing or malformed tokens when a server access code is configured', () => {
        assert.equal(verifyAccessToken(undefined, ACCESS_CODE_FIXTURE), false);
        assert.equal(verifyAccessToken('not-a-hex-digest', ACCESS_CODE_FIXTURE), false);
        assert.equal(verifyAccessToken('0'.repeat(64), ACCESS_CODE_FIXTURE), false);
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

describe('buildAccessCookie', () => {
    it('builds the shared image access cookie from the configured access code', () => {
        const cookie = buildAccessCookie(PAGE_PASSWORD_FIXTURE, new Headers({ 'x-forwarded-proto': 'https' }));

        assert.equal(cookie.name, 'gptImageAccess');
        assert.equal(verifyAccessToken(cookie.value, PAGE_PASSWORD_FIXTURE), true);
        assert.equal(cookie.options.path, '/');
        assert.equal(cookie.options.httpOnly, true);
        assert.equal(cookie.options.secure, true);
    });
});

describe('serializeAccessCookie', () => {
    it('serializes access cookie attributes for streamed responses', () => {
        const cookie = buildAccessCookie(PAGE_PASSWORD_FIXTURE, new Headers({ 'x-forwarded-proto': 'https' }));

        assert.equal(
            serializeAccessCookie(cookie),
            `gptImageAccess=${cookie.value}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`
        );
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
    it('reads a positive integer or falls back only when the value is absent', () => {
        assert.equal(readPositiveIntegerEnv({}, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1), 1);
        assert.equal(readPositiveIntegerEnv({ OPENAI_MAX_STREAMS_PER_CREDENTIAL: '2' }, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1), 2);
    });

    it('fails explicitly when the configured value is invalid', () => {
        assert.throws(
            () => readPositiveIntegerEnv({ OPENAI_MAX_STREAMS_PER_CREDENTIAL: '0' }, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1),
            /OPENAI_MAX_STREAMS_PER_CREDENTIAL/
        );
        assert.throws(
            () => readPositiveIntegerEnv({ OPENAI_MAX_STREAMS_PER_CREDENTIAL: 'bad' }, 'OPENAI_MAX_STREAMS_PER_CREDENTIAL', 1),
            /OPENAI_MAX_STREAMS_PER_CREDENTIAL/
        );
    });
});
