import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const sourceRoot = path.join(repositoryRoot, 'src');
const catalogPath = path.join(sourceRoot, 'lib', 'i18n.tsx');
const localeNames = ['zh-CN', 'en-US'] as const;

type LocaleName = (typeof localeNames)[number];
type Catalogs = Record<LocaleName, Record<string, string>>;

describe('WebUI translation contract', () => {
    it('keeps locale keys and interpolation placeholders aligned', async () => {
        const catalogs = await readCatalogs();
        const [defaultLocale, secondaryLocale] = localeNames;
        const defaultKeys = Object.keys(catalogs[defaultLocale]).sort();
        const secondaryKeys = Object.keys(catalogs[secondaryLocale]).sort();

        assert.deepEqual(secondaryKeys, defaultKeys);
        for (const key of defaultKeys) {
            assert.deepEqual(
                extractPlaceholders(catalogs[secondaryLocale][key]),
                extractPlaceholders(catalogs[defaultLocale][key]),
                `placeholder mismatch for ${key}`
            );
        }
    });

    it('resolves every static WebUI translation call in both locales', async () => {
        const catalogs = await readCatalogs();
        const translationCalls = await collectStaticTranslationCalls(sourceRoot);

        for (const [key, references] of translationCalls) {
            for (const locale of localeNames) {
                assert.ok(
                    catalogs[locale][key],
                    `missing ${locale} translation for ${key} at ${references.join(', ')}`
                );
            }
        }
    });
});

async function readCatalogs(): Promise<Catalogs> {
    const source = await readFile(catalogPath, 'utf8');
    const file = ts.createSourceFile(catalogPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const messagesDeclaration = file.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => statement.declarationList.declarations)
        .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'messages');

    assert.ok(messagesDeclaration?.initializer && ts.isObjectLiteralExpression(messagesDeclaration.initializer));
    const catalogs = {} as Catalogs;
    for (const localeProperty of messagesDeclaration.initializer.properties) {
        if (!ts.isPropertyAssignment(localeProperty)) continue;
        const locale = getPropertyName(localeProperty.name);
        if (!locale || !isLocaleName(locale) || !ts.isObjectLiteralExpression(localeProperty.initializer)) continue;
        catalogs[locale] = readCatalog(localeProperty.initializer);
    }

    for (const locale of localeNames) {
        assert.ok(catalogs[locale], `missing ${locale} catalog`);
    }
    return catalogs;
}

function readCatalog(object: ts.ObjectLiteralExpression): Record<string, string> {
    const catalog: Record<string, string> = {};
    for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = getPropertyName(property.name);
        if (!key || !ts.isStringLiteralLike(property.initializer)) continue;
        catalog[key] = property.initializer.text;
    }
    return catalog;
}

async function collectStaticTranslationCalls(root: string): Promise<Map<string, string[]>> {
    const files = await collectSourceFiles(root);
    const calls = new Map<string, string[]>();
    for (const filename of files) {
        if (filename === catalogPath || filename.endsWith('.test.ts') || filename.endsWith('.test.tsx')) continue;
        const source = await readFile(filename, 'utf8');
        const file = ts.createSourceFile(
            filename,
            source,
            ts.ScriptTarget.Latest,
            true,
            source.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        );
        collectCallsFromNode(file, file, calls);
    }
    return calls;
}

function collectCallsFromNode(file: ts.SourceFile, node: ts.Node, calls: Map<string, string[]>): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        const [firstArgument] = node.arguments;
        if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
            const references = calls.get(firstArgument.text) ?? [];
            const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
            references.push(`${path.relative(repositoryRoot, file.fileName)}:${line}`);
            calls.set(firstArgument.text, references);
        }
    }
    ts.forEachChild(node, (child) => collectCallsFromNode(file, child, calls));
}

async function collectSourceFiles(directory: string): Promise<string[]> {
    const entries = await import('node:fs/promises').then(({ readdir }) => readdir(directory, { withFileTypes: true }));
    const files = await Promise.all(
        entries.map(async (entry) => {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) return await collectSourceFiles(filename);
            return /\.tsx?$/.test(entry.name) ? [filename] : [];
        })
    );
    return files.flat();
}

function extractPlaceholders(value: string): string[] {
    return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function getPropertyName(name: ts.PropertyName): string | undefined {
    return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

function isLocaleName(value: string): value is LocaleName {
    return localeNames.includes(value as LocaleName);
}
