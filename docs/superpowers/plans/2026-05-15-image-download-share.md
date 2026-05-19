# 图片下载与分享实现计划

> **给执行代理：** 必须使用子技能：推荐 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项执行本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 在现有“发送到编辑”操作旁补齐图片下载和分享操作；分享链接支持可选访问码和可选有效期。

**架构：** 生成图片字节仍保存在现有存储路径中，分享功能通过 `generated-images/.shares` 下复制出的不可变分享产物对外提供。浏览器结果面板把图片读取职责交给 `src/app/page.tsx`，`src/components/image-output.tsx` 只保留展示和动作入口职责。分享功能使用专门的 App Router 路由创建分享、读取受保护元数据并返回分享图片内容。

**技术栈：** Next.js App Router、React 19、配合 tsx 的 node:test、现有 shadcn/radix UI 基础组件、`src/lib/share-store.ts`、现有 fs/IndexedDB 图片读取路径。

---

## CSE 控制合同

**主目标变量：** 已生成或已选中的单张图片可以下载到本地，也可以通过公开 URL 分享；该 URL 必须强制执行可选访问码和有效期。

**验收标准：**
- 在结果面板的单图视图中，用户能按以下顺序看到动作按钮：可用时显示日志、发送到编辑、下载、分享。
- 下载功能使用当前显示文件名保存当前显示图片的准确字节内容。
- 分享弹窗可以创建无访问码、有访问码、有有效期、同时有访问码和有效期四类链接。
- 访问需要访问码的分享链接时，未提供正确访问码不得暴露图片字节。
- 访问已过期分享链接时不得暴露图片字节。
- API 测试覆盖创建、读取、内容返回的成功路径和失败路径。
- UI 测试或浏览器冒烟测试覆盖按钮可见性和分享弹窗流程。
- 最终验证运行 `npm test`、`npm run lint`、`npm run build`、`git diff --check`；如果本分支完成实现，还要执行 Docker 冒烟验证。

**护栏指标：**
- 不得把受密码保护的 `/api/image/{filename}` 直接暴露为分享机制。
- 不得把 API Key、密码、访问码或原始提示词写入分享 URL。
- 不得破坏 Agent 产物内容路由。
- 不得破坏 `http://localhost:4783` 下无密码本地部署的既有行为。
- 不得静默回退到 mock 图片或伪造分享成功。

**采样计划：**
- L0：每个后端任务后运行定向 node 测试。
- L1：API 和 UI 集成任务后运行 `npm test`。
- L2：端到端接线完成后运行浏览器或 Docker 冒烟测试。

**已知时滞与时滞预算：**
- `npm run build` 和 Docker 重建属于慢反馈门禁；推迟到 L0/L1 稳定后执行。
- 浏览器冒烟测试依赖运行中的应用，可能需要一次开发服务器或 Docker 启动周期。

**恢复目标：**
- 所有改动都是普通源码改动，应能在 10 分钟内通过回滚任务提交或当前 diff 恢复。

**回滚触发器：**
- 如果分享 URL 在未满足访问码或有效期检查时能够暴露图片字节，立即停止并回滚分享路由改动。
- 如果现有图片生成、历史选择或发送到编辑在 L1 测试中回归，停止功能推进并优先修复该回归。

**约束：**
- 当前 `AGENTS.md` 要求中文沟通、基于事实下结论、禁止静默降级，并执行最小充分验证。
- 当前脏工作区包含密码和 cookie 适配相关改动。不要回滚或覆盖无关的用户改动或前序代理改动。
- 保持当前 `node:test` 布局；不要引入第二套测试框架。
- 代码和文档尽量使用 ASCII；不使用 Emoji 或装饰性 Unicode。

**边界：**
- 允许触碰的后端文件：`src/lib/share-store.ts`、`src/lib/share-store.test.ts`、新增 `src/app/api/shares/route.ts`、新增 `src/app/api/shares/[token]/route.ts`、新增 `src/app/api/shares/[token]/content/route.ts`，以及匹配的路由测试。
- 允许触碰的前端文件：`src/app/page.tsx`、`src/components/image-output.tsx`、可选新增 `src/components/share-dialog.tsx`、`src/lib/i18n.tsx`，以及可选测试。
- 允许触碰的文档：本计划；实现后如果行为需要面向用户说明，可补充一小段 README 说明。
- 冻结边界：Agent API schema、现有 `/api/agent/*` 行为、现有 `/api/image/{filename}` 认证契约、数据库 schema。

**耦合说明：**
- 分享创建依赖发送到编辑所使用的同一图片字节读取路径：IndexedDB blob 或 `/api/image/{filename}`。
- 分享内容必须独立于页面密码 cookie；否则外部接收者无法访问有效分享。
- 下载是纯浏览器行为，不应要求新增服务端状态。
- 分享 token 必须由 `crypto.randomBytes` 生成，不得使用 `Math.random`、时间戳或可预测输入派生。
- 访问码为空或纯空白时必须按“无访问码分享”处理；非空访问码必须满足最小长度，避免弱访问码被误认为受保护分享。
- 受访问码保护的分享在元数据路由中不得暴露原始文件名；原始文件名可能包含提示词或业务信息。
- 内容路由必须对错误访问码做基础失败限流，并返回明确的 429，不得允许无限次在线猜测。

**近似有效性：**
- 使用临时 `process.cwd()` 目录的单元测试可以验证 share-store 语义，但不能证明 Docker volume 持久化。
- 浏览器冒烟测试验证 UI 接线，但不验证长期过期行为；过期逻辑由固定 `now` 的确定性单元测试覆盖。
- 内容路由的内存限流只覆盖单进程实例。多实例部署或进程重启会丢失失败计数；如果未来部署到多副本或边缘/CDN 架构，需要改用外部共享存储限流。

**执行器预算：**
- 新增小型 API 路由和聚焦的 UI 动作。
- 复用现有 share-store 基础能力，而不是替换图片存储。
- 实现前围绕契约补充测试。

