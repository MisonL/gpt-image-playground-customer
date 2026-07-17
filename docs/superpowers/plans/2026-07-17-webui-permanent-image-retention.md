# WebUI 永久图片保留 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 为文件系统 WebUI 图片提供批量永久保存标记，排除自动清理，并让清理摘要在 Docker 独立 Next 工作进程间可见。

**Architecture:** 在 generated-images/.webui-state/webui-image-retention.sqlite 建立独立 SQLite 状态库，保存永久文件名和已脱敏清理摘要。自动清理、页面 API 和 React 页面都通过该状态库协作；浏览器只保存临时选择状态。

**Tech Stack:** Next.js 16 Route Handlers、React 19、TypeScript、better-sqlite3、node:test、Radix Checkbox、lucide-react、Docker Compose。

---

## 文件结构

- 新建 src/lib/webui-image-retention-store.ts 和 src/lib/webui-image-retention-store.test.ts：永久标记和摘要的唯一持久化边界。
- 新建 src/app/api/image-retention/route.ts 和 src/app/api/image-retention/route.test.ts：页面 API、鉴权和批量文件校验。
- 修改 src/lib/webui-image-cleanup-runtime.ts 和测试：持久化清理摘要、合并永久保护路径。
- 修改 src/app/api/image-delete/route.ts 和新建测试：手动删除同步移除标记。
- 修改 src/components/history-panel.tsx、测试、src/app/page.tsx、页面回归测试和 src/lib/i18n.tsx：选择模式和批量交互。
- 修改 README.md、.env.example、CHANGELOG.md：记录永久保存边界。

### Task 1: 建立 WebUI SQLite 状态库

**Files:**
- Create: src/lib/webui-image-retention-store.ts
- Create: src/lib/webui-image-retention-store.test.ts

- [ ] **Step 1: 写入失败测试**

    it('persists batch permanent filenames and cleanup summaries across store instances', async () => {
        const first = new SqliteWebuiImageRetentionStore(dbPath);
        await first.init();
        await first.preserve([firstFilename, secondFilename]);
        await first.writeCleanupStatus({ lastRun: publicRun });

        const second = new SqliteWebuiImageRetentionStore(dbPath);
        await second.init();
        assert.deepEqual(await second.listPermanentFilenames(), [firstFilename, secondFilename]);
        assert.deepEqual(await second.readCleanupStatus(), { lastRun: publicRun });
    });

- [ ] **Step 2: 确认测试失败**

Run: npm test -- src/lib/webui-image-retention-store.test.ts

Expected: FAIL，提示状态库模块或类尚不存在。

- [ ] **Step 3: 实现最小存储接口和 SQLite schema**

    export type WebuiImageRetentionAction = 'preserve' | 'release';

    export type PersistedWebuiImageCleanupStatus = {
        lastRun?: PublicWebuiImageCleanupRun;
        lastError?: string;
    };

    export class SqliteWebuiImageRetentionStore {
        constructor(private readonly dbPath: string) {}

        async init(): Promise<void> {
            fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('busy_timeout = 5000');
            this.db.exec(WEBUI_IMAGE_RETENTION_SCHEMA);
        }
    }

创建 webui_image_retention(filename PRIMARY KEY, saved_at) 和单行 webui_image_cleanup_status。实现 preserve、release、remove、listPermanentFilenames、writeCleanupStatus、readCleanupStatus；批量更新放在 SQLite transaction 中。状态库路径由 resolveImageOutputDir(env) 派生，固定为 .webui-state/webui-image-retention.sqlite。

- [ ] **Step 4: 扩展状态库测试**

    it('releases stale markers without requiring the image file to exist', async () => {
        await store.preserve([firstFilename]);
        await store.release([firstFilename]);
        assert.deepEqual(await store.listPermanentFilenames(), []);
    });

    it('does not persist failure filenames or absolute paths in cleanup status', async () => {
        await store.writeCleanupStatus({ lastRun: publicRun });
        assert.equal(JSON.stringify(await store.readCleanupStatus()).includes('/private/generated-images'), false);
    });

- [ ] **Step 5: 验证并提交**

Run: npm test -- src/lib/webui-image-retention-store.test.ts && npx tsc --noEmit

Expected: PASS.

    git add src/lib/webui-image-retention-store.ts src/lib/webui-image-retention-store.test.ts
    git commit -m "feat(storage): add webui image retention state"

### Task 2: 持久化清理摘要并接入永久保护集合

