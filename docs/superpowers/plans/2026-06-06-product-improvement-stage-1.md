# Product Improvement Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use Markdown task-list syntax for tracking.

**Goal:** 收窄并完善 GPT Image Playground 的第一阶段产品闭环，让产品从“能力集合”收敛为可验证、可部署、可解释的本地和内网 AI 图片创作工作台，同时保留 Agent API 作为明确的自动化接口。

**Architecture:** 本阶段不重写核心生图链路，先用文档、默认值、门禁和小型 UI/API 调整收束产品控制面。主产品线锁定为“本地/内网高分辨率图片生成与编辑工作台”，Agent API 保持机器调用入口但不包装成自治 Agent，公网分享与 HF Space 部署按更保守的安全默认值处理。

**Tech Stack:** Next.js 16 App Router, React 19, node:test, tsx, ESLint, existing npm scripts, Hugging Face Docker Space docs.

---

## Control Contract

**Primary Setpoint:** 第一阶段完成后，仓库内存在一套一致的产品合同、验证脚本和默认安全行为，能证明“中文创作工作台”主线、分享安全默认值、公网部署门禁和 Agent API 边界已经收敛。

**Acceptance:**
- `docs/product/product-contract.md` 明确第一用户、非目标用户、核心路径、上线边界、指标和 The Mom Test 验证脚本。
- `README.md`、`客户使用说明.md`、`docs/ui/literary-young-women-workbench-design.md`、`docs/deployment/huggingface-space-free.md` 对产品定位、Agent API、分享和公网部署的说法一致。
- 分享弹窗默认不再是“无访问码且永不过期”的最宽公开状态，服务端创建接口继续强制访问码长度、有效期和图片内容校验。
- HF Space 或公网部署文档和检查脚本明确提示 `APP_PASSWORD` 与 `AGENT_API_TOKEN`，并将未配置状态标为不适合公网客户使用。
- Agent 文案统一为 `Agent API` 或 `automation API`，不暗示具备自治执行、跨实例持久队列或生产级调度能力。
- 最终运行 `npm test`、`npm run lint`、`npm run lint:scripts`、`npm run build`、`git diff --check`，并记录结果。

**Guardrail Metrics:**
- 不破坏 `/api/images`、`/api/agent/*`、`/api/shares/*` 现有响应契约。
- 不把任何真实 API Key、token、访问码或个人配置写入源码或文档。
- 不把离线测试通过表述成真实 OpenAI、真实 HF Space 或真实客户验证通过。
- 不新增静默降级、mock 成功路径或吞没错误后继续的逻辑。
- 不引入第二套测试框架。

**Sampling Plan:**
- L0: 每个任务完成后运行对应文件的定向测试或静态检查。
- L1: 涉及 UI/API 接线后运行 `npm test` 和 `npm run lint`。
- L2: 收尾运行完整本地门禁；若触碰 HF Space 部署脚本，再运行 `npm run smoke:hf-space` 或明确记录未执行原因。

**Delay Budget:**
- `npm test` 和 lint 属于快速门禁，本阶段每个相关代码任务后执行。
- `npm run build` 属于慢 gate，安排在文档和代码收敛后执行。
- 真实 HF Space、真实上游生图、真实客户访谈不在本阶段自动执行；只建立可执行脚本、文档和验收表。

**Recovery Target:** 如果某个任务引入回归，先停止后续任务，在 10 分钟内通过当前任务 diff 回退到上一个验证通过状态。

**Rollback Trigger:**
- 分享内容路由在访问码错误或过期后仍能返回图片字节。
- 公网部署文档或脚本鼓励无访问码使用服务端 API Key。
- Agent 文档声明超过现有能力的自治执行、跨实例持久队列或生产调度。
- `npm test`、`npm run lint`、`npm run build` 出现与当前任务相关的失败且无法在任务内修复。