**风险：**
- 风险 1：分享路由意外暴露原始受保护图片 URL。缓解：只通过分享 token 路由返回复制出的分享产物。
- 风险 2：访问码或有效期只在 UI 层校验。缓解：在服务端路由强制校验，并测试直接 HTTP 路径。
- 风险 3：UI 动作破坏多图网格布局。缓解：在网格视图隐藏或禁用图片动作，并在浏览器中验证按钮几何布局。

## 项目控制拓扑

**总体设计负责人：** 本仓库 `AGENTS.md` 和用户当前指令是参考输入。任何超出本计划的共享路由契约变更都应停止并等待明确确认。

**主落点：** 数据面。本功能改变用户读取和对外暴露生成图片字节的方式。

**次级落点：** 状态面负责 `generated-images/.shares` 下复制出的分享记录；控制面只负责请求时的有效期和访问码决策。

**冻结边界：**
- `/api/agent/*` 契约保持不变。
- 现有生成图片文件名和 `/api/image/{filename}` 校验保持不变。
- 现有历史记录存储形状保持不变，除非后续任务明确证明必须修改。

**复杂性转移账本：**

| 字段 | 内容 |
| --- | --- |
| 复杂性原位置 | 用户目前依赖受保护图片 URL 或本地浏览器 blob 做临时下载/分享。 |
| 新位置 | 分享产物移动到 `generated-images/.shares`，包含元数据、复制字节、访问码哈希和有效期。 |
| 收益 | 外部分享访问不再依赖页面密码 cookie 或浏览器本地 IndexedDB 状态。 |
| 新成本 | 后续必须考虑分享清理和生命周期；分享元数据成为新的文件系统状态面。 |
| 失效模式 | 在后续新增清理任务前，孤立分享文件或过期分享可能持续积累。 |

## 只读调查得到的当前状态

- 证据命令：`rg -n "download|share|Share|Download|handleSendToEdit|api/shares|share-store" src -g "!node_modules"`，并直接读取 `src/lib/share-store.ts`、`src/lib/share-store.test.ts`、`src/components/image-output.tsx` 和 `src/app/page.tsx`。
- `src/lib/share-store.ts` 已实现分享元数据、复制内容、访问码哈希、有效期和路径限制。
- `src/lib/share-store.test.ts` 已覆盖存储模块，包括受保护/公开分享、有效期、不安全 token、当前工作目录和内容路径限制。
- `src/lib/server-runtime.ts` 已导出 `createAccessToken(serverPassword)` 和 `verifyAccessToken(clientAccessToken, serverPassword)`。
- `src/lib/page-password-auth.ts` 已导出 `PAGE_PASSWORD_AUTH_ERROR_CODES.missing` 和 `.invalid`，对应页面密码错误码。
- `src/components/image-output.tsx` 当前导入 `Grid`、`Loader2`、`Send`、`Terminal` 和 `Trash2`；没有下载/分享图标或 props。
- `src/components/image-output.tsx` 的动作行当前只渲染轮播控制、日志和发送到编辑。
- `src/components/image-output.tsx` 当前已有 `isSingleImageView`，定义为 `typeof viewMode === 'number'`。
- `src/app` 当前没有 `api/shares` 路由，也没有 `share/[token]` 页面；`find src/app -path "*shares*" -o -path "*share*"` 无返回路径。
- `src/app/page.tsx` 已知道如何为发送到编辑和历史选择读取已选图片 blob；分享/下载应复用这条路径，而不是新增第二套图片加载来源。
- `package.json` 当前使用 Next.js 16 和 React 19，`React.use(params)` 的 App Router 页面写法与当前技术栈匹配。

## 文件结构

- 修改 `src/lib/share-store.ts`
  - 保留存储基础能力。仅当路由测试需要稳定错误原因时，才增加小型校验 helper。
- 修改 `src/lib/share-store.test.ts`
  - 保留现有测试。仅在缺失时补充支撑路由的边界用例。
- 创建 `src/app/api/shares/route.ts`
  - 接收 multipart 表单数据，包含 `image`、`sourceFilename`、可选 `accessCode`、可选 `expiresInMinutes`。
  - 返回 `{ token, url, expiresAt, accessCodeRequired }`。
- 创建 `src/app/api/shares/route.test.ts`
  - 测试分享创建成功、无效文件、无效有效期，以及响应中不包含原始访问码。
- 创建 `src/app/api/shares/[token]/route.ts`
  - 返回分享页需要的公开元数据：可公开展示的文件名、MIME 类型、大小、createdAt、expiresAt、accessCodeRequired、expired。
  - 对受访问码保护的分享，元数据中的文件名必须脱敏为通用名称。
  - 永不返回 `accessCodeHash` 或 `accessCodeSalt`。
- 创建 `src/app/api/shares/[token]/content/route.ts`
  - 仅当 token 存在、未过期，且需要访问码时访问码有效，才返回图片字节。
  - 对连续错误访问码返回 `429 share_rate_limited`，并设置禁止共享内容被中间层缓存的响应头。
- 创建 `src/app/api/share-route.test.ts`
  - 导入动态路由模块，并用固定临时 cwd 测试元数据/内容行为。
- 创建 `src/app/share/[token]/page.tsx`
  - 渲染一个小型分享查看器。如果需要访问码，先收集访问码再加载图片字节。
- 创建 `src/components/share-dialog.tsx`
  - 受控弹窗，包含访问码、有效期选择、创建按钮和复制链接动作。
- 修改 `src/components/image-output.tsx`
  - 在发送到编辑旁添加下载/分享图标按钮。
  - 不在单图视图时，保持按钮不可见或禁用。
- 修改 `src/app/page.tsx`
  - 添加已选图片 blob 解析器。
  - 添加 `handleDownloadImage` 和 `handleCreateShare`。
  - 将处理函数传给 `ImageOutput`。
- 修改 `src/lib/i18n.tsx`
  - 添加下载、分享、分享弹窗、错误、复制成功所需的中英文短文案。
- 可选创建 `src/components/image-output.test.tsx`
  - 仅当现有工具链已支持 DOM 渲染时创建；否则优先使用浏览器冒烟测试和路由/单元测试。

## 黑盒输入/输出矩阵