**Files:**
- Modify: src/lib/webui-image-cleanup-runtime.ts
- Modify: src/lib/webui-image-cleanup-runtime.test.ts
- Modify: src/app/api/runtime-capabilities/route.ts
- Modify: src/app/api/runtime-capabilities/route.test.ts

- [ ] **Step 1: 运行现有跨进程摘要 RED 用例**

Run: npm test -- src/lib/webui-image-cleanup-runtime.test.ts --test-name-pattern='reads a persisted cleanup summary'

Expected: FAIL，summary.lastRun 为 undefined；该测试已经在工作树中，禁止先修改生产实现。

- [ ] **Step 2: 将公开摘要写入状态库**

    const retentionStore = await getWebuiImageRetentionStore(env);
    await retentionStore.writeCleanupStatus({ lastRun: toPublicRun(result) });

    const persisted = await readWebuiImageCleanupStatus(env);
    return {
        enabled: config.enabled,
        retentionDays: config.retentionDays,
        intervalMs: config.intervalMs,
        running,
        ...(lastRun ?? persisted.lastRun ? { lastRun: lastRun ?? persisted.lastRun } : {}),
        ...(lastError ?? persisted.lastError ? { lastError: lastError ?? persisted.lastError } : {})
    };

将 getWebuiImageCleanupSummary 改为 Promise<WebuiImageCleanupSummary>，并在 runtime-capabilities 路由中 await 它。成功后写入 lastRun；清理异常或 timer 注册失败时写入固定 CLEANUP_FAILURE_MESSAGE，并保留上次成功 lastRun。读写状态库失败必须抛出，不能静默丢失摘要。

- [ ] **Step 3: 合并 Agent 与永久保存保护路径**

    const permanentFilenames = await retentionStore.listPermanentFilenames();
    const permanentFilepaths = permanentFilenames.map((filename) => path.join(resolveImageOutputDir(env), filename));
    const agentFilepaths = await agentStore.listArtifactFilepaths();
    return cleanupExpiredWebuiImages({
        outputDir: resolveImageOutputDir(env),
        retentionDays,
        protectedArtifactFilepaths: [...agentFilepaths, ...permanentFilepaths],
        now
    });

- [ ] **Step 4: 补测试并验证**

    it('keeps permanently saved files in the cleanup protection set', async () => {
        await retentionStore.preserve([oldFilename]);
        const result = await runWebuiImageCleanupNow(env, now);
        assert.equal(result?.protectedCount, 1);
        await access(path.join(outputDir, oldFilename));
    });

Run: npm test -- src/lib/webui-image-cleanup-runtime.test.ts src/app/api/runtime-capabilities/route.test.ts

Expected: PASS，摘要中没有 failures、文件名或绝对路径。

- [ ] **Step 5: 提交**

    git add src/lib/webui-image-cleanup-runtime.ts src/lib/webui-image-cleanup-runtime.test.ts src/app/api/runtime-capabilities/route.ts src/app/api/runtime-capabilities/route.test.ts
    git commit -m "fix(runtime): persist webui cleanup summaries"

### Task 3: 新增永久保存 API 并同步手动删除

**Files:**
- Create: src/app/api/image-retention/route.ts
- Create: src/app/api/image-retention/route.test.ts
- Modify: src/app/api/image-delete/route.ts
- Create: src/app/api/image-delete/route.test.ts

- [ ] **Step 1: 写入 API 失败测试**

    it('preserves valid top-level files in one batch and reports invalid files', async () => {
        const response = await POST(jsonRequest({
            action: 'preserve',
            filenames: [validFilename, '../outside.png', missingFilename]
        }));
        assert.equal(response.status, 207);
        assert.deepEqual((await response.json()).results, [
            { filename: validFilename, success: true },
            { filename: '../outside.png', success: false, error: '文件名格式无效。' },
            { filename: missingFilename, success: false, error: '文件不存在。' }
        ]);
    });

- [ ] **Step 2: 确认测试失败**

Run: npm test -- src/app/api/image-retention/route.test.ts

Expected: FAIL，因为 API 路由尚不存在。

- [ ] **Step 3: 实现 GET、POST、鉴权和路径安全**

    const MAX_RETENTION_BATCH_SIZE = 100;

    type RetentionRequestBody = {
        action: 'preserve' | 'release';
        filenames: string[];
        passwordHash?: string;
    };

    export async function POST(request: NextRequest) {
        const body = await readRetentionRequest(request);
        await assertPageAuthorized(body.passwordHash);
        const results = await applyRetentionRequest(body);
        return NextResponse.json({ results }, { status: results.every((item) => item.success) ? 200 : 207 });
    }

