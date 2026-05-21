import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { readPositiveIntegerEnv } from './env-utils.mjs';

const TEST_ENV_NAME = 'GPT_IMAGE_PLAYGROUND_TEST_INTEGER';

afterEach(() => {
    delete process.env[TEST_ENV_NAME];
});

describe('Environment utilities', () => {
    it('returns the default value when the env var is unset', () => {
        assert.equal(readPositiveIntegerEnv(TEST_ENV_NAME, 30), 30);
    });

    it('returns valid integer env values', () => {
        process.env[TEST_ENV_NAME] = '42';

        assert.equal(readPositiveIntegerEnv(TEST_ENV_NAME, 30), 42);
    });

    it('accepts values exactly equal to the configured minimum', () => {
        process.env[TEST_ENV_NAME] = '1000';

        assert.equal(readPositiveIntegerEnv(TEST_ENV_NAME, 30, 1000), 1000);
    });

    it('accepts zero when the configured minimum is zero', () => {
        process.env[TEST_ENV_NAME] = '0';

        assert.equal(readPositiveIntegerEnv(TEST_ENV_NAME, 30, 0), 0);
    });

    it('rejects non-digit values before parsing', () => {
        process.env[TEST_ENV_NAME] = '12ms';

        assert.throws(() => readPositiveIntegerEnv(TEST_ENV_NAME, 30), /formatted as digits/);
    });

    it('rejects values below the configured minimum', () => {
        process.env[TEST_ENV_NAME] = '999';

        assert.throws(() => readPositiveIntegerEnv(TEST_ENV_NAME, 30, 1000), /greater than or equal to 1000/);
    });

    it('rejects integers that exceed JavaScript safe integer range', () => {
        process.env[TEST_ENV_NAME] = String(Number.MAX_SAFE_INTEGER + 1);

        assert.throws(() => readPositiveIntegerEnv(TEST_ENV_NAME, 30), /safe integer/);
    });
});
