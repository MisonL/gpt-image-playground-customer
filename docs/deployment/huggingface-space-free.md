# Hugging Face Space 免费层部署

本文档描述如何把本项目部署到 Hugging Face Docker Space 免费层，用作公网图片生成服务。

## 目标形态

- 手机浏览器可以访问 Space 网页并正常生图。
- 电脑上的 Agent 可以通过 `/api/agent/*` 调用同一个 Space 生图。
- 首战场景是中文内容运营者为小红书笔记、商品详情页或活动海报生成首版视觉稿，不是公开 SaaS。
- 状态后端使用 `memory`，不依赖 SQLite、PostgreSQL 或外部数据库。
- 图片 Web 结果优先保存在浏览器 IndexedDB，减少服务端临时盘依赖。

## Space README YAML

本仓库顶层 `README.md` 已包含 Hugging Face Space metadata。如果你维护的是单独的 Space 仓库，确认它的 `README.md` 顶部使用 Docker SDK，并暴露本项目端口：

```yaml
---
sdk: docker
app_port: 4783
---
```

官方依据：

- Docker Space 配置、Variables/Secrets 和权限说明：https://huggingface.co/docs/hub/main/spaces-sdks-docker
- 免费 CPU Basic 规格说明：https://huggingface.co/docs/hub/main/spaces-gpus
- Hugging Face CLI 安装和登录说明：https://huggingface.co/docs/huggingface_hub/en/guides/cli

## 全新电脑前置条件

全新用户、全新电脑需要先准备系统级工具。没有 Node.js 和 npm 时，仓库内 npm 脚本无法运行；没有 HF CLI 登录时，脚本无法把 Secret 写到远端 Space。

先检查：

```bash
node --version
npm --version
hf --help
hf auth whoami
```

要求：

- Node.js >=20.10.0。
- npm 随 Node.js 一起可用。
- Hugging Face CLI 使用当前官方 `hf` 命令。
- `hf auth login` 使用 Hugging Face Access Token，不是账号密码。
- Docker 只对本地 Space-like 容器 smoke（推荐 `npm run smoke:hf-space-local`，兼容别名 `npm run smoke:hf-space`）和本地容器验证必需；部署到远端 Space 使用 `hf` CLI。

安装 Hugging Face CLI 时，以官方文档为准。不要把远程安装脚本直接管道到 shell；如需使用官方脚本，先下载、核对来源和内容后再执行。

第一次拉取仓库后安装依赖：

```bash
npm install
```

如果不确定当前机器缺什么，运行只读诊断：

```bash
npm run doctor
```

`doctor` 会检查 Node、npm、`hf` CLI、HF 登录状态、`node_modules`、git、Docker、固定 Space 目标、远端 Variables 和远端 Secrets。该命令不会写远端 Secret、不会重启 Space、不会打印 Secret 值。

## 管理员命令中心

本仓库只保留一组稳定管理员入口：

```bash
npm run status
npm run doctor
npm run verify
npm run deploy:local
npm run deploy:space
npm run agent:doctor
```

- `status`：只读输出 git、Node、固定 Space 目标、Agent capabilities 路径和 Skill 入口。
- `doctor`：统一诊断入口，默认包含 HF Space 只读远端检查。
- `verify`：提交前基线，执行测试、lint、脚本语法、构建和 `git diff --check`；需要真实 PostgreSQL gate 时加 `--postgres`。
- `deploy:local`：重建本地 Docker 服务并探测真实 HTTP 端点；加 `--memory` 会断言 memory/indexeddb overlay 生效。
- `deploy:space`：上传当前干净 git HEAD 到固定 HF Space，并做只读公网验证。
- `agent:doctor`：通过仓库 Skill 脚本执行只读 Agent API 契约检查，不触发真实生图。

HF Space 交互使用官方 `hf` CLI。不要维护本机 access 文件，不要把 `APP_PASSWORD`、`AGENT_API_TOKEN`、OpenAI Key 或 Hugging Face token 写入仓库文件。

部署当前干净的 git HEAD 到固定 Space：

```bash
npm run deploy:space
```