| 控制输入 | 目标输出 | 方向 | 外溢风险 |
| --- | --- | --- | --- |
| 使用浏览器 blob URL 添加下载按钮 | 用户可以保存已选图片 | 提升本地导出可用性 | blob 来源错误可能下载到过期或缺失图片 |
| 添加分享创建 API | 用户可以创建分享 URL | 提升外部分享能力 | 如果认证绕过不当，可能暴露受保护图片字节 |
| 添加分享内容路由 | 接收者可以查看有效分享 | 启用公开读取路径 | 不得依赖页面密码 cookie |
| 添加访问码和有效期检查 | 无效接收者无法查看字节 | 降低未授权暴露 | 如果元数据和内容结果不一致，UI 可能变得困惑 |

## 状态模型

分享生命周期：

1. 浏览器弹窗中的 `draft`。
2. 正在把已选图片字节上传到 `/api/shares` 时为 `creating`。
3. 元数据和复制内容写入后为 `active`。
4. 需要访问码且查看者尚未提供有效访问码时为 `locked`。
5. 当 `now >= expiresAt` 时为 `expired`。
6. token 或内容缺失时为 `not_found`。

服务端不变量：

- Token 为 24 个十六进制字符。
- Token 必须来自 `crypto.randomBytes(12)`，保持 96 bit CSPRNG 熵。
- 分享内容路径必须解析到 `generated-images/.shares` 内部。
- 访问码永不明文存储。
- 访问码永不返回给客户端。
- 访问码为空字符串或纯空白时视为未设置；非空访问码长度必须为 8 到 128 字符。
- 已过期分享永不返回图片字节。

## 任务

### 任务 1：锁定分享路由契约

**文件：**
- 创建：`src/app/api/shares/route.test.ts`
- 创建：`src/app/api/share-route.test.ts`

- [x] **步骤 1：编写分享创建的失败测试**

创建 `src/app/api/shares/route.test.ts`：

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { createAccessToken } from '@/lib/server-runtime';
import { POST } from './route';
import { NextRequest } from 'next/server';

const originalAppPassword = process.env.APP_PASSWORD;
let previousCwd: string;
let tempDir: string;

async function withTempCwd() {
    previousCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-route-'));
    process.chdir(tempDir);
}

afterEach(async () => {
    if (previousCwd) process.chdir(previousCwd);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    if (originalAppPassword === undefined) {
        delete process.env.APP_PASSWORD;
    } else {
        process.env.APP_PASSWORD = originalAppPassword;
    }
});

function createShareRequest(form: FormData, options: { accessToken?: string | null } = {}) {
    const headers = new Headers();
    const accessToken = options.accessToken === undefined ? createAccessToken(['customer', 'password'].join('-')) : options.accessToken;
    if (accessToken) headers.set('Cookie', `gptImageAccess=${accessToken}`);
    return new NextRequest('http://localhost/api/shares', { method: 'POST', headers, body: form });
}

