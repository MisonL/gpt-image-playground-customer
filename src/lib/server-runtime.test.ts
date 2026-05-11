import {
    createBatchId,
    createImageFilename,
    readAffinityKey,
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