该脚本会：

- 使用 `git status --porcelain` 拒绝脏工作区。
- 使用 `git archive HEAD` 生成临时源码目录，只上传已跟踪源码。
- 使用 `hf upload` 上传到 `misonL/gpt-image-playground-customer`。
- 等待新 Space commit 进入 `RUNNING`。
- 检查 `/api/auth-status`、`/api/agent/capabilities` 和 `/api/runtime-capabilities`，不触发真实生图。

配置或轮换 Variables/Secrets 时，直接使用官方 `hf` CLI：

```bash
hf spaces variables add misonL/gpt-image-playground-customer -e AGENT_STATE_BACKEND=memory
hf spaces variables add misonL/gpt-image-playground-customer -e NEXT_PUBLIC_IMAGE_STORAGE_MODE=indexeddb
hf spaces variables add misonL/gpt-image-playground-customer -e APP_LOG_LEVEL=warn
hf spaces secrets add misonL/gpt-image-playground-customer -s APP_PASSWORD=<page-access-code>
hf spaces secrets add misonL/gpt-image-playground-customer -s AGENT_API_TOKEN=<long-random-agent-token>
```

源码部署、远端诊断、Variables 和 Secrets 都围绕 `hf` CLI 完成；仓库内不再提供第二套 access-file 同步流程。

## Space Variables

在 Space Settings 中添加这些 Variables：

```dotenv
AGENT_STATE_BACKEND=memory
NEXT_PUBLIC_IMAGE_STORAGE_MODE=indexeddb
APP_LOG_LEVEL=warn
```

`NEXT_PUBLIC_IMAGE_STORAGE_MODE` 是构建期和运行期都需要的值。Dockerfile 已声明 build arg，Hugging Face Docker Space 会把同名 Variable 作为 build arg 传入构建，并在运行期注入环境变量。

如果不使用 `memory`，再按实际状态后端追加可选变量：

```dotenv
AGENT_SQLITE_PATH=generated-images/.agent-state/agent.sqlite
AGENT_DATABASE_URL=postgres://...
AGENT_DB_PASSWORD=<database-password>
AGENT_DB_PASSWORD_FILE=/path/to/password-file
```

`AGENT_DATABASE_URL`、`AGENT_DB_PASSWORD` 和 `AGENT_DB_PASSWORD_FILE` 是 PostgreSQL 配置路径，不需要在 `memory` 模式下设置为空值。

可选：

```dotenv
AGENT_PUBLIC_BASE_URL=https://<user>-<space>.hf.space
```

`AGENT_PUBLIC_BASE_URL` 影响 OpenAPI `servers[0].url`，也用于 `POST /api/agent/artifacts/{id}/share` 返回用户可打开的分享外链。必须填写绝对 `http`/`https` URL，不能包含凭据、查询参数或片段；Agent skill 仍应以 `GPT_IMAGE_PLAYGROUND_URL` 指向实际 Space 地址。

## Space Secrets

在 Space Settings 中添加 Secrets，不要写入仓库文件：

```dotenv
OPENAI_API_KEY=<your-api-key>
OPENAI_API_BASE_URL=https://api.openai.com/v1
APP_PASSWORD=<page-access-code>
AGENT_API_TOKEN=<long-random-agent-token>
```

`OPENAI_API_BASE_URL` 和 `OPENAI_CHANNEL_N_BASE_URL` 必须是无凭据、无查询参数和无片段的 `http` 或 `https` 绝对地址，通常以 `/v1` 结尾。公网 Space 推荐使用 `https` 上游；只有内网、专用代理或已确认的兼容渠道需要 `http` 时才配置 `http`。

公网部署建议至少设置访问码 `APP_PASSWORD` 和 `AGENT_API_TOKEN`。如果不设置 `APP_PASSWORD`，任何人都可以打开网页并消耗服务端 API Key。

如果要把这个 Space 当成客户可见的公网服务，`npm run doctor:hf-space` 的 `remote-secrets` 必须通过，且应同时看到 `APP_PASSWORD` 和 `AGENT_API_TOKEN` 已配置。没有这两个值时，只适合本地或受控内网试用，不适合直接给客户公开。