describe('POST /api/shares', () => {
    it('creates a share from an uploaded image without returning secrets', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = ['customer', 'password'].join('-');
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('accessCode', '12345678');
        form.set('expiresInMinutes', '60');
        form.set('image', new File([new Uint8Array([1, 2, 3])], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 201);
        const body = await response.json();

        assert.match(body.token, /^[a-f0-9]{24}$/);
        assert.equal(body.accessCodeRequired, true);
        assert.equal(typeof body.url, 'string');
        assert.ok(body.url.includes(`/share/${body.token}`));
        assert.equal('accessCodeHash' in body, false);
        assert.equal('accessCodeSalt' in body, false);
    });

    it('rejects unauthenticated share creation when a page password is configured', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = ['customer', 'password'].join('-');
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([new Uint8Array([1])], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: null }));
        assert.equal(response.status, 401);
        const body = await response.json();
        assert.equal(body.code, PAGE_PASSWORD_AUTH_ERROR_CODES.missing);
    });

    it('rejects share creation with an invalid page access token', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = ['customer', 'password'].join('-');
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([new Uint8Array([1])], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: 'invalid-access-token' }));
        assert.equal(response.status, 401);
        const body = await response.json();
        assert.equal(body.code, PAGE_PASSWORD_AUTH_ERROR_CODES.invalid);
    });

    it('allows share creation when no page password is configured', async () => {
        await withTempCwd();
        delete process.env.APP_PASSWORD;
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('image', new File([new Uint8Array([1])], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form, { accessToken: null }));
        assert.equal(response.status, 201);
    });

    it('treats blank access codes as public shares', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = ['customer', 'password'].join('-');
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('accessCode', '   ');
        form.set('image', new File([new Uint8Array([1])], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 201);
        const body = await response.json();
        assert.equal(body.accessCodeRequired, false);
    });

    it('rejects short access codes', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = ['customer', 'password'].join('-');
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('accessCode', '1234567');
        form.set('image', new File([new Uint8Array([1])], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_access_code');
    });

    it('rejects missing image uploads', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = ['customer', 'password'].join('-');
        const form = new FormData();
        form.set('sourceFilename', 'result.png');

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'image_required');
    });

    it('rejects invalid expiry values', async () => {
        await withTempCwd();
        process.env.APP_PASSWORD = ['customer', 'password'].join('-');
        const form = new FormData();
        form.set('sourceFilename', 'result.png');
        form.set('expiresInMinutes', '-1');
        form.set('image', new File([new Uint8Array([1])], 'result.png', { type: 'image/png' }));

        const response = await POST(createShareRequest(form));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, 'invalid_expiry');
    });
});
```

- [x] **步骤 2：编写分享元数据和内容的失败测试**

创建 `src/app/api/share-route.test.ts`：

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createImageShare } from '@/lib/share-store';
import { GET as getShare } from './shares/[token]/route';
import { POST as getShareContent } from './shares/[token]/content/route';

let previousCwd: string;
let tempDir: string;

async function withTempCwd() {
    previousCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-content-route-'));
    process.chdir(tempDir);
}

function params(token: string) {
    return { params: Promise.resolve({ token }) };
}

afterEach(async () => {
    if (previousCwd) process.chdir(previousCwd);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('share metadata and content routes', () => {
    it('returns public metadata without hashes', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('image-bytes'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: '12345678',
            expiresInMinutes: 60
        });

        const response = await getShare(new Request(`http://localhost/api/shares/${record.token}`), params(record.token));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.token, record.token);
        assert.equal(body.accessCodeRequired, true);
        assert.equal(body.expired, false);
        assert.equal(body.sourceFilename, 'shared-image');
        assert.equal('accessCodeHash' in body, false);
        assert.equal('accessCodeSalt' in body, false);
    });

    it('marks expired metadata without serving content', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('expired-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: undefined,
            expiresInMinutes: null
        });
        const expiredRecord = { ...record, expiresAt: new Date(Date.now() - 60_000).toISOString() };
        await fs.writeFile(path.join(tempDir, 'generated-images', '.shares', `${record.token}.json`), `${JSON.stringify(expiredRecord)}\n`);

        const response = await getShare(new Request(`http://localhost/api/shares/${record.token}`), params(record.token));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.expired, true);
    });

    it('serves protected content only with the correct access code', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('protected-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: '12345678',
            expiresInMinutes: null
        });

        const missing = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, { method: 'POST', body: JSON.stringify({}) }),
            params(record.token)
        );
        assert.equal(missing.status, 401);

        const wrong = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accessCode: 'bad' })
            }),
            params(record.token)
        );
        assert.equal(wrong.status, 401);

        const ok = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accessCode: '12345678' })
            }),
            params(record.token)
        );
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get('content-type'), 'image/png');
        assert.match(ok.headers.get('cache-control') || '', /no-store/);
        assert.equal(ok.headers.get('surrogate-control'), 'no-store');
        assert.equal(await ok.text(), 'protected-image');
    });

    it('rate limits repeated wrong access codes', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('protected-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: '12345678',
            expiresInMinutes: null
        });

        for (let attempt = 0; attempt < 10; attempt += 1) {
            await getShareContent(
                new Request(`http://localhost/api/shares/${record.token}/content`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ accessCode: 'bad-code' })
                }),
                params(record.token)
            );
        }

        const response = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accessCode: 'bad-code' })
            }),
            params(record.token)
        );
        assert.equal(response.status, 429);
    });

    it('does not serve expired content', async () => {
        await withTempCwd();
        const record = await createImageShare({
            imageBuffer: Buffer.from('expired-image'),
            sourceFilename: 'image.png',
            mimeType: 'image/png',
            accessCode: undefined,
            expiresInMinutes: null
        });
        const expiredRecord = { ...record, expiresAt: new Date(Date.now() - 60_000).toISOString() };
        await fs.writeFile(path.join(tempDir, 'generated-images', '.shares', `${record.token}.json`), `${JSON.stringify(expiredRecord)}\n`);

        const response = await getShareContent(
            new Request(`http://localhost/api/shares/${record.token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({})
            }),
            params(record.token)
        );
        assert.equal(response.status, 410);
    });
});
```

- [x] **步骤 3：运行测试并确认失败**

运行：

```bash
npm test -- src/app/api/shares/route.test.ts src/app/api/share-route.test.ts
```

预期：由于 `src/app/api/shares/*` 路由尚不存在，导入失败。

### 任务 2：实现分享 API 路由

**文件：**
- 创建：`src/app/api/shares/route.ts`
- 创建：`src/app/api/shares/[token]/route.ts`
- 创建：`src/app/api/shares/[token]/content/route.ts`

- [x] **步骤 1：添加创建路由**

创建 `src/app/api/shares/route.ts`：

```ts
import { PAGE_PASSWORD_AUTH_ERROR_CODES } from '@/lib/page-password-auth';
import { createImageShare } from '@/lib/share-store';
import { verifyAccessToken } from '@/lib/server-runtime';
import { NextRequest, NextResponse } from 'next/server';

const MAX_SHARE_IMAGE_BYTES = 30 * 1024 * 1024;
const MIN_ACCESS_CODE_LENGTH = 8;
const MAX_ACCESS_CODE_LENGTH = 128;

type UploadedImage = Blob & {
    name?: string;
    type: string;
};

function jsonError(code: string, message: string, status: number) {
    return NextResponse.json({ error: message, code }, { status });
}

function parseExpiry(value: FormDataEntryValue | null): number | null | undefined {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const minutes = Number(value);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60 * 24 * 30) return undefined;
    return minutes;
}

function resolveShareUrl(request: Request, token: string): string {
    const url = new URL(request.url);
    return `${url.origin}/share/${token}`;
}

function isUploadedImage(value: FormDataEntryValue | null): value is UploadedImage {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Blob).arrayBuffer === 'function' &&
        typeof (value as Blob).size === 'number'
    );
}

function parseAccessCode(value: FormDataEntryValue | null): string | undefined | null {
    if (value === null) return undefined;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length < MIN_ACCESS_CODE_LENGTH || trimmed.length > MAX_ACCESS_CODE_LENGTH) return null;
    return trimmed;
}

function verifyShareCreator(request: NextRequest) {
    if (!process.env.APP_PASSWORD) return undefined;
    const accessToken = request.cookies.get('gptImageAccess')?.value;
    if (verifyAccessToken(accessToken, process.env.APP_PASSWORD)) return undefined;
    const code = accessToken ? PAGE_PASSWORD_AUTH_ERROR_CODES.invalid : PAGE_PASSWORD_AUTH_ERROR_CODES.missing;
    return jsonError(code, '未授权：无效的访问令牌。', 401);
}

export async function POST(request: NextRequest) {
    const authError = verifyShareCreator(request);
    if (authError) return authError;

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return jsonError('invalid_form_data', '分享请求格式无效。', 400);
    }

    const image = form.get('image');
    if (!isUploadedImage(image)) {
        return jsonError('image_required', '分享图片必填。', 400);
    }
    if (image.size <= 0 || image.size > MAX_SHARE_IMAGE_BYTES) {
        return jsonError('invalid_image_size', '分享图片大小无效。', 400);
    }

    const sourceFilenameValue = form.get('sourceFilename');
    const fallbackFilename = typeof image.name === 'string' && image.name.trim() ? image.name : 'shared-image.png';
    const sourceFilename = typeof sourceFilenameValue === 'string' && sourceFilenameValue.trim() ? sourceFilenameValue.trim() : fallbackFilename;
    const expiresInMinutes = parseExpiry(form.get('expiresInMinutes'));
    if (expiresInMinutes === undefined) {
        return jsonError('invalid_expiry', '分享有效期无效。', 400);
    }

    const accessCode = parseAccessCode(form.get('accessCode'));
    if (accessCode === null) {
        return jsonError('invalid_access_code', '访问码长度无效。', 400);
    }
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const record = await createImageShare({
        imageBuffer,
        sourceFilename,
        mimeType: typeof image.type === 'string' && image.type ? image.type : 'image/png',
        accessCode,
        expiresInMinutes
    });

    return NextResponse.json(
        {
            token: record.token,
            url: resolveShareUrl(request, record.token),
            expiresAt: record.expiresAt ?? null,
            accessCodeRequired: record.accessCodeRequired
        },
        { status: 201 }
    );
}
```

- [x] **步骤 2：添加元数据路由**

创建 `src/app/api/shares/[token]/route.ts`：

```ts
import { isImageShareExpired, readImageShare } from '@/lib/share-store';
import { NextResponse } from 'next/server';

function jsonError(code: string, message: string, status: number) {
    return NextResponse.json({ error: message, code }, { status });
}

function publicSourceFilename(record: { accessCodeRequired: boolean; sourceFilename: string }): string {
    return record.accessCodeRequired ? 'shared-image' : record.sourceFilename;
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const record = await readImageShare(token);
    if (!record) {
        return jsonError('share_not_found', '分享不存在。', 404);
    }

    return NextResponse.json({
        token: record.token,
        sourceFilename: publicSourceFilename(record),
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt ?? null,
        accessCodeRequired: record.accessCodeRequired,
        expired: isImageShareExpired(record)
    });
}
```

- [x] **步骤 3：添加内容路由**

创建 `src/app/api/shares/[token]/content/route.ts`：

```ts
import { isImageShareExpired, readImageShare, readImageShareContent, verifyImageShareAccess } from '@/lib/share-store';
import { NextResponse } from 'next/server';

const MAX_ACCESS_FAILURES = 10;
const ACCESS_FAILURE_WINDOW_MS = 15 * 60 * 1000;

type AccessFailureState = {
    count: number;
    firstFailedAt: number;
    blockedUntil?: number;
};

const accessFailures = new Map<string, AccessFailureState>();

function jsonError(code: string, message: string, status: number) {
    return NextResponse.json({ error: message, code }, { status });
}

function isAccessBlocked(token: string, now: number): boolean {
    const state = accessFailures.get(token);
    if (!state) return false;
    if (state.blockedUntil && state.blockedUntil > now) return true;
    if (state.blockedUntil && state.blockedUntil <= now) accessFailures.delete(token);
    return false;
}

function recordAccessFailure(token: string, now: number) {
    const current = accessFailures.get(token);
    const state =
        current && now - current.firstFailedAt <= ACCESS_FAILURE_WINDOW_MS ? current : { count: 0, firstFailedAt: now };
    state.count += 1;
    if (state.count >= MAX_ACCESS_FAILURES) {
        state.blockedUntil = now + ACCESS_FAILURE_WINDOW_MS;
    }
    accessFailures.set(token, state);
}

function clearAccessFailure(token: string) {
    accessFailures.delete(token);
}

async function readAccessCode(request: Request): Promise<string | undefined> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return undefined;
    const body = (await request.json().catch(() => ({}))) as { accessCode?: unknown };
    return typeof body.accessCode === 'string' ? body.accessCode : undefined;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const record = await readImageShare(token);
    if (!record) {
        return jsonError('share_not_found', '分享不存在。', 404);
    }
    if (isImageShareExpired(record)) {
        return jsonError('share_expired', '分享已过期。', 410);
    }

    const now = Date.now();
    if (isAccessBlocked(token, now)) {
        return jsonError('share_rate_limited', '访问码尝试次数过多。', 429);
    }

    const accessCode = await readAccessCode(request);
    if (!verifyImageShareAccess(record, accessCode)) {
        recordAccessFailure(token, now);
        return jsonError('share_access_denied', '访问码无效。', 401);
    }
    clearAccessFailure(token);

    const content = await readImageShareContent(record);
    return new NextResponse(content.buffer, {
        status: 200,
        headers: {
            'Content-Type': content.mimeType,
            'Content-Length': content.buffer.length.toString(),
            'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
            'Surrogate-Control': 'no-store'
        }
    });
}
```

- [x] **步骤 4：运行分享路由测试**

运行：

```bash
npm test -- src/app/api/shares/route.test.ts src/app/api/share-route.test.ts
```

预期：通过。

### 任务 3：添加分享查看页

**文件：**
- 创建：`src/app/share/[token]/page.tsx`
- 修改：`src/lib/i18n.tsx`

- [x] **步骤 1：创建客户端分享页**

创建 `src/app/share/[token]/page.tsx`：

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n';
import * as React from 'react';

type ShareMetadata = {
    token: string;
    sourceFilename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    expiresAt: string | null;
    accessCodeRequired: boolean;
    expired: boolean;
};

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
    const { t } = useI18n();
    const resolvedParams = React.use(params);
    const token = resolvedParams.token;
    const [metadata, setMetadata] = React.useState<ShareMetadata | null>(null);
    const [accessCode, setAccessCode] = React.useState('');
    const [imageUrl, setImageUrl] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isUnlocking, setIsUnlocking] = React.useState(false);
    const imageUrlRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        let active = true;
        const loadMetadata = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await fetch(`/api/shares/${token}`);
                const body = await response.json();
                if (!response.ok) {
                    throw new Error(body.error || t('share.loadFailed'));
                }
                if (active) setMetadata(body as ShareMetadata);
            } catch (err) {
                if (active) setError(err instanceof Error ? err.message : t('share.loadFailed'));
            } finally {
                if (active) setIsLoading(false);
            }
        };

        void loadMetadata();
        return () => {
            active = false;
        };
    }, [token, t]);

    React.useEffect(() => {
        return () => {
            if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        };
    }, []);

    const loadImage = React.useCallback(async () => {
        setIsUnlocking(true);
        setError(null);
        try {
            const response = await fetch(`/api/shares/${token}/content`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(accessCode.trim() ? { accessCode: accessCode.trim() } : {})
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || t('share.unlockFailed'));
            }
            if (!response.headers.get('content-type')?.startsWith('image/')) {
                throw new Error(t('share.unlockFailed'));
            }
            const blob = await response.blob();
            const nextUrl = URL.createObjectURL(blob);
            if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
            imageUrlRef.current = nextUrl;
            setImageUrl(nextUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('share.unlockFailed'));
        } finally {
            setIsUnlocking(false);
        }
    }, [accessCode, t, token]);

    React.useEffect(() => {
        if (!metadata || metadata.expired || metadata.accessCodeRequired || imageUrl) return;
        void loadImage();
    }, [imageUrl, loadImage, metadata]);

    return (
        <main className='bg-background text-foreground flex min-h-screen items-center justify-center p-6'>
            <section className='w-full max-w-3xl space-y-4'>
                <div>
                    <h1 className='text-2xl font-semibold'>{t('share.pageTitle')}</h1>
                    {metadata ? <p className='text-muted-foreground mt-2 text-sm'>{metadata.sourceFilename}</p> : null}
                </div>
                {isLoading ? <p className='text-muted-foreground'>{t('share.loading')}</p> : null}
                {error ? <p className='text-destructive text-sm'>{error}</p> : null}
                {metadata?.expired ? <p className='text-destructive text-sm'>{t('share.expired')}</p> : null}
                {metadata && metadata.accessCodeRequired && !imageUrl && !metadata.expired ? (
                    <form
                        className='flex max-w-sm gap-2'
                        onSubmit={(event) => {
                            event.preventDefault();
                            void loadImage();
                        }}>
                        <Input
                            value={accessCode}
                            onChange={(event) => setAccessCode(event.target.value)}
                            placeholder={t('share.accessCodePlaceholder')}
                            type='password'
                        />
                        <Button type='submit' disabled={isUnlocking || accessCode.trim().length === 0}>
                            {t('share.unlock')}
                        </Button>
                    </form>
                ) : null}
                {imageUrl ? (
                    <div className='relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted'>
                        <img src={imageUrl} alt={metadata?.sourceFilename || t('share.imageAlt')} className='h-full w-full object-contain' />
                    </div>
                ) : null}
            </section>
        </main>
    );
}
```

- [x] **步骤 2：添加 i18n 文案**

修改 `src/lib/i18n.tsx`，把这些 key 添加到两个语言映射中：

```ts
'share.pageTitle': '图片分享',
'share.loading': '正在加载分享信息...',
'share.loadFailed': '加载分享失败。',
'share.unlockFailed': '打开分享失败。',
'share.expired': '这个分享已过期。',
'share.unlock': '打开',
'share.accessCodePlaceholder': '输入访问码',
'share.imageAlt': '分享图片',
```

英文：

```ts
'share.pageTitle': 'Shared Image',
'share.loading': 'Loading share details...',
'share.loadFailed': 'Failed to load share.',
'share.unlockFailed': 'Failed to open share.',
'share.expired': 'This share has expired.',
'share.unlock': 'Open',
'share.accessCodePlaceholder': 'Enter access code',
'share.imageAlt': 'Shared image',
```

- [x] **步骤 3：运行页面类型构建门禁**

运行：

```bash
npm run build
```

预期：构建成功，并包含 `/share/[token]`。

### 任务 4：添加下载和分享 UI 接线

**文件：**
- 创建：`src/components/share-dialog.tsx`
- 修改：`src/components/image-output.tsx`
- 修改：`src/app/page.tsx`
- 修改：`src/lib/i18n.tsx`

- [x] **步骤 1：创建分享弹窗组件**

创建 `src/components/share-dialog.tsx`：

```tsx
'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import { Copy, Loader2 } from 'lucide-react';
import * as React from 'react';

