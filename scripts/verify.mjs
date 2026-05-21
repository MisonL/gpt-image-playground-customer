#!/usr/bin/env node

import { isMainModule, pickFailureOutput, printJson, runCommand } from './command-center-utils.mjs';

const FULL_VERIFY_PLAN = [
    { name: 'test', command: 'npm', args: ['test'] },
    { name: 'lint', command: 'npm', args: ['run', 'lint'] },
    { name: 'lint:scripts', command: 'npm', args: ['run', 'lint:scripts'] },
    { name: 'build', command: 'npm', args: ['run', 'build'] },
    { name: 'diff-check', command: 'git', args: ['diff', '--check'] },
    { name: 'diff-cached-check', command: 'git', args: ['diff', '--cached', '--check'] }
];

const QUICK_VERIFY_PLAN = [
    { name: 'test:scripts', command: 'npm', args: ['run', 'test:scripts'] },
    { name: 'lint:scripts', command: 'npm', args: ['run', 'lint:scripts'] },
    { name: 'diff-check', command: 'git', args: ['diff', '--check'] },
    { name: 'diff-cached-check', command: 'git', args: ['diff', '--cached', '--check'] }
];

const POSTGRES_VERIFY_STEP = { name: 'test:postgres', command: 'npm', args: ['run', 'test:postgres'] };

export function buildVerifyPlan(options = {}) {
    const source = options.quick ? QUICK_VERIFY_PLAN : FULL_VERIFY_PLAN;
    const plan = source.filter((step) => !(options.skipBuild && step.name === 'build'));
    if (!options.postgres) return plan;
    const firstDiffCheckIndex = plan.findIndex((step) => step.name.startsWith('diff-'));
    if (firstDiffCheckIndex === -1) return [...plan, POSTGRES_VERIFY_STEP];
    return [...plan.slice(0, firstDiffCheckIndex), POSTGRES_VERIFY_STEP, ...plan.slice(firstDiffCheckIndex)];
}

function parseArgs(argv) {
    const unknown = argv.find((arg) => !['--help', '-h', '--quick', '--skip-build', '--postgres'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        postgres: argv.includes('--postgres'),
        quick: argv.includes('--quick'),
        skipBuild: argv.includes('--skip-build')
    };
}

function printHelp() {
    console.log(`Usage:
  npm run verify
  npm run verify -- --quick

Options:
  --quick        Run script tests, script syntax checks, and git diff whitespace checks.
  --postgres     Include the live PostgreSQL gate with npm run test:postgres.
  --skip-build   Run the full plan without npm run build.
  --help         Show this help.`);
}

function runVerify(options) {
    const checks = [];
    for (const step of buildVerifyPlan(options)) {
        const result = runCommand(step.command, step.args);
        checks.push({
            name: step.name,
            command: [step.command, ...step.args].join(' '),
            status: result.ok ? 'pass' : 'fail',
            elapsed_ms: result.elapsed_ms,
            ...(result.ok ? {} : { output: pickFailureOutput(result) })
        });
        if (!result.ok) break;
    }

    const ok = checks.every((check) => check.status === 'pass');
    printJson({ ok, profile: options.quick ? 'quick' : 'full', postgres: Boolean(options.postgres), checks });
    if (!ok) process.exit(1);
}

try {
    if (isMainModule(import.meta.url, process.argv[1])) {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            printHelp();
        } else {
            runVerify(options);
        }
    }
} catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}