如果使用服务端渠道池，改用 `OPENAI_CHANNEL_N_*` Secrets：

```dotenv
OPENAI_ROUTING_STRATEGY=round_robin
OPENAI_CHANNEL_1_ID=official
OPENAI_CHANNEL_1_BASE_URL=https://api.openai.com/v1
OPENAI_CHANNEL_1_API_KEYS=<key-a>,<key-b>
```

## 手机网页使用

1. 打开 Space 地址，例如 `https://<user>-<space>.hf.space`。
2. 如果配置了 `APP_PASSWORD`，输入页面访问码。
3. 直接填写提示词并生图。若 Space 没有配置服务端 API Key，也可以在右上角 `API 设置` 中填写自己的 API Key 和 API URL。
4. `NEXT_PUBLIC_IMAGE_STORAGE_MODE=indexeddb` 时，图片结果保存在当前浏览器 IndexedDB。换设备、清理浏览器数据或隐私模式退出后，本地历史可能消失。

## 电脑 Agent API 使用

先做只读契约检查，不触发真实生图：

```bash
GPT_IMAGE_PLAYGROUND_URL=https://<user>-<space>.hf.space \
GPT_IMAGE_AGENT_TOKEN=<agent-token> \
GPT_IMAGE_AGENT_CONTRACT_CHECK=1 \
node skills/gpt-image-playground-agent/scripts/generate-image.mjs
```

真实文生图：

```bash
GPT_IMAGE_PLAYGROUND_URL=https://<user>-<space>.hf.space \
GPT_IMAGE_AGENT_TOKEN=<agent-token> \
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --allow-billable \
  "a product photo of a ceramic mug on a wooden table"
```

脚本会先读取 `GET /api/agent/capabilities`，再调用 Agent API。成功响应会保留相对 `content_url`，同时补充 `absolute_content_url` 和 `absolute_metadata_url`，便于在桌面环境直接下载产物。

远端 Agent 调用不要硬编码路径。普通文生图默认提交业务意图到 capabilities 声明的 `orchestration.endpoint`，由服务端选择内部执行路径、上游 request mode 和轮询方式；Agent 客户端不按尺寸、远端 HTTPS 或流式参数自行选择 Images、Responses、SSE 或非流式路径。显式 page_sse 诊断、默认 WebP edit、高分辨率 edit 和复杂批量仍按 Skill 规则使用页面端 `/api/images` SSE；页面流式失败或不可用时，先诊断结构化错误，再用新的 `Idempotency-Key` 显式选择 Agent JSON、Agent edit 或 job 路径对照。job polling 只在显式选择时使用。需要诊断对照时可用 `--agent` 或 `--streaming-strategy off` 强制 Agent JSON，也可用 `--page-sse` 或 `--job` 显式选择路径。

如果 Space 同时配置了 `APP_PASSWORD` 和 `AGENT_API_TOKEN`，Agent JSON 端点用 `GPT_IMAGE_AGENT_TOKEN` 发送 Bearer token；页面端 `/api/images` SSE 仍按 capabilities 的 `agent_streaming.page_sse.auth` 判断，可能需要额外设置 `GPT_IMAGE_APP_PASSWORD_HASH`，并通过 form-data `passwordHash` 发送页面访问码哈希。页面 SSE 会把业务 key 写入 `clientRequestId`，长度上限以 capabilities 中的 `agent_streaming.page_sse.client_request_id.max_length` 为准。

## 本地 HF 近似 smoke

提交前运行：

```bash
npm run smoke:hf-space-local
```

该命令会：

- 使用 `NEXT_PUBLIC_IMAGE_STORAGE_MODE=indexeddb` 构建 Docker 镜像。
- 以 `AGENT_STATE_BACKEND=memory` 启动临时容器。
- 用手机 User-Agent 检查首页可访问。
- 检查 `/api/agent/capabilities` 返回 `state_backend=memory` 和 `image_storage_mode=indexeddb`。
- 默认等待容器 HTTP ready 最多 45 秒；慢机器可设置 `HF_SPACE_SMOKE_READY_TIMEOUT_MS=90000`。
- 执行 Agent 生成和编辑脚本的契约检查，不触发真实上游生图。