**Constraints:**
- 全程中文沟通。
- 代码、注释、日志和 Markdown 不使用 Emoji 或装饰性 Unicode 符号。
- 不修改与本阶段目标无关的 UI 视觉细节、模型兼容逻辑、数据库 schema 或 Agent API schema。
- 当前仓库没有任务跟踪文件，以用户本回合指定的产品完善任务为唯一任务来源。

**Boundary:**
- Allowed docs: `docs/product/product-contract.md`, `docs/product/user-validation-script.md`, `docs/ui/literary-young-women-workbench-design.md`, `docs/deployment/huggingface-space-free.md`, `README.md`, `客户使用说明.md`.
- Allowed UI/lib files: `src/components/share-dialog.tsx`, `src/lib/share-client.ts`, `src/lib/i18n.tsx`.
- Allowed API/tests: `src/app/api/shares/route.ts`, `src/app/api/shares/route.test.ts`, `src/app/api/share-route.test.ts`, targeted share client or UI tests if needed.
- Allowed scripts/docs gates: `scripts/doctor-hf-space.mjs`, `scripts/hf-space-doctor-utils.mjs`, matching `*.test.mjs`, `scripts/verify.mjs` only if a gate integration is necessary.
- Frozen: `/api/agent/*` schema, image generation request/response schema, database schema, core upstream routing, cost calculation semantics.

**Coupling Notes:**
- 分享默认值 touches UI state, client form submission, server validation, and route tests.
- HF Space safety touches deployment docs and doctor diagnostics, but should not change runtime auth semantics without separate approval.
- Product contract touches README and UI design docs, but must not create a second product truth that conflicts with code.

**Approximation Validity:**
- node:test route tests validate local API semantics and in-memory/filesystem behavior, not multi-instance distributed rate limiting.
- Documentation and validation scripts can make customer research repeatable, but do not count as completed customer research.
- HF Space doctor tests can validate configuration warnings, not prove a deployed Space is production-ready.

**Actuator Budget:**
- Documentation edits, localized copy edits, small UI default changes, route tests, doctor warning tests, and verification scripts.
- No broad redesign, no schema migration, no new database, no external analytics service, no new auth system.

**Risks:**
- Risk 1: Product contract becomes another stale document. Mitigation: link it from README and UI design baseline, and make it the source for product-stage decisions.
- Risk 2: Safer sharing defaults reduce convenience. Mitigation: keep no-access-code sharing available as an explicit user choice, but make the risk visible.
- Risk 3: Public deployment checks become too strict for local use. Mitigation: scope warnings to public/HF deployment docs and doctor output, not local dev startup.

## State Estimate

- `main` is clean and matches `origin/main` at `34b982e Release v2.0.0` before this planning branch was created.
- Current branch for this work: `codex/product-improvement-planning-only`.
- Existing UI PRD defines `图像手记` as a Chinese creative workbench and names a visual audience, but does not define measurable first-user outcomes.
- Existing README also positions the repo as a local `gpt-image-2` service, compatible API probe, Agent API, and HF Space deployment artifact.
- Existing share route already validates creator auth when `APP_PASSWORD` exists, image type, access code length, expiry range and content MIME type.
- Existing share UI defaults to no access code and no expiry.
- Existing HF Space docs already warn that free tier memory state and temporary image files are not persistent.

## Execution Record

- Stage 1 implementation completed on branch `codex/product-improvement-planning-only`.
- Implementation commits:
  - `896d4a4 docs: define product contract and validation`
  - `9e36e11 fix: make image sharing defaults safer`
  - `c6cc4cc docs: tighten public deployment and agent boundary`
  - `9efcda8 docs: record product stage one gate`
- Final local gate executed on the completed branch: `npm run verify` returned `"ok": true`.
- Targeted share gates executed on the completed branch:
  - `node --test --import tsx src/components/share-dialog.test.tsx` returned 2 pass.
  - `node --test --import tsx src/app/api/shares/route.test.ts` returned 21 pass.
