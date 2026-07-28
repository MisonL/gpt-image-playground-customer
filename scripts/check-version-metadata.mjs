#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CHANGELOG_BASE_URL = 'https://github.com/MisonL/visual-journal';

function readText(path) {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
}

function readJson(path) {
    return JSON.parse(readText(path));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readReadmeBadgeVersion(readme) {
    const match = readme.match(/!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-(.+?)-blue\)/);
    return match?.[1];
}

function addCheck(checks, name, ok, details = {}) {
    checks.push({ name, status: ok ? 'pass' : 'fail', ...details });
}

function buildChecks() {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const readme = readText('README.md');
    const changelog = readText('CHANGELOG.md');
    const version = packageJson.version;
    const checks = [];

    addCheck(checks, 'package-version-semver', SEMVER_PATTERN.test(version), { version });
    addCheck(checks, 'package-lock-root-version', packageLock.version === version, {
        expected: version,
        actual: packageLock.version
    });
    addCheck(checks, 'package-lock-package-version', packageLock.packages?.['']?.version === version, {
        expected: version,
        actual: packageLock.packages?.['']?.version
    });
    addCheck(checks, 'readme-version-badge', readReadmeBadgeVersion(readme) === version, {
        expected: version,
        actual: readReadmeBadgeVersion(readme) || null
    });
    addCheck(checks, 'changelog-unreleased-section', /^## \[未发布\]$/m.test(changelog));
    addCheck(checks, 'changelog-current-version-section', hasChangelogVersionSection(changelog, version), { version });
    addCheck(checks, 'changelog-unreleased-link', hasUnreleasedLink(changelog, version), { version });
    addCheck(checks, 'changelog-current-version-link', hasVersionLink(changelog, version), { version });

    return checks;
}

function hasChangelogVersionSection(changelog, version) {
    return new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog);
}

function hasUnreleasedLink(changelog, version) {
    const expected = `[未发布]: ${CHANGELOG_BASE_URL}/compare/v${version}...HEAD`;
    return changelog.split(/\r?\n/).includes(expected);
}

function hasVersionLink(changelog, version) {
    return new RegExp(`^\\[${escapeRegExp(version)}\\]: ${escapeRegExp(CHANGELOG_BASE_URL)}/compare/.+v${escapeRegExp(version)}$`, 'm').test(changelog);
}

function main() {
    const checks = buildChecks();
    const ok = checks.every((check) => check.status === 'pass');
    console.log(JSON.stringify({ ok, checks }, null, 2));
    if (!ok) process.exit(1);
}

main();
