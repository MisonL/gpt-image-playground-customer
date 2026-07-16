# WebUI Image Auto Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 WebUI 文件系统图片增加默认关闭、启用后保留 30 天的自动清理，并证明 Agent API 四种请求方式生成的产物不会被提前删除且仍由 Agent TTL 回收。

**Architecture:** 新增纯文件清理模块和运行时调度模块。清理器扫描输出目录顶层合法图片，并从 Agent 状态库读取 artifact 路径作为保护集合；启动入口先完成 Agent 回收，再启动默认关闭的 6 小时清理调度。运行能力接口只读取非敏感配置与最近运行摘要。

**Tech Stack:** Next.js 16 instrumentation、TypeScript、Node.js `fs/promises`、`node:test`、SQLite、Postgres、Docker Compose。

---

## File Map

- Create: `src/lib/webui-image-cleanup.ts`，负责严格配置解析、候选筛选、删除和运行结果类型。
- Create: `src/lib/webui-image-cleanup.test.ts`，覆盖配置、文件边界、Agent 保护和失败结果。
- Create: `src/lib/webui-image-cleanup-runtime.ts`，负责启动执行、6 小时调度、去重注册和最近状态。
- Create: `src/lib/webui-image-cleanup-runtime.test.ts`，覆盖默认关闭、立即执行、重复注册与失败观测。
- Modify: `src/lib/agent-state-store.ts`，增加 artifact 文件路径只读枚举契约。
- Modify: `src/lib/agent-state-memory.ts`、`src/lib/agent-state-sqlite.ts`、`src/lib/agent-state-postgres.ts`，实现同一枚举契约。
- Modify: `src/lib/agent-state-memory.test.ts`、`src/lib/agent-state-sqlite.test.ts`、`src/lib/agent-state-postgres.test.ts`，锁定三种后端行为或 SQL 契约。
- Modify: `src/instrumentation.ts`、`src/lib/agent-state-runtime.test.ts`，接入启动调度并保持启动失败可见。
- Modify: `src/app/api/runtime-capabilities/route.ts`、`src/app/api/runtime-capabilities/route.test.ts`，暴露非敏感清理状态。
- Modify: `src/app/api/agent/agent-routes.test.ts`，覆盖四种上游请求方式的 artifact 登记和 TTL 清理契约。
- Modify: `.env.example`、`README.md`、`CHANGELOG.md`，记录默认关闭、30 天保留和 Agent 隔离规则。

### Task 1: Agent Artifact Protection Contract

**Files:**
- Modify: `src/lib/agent-state-store.ts:75`
- Modify: `src/lib/agent-state-memory.ts:233`
- Modify: `src/lib/agent-state-sqlite.ts:352`
- Modify: `src/lib/agent-state-postgres.ts:293`
- Test: `src/lib/agent-state-memory.test.ts`
- Test: `src/lib/agent-state-sqlite.test.ts`
- Test: `src/lib/agent-state-postgres.test.ts`

- [ ] **Step 1: Write failing memory and SQLite enumeration tests**

Save two artifacts and require sorted unique paths:

```ts
await store.saveArtifacts([
    buildArtifact({ id: 'artifact-b', filepath: path.join(tempDir, 'generated-images', 'b.png') }),
    buildArtifact({ id: 'artifact-a', filepath: path.join(tempDir, 'generated-images', 'a.png') })
]);

assert.deepEqual(await store.listArtifactFilepaths(), [
    path.join(tempDir, 'generated-images', 'a.png'),
    path.join(tempDir, 'generated-images', 'b.png')
]);
```

- [ ] **Step 2: Add a failing Postgres SQL contract test**