- HF Space diagnostic gate executed on the completed branch: `npm run doctor:hf-space` returned `ok: true` and confirmed `remote-secrets` contains `APP_PASSWORD` and `AGENT_API_TOKEN`.
- `npm run deploy:space` was not executed because the plan marks deployment as optional unless explicitly requested; this remains a residual external deployment gate in `docs/reviews/CR-PRODUCT-STAGE-1-GATE-2026-06-06.md`.

## Follow-up Addendum

- Current branch follow-up narrows the first battle to Chinese content operators generating first publish visuals for Xiaohongshu or e-commerce workflows.
- Local result feedback markers were added to recent history items so the latest generation can be marked `可用` or `需修改` inside the workbench history.
- Fresh local browser verification on `http://localhost:4784` confirmed the result feedback block renders on a recent history card with `结果反馈`, `可用` and `需修改` actions.
- Public deployment docs now require `npm run deploy:space` plus a real browser check for customer-visible use, or an explicit residual note if that external gate is not executed.
- Agent skill docs now keep Agent API in the automation lane and out of the first-battle proof path.

## File Structure

- Create `docs/product/product-contract.md`
  - Single source for first-stage product positioning, non-goals, core workflow, metrics, launch boundary and evidence standard.
- Create `docs/product/user-validation-script.md`
  - Field script for 5 to 10 target users, including tasks, questions, pass/fail criteria and evidence table.
- Modify `docs/ui/literary-young-women-workbench-design.md`
  - Reference the product contract and clarify that visual style is not the target-user proof.
- Modify `README.md`
  - Align product summary, Agent API wording, sharing defaults and deployment safety copy.
- Modify `客户使用说明.md`
  - Add customer-facing safety and first-run path without developer-heavy language.
- Modify `docs/deployment/huggingface-space-free.md`
  - Make public deployment safety gate explicit and keep free-tier limitations visible.
- Modify `src/components/share-dialog.tsx`
  - Change initial expiry default to a safer short-lived option and show explicit copy for public no-access-code sharing.
- Modify `src/lib/share-client.ts`
  - Keep client form submission explicit and add small tests if defaults move into a helper.
- Modify `src/lib/i18n.tsx`
  - Add or adjust share safety copy in Chinese and English.
- Modify `src/app/api/shares/route.test.ts` and `src/app/api/share-route.test.ts`
  - Lock server-side share behavior against no access code, expiry, protected content and error paths.
- Optional modify `scripts/hf-space-doctor-utils.mjs` and tests
  - Only if current diagnostics do not visibly mark missing public auth as unsafe.

## Project Control Topology

**总体设计部:** `AGENTS.md`, this plan, `docs/product/product-contract.md`, and user instructions define the project-level reference. Final gate is local verification plus explicit residual gate notes.

**控制结构:**
- Product docs can change positioning, wording and validation requirements.
- UI/API tasks can change default choices and visible warnings.
- Deployment scripts can observe and warn about unsafe public configuration.
- Core image generation, Agent schema, database schema and upstream compatibility are frozen.

**主落点:** 控制面。This stage changes product defaults, warnings, gates and documentation. It should not move the core data plane.

**次级落点:** 状态面 is touched only through share metadata semantics and HF Space memory-state documentation. Data plane remains the existing image generation and image serving paths.

**复杂性转移账本:**

| 字段 | 内容 |
| --- | --- |
| 复杂性原位置 | 用户需要从 README、UI design、HF docs and runtime behavior infer product boundaries and safety defaults. |
| 新位置 | Product contract, safer share defaults, public deployment diagnostics and aligned customer docs. |
| 收益 | Product decisions become inspectable and deployment risks become visible before customer exposure. |
| 新成本 | Docs and diagnostics must stay aligned with future runtime changes. |
| 失效模式 | A future feature bypasses product contract or reintroduces unsafe defaults without updating tests. |