## 免费层限制

- Hugging Face 免费 CPU Basic 适合公开演示和轻量使用，不适合长期高并发。
- CPU Basic 免费层在长时间无访问后会休眠；需要真正永不休眠或自定义 sleep time 时，应升级到付费硬件。
- Docker Space 重启后容器磁盘写入会丢失。`memory` 状态后端的 Agent 幂等记录、replay 状态和分享元数据也会丢失。
- Agent API 仍会把产物图片写入容器临时文件系统，以便提供 `content_url` 下载。重启后这些链接不保证继续有效。
- 需要长期保存图片、分享链接或 Agent replay 状态时，不应使用免费层纯内存模式。应切换到 PostgreSQL 加持久卷或外部对象存储。

## 公网客户门槛

如果把 Space 对外提供给客户使用，至少要满足以下门槛：

- 先执行 `npm run deploy:space`，确保当前干净 git HEAD 已上传到固定 Space。
- 再用真实浏览器打开 Space，确认页面能进入并完成一次真实的浏览器检查。
- 仅有 `npm run doctor:hf-space` 的远端可达与 secret 检查，不足以证明客户可见上线。
- `APP_PASSWORD` 已设置，网页不会裸露给匿名访问者。
- `AGENT_API_TOKEN` 已设置，自动化调用不会回退到页面访问码哈希。
- `npm run doctor:hf-space` 的 `remote-secrets` 检查通过。
- 共享链接明确保留访问码和有效期的默认控制，不把无访问码永久链接当成默认发布形态。
- 免费层重启丢失分享元数据和 Agent replay 的前提已被客户知晓。

## 免费层 Keepalive

本仓库提供 GitHub Actions 定时 keepalive，降低 CPU Basic 因长时间无访问进入休眠的概率：

- 工作流文件：`.github/workflows/hf-space-keepalive.yml`
- 默认频率：每 6 小时一次，可手动触发 `workflow_dispatch`
- 默认目标：`https://misonl-gpt-image-playground-customer.hf.space/api/auth-status`
- GitHub Actions 中默认最多请求 3 次，每次超时 30 秒，重试间隔 5 秒。失败日志会记录每次尝试，不把超时伪装成成功。
- 行为边界：只访问只读鉴权状态端点，不携带 `APP_PASSWORD`、`AGENT_API_TOKEN` 或 OpenAI Key，不触发生图、不访问 Agent 生成接口。

如果 Space 地址变化，在 GitHub 仓库 Variables 中设置：

```text
HF_SPACE_KEEPALIVE_URL=https://<user>-<space>.hf.space
```

本地手动验证：

```bash
HF_SPACE_KEEPALIVE_URL=https://<user>-<space>.hf.space \
HF_SPACE_KEEPALIVE_EXPECT_PASSWORD_REQUIRED=true \
HF_SPACE_KEEPALIVE_MAX_ATTEMPTS=3 \
npm run keepalive:hf-space
```

注意：keepalive 是免费层的 best-effort 机制，不能保证绕过 Hugging Face 平台维护、重启或政策限制。若需要平台级保证，应升级到付费硬件并设置永不休眠。

## 验证门禁

最小验证：

```bash
npm test
npm run lint
npm run lint:scripts
npm run build
npm run keepalive:hf-space
npm run smoke:hf-space-local
git diff --check
```

真实 Hugging Face gate：

1. 提交代码后执行 `npm run deploy:space`，等待 Space 新 commit 进入 `RUNNING`。
2. 用真实浏览器打开 Space，确认页面可进入并至少完成一次页面检查。
3. 电脑执行 `GPT_IMAGE_AGENT_CONTRACT_CHECK=1` 契约检查。
4. 如有可用测试额度，再执行一次真实 Agent 生成。
5. 重启 Space 后确认旧 Agent replay 和旧临时产物丢失符合预期。
6. 如果未执行第 1 步和第 2 步，必须在门禁报告里明确标注残余外部门禁未验证。
