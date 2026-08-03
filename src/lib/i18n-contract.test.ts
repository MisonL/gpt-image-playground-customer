import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const sourceRoot = path.join(repositoryRoot, 'src');
const catalogPath = path.join(sourceRoot, 'lib', 'i18n.tsx');
const webUiRoots = [path.join(sourceRoot, 'app'), path.join(sourceRoot, 'components')];
const localeNames = ['zh-CN', 'en-US'] as const;
const userVisibleAttributeNames = new Set([
    'alt',
    'aria-label',
    'aria-description',
    'aria-valuetext',
    'description',
    'label',
    'placeholder',
    'title'
]);

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

    it('updates browser metadata through localized catalog entries', async () => {
        const [catalogs, source] = await Promise.all([readCatalogs(), readFile(catalogPath, 'utf8')]);

        for (const locale of localeNames) {
            assert.ok(catalogs[locale]['meta.title'], `missing ${locale} metadata title`);
            assert.ok(catalogs[locale]['meta.description'], `missing ${locale} metadata description`);
        }
        assert.match(source, /const title = t\('meta\.title'\)/);
        assert.match(source, /document\.title = title/);
        assert.match(source, /const descriptionContent = t\('meta\.description'\)/);
        assert.match(source, /description\.content = descriptionContent/);
        assert.match(source, /new MutationObserver\(scheduleMetadataSync\)/);
        assert.match(source, /metadataObserver\.observe\(document\.head/);
        assert.match(source, /attributeFilter: \['content'\]/);
    });

    it('defines localized language names for every selectable locale', async () => {
        const catalogs = await readCatalogs();

        assert.equal(catalogs['zh-CN']['app.languageChinese'], '简体中文');
        assert.equal(catalogs['zh-CN']['app.languageEnglish'], 'English');
        assert.equal(catalogs['en-US']['app.languageChinese'], 'Simplified Chinese');
        assert.equal(catalogs['en-US']['app.languageEnglish'], 'English');
    });

    it('does not hardcode natural-language WebUI text in JSX', async () => {
        const violations = (await Promise.all(webUiRoots.map(collectUserVisibleTextViolations))).flat();

        assert.deepEqual(violations, []);
    });

    it('uses concrete save-mask language for the persisted mask flow', async () => {
        const catalogs = await readCatalogs();

        assert.match(catalogs['zh-CN']['ux.disabledUnsavedMask'], /保存/);
        assert.match(catalogs['zh-CN']['alert.saveMaskBeforeSubmit'], /保存/);
        assert.equal(catalogs['zh-CN']['edit.saveMask'], '保存蒙版');
        assert.match(catalogs['en-US']['ux.disabledUnsavedMask'], /^Save /);
        assert.match(catalogs['en-US']['alert.saveMaskBeforeSubmit'], /^Save /);
        assert.equal(catalogs['en-US']['edit.saveMask'], 'Save mask');
    });

    it('does not expose optional-plural notation in English WebUI copy', async () => {
        const catalogs = await readCatalogs();
        const optionalPluralValues = Object.values(catalogs['en-US']).filter((value) => /\b\w+\(s\)/.test(value));

        assert.deepEqual(optionalPluralValues, []);
    });

    it('keeps automatic-cleanup protection copy aligned with local-history clearing behavior', async () => {
        const catalogs = await readCatalogs();

        assert.match(catalogs['zh-CN']['retention.hint'], /手动删除会移除服务器图片/);
        assert.match(catalogs['zh-CN']['retention.hint'], /清空历史只会清除当前浏览器中的记录/);
        assert.match(catalogs['en-US']['retention.hint'], /Manual deletion removes the server image/);
        assert.match(catalogs['en-US']['retention.hint'], /clearing history only clears records in this browser/);
    });

    it('distinguishes browser-only history clearing from IndexedDB image deletion', async () => {
        const catalogs = await readCatalogs();

        assert.match(catalogs['zh-CN']['confirm.clearHistoryFs'], /服务器图片不会被删除/);
        assert.match(catalogs['en-US']['confirm.clearHistoryFs'], /Server images will not be deleted/);
        assert.match(catalogs['zh-CN']['confirm.clearHistoryIndexedDb'], /永久删除已存储图片/);
        assert.match(catalogs['en-US']['confirm.clearHistoryIndexedDb'], /permanently delete all stored images/);
    });

    it('states edit upload format and size limits in both locales', async () => {
        const catalogs = await readCatalogs();

        assert.match(catalogs['zh-CN']['edit.referenceEmpty'], /PNG、JPEG、WebP/);
        assert.match(catalogs['zh-CN']['edit.referenceHint'], /singleLimit/);
        assert.match(catalogs['zh-CN']['edit.referenceTotalLimit'], /总大小/);
        assert.match(catalogs['zh-CN']['edit.responsesInputLimit'], /参考图和蒙版/);
        assert.match(catalogs['zh-CN']['edit.maskHint'], /透明区域/);
        assert.match(catalogs['en-US']['edit.referenceEmpty'], /PNG, JPEG, and WebP/);
        assert.match(catalogs['en-US']['edit.referenceHint'], /singleLimit/);
        assert.match(catalogs['en-US']['edit.referenceTotalLimit'], /together cannot exceed/);
        assert.match(catalogs['en-US']['edit.responsesInputLimit'], /reference images and the mask/);
        assert.match(catalogs['en-US']['edit.maskHint'], /transparent areas/);
    });

    it('keeps English edit upload summaries independent of trailing translation whitespace', async () => {
        const catalogs = await readCatalogs();
        const english = catalogs['en-US'];

        for (const key of ['edit.referenceTotalLimit', 'edit.referenceNoTotalLimit']) {
            assert.equal(english[key], english[key].trimEnd(), `${key} must not carry layout whitespace`);
        }
        assert.match(english['edit.referenceHint'], /per image\. \{totalHint\} Add the image/);
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

async function collectUserVisibleTextViolations(root: string): Promise<string[]> {
    const files = await collectSourceFiles(root);
    const violations: string[] = [];
    for (const filename of files) {
        if (!filename.endsWith('.tsx') || filename.endsWith('.test.tsx')) continue;
        const source = await readFile(filename, 'utf8');
        const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        collectUserVisibleTextViolationsFromNode(file, file, violations);
    }
    return violations;
}

function collectUserVisibleTextViolationsFromNode(file: ts.SourceFile, node: ts.Node, violations: string[]): void {
    if (ts.isJsxText(node)) {
        reportVisibleTextViolation(file, node, node.text, violations);
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression)) {
        reportVisibleTextViolation(file, node, node.expression.text, violations);
    }
    if (ts.isJsxAttribute(node) && userVisibleAttributeNames.has(node.name.text)) {
        const value = getStaticJsxAttributeValue(node);
        if (value !== undefined) reportVisibleTextViolation(file, node, value, violations);
    }
    ts.forEachChild(node, (child) => collectUserVisibleTextViolationsFromNode(file, child, violations));
}

function getStaticJsxAttributeValue(attribute: ts.JsxAttribute): string | undefined {
    if (!attribute.initializer) return undefined;
    if (ts.isStringLiteralLike(attribute.initializer)) return attribute.initializer.text;
    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
        return ts.isStringLiteralLike(attribute.initializer.expression)
            ? attribute.initializer.expression.text
            : undefined;
    }
    return undefined;
}

function reportVisibleTextViolation(file: ts.SourceFile, node: ts.Node, value: string, violations: string[]): void {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || !/[A-Za-z\u4e00-\u9fff]/.test(text) || isAllowedTechnicalUiText(text)) return;
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    violations.push(`${path.relative(repositoryRoot, file.fileName)}:${line} ${JSON.stringify(text)}`);
}

function isAllowedTechnicalUiText(value: string): boolean {
    return (
        value === 'x' ||
        value === 'sRGB' ||
        value === 'sk-...' ||
        value === 'https://api.openai.com/v1' ||
        value === 'OPENAI_RESPONSES_API_MODEL' ||
        /^OPENAI_[A-Z0-9_]+=$/.test(value) ||
        /^gpt-image-[\w.-]+:?$/.test(value)
    );
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