## Black-Box Input/Output Matrix

| Control Input | Target Output | Direction | Coupled Outputs | Rollback Signal |
| --- | --- | --- | --- | --- |
| Add product contract | Product positioning ambiguity | Decrease | README and UI docs copy | Docs contradict current API or workflow |
| Add validation script | User evidence quality | Increase | Product roadmap and acceptance gates | Script asks opinions instead of past behavior |
| Change share expiry default | Public exposure duration | Decrease | Share dialog UX and tests | Existing protected share tests fail |
| Add share risk copy | User risk awareness | Increase | i18n and dialog layout | Text overflows or confuses no-access-code option |
| Add HF public safety gate | Unsafe public deployments | Decrease | doctor output and deployment docs | Local-only use incorrectly blocked |
| Rename Agent positioning | Overclaim risk | Decrease | README, skill docs and customer docs | Agent API contract wording becomes unclear |

## Tasks

### Task 1: Create Product Contract

**Files:**
- Create: `docs/product/product-contract.md`
- Modify: `README.md`
- Modify: `docs/ui/literary-young-women-workbench-design.md`

- [x] **Step 1: Create product directory**

Run:

```bash
mkdir -p docs/product
```

Expected: `docs/product` exists.

- [x] **Step 2: Write the product contract**

Create `docs/product/product-contract.md` with these sections:

```markdown
# 图像手记产品合同

## 阶段结论

第一阶段主线是给中文小红书和电商内容运营者使用的本地或内网 AI 图片创作工作台，不是通用图片平台、公开 SaaS、自治 Agent 或兼容接口基准测试平台。

## 第一真实用户

第一真实用户是需要为小红书笔记、商品详情页或活动海报反复产出首版视觉稿的中文内容运营者。她通常一个人或在 2 到 5 人小团队内工作，有自己的 API Key 或由团队配置服务端 Key，需要在本机、内网或受控公网环境中完成提示词生成、结果挑选、继续编辑、下载和安全分享。

## 首战场景

首战场景只验证一件事：目标用户为一个真实发布任务生成一张可下载、可继续修改、可被标记为可用或需修改的首版封面或商品氛围图。第一阶段不同时证明企业素材库、多人审批、公开 SaaS、模型兼容探测和长期 Agent 调度。

## 非目标用户

- 需要多人协作素材库、权限分层、审批流或结算系统的企业团队。
- 需要生产级公网 SaaS 可用性、对象存储和审计合规的客户。
- 需要自治 Agent 长期调度、跨实例队列和任务审计的自动化系统。
- 只想验证任意 OpenAI-compatible 接口全部能力的工程测试人员。

## 核心闭环

1. 选一个正在准备发布的笔记、商品或活动主题。
2. 写下真实提示词。
3. 选择常用尺寸、数量、清晰度和格式。
4. 生成或编辑图片。
5. 在中央预览中挑选结果。
6. 在最近生成中标记结果为 `可用` 或 `需修改`。
7. 继续编辑、做变体、复用提示词、对比、下载或分享。
8. 从最近生成或灵感相册回到下一次创作。

## 产品指标

- 第 3 分钟：新用户能在不听讲解的情况下生成一张可下载图片。
- 第 30 分钟：用户能从历史或当前结果继续编辑或复用提示词。
- 第 3 天：用户再次打开并复用历史、灵感或参数。
- 结果质量：用户能为最近生成结果标记 `可用` 或 `需修改`，并说明标记理由。
- 失败恢复：用户看到明确失败原因后知道该重试、改参数、换上游还是停止。

## 上线边界

第一阶段可以面向本地、内网和受控公网部署。公网部署必须配置页面访问码；使用服务端 API Key 时必须配置页面访问码，Agent API 对外开放时必须配置 Agent token。

## 证据标准

产品判断优先使用真实行为、任务完成、质量标记、迁移、复用、授权、付费和引荐承诺。口头认可、审美偏好和内部演示不能单独证明产品成立。
```

