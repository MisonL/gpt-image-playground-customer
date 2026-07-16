#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function collectTestFiles(root, directory, suffixes, files) {
    const currentDirectory = path.join(root, directory);
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
        const entryPath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
            collectTestFiles(root, path.join(directory, entry.name), suffixes, files);
            continue;
        }
        if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
            files.push(path.relative(root, entryPath));
        }
    }
}

function validateTestScope(scope) {
    if (scope !== 'all' && scope !== 'scripts') {
        throw new Error(`未知测试范围：${scope}`);
    }
}

export function findTestFiles(root = process.cwd(), scope = 'all') {
    validateTestScope(scope);
    const files = [];
    if (scope === 'all') {
        collectTestFiles(root, 'src', ['.test.ts', '.test.tsx'], files);
    }
    collectTestFiles(root, 'scripts', ['.test.mjs'], files);
    return files.sort();
}

function hasExplicitTestFile(nodeArguments) {
    return nodeArguments.some(
        (argument) => !argument.startsWith('-') && /\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(argument)
    );
}

function hasTestConcurrencyArgument(nodeArguments) {
    return nodeArguments.some(
        (argument) => argument === '--test-concurrency' || argument.startsWith('--test-concurrency=')
    );
}

export function parseTestRunnerArguments(arguments_) {
    const nodeArguments = [...arguments_];
    const scope = nodeArguments[0] === 'scripts' ? nodeArguments.shift() : 'all';
    return { scope, nodeArguments };
}

export function selectTestFiles(root, scope, nodeArguments) {
    return hasExplicitTestFile(nodeArguments) ? [] : findTestFiles(root, scope);
}

export function buildTestArguments(supportsTestConcurrency, testFiles = findTestFiles(), nodeArguments = []) {
    const defaultConcurrency =
        supportsTestConcurrency && !hasTestConcurrencyArgument(nodeArguments) ? ['--test-concurrency=4'] : [];
    return ['--test', ...defaultConcurrency, '--import', 'tsx', ...nodeArguments, ...testFiles];
}

export function detectTestConcurrencySupport() {
    const result = spawnSync(process.execPath, ['--test-concurrency=1', '--help'], { stdio: 'ignore' });
    if (result.error) throw result.error;
    if (result.status === 0) return true;
    if (result.status === 9) return false;
    throw new Error(`Node 参数能力探测失败，退出码 ${result.status ?? 'unknown'}`);
}

export function runTests(scope = 'all', nodeArguments = []) {
    const supportsTestConcurrency = detectTestConcurrencySupport();
    const testFiles = selectTestFiles(process.cwd(), scope, nodeArguments);
    if (testFiles.length === 0 && !hasExplicitTestFile(nodeArguments)) throw new Error('未找到测试文件。');
    if (!supportsTestConcurrency && !hasTestConcurrencyArgument(nodeArguments)) {
        console.error(`[test] Node ${process.version} 不支持 --test-concurrency，使用运行时默认并发。`);
    }

    return spawn(process.execPath, buildTestArguments(supportsTestConcurrency, testFiles, nodeArguments), {
        stdio: 'inherit'
    });
}

function main() {
    let child;
    try {
        const { scope, nodeArguments } = parseTestRunnerArguments(process.argv.slice(2));
        child = runTests(scope, nodeArguments);
    } catch (error) {
        console.error(`[test] 无法启动测试：${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        return;
    }

    child.once('error', (error) => {
        console.error(`[test] 无法启动测试：${error.message}`);
        process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exitCode = code ?? 1;
    });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main();
}
