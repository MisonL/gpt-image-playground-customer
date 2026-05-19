import { sha256Hex, sha256HexFromBytes } from './sha256';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('sha256HexFromBytes', () => {
    it('returns a SHA-256 hex digest', () => {
        assert.match(sha256HexFromBytes(new TextEncoder().encode('fixture text')), /^[a-f0-9]{64}$/);
    });
});

describe('sha256Hex', () => {
    it('hashes text with the universal client helper', async () => {
        const input = 'fixture text';

        assert.equal(await sha256Hex(input), sha256HexFromBytes(new TextEncoder().encode(input)));
    });
});