export type ShareDialogValues = {
    accessCode: string;
    expiresInMinutes: number | null;
};

type ShareDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isCreating: boolean;
    shareUrl: string | null;
    error: string | null;
    onCreate: (values: ShareDialogValues) => void;
};

const expiryOptions = [
    { value: 'none', minutes: null },
    { value: '60', minutes: 60 },
    { value: '1440', minutes: 1440 },
    { value: '10080', minutes: 10080 }
] as const;

export function ShareDialog({ open, onOpenChange, isCreating, shareUrl, error, onCreate }: ShareDialogProps) {
    const { t } = useI18n();
    const [accessCode, setAccessCode] = React.useState('');
    const [expiry, setExpiry] = React.useState('none');
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        if (!open) {
            setCopied(false);
        }
    }, [open]);

    const selectedExpiry = expiryOptions.find((option) => option.value === expiry) ?? expiryOptions[0];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('share.dialogTitle')}</DialogTitle>
                    <DialogDescription>{t('share.dialogDescription')}</DialogDescription>
                </DialogHeader>
                <div className='grid gap-4'>
                    <div className='grid gap-2'>
                        <Label htmlFor='share-access-code'>{t('share.accessCode')}</Label>
                        <Input
                            id='share-access-code'
                            value={accessCode}
                            onChange={(event) => setAccessCode(event.target.value)}
                            placeholder={t('share.accessCodeOptional')}
                        />
                    </div>
                    <div className='grid gap-2'>
                        <Label>{t('share.expiry')}</Label>
                        <Select value={expiry} onValueChange={setExpiry}>
                            <SelectTrigger className='w-full'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value='none'>{t('share.expiryNone')}</SelectItem>
                                <SelectItem value='60'>{t('share.expiryOneHour')}</SelectItem>
                                <SelectItem value='1440'>{t('share.expiryOneDay')}</SelectItem>
                                <SelectItem value='10080'>{t('share.expirySevenDays')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {error ? <p className='text-destructive text-sm'>{error}</p> : null}
                    {shareUrl ? (
                        <div className='grid gap-2'>
                            <Label>{t('share.link')}</Label>
                            <div className='flex gap-2'>
                                <Input value={shareUrl} readOnly />
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='icon'
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(shareUrl);
                                        setCopied(true);
                                    }}
                                    aria-label={t('share.copyLink')}>
                                    <Copy className='h-4 w-4' />
                                </Button>
                            </div>
                            {copied ? <p className='text-sm text-emerald-600'>{t('common.copied')}</p> : null}
                        </div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button
                        type='button'
                        onClick={() => onCreate({ accessCode, expiresInMinutes: selectedExpiry.minutes })}
                        disabled={isCreating}>
                        {isCreating ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
                        {t('share.create')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
```

- [x] **步骤 2：给图片输出组件添加动作 props**

修改 `src/components/image-output.tsx`。当前组件已有 `isSingleImageView`；如果执行时发现变量名已变化，先按实际代码调整，不要新增重复状态。

```tsx
import { Download, Grid, Loader2, Send, Share2, Terminal, Trash2 } from 'lucide-react';
```

添加 props：

```ts
onDownloadImage: (filename: string) => void;
onShareImage: (filename: string) => void;
```

添加解构：

```ts
onDownloadImage,
onShareImage,
```

添加处理函数：

```ts
const handleDownloadClick = () => {
    if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
        onDownloadImage(imageBatch[viewMode].filename);
    }
};

const handleShareClick = () => {
    if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
        onShareImage(imageBatch[viewMode].filename);
    }
};
```

添加 `canUseImageActions`：

```ts
const canUseImageActions = !isLoading && isSingleImageView && imageBatch && imageBatch[viewMode];
```

把两个按钮按 DOM 顺序放在发送到编辑按钮之后：先下载，再分享，确保最终动作顺序为“日志、发送到编辑、下载、分享”。

```tsx
<Button
    variant='outline'
    size='sm'
    onClick={handleDownloadClick}
    disabled={!canUseImageActions}
    className={cn(
        'shrink-0 disabled:opacity-50',
        showCarousel && viewMode === 'grid' ? 'invisible' : 'visible'
    )}>
    <Download className='mr-2 h-4 w-4' />
    {t('output.download')}
</Button>
<Button
    variant='outline'
    size='sm'
    onClick={handleShareClick}
    disabled={!canUseImageActions}
    className={cn(
        'shrink-0 disabled:opacity-50',
        showCarousel && viewMode === 'grid' ? 'invisible' : 'visible'
    )}>
    <Share2 className='mr-2 h-4 w-4' />
    {t('output.share')}
</Button>
```

- [x] **步骤 3：添加页面 blob 解析器和下载/分享处理函数**

修改 `src/app/page.tsx`。

导入弹窗：

```ts
import { ShareDialog, type ShareDialogValues } from '@/components/share-dialog';
```

添加状态：

```ts
const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
const [shareTargetFilename, setShareTargetFilename] = React.useState<string | null>(null);
const [shareUrl, setShareUrl] = React.useState<string | null>(null);
const [shareError, setShareError] = React.useState<string | null>(null);
const [isCreatingShare, setIsCreatingShare] = React.useState(false);
```

添加共享解析器：

```ts
const resolveImageBlob = React.useCallback(
    async (filename: string): Promise<Blob> => {
        if (effectiveStorageModeClient === 'indexeddb') {
            const record = allDbImages?.find((img) => img.filename === filename);
            if (!record?.blob) {
                throw new Error(t('error.imageNotFoundDb', { filename }));
            }
            return record.blob;
        }

        if (!(await refreshImageAccessCookie())) {
            throw new Error(t('error.imageAccessRefreshFailed'));
        }
        const response = await fetch(`/api/image/${filename}`);
        if (!response.ok) {
            throw new Error(t('error.fetchImage', { statusText: response.statusText }));
        }
        return response.blob();
    },
    [allDbImages, effectiveStorageModeClient, refreshImageAccessCookie, t]
);
```

添加下载：

```ts
const handleDownloadImage = React.useCallback(
    async (filename: string) => {
        try {
            const blob = await resolveImageBlob(filename);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 150);
        } catch (error) {
            setError(createErrorNotice(error instanceof Error ? error.message : t('error.retrieveImage', { filename })));
        }
    },
    [createErrorNotice, resolveImageBlob, t]
);
```

添加打开分享和创建分享逻辑：

```ts
const handleOpenShareImage = React.useCallback((filename: string) => {
    setShareTargetFilename(filename);
    setShareUrl(null);
    setShareError(null);
    setShareDialogOpen(true);
}, []);

