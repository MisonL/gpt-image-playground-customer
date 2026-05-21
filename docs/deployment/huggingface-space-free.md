# Hugging Face Space 免费层部署

本文档描述如何把本项目部署到 Hugging Face Docker Space 免费层，用作公网图片生成服务。

## 目标形态

- 手机浏览器可以访问 Space 网页并正常生图。
- 电脑上的 Agent 可以通过 `/api/agent/*` 调用同一个 Space 生图。
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

- Node.js 20 或更高版本。
- npm 随 Node.js 一起可用。
- Hugging Face CLI 使用当前官方 `hf` 命令。
- `hf auth login` 使用 Hugging Face Access Token，不是账号密码。
- Docker 只对 `npm run smoke:hf-space` 和本地容器验证必需；只创建 txt 文件和同步 Secret 不需要 Docker。

安装 Hugging Face CLI 时，以官方文档为准。不要把远程安装脚本直接管道到 shell；如需使用官方脚本，先下载、核对来源和内容后再执行。

第一次拉取仓库后安装依赖：

```bash
npm install
```

如果不确定当前机器缺什么，运行只读诊断：

```bash
npm run doctor:hf-space
```

`doctor:hf-space` 会检查 Node、npm、`hf` CLI、HF 登录状态、`node_modules`、git、Docker、本机 access 文件和可选远端 Space 配置。该命令不会写远端 Secret、不会重启 Space、不会打印 Secret 值。

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

`AGENT_PUBLIC_BASE_URL` 只影响 OpenAPI `servers[0].url`，必须填写绝对 `http`/`https` URL，不能包含凭据、查询参数或片段；Agent skill 仍应以 `GPT_IMAGE_PLAYGROUND_URL` 指向实际 Space 地址。

## Space Secrets

在 Space Settings 中添加 Secrets，不要写入仓库文件：

```dotenv
OPENAI_API_KEY=<your-api-key>
OPENAI_API_BASE_URL=https://api.openai.com/v1
APP_PASSWORD=<page-access-code>
AGENT_API_TOKEN=<long-random-agent-token>
```

公网部署建议至少设置访问码 `APP_PASSWORD` 和 `AGENT_API_TOKEN`。如果不设置 `APP_PASSWORD`，任何人都可以打开网页并消耗服务端 API Key。

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

## 本地 HF 近似 smoke

提交前运行：

```bash
npm run smoke:hf-space
```

该命令会：

- 使用 `NEXT_PUBLIC_IMAGE_STORAGE_MODE=indexeddb` 构建 Docker 镜像。
- 以 `AGENT_STATE_BACKEND=memory` 启动临时容器。
- 用手机 User-Agent 检查首页可访问。
- 检查 `/api/agent/capabilities` 返回 `state_backend=memory` 和 `image_storage_mode=indexeddb`。
- 执行 Agent 生成和编辑脚本的契约检查，不触发真实上游生图。

## 免费层限制

- Hugging Face 免费 CPU Basic 适合公开演示和轻量使用，不适合长期高并发。
- CPU Basic 免费层在长时间无访问后会休眠；需要真正永不休眠或自定义 sleep time 时，应升级到付费硬件。
- Docker Space 重启后容器磁盘写入会丢失。`memory` 状态后端的 Agent 幂等记录、replay 状态和分享元数据也会丢失。
- Agent API 仍会把产物图片写入容器临时文件系统，以便提供 `content_url` 下载。重启后这些链接不保证继续有效。
- 需要长期保存图片、分享链接或 Agent replay 状态时，不应使用免费层纯内存模式。应切换到 PostgreSQL 加持久卷或外部对象存储。

## 免费层 Keepalive

本仓库提供 GitHub Actions 定时 keepalive，降低 CPU Basic 因长时间无访问进入休眠的概率：

- 工作流文件：`.github/workflows/hf-space-keepalive.yml`
- 默认频率：每 6 小时一次，可手动触发 `workflow_dispatch`
- 默认目标：`https://misonl-gpt-image-playground-customer.hf.space/api/auth-status`
- 行为边界：只访问只读鉴权状态端点，不携带 `APP_PASSWORD`、`AGENT_API_TOKEN` 或 OpenAI Key，不触发生图、不访问 Agent 生成接口。

如果 Space 地址变化，在 GitHub 仓库 Variables 中设置：

```text
HF_SPACE_KEEPALIVE_URL=https://<user>-<space>.hf.space
```

本地手动验证：

```bash
HF_SPACE_KEEPALIVE_URL=https://<user>-<space>.hf.space \
HF_SPACE_KEEPALIVE_EXPECT_PASSWORD_REQUIRED=true \
npm run keepalive:hf-space
```

注意：keepalive 是免费层的 best-effort 机制，不能保证绕过 Hugging Face 平台维护、重启或政策限制。若需要平台级保证，应升级到付费硬件并设置永不休眠。