- [x] **Step 3: Link contract from README**

Add a short sentence near the README product introduction:

```markdown
第一阶段产品边界以 `docs/product/product-contract.md` 为准：主线是给中文内容运营者产出首版视觉稿的本地和内网 AI 图片创作工作台，Agent API 是自动化接口，不是自治 Agent 平台。
```

- [x] **Step 4: Link contract from UI design baseline**

Add this after `docs/ui/literary-young-women-workbench-design.md` line describing the core positioning:

```markdown
产品边界以 `docs/product/product-contract.md` 为准；本文档只定义工作台信息架构和视觉交互基线，不把审美画像当作真实用户证据。首战验证必须落在真实发布任务、可下载结果、继续编辑或复用、以及最近生成里的 `可用` / `需修改` 结果反馈。
```

- [x] **Step 5: Verify doc references**

Run:

```bash
rg -n "product-contract|自治 Agent|本地和内网 AI 图片创作工作台" README.md docs/ui docs/product
git diff --check
```

Expected: references are present and `git diff --check` exits 0.

- [x] **Step 6: Commit task**

Run:

```bash
git add README.md docs/ui/literary-young-women-workbench-design.md docs/product/product-contract.md
git commit -m "docs: define product contract"
```

Expected: commit succeeds with only these files staged.

### Task 2: Add User Validation Script

**Files:**
- Create: `docs/product/user-validation-script.md`
- Modify: `docs/product/product-contract.md`

- [x] **Step 1: Write validation script**

Create `docs/product/user-validation-script.md` with:

```markdown
# 用户验证脚本

## 样本

本轮验证 5 到 10 名目标用户。用户必须独立完成任务，观察者不能解释产品意义，只能回答环境和安全问题。

## 任务

1. 打开本地或受控公网地址，确认它是给小红书笔记、商品详情页或活动海报产图的工作台。
2. 填写 API 设置或使用已配置服务端 Key。
3. 用自己的真实发布需求写提示词并生成一张首版图片。
4. 下载生成结果。
5. 从结果进入继续编辑或做变体。
6. 从最近生成或灵感相册复用一次提示词。
7. 给最近生成结果标记 `可用` 或 `需修改`。
8. 如需分享，创建一个有有效期的分享链接。

## 观察记录

| 用户 | 第 3 分钟是否出图 | 是否下载 | 是否继续编辑或变体 | 是否复用历史或灵感 | 是否标记可用或需修改 | 是否理解费用和失败原因 | 迁移承诺 | 授权承诺 | 付费承诺 | 引荐承诺 | 卡点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## The Mom Test 问题

- 你上次需要这类图片是什么时候。
- 当时你怎么处理。
- 花了多久，经过几个人，是否付费。
- 当时哪里最麻烦。
- 你试过哪些替代方案，为什么没有继续用。
- 如果这个工具现在解决该问题，你愿意付出什么承诺：时间、迁移、授权、付费、让同事使用或引荐。
- 这次生成结果你会标记为可用还是需修改，为什么。

## 通过标准

- 至少 4 名用户能在第 3 分钟内独立生成并下载图片。
- 至少 3 名用户能完成继续编辑、做变体或复用提示词中的任一动作。
- 至少 4 名用户给最近生成结果标记 `可用` 或 `需修改`，并能说出标记理由。
- 至少 2 名用户在第 3 天复用历史、灵感或参数。
- 至少 2 名用户给出明确迁移、授权、付费、团队使用或引荐承诺中的任一项。
- 所有用户遇到失败时都能看到明确原因或下一步处理建议。

## 不通过信号

- 用户需要听产品解释才明白产品价值。
- 用户只夸审美但没有真实任务。
- 用户无法给结果标记，或标记理由只停留在好看、不好看这类审美评价。
- 用户不愿填写 API Key、不愿迁移流程、不愿复用历史。
- 用户第 3 天没有任何复用动作，也没有迁移、授权、付费或引荐承诺。
- 分享链接被误认为默认私密。
```