const handleCreateShare = React.useCallback(
    async (values: ShareDialogValues) => {
        if (!shareTargetFilename) return;
        setIsCreatingShare(true);
        setShareError(null);
        try {
            const blob = await resolveImageBlob(shareTargetFilename);
            const form = new FormData();
            form.set('sourceFilename', shareTargetFilename);
            form.set('image', new File([blob], shareTargetFilename, { type: blob.type || 'image/png' }));
            const accessCode = values.accessCode.trim();
            if (accessCode) {
                form.set('accessCode', accessCode);
            }
            if (typeof values.expiresInMinutes === 'number') {
                form.set('expiresInMinutes', String(values.expiresInMinutes));
            }

            const response = await fetch('/api/shares', { method: 'POST', body: form });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.error || t('share.createFailed'));
            }
            setShareUrl(body.url);
        } catch (error) {
            setShareError(error instanceof Error ? error.message : t('share.createFailed'));
        } finally {
            setIsCreatingShare(false);
        }
    },
    [resolveImageBlob, shareTargetFilename, t]
);
```

在其他顶层弹窗附近渲染分享弹窗：

```tsx
<ShareDialog
    open={shareDialogOpen}
    onOpenChange={setShareDialogOpen}
    isCreating={isCreatingShare}
    shareUrl={shareUrl}
    error={shareError}
    onCreate={handleCreateShare}