## 初始化本机访问记录

不同用户首次接手自己的 Space 时，先在本机生成访问记录文件。该文件保存在用户 home 目录下，不应提交到仓库：

```bash
npm run init-access:hf-space -- \
  --space-id <namespace>/<space-name> \
  --space-url https://<user>-<space>.hf.space
```

默认写入：

```text
~/.cache/gpt-image-playground-customer/hf-space-access.txt
```

文件会包含：

```dotenv
HF_SPACE_ID=<namespace>/<space-name>
HF_SPACE_URL=https://<user>-<space>.hf.space
HF_SPACE_SECRET_KEYS=APP_PASSWORD,AGENT_API_TOKEN
APP_PASSWORD=<generated-page-access-code>
AGENT_API_TOKEN=<generated-agent-token>
```

`HF_SPACE_URL` 必须是 Hugging Face 的 `https://*.hf.space` 纯 origin 地址，不能包含凭据、路径、查询参数或片段，也不能填写反向代理、自定义域名或普通示例域名。

脚本不会在输出中回显 `APP_PASSWORD` 或 `AGENT_API_TOKEN`。如果文件已存在，默认拒绝覆盖；确认要重置时使用：

```bash
npm run init-access:hf-space -- \
  --space-id <namespace>/<space-name> \
  --space-url https://<user>-<space>.hf.space \
  --force
```

创建这个 txt 文件不需要 Hugging Face 账号密码。它只保存本项目的访问码、Agent token 和 Space 目标信息。

同步 Secret 到远端 Space 时，需要本机 `hf` CLI 已登录有目标 Space 管理权限的 Hugging Face Access Token。先检查登录状态：

```bash
hf auth whoami
```

如果未登录，执行：

```bash
hf auth login
```

`hf auth login` 使用的是 Hugging Face Access Token，不是账号密码。不要把 HF 账号密码或 HF Access Token 写入 `hf-space-access.txt`。

生成后可先做本机只读诊断，不写远端：

```bash
npm run doctor:hf-space -- --skip-remote
```

如果诊断提示 access 文件缺少 `HF_SPACE_ID`、`HF_SPACE_URL` 或 `HF_SPACE_SECRET_KEYS`，说明本机可能已有旧格式文件。可手工补齐这些字段，或确认重置后重新生成：

```bash
npm run init-access:hf-space -- \
  --space-id <namespace>/<space-name> \
  --space-url https://<user>-<space>.hf.space \
  --force
```

## 同步本机访问码到 Space

如果本机访问记录文件里的 `APP_PASSWORD` 已更新，可以用脚本同步到 HF Space Secret、重启服务并验证新访问码：

```bash
npm run sync-secret:hf-space
```

默认读取：

```text
~/.cache/gpt-image-playground-customer/hf-space-access.txt
```

由 `init-access:hf-space` 生成的文件会让同步脚本同时同步 `APP_PASSWORD` 和 `AGENT_API_TOKEN`。旧格式文件默认只同步 `APP_PASSWORD`，不会在输出中回显访问码值。可通过环境变量覆盖目标或同步多个 key：

```bash
HF_SPACE_ID=misonL/gpt-image-playground-customer \
HF_SPACE_URL=https://misonl-gpt-image-playground-customer.hf.space \
HF_SPACE_ACCESS_FILE=~/.cache/gpt-image-playground-customer/hf-space-access.txt \
HF_SPACE_SECRET_KEYS=APP_PASSWORD,AGENT_API_TOKEN \
npm run sync-secret:hf-space
```

同步脚本默认要求 `HF_SPACE_ID` 和 `HF_SPACE_URL` 来自 access 文件或环境变量，避免不同用户误写到仓库示例 Space。只有维护默认示例 Space 时才使用：

```bash
npm run sync-secret:hf-space -- --use-default-target
```

可选参数：

- `npm run sync-secret:hf-space -- --no-restart`：只写 Secret，不重启 Space。
- `npm run sync-secret:hf-space -- --skip-verify`：跳过 `/api/auth-verify` 访问码验证。
- `npm run sync-secret:hf-space -- --use-default-target`：允许使用脚本内置默认 Space 目标。

## 验证门禁

最小验证：

```bash
npm test
npm run lint
npm run lint:scripts
npm run build
npm run keepalive:hf-space
npm run smoke:hf-space
git diff --check
```

真实 Hugging Face gate：

1. 推送到 Space 仓库后等待构建完成。
2. 手机打开 Space 页面，确认能进入页面并发起一次真实生成。
3. 电脑执行 `GPT_IMAGE_AGENT_CONTRACT_CHECK=1` 契约检查。
4. 如有可用测试额度，再执行一次真实 Agent 生成。
5. 重启 Space 后确认旧 Agent replay 和旧临时产物丢失符合预期。