- [x] **Step 2: Reference validation in product contract**

Add to `docs/product/product-contract.md`:

```markdown
## 当前验证门禁

上线前按 `docs/product/user-validation-script.md` 执行 5 到 10 名用户验证。未执行前，不能声称产品已经通过真实用户验证。
```

- [x] **Step 3: Verify no opinion-only questions**

Run:

```bash
rg -n "你觉得|会不会用|有没有价值|不错|喜欢吗" docs/product/user-validation-script.md
```

Expected: no matches.

- [x] **Step 4: Commit task**

Run:

```bash
git add docs/product/product-contract.md docs/product/user-validation-script.md
git commit -m "docs: add product validation script"
```

Expected: commit succeeds.

### Task 3: Make Share Defaults Safer

**Files:**
- Modify: `src/components/share-dialog.tsx`
- Modify: `src/lib/i18n.tsx`
- Modify: `src/app/api/shares/route.test.ts`
- Modify: `src/app/api/share-route.test.ts`

- [x] **Step 1: Add failing UI default test**

If no existing share dialog test exists, create `src/components/share-dialog.test.tsx`:

```tsx
import { ShareDialog } from './share-dialog';
import { I18nProvider } from '@/lib/i18n';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

describe('ShareDialog', () => {
    it('defaults to a time-limited share and explains public sharing risk', () => {
        const html = renderToStaticMarkup(
            <I18nProvider>
                <ShareDialog
                    open
                    onOpenChange={() => {}}
                    isCreating={false}
                    shareUrl={null}
                    error={null}
                    onCreate={() => {}}
                />
            </I18nProvider>
        );

        assert.match(html, /1 天/);
        assert.match(html, /无访问码/);
        assert.match(html, /链接获得者/);
    });
});
```

Run:

```bash
npm test -- src/components/share-dialog.test.tsx
```

Expected: FAIL before copy/default changes.

- [x] **Step 2: Change share dialog initial expiry**

In `src/components/share-dialog.tsx`, change:

```ts
const [expiry, setExpiry] = React.useState('none');
```

to:

```ts
const [expiry, setExpiry] = React.useState('1440');
```

- [x] **Step 3: Add public share risk copy**

Add localized messages in `src/lib/i18n.tsx`:

```ts
'share.publicRiskHint': '不设置访问码时，链接获得者可以直接查看图片。建议保留有效期。',
```

and English:

```ts
'share.publicRiskHint': 'Without an access code, anyone with the link can view the image. Keep an expiry enabled.',
```

Render it below the access code input in `ShareDialog`:

```tsx
<p className='text-muted-foreground text-xs'>{t('share.publicRiskHint')}</p>
```

- [x] **Step 4: Lock server behavior**

Ensure route tests cover:

```ts
it('allows explicit no-access-code shares but preserves expiry when provided', async () => {
    // Build FormData with image and expiresInMinutes=1440.
    // POST /api/shares.
    // Assert 201, accessCodeRequired=false, expiresAt is a string.
});
```

and:

```ts
it('does not return expired share content', async () => {
    // Create an expired share record using share-store helper.
    // POST /api/shares/{token}/content.
    // Assert status 410 and code share_expired.
});
```

- [x] **Step 5: Run targeted verification**

Run:

```bash
npm test -- src/components/share-dialog.test.tsx src/app/api/shares/route.test.ts src/app/api/share-route.test.ts
npm run lint
git diff --check
```

Expected: all pass.

- [x] **Step 6: Commit task**

Run:

```bash
git add src/components/share-dialog.tsx src/components/share-dialog.test.tsx src/lib/i18n.tsx src/app/api/shares/route.test.ts src/app/api/share-route.test.ts
git commit -m "fix: make image sharing defaults safer"
```

Expected: commit succeeds.