/>
```

向 `ImageOutput` 传递 props：

```tsx
onDownloadImage={handleDownloadImage}
onShareImage={handleOpenShareImage}
```

- [x] **步骤 4：添加动作和弹窗 i18n 文案**

修改 `src/lib/i18n.tsx`。

中文：

```ts
'output.download': '下载',
'output.share': '分享',
'share.dialogTitle': '分享图片',
'share.dialogDescription': '创建一个可访问的图片链接，可以设置访问码和有效期。',
'share.accessCode': '访问码',
'share.accessCodeOptional': '留空表示不需要访问码',
'share.expiry': '有效期',
'share.expiryNone': '永久有效',
'share.expiryOneHour': '1 小时',
'share.expiryOneDay': '1 天',
'share.expirySevenDays': '7 天',
'share.link': '分享链接',
'share.copyLink': '复制分享链接',
'share.create': '创建分享',
'share.createFailed': '创建分享失败。',
'error.imageAccessRefreshFailed': '无法刷新图片访问权限，请重新输入密码后再试。',
```

英文：

```ts
'output.download': 'Download',
'output.share': 'Share',
'share.dialogTitle': 'Share Image',
'share.dialogDescription': 'Create an image link with an optional access code and expiry.',
'share.accessCode': 'Access Code',
'share.accessCodeOptional': 'Leave blank for no access code',
'share.expiry': 'Expiry',
'share.expiryNone': 'Never expires',
'share.expiryOneHour': '1 hour',
'share.expiryOneDay': '1 day',
'share.expirySevenDays': '7 days',
'share.link': 'Share link',
'share.copyLink': 'Copy share link',
'share.create': 'Create Share',
'share.createFailed': 'Failed to create share.',
'error.imageAccessRefreshFailed': 'Unable to refresh image access. Enter the password again and retry.',
```

- [x] **步骤 5：运行前端验证**

运行：

```bash
npm run lint
npm run build
```

预期：两项都通过。

### 任务 5：端到端验证

**文件：**
- 除非验证发现缺陷，否则不改代码。

- [x] **步骤 1：运行完整本地门禁**

运行：

```bash
npm test
npm run lint
npm run build
git diff --check
```

预期：
- `npm test`：全部测试通过；除非已配置，否则 PostgreSQL live 测试可以继续跳过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。

- [x] **步骤 2：启动应用用于浏览器冒烟测试**

如果 4783 上没有运行中的服务：

```bash
npm run dev
```

如果需要 Docker 验证：

```bash
docker compose up -d --build
```

预期：应用可通过 `http://localhost:4783` 访问。

