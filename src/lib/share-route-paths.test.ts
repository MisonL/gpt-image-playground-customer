import { buildShareApiPath } from './share-route-paths';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('buildShareApiPath', () => {
    it('uses root API paths for root share pages', () => {
        assert.equal(
            buildShareApiPath({ pathname: '/share/abc123', token: 'abc123' }),
            '/api/shares/abc123'
        );
        assert.equal(
            buildShareApiPath({ pathname: '/share/abc123', token: 'abc123', suffix: 'content' }),
            '/api/shares/abc123/content'
        );
    });

    it('keeps deployment path prefixes for share pages', () => {
        assert.equal(
            buildShareApiPath({ pathname: '/playground/share/abc123', token: 'abc123' }),
            '/playground/api/shares/abc123'
        );
        assert.equal(
            buildShareApiPath({ pathname: '/playground/share/abc123', token: 'abc123', suffix: '/content' }),
            '/playground/api/shares/abc123/content'
        );
    });

    it('handles trailing slashes and URL-encodes tokens', () => {
        assert.equal(
            buildShareApiPath({ pathname: '/playground/share/a b/', token: 'a b', suffix: 'content' }),
            '/playground/api/shares/a%20b/content'
        );
    });
});