```ts
const source = readFileSync(new URL('./agent-state-postgres.ts', import.meta.url), 'utf8');
assert.match(source, /SELECT DISTINCT filepath FROM agent_artifacts ORDER BY filepath ASC/);
```

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- src/lib/agent-state-memory.test.ts src/lib/agent-state-sqlite.test.ts src/lib/agent-state-postgres.test.ts
```

Expected: FAIL because `listArtifactFilepaths` does not exist.

- [ ] **Step 4: Add the interface and three implementations**

```ts
listArtifactFilepaths(): Promise<string[]>;
```

Memory uses a sorted set. SQLite and Postgres use `SELECT DISTINCT filepath FROM agent_artifacts ORDER BY filepath ASC`. No request JSON, prompts, IDs, or credentials are returned.

- [ ] **Step 5: Run tests and verify GREEN**

Run Step 3 again. Expected: selected tests pass; live Postgres cases remain skipped when `AGENT_POSTGRES_TEST_DATABASE_URL` is absent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-state-store.ts src/lib/agent-state-memory.ts src/lib/agent-state-sqlite.ts src/lib/agent-state-postgres.ts src/lib/agent-state-memory.test.ts src/lib/agent-state-sqlite.test.ts src/lib/agent-state-postgres.test.ts
git commit -m "feat(storage): expose protected agent artifact paths"
```

### Task 2: Cleanup Configuration and File Selection

**Files:**
- Create: `src/lib/webui-image-cleanup.ts`
- Create: `src/lib/webui-image-cleanup.test.ts`

- [ ] **Step 1: Write failing configuration tests**

```ts
assert.deepEqual(readWebuiImageCleanupConfig({}), {
    enabled: false,
    retentionDays: 30,
    intervalMs: 6 * 60 * 60 * 1000
});
assert.deepEqual(readWebuiImageCleanupConfig({ WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true' }), {
    enabled: true,
    retentionDays: 30,
    intervalMs: 6 * 60 * 60 * 1000
});
assert.throws(
    () => readWebuiImageCleanupConfig({ WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'invalid' }),
    /WEBUI_IMAGE_AUTO_CLEANUP_ENABLED/
);
assert.throws(
    () => readWebuiImageCleanupConfig({
        WEBUI_IMAGE_AUTO_CLEANUP_ENABLED: 'true',
        WEBUI_IMAGE_RETENTION_DAYS: '0'
    }),
    /WEBUI_IMAGE_RETENTION_DAYS/
);
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/lib/webui-image-cleanup.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict configuration parsing**

```ts
export const WEBUI_IMAGE_DEFAULT_RETENTION_DAYS = 30;
export const WEBUI_IMAGE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type WebuiImageCleanupConfig = {
    enabled: boolean;
    retentionDays: number;
    intervalMs: number;
};

export function readWebuiImageCleanupConfig(
    env: Record<string, string | undefined>
): WebuiImageCleanupConfig;
```

Accept `1/true/yes/on` and `0/false/no/off`; reject other non-empty values. Parse retention with `readPositiveIntegerFromEnv` only when enabled, otherwise report the 30-day default.

- [ ] **Step 4: Run configuration tests and verify GREEN**

Run Step 2 again. Expected: configuration cases pass.

- [ ] **Step 5: Write failing cleanup boundary tests**

Create a temporary output directory with:

- one old valid WebUI image;
- one new valid image;
- one old valid Agent-protected image;
- one old invalid filename;
- one old image under `.shares/`;
- one symbolic link to an old file outside the directory.

```ts
const result = await cleanupExpiredWebuiImages({
    outputDir,
    retentionDays: 30,
    protectedArtifactFilepaths: [protectedPath],
    now: new Date('2026-07-16T00:00:00.000Z')
});
```

Assert only the old unprotected valid top-level image is deleted and all result counts are exact.

- [ ] **Step 6: Verify cleanup tests are RED**

```bash
npm test -- src/lib/webui-image-cleanup.test.ts
```

Expected: FAIL because `cleanupExpiredWebuiImages` is missing.

- [ ] **Step 7: Implement minimal cleanup**

```ts
export type WebuiImageCleanupRun = {
    status: 'succeeded' | 'failed';
    startedAt: string;
    completedAt: string;
    cutoffAt: string;
    scannedCount: number;
    protectedCount: number;
    deletedCount: number;
    failedCount: number;
    failures: Array<{ filename: string; message: string }>;
};