- [x] **步骤 3：浏览器冒烟测试**

使用内置 Browser 访问 `http://localhost:4783`：

- 生成一张图片，或选择已有历史图片。
- 切换到单图视图。
- 确认发送到编辑、下载和分享按钮可见且没有重叠。
- 点击下载，并确认浏览器启动文件下载，或产生有效的 object URL 点击路径。
- 点击分享，创建无访问码分享，打开返回 URL，确认图片渲染。
- 创建带访问码的分享，打开返回 URL，确认输入访问码前图片不渲染，输入正确访问码后图片渲染。

- [x] **步骤 4：分享路由直接 HTTP 冒烟测试**

通过生成的一字节 PNG payload 创建受保护分享，然后测试元数据、错误访问码和正确访问码，执行直接路由冒烟测试：

```bash
node --input-type=module <<'NODE'
import crypto from 'node:crypto';

async function resolveAccessCookie() {
    if (!process.env.APP_PASSWORD) return '';
    const passwordHash = crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest('hex');
    const response = await fetch('http://localhost:4783/api/auth-verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passwordHash })
    });
    if (!response.ok) {
        throw new Error(`auth-verify failed: ${response.status} ${await response.text()}`);
    }
    const cookie = response.headers.get('set-cookie');
    if (!cookie) throw new Error('auth-verify did not return an access cookie');
    return cookie.split(';')[0];
}

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luz7wgAAAABJRU5ErkJggg==';
const blob = new Blob([Buffer.from(pngBase64, 'base64')], { type: 'image/png' });
const form = new FormData();
form.set('sourceFilename', 'smoke.png');
form.set('accessCode', 'smoke-code');
form.set('expiresInMinutes', '60');
form.set('image', new File([blob], 'smoke.png', { type: 'image/png' }));

const headers = new Headers();
const accessCookie = await resolveAccessCookie();
if (accessCookie) headers.set('Cookie', accessCookie);

const createResponse = await fetch('http://localhost:4783/api/shares', { method: 'POST', headers, body: form });
const createBody = await createResponse.json();
console.log('create', createResponse.status, createBody);

const metadataResponse = await fetch(`http://localhost:4783/api/shares/${createBody.token}`);
console.log('metadata', metadataResponse.status, await metadataResponse.json());

const wrongResponse = await fetch(`http://localhost:4783/api/shares/${createBody.token}/content`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessCode: 'wrong' })
});
console.log('wrong', wrongResponse.status, await wrongResponse.text());

const okResponse = await fetch(`http://localhost:4783/api/shares/${createBody.token}/content`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessCode: 'smoke-code' })
});
console.log('ok', okResponse.status, okResponse.headers.get('content-type'), (await okResponse.arrayBuffer()).byteLength);
NODE
```

预期：
- 创建接口返回 `201`，包含 24 字符十六进制 token，且不包含访问码 hash 或 salt。
- 元数据接口返回 `200`。
- 错误访问码返回 `401`。
- 正确访问码返回图片内容，content type 为图片类型，且字节长度非零。

- [x] **步骤 5：复核 diff 范围**

运行：

```bash
git diff --name-only
git status --short
```

预期：
- Diff 只包含计划内文件，以及任何预先存在的无关脏文件。
- 不要回滚预先存在的无关改动。

## 自审清单

- 规格覆盖：下载按钮、分享按钮、访问码、有效期、接收者直接访问、Docker/浏览器验证都已映射到任务。
- 占位符扫描：没有任务使用 `TBD`、`TODO`、`implement later`、`fill in details` 或尖括号命令占位符。
- 类型一致性：分享弹窗返回 `ShareDialogValues`，页面处理函数接收相同类型，分享路由返回 `accessCodeRequired` 和 `url`。
- 边界检查：Agent API 保持冻结；分享功能使用新的 `/api/shares` 路由和复制出的分享产物。
- 门禁边界：单元/API 测试证明服务端契约；浏览器/Docker 冒烟测试证明运行时 UI 接线。
