import {
    PAGE_PASSWORD_AUTH_ERROR_CODES,
    hasPreservedDisplayedAuthError,
    isPagePasswordAuthErrorCode
} from './page-password-auth';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('page access code auth error codes', () => {
    it('recognizes only page access code auth errors', () => {
        assert.equal(isPagePasswordAuthErrorCode(PAGE_PASSWORD_AUTH_ERROR_CODES.missing), true);
        assert.equal(isPagePasswordAuthErrorCode(PAGE_PASSWORD_AUTH_ERROR_CODES.invalid), true);
        assert.equal(isPagePasswordAuthErrorCode('upstream_unauthorized'), false);
        assert.equal(isPagePasswordAuthErrorCode(undefined), false);
    });
});

describe('hasPreservedDisplayedAuthError', () => {
    it('only matches errors that explicitly preserve an already displayed auth message', () => {
        assert.equal(hasPreservedDisplayedAuthError({ status: 401 }), false);
        assert.equal(hasPreservedDisplayedAuthError({ status: 401, preserveDisplayedError: false }), false);
        assert.equal(hasPreservedDisplayedAuthError({ status: 401, preserveDisplayedError: true }), true);
    });
});