### Task 4: Tighten Public Deployment Safety Gate

**Files:**
- Modify: `docs/deployment/huggingface-space-free.md`
- Modify: `客户使用说明.md`
- Optional modify: `scripts/hf-space-doctor-utils.mjs`
- Optional modify: `scripts/hf-space-doctor-utils.test.mjs`

- [x] **Step 1: Update HF Space docs**

In `docs/deployment/huggingface-space-free.md`, keep the existing warning and add:

```markdown
公网客户试用必须同时完成以下检查：

- `APP_PASSWORD` 已设置。
- 使用 Agent API 时 `AGENT_API_TOKEN` 已设置。
- 服务端 API Key 只写入 Space Secrets，不写入仓库文件或 README。
- 免费层只适合演示和轻量试用，不承诺图片、分享链接或 Agent replay 长期保存。
```

- [x] **Step 2: Update customer instructions**

Add to `客户使用说明.md`:

```markdown
## 六、公网使用提醒

如果把服务部署到公网地址，必须设置网页访问码。没有访问码时，任何能打开网址的人都可能消耗服务端 API Key。

分享图片时建议保留有效期；如果不设置访问码，获得链接的人可以直接查看图片。
```

- [x] **Step 3: Inspect current doctor behavior**

Run:

```bash
npm run doctor -- --help
npm run doctor:hf-space -- --help
```

Expected: commands print help or structured diagnostics without secrets.

- [x] **Step 4: Add diagnostic warning only if missing**

If doctor output does not already flag missing public auth, add or adjust tests in `scripts/hf-space-doctor-utils.test.mjs` so the missing `APP_PASSWORD` case returns a warning named `hf-space-public-auth`.

Expected assertion shape:

```js
assert.equal(result.checks.find((check) => check.name === 'hf-space-public-auth')?.status, 'warn');
```

- [x] **Step 5: Run targeted verification**

Run:

```bash
npm run test:scripts
npm run lint:scripts
git diff --check
```

Expected: all pass.

- [x] **Step 6: Commit task**

Run:

```bash
git add docs/deployment/huggingface-space-free.md 客户使用说明.md scripts/hf-space-doctor-utils.mjs scripts/hf-space-doctor-utils.test.mjs
git commit -m "docs: tighten public deployment safety gate"
```

If script files were not changed, omit them from `git add`.

### Task 5: Align Agent API Positioning

**Files:**
- Modify: `README.md`
- Modify: `skills/gpt-image-playground-agent/SKILL.md`
- Modify: `skills/gpt-image-playground-agent/references/api.md`
- Modify: `docs/product/product-contract.md`

- [x] **Step 1: Search overclaim wording**

Run:

```bash
rg -n "自治|自主|自动完成|Agent 平台|生产级队列|持久队列|长期调度|无需人工" README.md docs skills
```

Expected: identify wording that could exceed current code capabilities.

- [x] **Step 2: Replace positioning with automation API boundary**

Use this wording where applicable:

```markdown
Agent API 是给 Codex、Claude Code、Gemini 等自动化客户端使用的机器接口。它提供结构化错误、幂等重试、产物追踪和脚本化调用能力，但不是自治 Agent 平台，也不承诺跨实例持久队列或生产级调度。
```

- [x] **Step 3: Keep existing contract details**

Do not remove these existing README claims:

```markdown
Agent 请求必须带 `Idempotency-Key`
`AGENT_API_TOKEN` 存在时 Agent API 只接受 Bearer token
Job polling 当前是同一 Next.js 服务实例内的后台任务
```

- [x] **Step 4: Verify capabilities wording**

Run:

```bash
rg -n "Agent API 是给|不是自治 Agent 平台|跨实例持久队列|Idempotency-Key|AGENT_API_TOKEN" README.md docs/product skills
npm run lint:scripts
git diff --check
```

Expected: wording exists and script lint passes.

- [x] **Step 5: Commit task**