export async function cleanupExpiredWebuiImages(input: {
    outputDir: string;
    retentionDays: number;
    protectedArtifactFilepaths: readonly string[];
    now?: Date;
}): Promise<WebuiImageCleanupRun>;
```

Use `readdir(..., { withFileTypes: true })`, `lstat`, `isValidImageFilename`, `path.resolve`, and `unlink`. Skip directories and symbolic links. Continue after per-file failures, record only sanitized filename and message, and mark the run failed when `failedCount > 0`.

- [ ] **Step 8: Add deterministic deletion-failure coverage and verify GREEN**

Inject narrow filesystem operations so one candidate fails while another is deleted. Assert visible failure details and continued processing.

```bash
npm test -- src/lib/webui-image-cleanup.test.ts
```

Expected: all cleanup tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/webui-image-cleanup.ts src/lib/webui-image-cleanup.test.ts
git commit -m "feat(storage): add guarded webui image cleanup"
```

### Task 3: Runtime Scheduling and Capability Observability

**Files:**
- Create: `src/lib/webui-image-cleanup-runtime.ts`
- Create: `src/lib/webui-image-cleanup-runtime.test.ts`
- Modify: `src/instrumentation.ts:1`
- Modify: `src/lib/agent-state-runtime.test.ts`
- Modify: `src/app/api/runtime-capabilities/route.ts:18`
- Modify: `src/app/api/runtime-capabilities/route.test.ts:18`

- [ ] **Step 1: Write failing scheduler tests**

```ts
const disabled = await startWebuiImageCleanupScheduler({
    env: {},
    runCleanup,
    setInterval: fakeSetInterval,
    logger
});
assert.equal(disabled.enabled, false);
assert.equal(cleanupCalls, 0);
assert.equal(intervalCalls, 0);
```

For enabled configuration, assert one immediate cleanup, one 6-hour interval, `unref()`, and no duplicate timer after a second start. Reset module state after every test.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/lib/webui-image-cleanup-runtime.test.ts
```

Expected: FAIL because the runtime module is missing.

- [ ] **Step 3: Implement runtime state and scheduling**

```ts
export async function runWebuiImageCleanupNow(
    env?: Record<string, string | undefined>,
    now?: Date
): Promise<WebuiImageCleanupRun | undefined>;

export async function startWebuiImageCleanupScheduler(
    options?: SchedulerOptions
): Promise<WebuiImageCleanupSummary>;
export function getWebuiImageCleanupSummary(
    env?: Record<string, string | undefined>
): WebuiImageCleanupSummary;
export function resetWebuiImageCleanupRuntimeForTests(): void;
```

`runWebuiImageCleanupNow` calls `ensureAgentStateStoreReady`, then `listArtifactFilepaths`, then the cleanup core with `outputDir`. Top-level errors update `lastError` and rethrow. Periodic callbacks catch and log errors to avoid unhandled rejections while preserving failed status.

- [ ] **Step 4: Run scheduler tests and verify GREEN**

Run Step 2 again. Expected: all scheduler cases pass and no referenced timer survives test cleanup.

- [ ] **Step 5: Write failing instrumentation tests**

Require startup ordering:

```ts
assert.deepEqual(events, ['agent-recovery', 'webui-cleanup-start']);
```

Also assert cleanup startup failures are logged and reject.

- [ ] **Step 6: Wire instrumentation and pass tests**

Call the cleanup scheduler only after Agent startup recovery succeeds, retaining the `NEXT_RUNTIME === 'nodejs'` guard.

```bash
npm test -- src/lib/agent-state-runtime.test.ts src/lib/webui-image-cleanup-runtime.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Write failing capability tests**

```ts
assert.deepEqual(body.webuiImageCleanup, {
    enabled: false,
    retentionDays: 30,
    intervalMs: 21_600_000,
    running: false
});
```

Add enabled and sanitized recent-run cases.

- [ ] **Step 8: Expose capability and pass tests**

Add `webuiImageCleanup: getWebuiImageCleanupSummary(process.env)`. Invalid enabled configuration must produce HTTP 500, and summaries must not expose filesystem paths.

```bash
npm test -- src/app/api/runtime-capabilities/route.test.ts src/lib/webui-image-cleanup-runtime.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/instrumentation.ts src/lib/agent-state-runtime.test.ts src/lib/webui-image-cleanup-runtime.ts src/lib/webui-image-cleanup-runtime.test.ts src/app/api/runtime-capabilities/route.ts src/app/api/runtime-capabilities/route.test.ts
git commit -m "feat(runtime): schedule webui image retention cleanup"
```

### Task 4: Four Agent Request Mode Lifecycle Matrix