复制 image-delete 的 APP_PASSWORD 哈希校验语义。preserve 必须通过 isValidImageFilename、path.dirname(resolved) === outputDir、lstat().isFile() 和 !lstat().isSymbolicLink()；release 可删除不存在文件的旧标记。GET 仅返回 { filenames: string[] }。

- [ ] **Step 4: 删除成功后移除标记**

    await fs.unlink(filepath);
    await retentionStore.remove([filename]);
    deletionResults.push({ filename, success: true });

标记移除失败必须使该文件的删除结果显式失败，避免前端误报完全成功。

- [ ] **Step 5: 验证并提交**

Run: npm test -- src/app/api/image-retention/route.test.ts src/app/api/image-delete/route.test.ts

Expected: PASS，覆盖未授权、100 张上限、部分成功、符号链接、release 缺失文件和删除同步。

    git add src/app/api/image-retention src/app/api/image-delete/route.ts src/app/api/image-delete/route.test.ts
    git commit -m "feat(api): manage permanent webui image retention"

### Task 4: 在历史面板实现选择模式和批量动作

**Files:**
- Modify: src/components/history-panel.tsx
- Modify: src/components/history-panel.test.tsx
- Modify: src/lib/i18n.tsx

- [ ] **Step 1: 写入 HistoryPanel 失败测试**

    it('renders permanent-save selection controls only for fs history when cleanup is enabled', () => {
        const html = renderHistoryPanel([fsHistoryItem, indexedDbHistoryItem], [], [], false, {
            cleanupEnabled: true,
            permanentlySavedFilenames: new Set([fsHistoryItem.images[0].filename])
        });
        assert.match(html, /aria-label="选择最近生成图片"/);
        assert.match(html, /aria-label="已永久保存"/);
    });

- [ ] **Step 2: 确认测试失败**

Run: npm test -- src/components/history-panel.test.tsx --test-name-pattern='permanent-save selection'

Expected: FAIL，因为 HistoryPanelProps 尚无清理状态与永久保存集合。

- [ ] **Step 3: 增加受控 props 和局部选择状态**

    type HistoryPanelProps = {
        cleanupEnabled?: boolean;
        permanentlySavedFilenames?: ReadonlySet<string>;
        onUpdatePermanentSave?: (action: 'preserve' | 'release', filenames: string[]) => Promise<void>;
    };

    const [isSelectingRetention, setIsSelectingRetention] = React.useState(false);
    const [selectedRetentionFilenames, setSelectedRetentionFilenames] = React.useState<Set<string>>(() => new Set());

只收集 storageModeUsed === 'fs' 的单个图片文件名；失败项和 IndexedDB 项不提供勾选。进入选择模式后显示 Checkbox；已永久保存图显示 Bookmark 标记；切换 Tab、退出选择模式和成功操作后清空选择。

- [ ] **Step 4: 实现固定批量栏和国际化文案**

    {isSelectingRetention ? (
        <div className='border-border bg-background sticky bottom-0 z-20 flex min-h-14 items-center gap-2 border-t px-3 py-2'>
            <span className='text-muted-foreground mr-auto text-xs'>{t('retention.selectedCount', { count })}</span>
            <Button disabled={count === 0 || isUpdatingRetention} onClick={() => void submitRetention('preserve')}>
                <Bookmark className='h-3.5 w-3.5' />
                {t('retention.preserve')}
            </Button>
            <Button variant='outline' disabled={count === 0 || isUpdatingRetention} onClick={() => void submitRetention('release')}>
                {t('retention.release')}
            </Button>
        </div>
    ) : null}

新增 retention.select、retention.exitSelection、retention.preserve、retention.release、retention.permanentlySaved、retention.selectedCount、retention.hint、retention.updateFailed 的中英文翻译。

- [ ] **Step 5: 验证并提交**

Run: npm test -- src/components/history-panel.test.tsx

Expected: PASS，覆盖禁用时隐藏入口、fs 与 indexeddb 分流、多图历史、已保存标记、选择数和移动端底栏类名。

    git add src/components/history-panel.tsx src/components/history-panel.test.tsx src/lib/i18n.tsx
    git commit -m "feat(ui): batch permanent image retention controls"

### Task 5: 在页面协调运行时能力与永久保存 API