Run:

```bash
git add README.md docs/product/product-contract.md skills/gpt-image-playground-agent/SKILL.md skills/gpt-image-playground-agent/references/api.md
git commit -m "docs: clarify agent api product boundary"
```

Expected: commit succeeds.

### Task 6: Create Product Gate Review

**Files:**
- Create: `docs/reviews/CR-PRODUCT-STAGE-1-GATE-2026-06-06.md`

- [x] **Step 1: Create gate review**

Create `docs/reviews/CR-PRODUCT-STAGE-1-GATE-2026-06-06.md`:

```markdown
# Product Stage 1 Gate Review - 2026-06-06

## Scope

This review verifies the first-stage product improvement boundary: product contract, user validation script, safer sharing defaults, public deployment safety and Agent API positioning.

## Evidence

| Check | Command | Exit | Result |
| --- | --- | --- | --- |
| Tests | `npm test` |  |  |
| Lint | `npm run lint` |  |  |
| Script lint | `npm run lint:scripts` |  |  |
| Build | `npm run build` |  |  |
| Diff check | `git diff --check` |  |  |

## Product Contract

- First user:
- Non-goals:
- Core workflow:
- Metrics:

## Share Safety

- Default expiry:
- No-access-code warning:
- Server-side protected content behavior:

## Public Deployment

- APP_PASSWORD gate:
- AGENT_API_TOKEN gate:
- Free-tier persistence boundary:

## Agent API Boundary

- Automation API wording:
- Non-goals:
- Existing contract preserved:

## Residual Risks

- Real customer validation has not been executed until the user-validation script table is populated with actual sessions.
- Real HF Space gate is not covered unless `npm run deploy:space` and a real browser check are executed separately.
- Real upstream image generation is not covered unless a billable smoke is explicitly run.
```

- [x] **Step 2: Fill evidence after commands**

Run:

```bash
npm test
npm run lint
npm run lint:scripts
npm run build
git diff --check
```

Fill the evidence table with exit codes and summaries.

- [x] **Step 3: Verify review has no blank exit cells**

Run:

```bash
rg -n "\\| .* \\|  \\|" docs/reviews/CR-PRODUCT-STAGE-1-GATE-2026-06-06.md
```

Expected: no matches.

- [x] **Step 4: Commit task**

Run:

```bash
git add docs/reviews/CR-PRODUCT-STAGE-1-GATE-2026-06-06.md
git commit -m "docs: record product stage one gate"
```

Expected: commit succeeds.

### Task 7: Final Branch Verification

**Files:**
- No new files expected.

- [x] **Step 1: Confirm branch and diff**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git diff --stat main...HEAD
```

Expected: branch is `codex/product-improvement-planning-only`; working tree is clean after commits; diff contains only planned files.

- [x] **Step 2: Run final verification**

Run:

```bash
npm run verify
```

Expected: JSON output has `"ok": true`.

- [x] **Step 3: Record optional public deployment gate decision**

Only if user explicitly asks to verify HF Space or deploy:

```bash
npm run deploy:space
```

Expected: Space reaches `RUNNING` and documented public checks pass.

Status: not executed in this stage because no explicit deploy request was made. The remote configuration diagnostic was executed with `npm run doctor:hf-space`; fresh deployment and browser verification remain external residual gates.

- [x] **Step 4: Prepare closeout**

Final report must include:

```markdown
Summary
State Estimate / Root Cause
Changes
Verification
Residual Risks / Gate Boundary
```

## Self-Review

- Spec coverage: The plan covers positioning, validation, sharing defaults, public deployment safety, Agent API wording, and final evidence.
- Placeholder scan: No prohibited placeholder markers are present.
- Type consistency: Planned files and commands match current repo conventions: npm, node:test, Next.js App Router, existing share routes and docs.
- Scope check: The plan is one implementation stage and does not attempt broader product rebuild, schema changes, analytics service, or production deployment.
