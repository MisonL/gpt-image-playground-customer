import {
    buildTestArguments,
    DEFAULT_TEST_TIMEOUT_MS,
    findTestFiles,
    parseTestRunnerArguments,
    selectTestFiles
} from './run-tests.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const testFiles = ['scripts/example.test.mjs', 'src/example.test.ts', 'src/example.test.tsx'];
const baseTestArguments = ['--test', '--import', 'tsx', ...testFiles];

describe('test runner arguments', () => {
    it('limits concurrency and test duration when the current Node runtime supports both options', () => {
        assert.deepEqual(buildTestArguments(true, testFiles, [], true), [
            '--test',
            '--test-concurrency=4',
            `--test-timeout=${DEFAULT_TEST_TIMEOUT_MS}`,
            ...baseTestArguments.slice(1)
        ]);
    });

    it('keeps Node 20.10 compatible when the concurrency option is unavailable', () => {
        assert.deepEqual(buildTestArguments(false, testFiles), baseTestArguments);
    });

    it('forwards explicit test files and Node test options without adding the full suite', () => {
        const nodeArguments = ['--test-name-pattern=ShareDialog', 'src/components/share-dialog.test.tsx'];
        assert.deepEqual(parseTestRunnerArguments(nodeArguments), {
            scope: 'all',
            nodeArguments
        });
        assert.deepEqual(selectTestFiles(process.cwd(), 'all', nodeArguments), []);
        assert.deepEqual(buildTestArguments(true, [], nodeArguments, true), [
            '--test',
            '--test-concurrency=4',
            `--test-timeout=${DEFAULT_TEST_TIMEOUT_MS}`,
            '--import',
            'tsx',
            ...nodeArguments
        ]);
    });

    it('keeps the scripts scope while forwarding Node test options', () => {
        assert.deepEqual(
            parseTestRunnerArguments(['scripts', '--test-name-pattern=test runner', 'scripts/run-tests.test.mjs']),
            {
                scope: 'scripts',
                nodeArguments: ['--test-name-pattern=test runner', 'scripts/run-tests.test.mjs']
            }
        );
    });

    it('preserves an explicit Node test concurrency value', () => {
        assert.deepEqual(buildTestArguments(true, testFiles, ['--test-concurrency=1'], true), [
            '--test',
            `--test-timeout=${DEFAULT_TEST_TIMEOUT_MS}`,
            '--import',
            'tsx',
            '--test-concurrency=1',
            ...testFiles
        ]);
    });

    it('preserves an explicit Node test timeout value', () => {
        assert.deepEqual(buildTestArguments(true, testFiles, ['--test-timeout=120000'], true), [
            '--test',
            '--test-concurrency=4',
            '--import',
            'tsx',
            '--test-timeout=120000',
            ...testFiles
        ]);
    });

    it('finds supported test files without relying on Node test runner glob support', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'gipc-test-runner-'));
        try {
            await Promise.all([
                mkdir(path.join(root, 'src', 'nested'), { recursive: true }),
                mkdir(path.join(root, 'scripts'), { recursive: true })
            ]);
            await Promise.all([
                writeFile(path.join(root, 'src', 'unit.test.ts'), ''),
                writeFile(path.join(root, 'src', 'nested', 'component.test.tsx'), ''),
                writeFile(path.join(root, 'src', 'ignored.ts'), ''),
                writeFile(path.join(root, 'scripts', 'runner.test.mjs'), ''),
                writeFile(path.join(root, 'scripts', 'ignored.test.ts'), '')
            ]);

            assert.deepEqual(findTestFiles(root), [
                path.join('scripts', 'runner.test.mjs'),
                path.join('src', 'nested', 'component.test.tsx'),
                path.join('src', 'unit.test.ts')
            ]);
            assert.deepEqual(findTestFiles(root, 'scripts'), [path.join('scripts', 'runner.test.mjs')]);
            assert.deepEqual(selectTestFiles(root, 'all', ['--test-name-pattern=unit']), [
                path.join('scripts', 'runner.test.mjs'),
                path.join('src', 'nested', 'component.test.tsx'),
                path.join('src', 'unit.test.ts')
            ]);
            assert.throws(() => findTestFiles(root, 'unknown'), /未知测试范围：unknown/);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