**Files:**
- Modify: src/app/page.tsx
- Modify: src/app/page-regressions.test.tsx

- [ ] **Step 1: 写入页面失败契约测试**

    it('loads permanent filenames only when fs cleanup is enabled and forwards batch actions to HistoryPanel', async () => {
        const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
        assert.match(source, /fetch\('\/api\/image-retention'\)/);
        assert.match(source, /onUpdatePermanentSave=/);
        assert.match(source, /webuiImageCleanup\?\.enabled/);
    });

- [ ] **Step 2: 确认测试失败**

Run: npm test -- src/app/page-regressions.test.tsx --test-name-pattern='permanent filenames'

Expected: FAIL，因为页面尚未读取永久保存状态。

- [ ] **Step 3: 实现加载与批量回调**

    const [permanentlySavedFilenames, setPermanentlySavedFilenames] = React.useState<Set<string>>(() => new Set());
    const cleanupEnabled = runtimeCapabilities?.webuiImageCleanup?.enabled === true;

    const updatePermanentSave = React.useCallback(async (action: 'preserve' | 'release', filenames: string[]) => {
        const response = await fetch('/api/image-retention', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, filenames, ...(clientPasswordHash ? { passwordHash: clientPasswordHash } : {}) })
        });
        const body = await response.json();
        if (!response.ok && response.status !== 207) throw new Error(body.error || t('retention.updateFailed'));
        setPermanentlySavedFilenames((current) => mergeRetentionResults(current, action, body.results));
        if (body.results.some((result: { success: boolean }) => !result.success)) throw new Error(t('retention.partialUpdateFailed'));
    }, [clientPasswordHash, t]);

仅在 cleanupEnabled 且存在 fs 历史时请求 GET；使用 AbortController 防止卸载后更新状态。成功手动删除图片后也从本地集合移除对应文件名。

- [ ] **Step 4: 验证并提交**

Run: npm test -- src/app/page-regressions.test.tsx src/components/history-panel.test.tsx

Expected: PASS。

    git add src/app/page.tsx src/app/page-regressions.test.tsx
    git commit -m "feat(page): sync permanent image retention state"

### Task 6: 文档、全量门禁与 Docker 实测

**Files:**
- Modify: .env.example
- Modify: README.md
- Modify: CHANGELOG.md
- Modify: docs/superpowers/specs/2026-07-17-webui-permanent-image-retention-design.md

- [ ] **Step 1: 补齐文档**

README 说明永久保存仅在启用 WebUI 自动清理且使用文件系统存储时可用；用户可在“最近生成”批量设置或取消；手动删除同步移除标记；Agent artifact 生命周期不受影响。.env.example 保持自动清理默认关闭和 30 天默认值，不新增永久保存开关。

- [ ] **Step 2: 运行定向验证**

Run: npm test -- src/lib/webui-image-retention-store.test.ts src/lib/webui-image-cleanup.test.ts src/lib/webui-image-cleanup-runtime.test.ts src/app/api/image-retention/route.test.ts src/app/api/image-delete/route.test.ts src/app/api/runtime-capabilities/route.test.ts src/components/history-panel.test.tsx src/app/page-regressions.test.tsx

Run: npx tsc --noEmit

Run: npm run lint

Run: npm run lint:scripts

Run: git diff --check

Expected: 全部 PASS。

- [ ] **Step 3: 运行完整门禁**

Run: npm run verify

Expected: 输出 ok: true，测试、lint、脚本检查、生产构建和 diff 检查全部通过。

- [ ] **Step 4: Docker 隔离验证**

在临时输出目录启动隔离容器，创建一张 31 天前的普通图片和一张 31 天前的永久保存图片，重启后执行：

    curl -fsS http://127.0.0.1:4783/api/runtime-capabilities | jq '.webuiImageCleanup.lastRun'
    curl -fsS http://127.0.0.1:4783/api/image-retention

Expected: 普通图片已删除，永久保存图片仍存在，lastRun.deletedCount 与 protectedCount 可跨工作进程读取，响应不包含绝对路径或文件名。

- [ ] **Step 5: 提交文档收尾**

    git add .env.example README.md CHANGELOG.md docs/superpowers/specs/2026-07-17-webui-permanent-image-retention-design.md
    git commit -m "docs: document permanent webui image retention"
    git status --short --branch

Expected: 只保留本功能的原子提交；不提交 generated-images、.webui-state、日志、截图或临时 Docker 文件。
