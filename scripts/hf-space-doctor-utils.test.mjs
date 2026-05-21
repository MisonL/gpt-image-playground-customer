import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    assertKnownOptions,
    assertSpaceTargetConfig,
    buildNextActions,
    classifyRequiredAndRecommendedNames,
    getJsonKeyValues,
    getJsonNames,
    isMainModule,
    readOptionValue,
    runDoctorCommand,
    validateSpaceId,
    validateSpaceUrl
} from './hf-space-doctor-utils.mjs';

describe('HF Space doctor utilities', () => {
    it('parses hf CLI JSON output after hint lines', () => {
        const names = getJsonNames(
            [
                'Hint: Use `hf spaces variables add user/space -e KEY=VALUE` to add variables.',
                '[{"key":"APP_PASSWORD"},{"key":"AGENT_API_TOKEN"}]'
            ].join('\n')
        );

        assert.deepEqual([...names], ['APP_PASSWORD', 'AGENT_API_TOKEN']);
    });

    it('does not treat square brackets in hint text as JSON', () => {
        const names = getJsonNames(
            [
                'Hint: Usage: hf spaces secrets list [OPTIONS] SPACE_ID',
                '[{"key":"OPENAI_API_KEY"}]'
            ].join('\n')
        );

        assert.deepEqual([...names], ['OPENAI_API_KEY']);
    });

    it('parses hf CLI variable values after hint lines', () => {
        const values = getJsonKeyValues(
            [
                'Hint: Use `hf spaces variables add user/space -e KEY=VALUE` to add variables.',
                '[{"key":"AGENT_STATE_BACKEND","value":"memory"},{"key":"NEXT_PUBLIC_IMAGE_STORAGE_MODE","value":"indexeddb"}]'
            ].join('\n')
        );

        assert.deepEqual([...values], [
            ['AGENT_STATE_BACKEND', 'memory'],
            ['NEXT_PUBLIC_IMAGE_STORAGE_MODE', 'indexeddb']
        ]);
    });

    it('keeps auth remediation broad enough for network and token failures', () => {
        const actions = buildNextActions([
            {
                status: 'fail',
                name: 'hf-auth',
                message: 'hf CLI auth check failed.',
                error: 'TLS failed while checking auth'
            }
        ]);

        assert.equal(actions.length, 1);
        assert.match(actions[0], /network\/proxy/);
        assert.match(actions[0], /hf auth login/);
    });

    it('classifies required and recommended remote variables separately', () => {
        const result = classifyRequiredAndRecommendedNames(
            new Set(['AGENT_STATE_BACKEND', 'NEXT_PUBLIC_IMAGE_STORAGE_MODE']),
            ['AGENT_STATE_BACKEND', 'NEXT_PUBLIC_IMAGE_STORAGE_MODE'],
            ['APP_LOG_LEVEL']
        );

        assert.deepEqual(result, {
            missingRequired: [],
            missingRecommended: ['APP_LOG_LEVEL']
        });
    });

    it('detects the main module with file URL encoding', () => {
        const argvPath = 'scripts/path with space.mjs';
        const moduleUrl = pathToFileURL(resolve(argvPath)).href;

        assert.equal(isMainModule(moduleUrl, argvPath), true);
        assert.equal(isMainModule(moduleUrl, undefined), false);
    });

    it('validates Hugging Face Space target config consistently', () => {
        assert.equal(validateSpaceId('example/demo'), undefined);
        assert.equal(validateSpaceUrl('https://example-demo.hf.space'), undefined);
        assert.match(validateSpaceId('bad'), /namespace\/space/);
        assert.match(validateSpaceUrl('https://example.com'), /\.hf\.space/);
        assert.match(validateSpaceUrl('https://user:pass@example-demo.hf.space'), /plain Space origin/);
        assert.match(validateSpaceUrl('https://example-demo.hf.space/share/abc'), /plain Space origin/);
        assert.match(validateSpaceUrl('https://example-demo.hf.space?token=secret'), /plain Space origin/);
        assert.throws(
            () =>
                assertSpaceTargetConfig({
                    spaceId: 'example/demo',
                    spaceUrl: 'https://example.com'
                }),
            /\.hf\.space/
        );
    });

    it('rejects unknown CLI options and blank inline option values', () => {
        assert.doesNotThrow(() => assertKnownOptions(['--skip-remote'], ['--skip-remote']));
        assert.throws(() => assertKnownOptions(['--unknown'], ['--skip-remote']), /Unknown option/);
        assert.throws(() => readOptionValue(['--space-id='], '--space-id'), /requires a value/);
    });

    it('times out direct doctor commands instead of hanging', () => {
        const result = runDoctorCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 20 });

        assert.equal(result.ok, false);
        assert.match(result.error, /timed out|ETIMEDOUT|SIGTERM/i);
    });
});