**Files:**
- Modify: `src/app/api/agent/agent-routes.test.ts`
- Test: `src/lib/webui-image-cleanup.test.ts`

- [ ] **Step 1: Add a four-mode persistence matrix**

```ts
const modes = [
    'images-non-stream',
    'images-sse',
    'responses-non-stream',
    'responses-sse'
] as const;
```

Use local Images JSON, Images SSE, Responses JSON, and Responses SSE fixtures. For each mode assert:

```ts
assert.equal(response.status, 200);
assert.equal(body.execution.channel_request_mode, mode);
const artifactPath = readStoredArtifactFilepath(artifactId);
await access(artifactPath);
assert.ok((await store.listArtifactFilepaths()).includes(artifactPath));
```

- [ ] **Step 2: Run matrix and verify RED for missing coverage**

```bash
npm test -- --test-name-pattern="registers cleanup-managed artifacts for every request mode" src/app/api/agent/agent-routes.test.ts
```

Expected before fixtures are complete: FAIL for any mode that does not produce or register an artifact, especially Responses non-stream.

- [ ] **Step 3: Complete only the failing fixture or production path**

Do not add protocol fallback. Every mode must use its named protocol and then flow through shared `persistOpenAiImages` and `saveAgentExecutionArtifacts`. If production already satisfies the contract, only add the missing test fixture.

- [ ] **Step 4: Add protection and Agent TTL assertions**

Backdate each artifact file beyond 30 days while its Agent request remains active. Run WebUI cleanup with `store.listArtifactFilepaths()` and assert the file remains. Purge after `expiresAt` and assert artifact metadata and file are removed.

- [ ] **Step 5: Run matrix and verify GREEN**

Run Step 2 again. Expected: four subcases pass using their exact selected modes.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agent/agent-routes.test.ts src/lib/webui-image-cleanup.test.ts
git commit -m "test(agent): cover image cleanup across request modes"
```

### Task 5: Documentation, Full Gates, and Docker Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document configuration**

```dotenv
# WebUI 文件图片自动清理默认关闭。启用后默认保留 30 天。
# WEBUI_IMAGE_AUTO_CLEANUP_ENABLED=false
# WEBUI_IMAGE_RETENTION_DAYS=30
```

README must distinguish WebUI retention from `AGENT_REQUEST_TTL_SECONDS`, describe protected Agent paths, and state that existing unregistered top-level images are treated as WebUI images when enabled.

- [ ] **Step 2: Format and check the diff**

```bash
npx prettier --write "src/lib/webui-image-cleanup*.ts" "src/instrumentation.ts" "src/app/api/runtime-capabilities/route*.ts" "src/app/api/agent/agent-routes.test.ts"
git diff --check
```

Expected: exit 0.

- [ ] **Step 3: Run full verification**

```bash
npm run verify
npx tsc --noEmit
```

Expected: all tests, lint, script syntax, build, diff, and TypeScript checks pass.

- [ ] **Step 4: Commit docs**

```bash
git add .env.example README.md CHANGELOG.md
git commit -m "docs: document webui image retention controls"
```

- [ ] **Step 5: Rebuild Docker**

```bash
docker compose up -d --build
docker compose ps
```

Expected: `gpt-image-playground-customer` is `Up` on port `4783` with zero restarts.

- [ ] **Step 6: Verify default-off live HTTP**

```bash
curl -fsS http://127.0.0.1:4783/api/runtime-capabilities | jq '.webuiImageCleanup'
```

Expected:

```json
{
  "enabled": false,
  "retentionDays": 30,
  "intervalMs": 21600000,
  "running": false
}
```

- [ ] **Step 7: Verify enabled cleanup in isolation**

Use a temporary `IMAGE_OUTPUT_DIR` with `WEBUI_IMAGE_AUTO_CLEANUP_ENABLED=true`. Confirm an old WebUI fixture is deleted while a protected Agent fixture remains. Do not enable cleanup against the deployed `generated-images/` directory.

- [ ] **Step 8: Final audit**

```bash
git status --short --branch
git log --oneline -8
docker inspect gpt-image-playground-customer --format 'status={{.State.Status}} restart={{.RestartCount}} image={{.Image}}'
```

Expected: worktree clean, commits are atomic, container is running with zero restarts, and current Docker remains default-off.
