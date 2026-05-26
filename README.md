---
sdk: docker
app_port: 4783
---

# GPT Image Playground

![Version](https://img.shields.io/badge/version-1.3.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)

GPT Image Playground 是一个用于本地部署的 `gpt-image-2` 图片服务：在浏览器里调用 OpenAI Images API 或兼容接口，支持流式预览、4K 图片输出、图片编辑、遮罩编辑、历史记录和费用估算。

它和普通图片生成页面的区别是：围绕 `gpt-image-2` 的高分辨率生成能力设计，支持 2K/4K 预设和自定义尺寸，流式输出过程可见，结果默认保存在本地，参数和费用记录可追溯。

适合这些场景：

- 在本机或内网服务器部署一个可控的 `gpt-image-2` 图片生成服务。
- 验证 `gpt-image-2` 的流式预览、4K 输出、自定义尺寸和编辑参数。
- 使用 OpenAI 兼容接口时，快速确认 API URL、模型、尺寸、质量、输出格式和错误响应是否正确。

<p align="center">
  <img src="./readme-images/interface.jpg" alt="GPT Image Playground 界面" width="900"/>
</p>

## 快速开始

系统推荐采用 Docker 部署。Docker 运行环境更稳定，依赖隔离更清晰，也更适合长期本地服务或内网服务。

如果不方便使用 Docker，也支持原生启动。仓库提供 Windows、macOS、Linux 三个平台的一键启动脚本，会自动检查 Node.js、创建 `.env.local`、安装依赖并启动浏览器服务。

### 推荐：Docker 部署

1. 可选：准备 `.env.local`，用于给服务端配置默认 API Key 或渠道池；如果不创建，也可以启动后在页面右上角 `API 设置` 中填写。

```dotenv
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE_URL=https://api.openai.com/v1
```

多渠道部署可以改用服务端渠道池：

```dotenv
OPENAI_ROUTING_STRATEGY=round_robin

OPENAI_CHANNEL_1_ID=official
OPENAI_CHANNEL_1_BASE_URL=https://api.openai.com/v1
OPENAI_CHANNEL_1_API_KEYS=sk-primary

OPENAI_CHANNEL_2_ID=backup
OPENAI_CHANNEL_2_BASE_URL=https://your-compatible-api.example.com/v1
OPENAI_CHANNEL_2_API_KEYS=sk-backup-a,sk-backup-b

# 可选：开启并发流式批处理。默认关闭。
ENABLE_STREAMING_BATCH=true
OPENAI_MAX_STREAMS_PER_CREDENTIAL=1
```

2. 启动服务：

```bash
docker compose up -d --build --remove-orphans
```

3. 打开：

```text
http://localhost:4783
```

### 兼容：原生一键启动

Windows：

```text
start-windows.bat
```

macOS：

```bash
./start-macos.sh
```

Linux：

```bash
./start-linux.sh
```

脚本会执行这些动作：

- 检查 `package.json` 是否位于项目根目录。
- 检查 Node.js 20 或更高版本。
- 检查 npm 是否可用。
- 如果没有 `.env.local`，自动从 `.env.example` 创建。
- 如果没有 `node_modules`，自动执行 `npm install`。
- 启动前检查 `4783` 端口是否可用，避免 Next.js 自动切换端口后打开错服务。
- 启动本地服务并尝试打开 `http://localhost:4783`。

### 手动原生启动

1. 准备环境变量：

```bash
cp .env.example .env.local
```

2. 安装依赖并启动：

```bash
npm install
npm run dev
```

3. 打开：

```text
http://localhost:4783
```

## 核心功能

- `gpt-image-2` 图片生成：根据文本提示词生成一张或多张图片。
- `gpt-image-2` 图片编辑：上传源图后用提示词修改图片，可选遮罩。
- Agent API：为 Codex、Claude Code、Gemini 等 Agent 提供强契约接口、幂等重试、结构化错误和产物追踪。
- 内置遮罩工具：直接在图片上绘制遮罩，也可以上传 PNG 遮罩。
- 完整参数控制：模型、尺寸、质量、输出格式、压缩、背景、审核级别、生成数量。
- 4K 与自定义尺寸：支持 2K/4K 预设和手动输入宽高，并在前端校验尺寸约束。
- 流式输出：用户显式开启后支持生成和编辑过程中的局部图片预览。
- 历史记录：保留提示词、参数、图片、耗时、token 使用量和估算费用。
- 发送到编辑：从生成结果或历史记录直接进入编辑模式。
- 下载与分享：单图结果可直接下载，分享链接支持访问码和有效期。
- 页面访问保护：可通过 `APP_PASSWORD` 给网页和受保护图片访问加访问码。
- Agent 状态后端：支持 `memory`、`sqlite`、`postgres`，覆盖临时演示、单实例和集中状态库场景。
- 双语和主题：支持中文、英文、亮色、暗色。
- 两种图片存储模式：服务端文件系统或浏览器 IndexedDB。

## 默认行为

- 图片生成默认使用 `quality=high`。如需降低成本或让上游自行选择质量，可在页面或 Agent 请求中显式改为 `auto`、`medium` 或 `low`。
- 页面默认不发送流式请求；用户显式开启流式预览后，才会走 SSE 路径。并发流式批处理仍默认关闭，只有设置 `ENABLE_STREAMING_BATCH=true` 后才会把 `n>1` 拆成多个流式任务。
- 服务端会把官方 OpenAI Images 流式事件、gaoren002/new-api 与 sub2api 图片 SSE、OtokAPI `image.generation.*`、Responses `image_generation_call` 事件统一映射为前端稳定的 `partial_image`、`completed`、`done`、`error` 事件。
- 流式请求失败时会显示原始错误状态和排查建议，不会自动改用非流式请求，以避免隐藏网关、限流或上游故障。

## 图片后端路径

- 默认路径是服务端中继 OpenAI Images API：`/api/images` 调用上游 `/images/generations` 或 `/images/edits`，再返回本项目稳定的 JSON 或 SSE 协议。原版 new-api 和 sub2api 普通 JSON 能力保持这个基线。
- 流式能力由请求字段或环境变量显式控制：`off`、`auto`、`openai-sse`、`newapi-keepalive-sse`、`responses-sse`、`force-sse`。`auto` 不会凭仓库名假设上游能力；Agent 辅助脚本对 `max_edge>2048` 的单次文生图默认优先使用页面端 `/api/images` SSE，失败后先诊断，再显式选择 Agent JSON 或 job 路径。
- 流式请求在没有 partial image 前只显示连接保持状态，不会把 keepalive 当成图片预览或成功结果。
- gaoren002/new-api、sub2api、OtokAPI 与 GPT2Image 风格 Responses 兼容仅发生在事件适配层：partial image 只作为预览，只有最终 completed base64 才会保存为 artifact；缺最终 base64 或仅返回远程 URL 会显式失败。
- Responses API image generation 是实验路径，默认关闭。只有同时设置 `ENABLE_RESPONSES_IMAGE_BACKEND=true`、配置 `OPENAI_RESPONSES_API_MODEL`，并在请求中显式传入 `image_backend=responses-image-generation` 或兼容别名 `imageBackend=responses` 时，服务端才会调用 `/responses` 并读取 `image_generation_call.result`。
- Agent capabilities 会同时暴露 `supported.image_backends` 枚举和 `supported.enabled_image_backends` 当前启用后端；自动化脚本应以后者和 `image_backend_requirements` 判断 runtime 是否已准备好。
- Responses API 的顶层模型由 `OPENAI_RESPONSES_API_MODEL` 或请求字段 `responsesModel` 指定；页面表单里的图片模型只传给 `image_generation` 工具。
- Responses API 实验路径支持单张 `generate` 的非流式和上游 SSE 消费，不替换默认 Images API，不接入编辑表单。Agent generate 对外仍返回最终 JSON，可通过 `image_backend`、`streaming_strategy`、`partial_images` 显式启用服务端内部上游 SSE 消费。

## 编辑与遮罩

编辑模式支持最多 10 张源图。遮罩必须与源图尺寸一致，绘制或上传后会随编辑请求一起提交。

<p align="center">
  <img src="./readme-images/mask-creation.jpg" alt="遮罩创建" width="460"/>
</p>

## 历史与费用

历史面板会记录每次生成或编辑的参数和结果。返回 usage 的接口会显示 token 明细和估算费用，方便对比不同模型和参数的成本。

<p align="center">
  <img src="./readme-images/history.jpg" alt="历史面板" width="900"/>
</p>

<p align="center">
  <img src="./readme-images/cost-breakdown.jpg" alt="费用明细" width="460"/>
</p>

## API 设置

页面右上角的 `API 设置` 会把配置保存在当前浏览器中，不会写入源码文件。

| 配置 | 说明 |
| --- | --- |
| API Key | OpenAI 或兼容接口的密钥。 |
| API URL | OpenAI 兼容接口根地址，通常以 `/v1` 结尾。 |

常见填写方式：

```text
https://api.openai.com/v1
https://your-compatible-api.example.com/v1
```

不要填写管理后台首页或网页地址。如果接口返回 HTML，应用会提示 API URL 不是 OpenAI Images JSON 响应。

## Agent API

Agent API 面向自动化调用，不要求 Agent 模拟网页表单。接口统一使用结构化错误、`Idempotency-Key` 和产物 ID。
自动化客户端应先读取 `GET /api/agent/capabilities`，按其中的 `routing_rules`、`agent_streaming`、`agent_jobs`、`supported.enabled_image_backends` 和 `supported.image_backend_requirements` 选择路径，不要硬编码当前部署默认值。

| 接口 | 用途 |
| --- | --- |
| `GET /api/agent/capabilities` | 查询模型、限制、认证方式、状态后端和端点列表，不公开服务端本地 SQLite 路径。 |
| `GET /api/agent/openapi.json` | 获取机器可读 OpenAPI 描述。 |
| `POST /api/agent/images/generate` | JSON 文生图，默认只返回文件路径和元数据。 |
| `POST /api/agent/images/edit` | multipart 图片编辑，支持源图和 PNG mask。 |
| `POST /api/agent/jobs/images/generate` | 创建文生图 job，适合显式选择 job polling 的长耗时请求；大图单次文生图默认优先按 capabilities 使用页面端 `/api/images` SSE。 |
| `GET /api/agent/jobs/{id}` | 轮询 job 状态。 |
| `GET /api/agent/jobs/{id}/result` | 读取完成后的标准图片响应，运行中返回可重试错误。 |
| `GET /api/agent/artifacts/{id}` | 查询产物元数据。 |
| `GET /api/agent/artifacts/{id}/content` | 下载产物图片内容。 |
| `DELETE /api/agent/artifacts/{id}` | 删除产物和元数据。 |

Agent 请求必须带 `Idempotency-Key`，避免超时重试造成重复出图和重复扣费。若设置 `AGENT_API_TOKEN`，请求需携带：

```text
Authorization: Bearer your-agent-token
```

`AGENT_API_TOKEN` 存在时 Agent API 只接受 Bearer token，不会回退到页面访问码哈希。只有未设置 `AGENT_API_TOKEN` 且设置了 `APP_PASSWORD` 时，Agent API 才接受 `X-App-Password-Hash`；实际可用方案以 `/api/agent/capabilities` 的 `auth.schemes` 为准。

页面端 `/api/images` SSE 是独立的 form-data 路径，不属于 `/api/agent/*` JSON 响应契约。`agent_streaming.page_sse.auth.required=true` 时，脚本需要把 `GPT_IMAGE_APP_PASSWORD_HASH` 作为 form-data `passwordHash` 发送；同一个业务 key 会作为 `clientRequestId` 发送，长度不得超过 capabilities 声明的 `agent_streaming.page_sse.client_request_id.max_length`。

同一个 `Idempotency-Key` 如果已进入终态 `failed`，再次请求只会回放该失败，不会重新执行。终态失败回放会返回 `retryable=false`，并保留错误码、上游状态和脱敏诊断字段；需要重新尝试时，应创建新的业务操作和新的 `Idempotency-Key`。

Job polling 当前是同一 Next.js 服务实例内的后台任务，结果和错误会写入 Agent 状态后端；它不是跨实例持久队列。若服务进程在 job 结束前重启，客户端应继续按状态端点和结构化错误处理，必要时用相同 `Idempotency-Key` 重建同一业务操作。
运行中的 job 会定时刷新请求 lease，避免高质量长耗时上游调用仍在执行时被 recovery 误判为孤儿请求。
`POST /api/agent/images/generate` 对外始终是最终 JSON；`max_edge>2048` 的单次文生图默认建议按 `/api/agent/capabilities` 使用页面端 `/api/images` SSE。显式传 `--agent` 或 `streaming_strategy=off` 时才走 Agent JSON 非流式路径，用于诊断对照。
仓库辅助脚本支持 `--page-sse`、`--agent` 和 `--job` 显式选择路径。`--page-sse` 使用页面 SSE，`--agent` 强制 `/api/agent/images/generate` 最终 JSON，`--job` 使用 Agent job polling。页面流式失败后不会自动二次计费回退，需先按结构化错误和诊断字段确认原因，再选择新的业务操作和新的 `Idempotency-Key`。

生成示例：

```bash
curl -s http://localhost:4783/api/agent/images/generate \
  -H "Authorization: Bearer your-agent-token" \
  -H "Idempotency-Key: demo-$(date +%s)" \
  -H "Content-Type: application/json" \
  --data '{"prompt":"a product photo of a ceramic mug","model":"gpt-image-2","response_mode":"path"}'
```

成功响应会包含：

```json
{
  "request_id": "uuid",
  "idempotency_key": "demo-key",
  "cached": false,
  "images": [
    {
      "id": "artifact-uuid",
      "filename": "1715400000000-abcdef1234567890-0.png",
      "content_url": "/api/agent/artifacts/artifact-uuid/content",
      "metadata_url": "/api/agent/artifacts/artifact-uuid",
      "output_format": "png",
      "mime_type": "image/png",
      "size_bytes": 12345,
      "width": 2048,
      "height": 2048
    }
  ],
  "created_at": "2026-05-12T00:00:00.000Z"
}
```

未显式传 `quality` 时，Agent 生成接口默认使用 `high`。需要使用其他质量时，在 JSON 请求中传入 `"quality":"auto"`、`"medium"` 或 `"low"`。

Web 流式 `/api/images` 事件会同时提供 camelCase 字段和旧 snake_case 字段，例如 `outputFormat`/`output_format`、`clientRequestId`/`client_request_id`、`actualCost`/`actual_cost`。新客户端优先读取 camelCase，旧字段继续保留用于兼容。最终事件中的实际扣费字段含义如下：

| 字段 | 说明 |
| --- | --- |
| `estimatedUsd` | 本地按 token 价格估算的美元成本。 |
| `actualAmount` | 上游返回的实际扣费金额，单位由 `currency` 定义。 |
| `actualQuota` | 上游以 quota 计费时的原始扣减值。 |
| `currency` | `usd-equivalent` 或 `quota-unit`。 |
| `source` | 成本来源，如估算、New API 日志匹配、结算中或不可用。 |
| `confidence` | 成本可信度，取值为 `exact`、`high`、`low` 或 `none`。 |
| `upstreamProvider` | 提供扣费或日志数据的上游。 |
| `matchedLogId` | 匹配到的上游日志 ID。 |
| `matchedRequestId` | 用于匹配或关联的上游请求 ID。 |
| `reason` | 结算中、不可用或低可信度时的说明。 |

错误响应固定为：

```json
{
  "error": {
    "code": "validation_error",
    "message": "请求校验失败。",
    "retryable": false,
    "details": {
      "fields": {
        "n": "必须是 1 到 10 之间的整数"
      }
    },
    "request_id": "uuid"
  }
}
```

## 环境变量

| 变量 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 条件必填 | 无 | 服务端默认 API Key。也可以在页面 `API 设置` 中填写。 |
| `OPENAI_API_BASE_URL` | 否 | OpenAI 官方地址 | OpenAI 兼容接口根地址。 |
| `OPENAI_ROUTING_STRATEGY` | 否 | `sticky` | 服务端多渠道路由策略，可选 `sticky`、`round_robin`、`random`。 |
| `OPENAI_CHANNEL_N_ID` | 否 | 无 | 第 N 个服务端渠道标识，只用于日志排查。 |
| `OPENAI_CHANNEL_N_BASE_URL` | 否 | 无 | 第 N 个 OpenAI 兼容接口根地址，通常以 `/v1` 结尾。 |
| `OPENAI_CHANNEL_N_API_KEYS` | 否 | 无 | 第 N 个渠道的一个或多个 API Key，多个 key 用英文逗号分隔。 |
| `OPENAI_CHANNEL_N_FAILURE_COOLDOWN_MS` | 否 | 继承全局值 | 第 N 个渠道的失败冷却时间。 |
| `ENABLE_STREAMING_BATCH` | 否 | `false` | 显式设为 `true` 后，流式模式下 `n>1` 会拆成多个 `n=1` 任务并发执行。 |
| `IMAGE_GENERATION_BACKEND` | 否 | `images-api` | 服务端默认图片后端，可选 `images-api` 或 `responses-image-generation`。请求字段可覆盖。 |
| `IMAGE_STREAMING_STRATEGY` | 否 | `auto` | 服务端默认流式兼容策略，可选 `off`、`auto`、`openai-sse`、`newapi-keepalive-sse`、`responses-sse`、`force-sse`。请求字段可覆盖。 |
| `ENABLE_RESPONSES_IMAGE_BACKEND` | 否 | `false` | 实验开关。显式设为 `true` 后，`image_backend=responses-image-generation` 或兼容别名 `imageBackend=responses` 请求才可调用 Responses API image generation。 |
| `OPENAI_RESPONSES_API_MODEL` | 否 | 无 | Responses API 实验后端的 `/responses` 顶层模型。启用 Responses 图片后端时必须设置，或在请求中传 `responsesModel`。 |
| `OPENAI_MAX_STREAMS_PER_CREDENTIAL` | 否 | `1` | 每个服务端 credential 允许同时执行的流式任务数。 |
| `OPENAI_CHANNEL_FAILURE_COOLDOWN_MS` | 否 | `60000` | 服务端 credential 或 channel 失败后的默认冷却时间。 |
| `APP_PASSWORD` | 否 | 无 | 设置后，页面会要求输入访问码。 |
| `AGENT_API_TOKEN` | 否 | 无 | 设置后，`/api/agent/*` 需要 Bearer token。 |
| `AGENT_STATE_BACKEND` | 否 | `sqlite` | Agent 状态后端，可选 `memory`、`sqlite` 或 `postgres`。 |
| `AGENT_SQLITE_PATH` | 否 | `generated-images/.agent-state/agent.sqlite` | SQLite 状态库路径。 |
| `AGENT_DATABASE_URL` | PostgreSQL 模式可选 | 无 | PostgreSQL 连接串；也可改用下面的拆分字段。 |
| `AGENT_DB_HOST` / `AGENT_DB_PORT` / `AGENT_DB_NAME` / `AGENT_DB_USER` | PostgreSQL 模式可选 | `localhost` / `5432` / `gpt_image_playground` / `gpt_image` | 未设置 `AGENT_DATABASE_URL` 时用于组装 PostgreSQL 连接串。 |
| `AGENT_DB_PASSWORD` / `AGENT_DB_PASSWORD_FILE` | PostgreSQL 模式必填其一 | 无 | PostgreSQL 密码或 Docker secret file 路径。 |
| `GPT_IMAGE_POSTGRES_PASSWORD` | Docker PostgreSQL 模式必填 | 无 | `docker-compose.postgres.yml` 中 PostgreSQL 容器密码，通过 Docker secret file 注入，不提供默认值。 |
| `AGENT_REQUEST_LEASE_MS` | 否 | `600000` | Agent 请求运行锁租约时间。 |
| `AGENT_REQUEST_TTL_SECONDS` | 否 | `86400` | 幂等请求记录保留秒数。 |
| `AGENT_RECOVERY_INTERVAL_MS` | 否 | `30000` | Agent 请求触发轻量 recovery 的最小间隔。 |
| `AGENT_PUBLIC_BASE_URL` | 否 | `/` | OpenAPI `servers[0].url`，供外部 Agent 生成客户端时使用；配置时必须是绝对 `http`/`https` URL，不能包含凭据、查询参数或片段。 |
| `APP_LOG_LEVEL` | 否 | 生产环境 `warn`，其他环境 `info` | 服务端日志等级，可选 `debug`、`info`、`warn`、`error`。 |
| `NEXT_PUBLIC_IMAGE_STORAGE_MODE` | 否 | `fs` | 可选 `fs` 或 `indexeddb`。 |

自定义 API URL 必须同时提供 API Key，避免服务器密钥被发送到未知接口。

### 服务端多渠道路由

服务端多渠道路由用于配置多个 OpenAI 兼容渠道和多个 key。页面右上角 `API 设置` 中显式填写的 API Key/API URL 仍然优先，未填写时才会使用服务端渠道池。

优先级：

```text
页面 API 设置 > OPENAI_CHANNEL_N_* 渠道池 > OPENAI_API_KEY 单 key 默认配置
```

配置字段：

| 字段 | 说明 |
| --- | --- |
| `OPENAI_ROUTING_STRATEGY` | 可选 `sticky`、`round_robin`、`random`。不填默认 `sticky`。 |
| `OPENAI_CHANNEL_N_ID` | 渠道标识，只用于日志与排查，不会暴露 API Key。 |
| `OPENAI_CHANNEL_N_BASE_URL` | 兼容接口根地址，通常以 `/v1` 结尾。 |
| `OPENAI_CHANNEL_N_API_KEYS` | 当前渠道下的一个或多个 API Key，多个 key 用英文逗号分隔。 |
| `OPENAI_CHANNEL_N_FAILURE_COOLDOWN_MS` | 可选，覆盖单个渠道的失败冷却窗口。 |

并发流式批处理默认关闭。开启 `ENABLE_STREAMING_BATCH=true` 后，页面允许在流式模式下选择多张图片；应用会把批次拆成多个独立 `n=1` 流式请求。推荐并发窗口由服务端运行时能力接口返回：默认 `sticky` 路由按单个 credential 容量计算，`round_robin` / `random` 路由按完整 credential 池计算。

`OPENAI_MAX_STREAMS_PER_CREDENTIAL` 默认是 `1`，建议只在真实上游探针验证单 key 可承受更高并发后再调大。

如果服务端 credential 返回鉴权失败、额度不足或限流错误，应用会把该 credential 标记为短暂不可用。若渠道返回 5xx、Cloudflare 520/522/523/524、连接失败或超时，应用会冷却整个 channel，并在冷却窗口内跳过该 channel 下所有 key。若兼容网关把 `invalid_api_key`、`insufficient_quota` 等 credential 错误包在 5xx 中返回，credential 错误优先，不会误冷却整个 channel。所有 credential 都在冷却中时，请求会显式失败，不会伪造成功或静默降级。

运行时能力接口会返回健康 credential/channel 数量与最近一次失败摘要（status、code、requestId），用于诊断和前端并发窗口刷新；不会返回 API Key 或上游错误消息。

三种策略：

| 策略 | 行为 |
| --- | --- |
| `sticky` | 按请求来源稳定映射到同一凭证，适合减少同一用户在多个渠道间跳转。 |
| `round_robin` | 按请求顺序轮询所有渠道 key，适合简单均摊流量。 |
| `random` | 每次随机选择一个渠道 key，适合轻量分散请求。 |

完整示例：

```dotenv
OPENAI_ROUTING_STRATEGY=sticky

OPENAI_CHANNEL_1_ID=official
OPENAI_CHANNEL_1_BASE_URL=https://api.openai.com/v1
OPENAI_CHANNEL_1_API_KEYS=sk-key-1,sk-key-2

OPENAI_CHANNEL_2_ID=backup
OPENAI_CHANNEL_2_BASE_URL=https://your-compatible-api.example.com/v1
OPENAI_CHANNEL_2_API_KEYS=sk-backup-1
```

## 图片保存位置

默认存储模式是 `fs`。生成图片会保存到项目目录：

```text
generated-images/
```

Docker 正式服务中，容器内路径是：

```text
/app/generated-images
```

宿主机映射路径是：

```text
./generated-images
```

前端读取图片时走接口：

```text
/api/image/{filename}
```

Agent API 读取图片时走鉴权接口：

```text
/api/agent/artifacts/{id}/content
```

状态库保存 Agent 请求、幂等、产物元数据和分享元数据，不保存图片二进制。备份时需要同时备份状态库和 `generated-images/`。PostgreSQL 只集中保存元数据；如果运行多个应用副本，所有副本还必须共享同一个 `generated-images/` 卷，或改造为外部对象存储，否则某个副本可能读不到另一个副本写入的图片文件。

如果部署到只读或临时文件系统，可以把 `NEXT_PUBLIC_IMAGE_STORAGE_MODE` 设置为 `indexeddb`。这时图片会保存在浏览器 IndexedDB 中，服务端不落盘。

## Docker 运行

SQLite 单实例默认部署：

```bash
docker compose up -d --build --remove-orphans
```

内存临时演示部署：

```bash
docker compose -f docker-compose.yml -f docker-compose.memory.yml up -d --build --remove-orphans
```

PostgreSQL 高并发部署：

```bash
GPT_IMAGE_POSTGRES_PASSWORD='<database-password>' \
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

三种 Docker 模板的状态后端如下：

| 文件 | 状态后端 | 适用场景 |
| --- | --- | --- |
| `docker-compose.yml` | `sqlite` | 本地单实例、需要保留 Agent 幂等和分享元数据。 |
| `docker-compose.yml` + `docker-compose.memory.yml` | `memory` | Hugging Face Space 免费层、公开演示、重启可丢状态的临时服务。 |
| `docker-compose.yml` + `docker-compose.postgres.yml` | `postgres` | 高并发、多实例或需要集中状态库的部署。 |

三种模式共享同一个 Compose project、应用容器名和图片目录。切换模式时建议使用 `--remove-orphans`，避免保留不再属于当前配置的容器。

`GPT_IMAGE_POSTGRES_PASSWORD` 只在 PostgreSQL volume 首次初始化时生效。已有 `postgres-data` volume 的部署如果要更换密码，需要先在数据库内修改用户密码，或备份后重建 volume；仅修改环境变量不会自动轮换现有数据库密码。

SQLite 适合单实例本地服务。多实例或长期高并发 Agent 服务应使用 PostgreSQL，不要让多个容器共享同一个 SQLite 文件作为主状态库。即使使用 PostgreSQL，多实例部署仍需要共享图片文件存储；仅共享数据库不足以保证 artifact 和分享内容可读。

Hugging Face Space 免费层或其他临时容器演示可以使用纯内存状态后端：

```dotenv
AGENT_STATE_BACKEND=memory
NEXT_PUBLIC_IMAGE_STORAGE_MODE=indexeddb
```

本仓库也提供 `docker-compose.memory.yml` 作为本地模拟模板；Hugging Face Docker Space 通常直接通过 Space Variables 和 Secrets 设置环境变量，不需要提交 `.env.local`。完整部署步骤见 [Hugging Face Space 免费层部署](./docs/deployment/huggingface-space-free.md)。

免费 CPU Basic 会在长时间无访问后休眠。本仓库提供 `.github/workflows/hf-space-keepalive.yml`，默认每 6 小时访问一次 `/api/auth-status`，只做只读 keepalive，不携带访问码或 token，不触发生图。若 Space 地址变化，在 GitHub 仓库 Variables 中设置 `HF_SPACE_KEEPALIVE_URL`。

全新电脑从 0 开始时，先完成系统级前置条件：

```bash
node --version
npm --version
hf --help
hf auth login
npm install
```

要求 Node.js 20 或更高版本。Hugging Face CLI 安装方式以官方文档为准；当前官方入口是 `hf` 命令，登录使用 Hugging Face Access Token。

本仓库只保留一种推荐的管理员交互方式：先用顶层命令判断状态，再进入具体部署命令。Hugging Face Space 操作使用官方 `hf` CLI；不要再维护本机 access 文件，也不要把 Space Secret 写入仓库。

常用入口：

```bash
npm run status
npm run doctor
npm run verify
npm run deploy:local
npm run deploy:space
npm run agent:doctor
```

`status` 只读输出 git、Node、固定 Space 目标、Agent capabilities 路径、仓库 Skill 入口和独立真实图片上游 smoke 配置摘要。它会按 shell 环境变量、`.env.real-smoke.local`、`.env.local` 的优先级判断真实 smoke 配置是否齐全，但不会输出 URL 或 API Key；`doctor` 汇总本机与 HF Space 诊断；`verify` 执行提交前基线，需要真实 PostgreSQL gate 时加 `--postgres`；`deploy:local` 重建本地 Docker 并探测真实端点；`deploy:space` 是 HF Space 发布的稳定别名；`agent:doctor` 对当前 Agent API 做只读契约检查。

如果只想诊断 HF Space 前置条件，可运行：

```bash
npm run doctor:hf-space
```

该命令会检查 Node、npm、`hf` CLI、HF 登录状态、`node_modules`、git、Docker、固定 Space 目标、远端 Variables 和远端 Secrets；不会写远端 Secret、不会重启 Space、不会打印 Secret 值。

部署当前干净的 git HEAD 到固定 Space：

```bash
npm run deploy:space
```

该脚本会使用 `git archive HEAD` 生成临时源码目录，通过 `hf upload` 上传到 `misonL/gpt-image-playground-customer`，等待新 Space commit 进入 `RUNNING`，并执行只读公网端点检查。若工作区有未提交改动，脚本会直接失败，避免把本地临时状态误当成可复现发布。

配置或轮换 Space Secret 时，直接使用官方 `hf` CLI：

```bash
hf spaces variables add misonL/gpt-image-playground-customer -e AGENT_STATE_BACKEND=memory
hf spaces secrets add misonL/gpt-image-playground-customer -s APP_PASSWORD=<page-access-code>
hf spaces secrets add misonL/gpt-image-playground-customer -s AGENT_API_TOKEN=<long-random-agent-token>
```

`memory` 模式不创建 SQLite 文件，也不连接 PostgreSQL。它只适合无持久化演示、短会话调试或可接受重启丢失 Agent 幂等状态的环境；容器重启后请求记录、artifact 元数据和 replay 状态都会清空。Web 图片二进制按 `NEXT_PUBLIC_IMAGE_STORAGE_MODE` 保存；HF 免费层推荐 `indexeddb`，让网页结果保存在浏览器侧。Agent API 产物仍写入容器临时文件系统，以便提供 `content_url` 下载。

如果把当前 Dockerfile 直接部署到 Hugging Face Docker Space，Space README 顶部 YAML 需要使用 Docker SDK，并把应用端口指向本项目默认端口：

```yaml
---
sdk: docker
app_port: 4783
---
```

免费层文件系统不是长期持久化介质，因此 `memory` 模式只用于公开演示或临时体验。需要长期保留图片、分享和 Agent replay 状态时，应改用 PostgreSQL 加持久卷或外部对象存储。

PostgreSQL live 并发测试可用以下命令单独执行。未提供 `AGENT_POSTGRES_TEST_DATABASE_URL` 时，脚本会自动启动临时 PostgreSQL 容器并在结束后清理。

```bash
npm run test:postgres
```

Docker 容器内外端口统一使用 `4783`。

默认访问地址：

```text
http://localhost:4783
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker logs -f gpt-image-playground-customer
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `./start-macos.sh` | macOS 原生一键启动。 |
| `./start-linux.sh` | Linux 原生一键启动。 |
| `start-windows.bat` | Windows 原生一键启动。 |
| `npm run dev` | 启动本地开发服务。 |
| `npm run build` | 执行生产构建。 |
| `npm run start` | 启动生产模式服务。 |
| `npm run status` | 只读输出 git、Node、Space 目标、Agent API、Skill 入口和独立真实图片上游 smoke 配置摘要；会自动读取 `.env.real-smoke.local`，不输出 URL 或 API Key。 |
| `npm run doctor` | 运行统一诊断入口，默认包含 HF Space 只读远端检查。 |
| `npm run verify` | 执行提交前基线：测试、lint、脚本语法、构建和 `git diff --check`；加 `-- --postgres` 会包含 live PostgreSQL gate。 |
| `npm run deploy:local` | 重建本地 Docker 服务并探测 `/api/auth-status`、`/api/runtime-capabilities`、`/api/agent/capabilities`；加 `-- --memory` 会断言 memory/indexeddb overlay 生效。 |
| `npm run deploy:space` | 上传当前干净 git HEAD 到固定 HF Space，并做只读公网验证。 |
| `npm run agent:doctor` | 通过仓库 Skill 脚本执行只读 Agent API 契约检查，不触发真实生图。 |
| `npm run deploy:hf-space` | 使用官方 `hf` CLI 上传当前干净 git HEAD 到固定 Space 并做只读公网验证。 |
| `npm run doctor:hf-space` | 只读诊断 HF Space 部署前置条件、固定 Space 目标和远端配置。 |
| `npm run keepalive:hf-space` | 访问 HF Space 只读状态端点，用于 keepalive 验证。 |
| `npm run smoke:hf-space` | 构建并启动 HF 免费层近似容器，验证 memory 状态后端和 Agent API 契约；慢机器可设置 `HF_SPACE_SMOKE_READY_TIMEOUT_MS`。 |
| `npm run smoke:image-upstream-compat` | 启动本地 mock 上游，验证 Images API、new-api/sub2api SSE 和 Responses image_generation 兼容契约。 |
| `npm run smoke:image-upstream-local` | 启动本地 fixture，并通过真实 smoke final gate 跑满 `original-images-json`、`gaoren-images-sse`、`sub2api-images-sse`、`sub2api-responses-json`、`gpt2image-responses-sse` 五个独立场景。 |
| `npm run smoke:image-upstream-real` | 检查真实上游 smoke 配置；加 `-- --allow-billable` 后才会触发真实生图。 |
| `npm run lint` | 检查 `src/` 代码。 |
| `npm run lint:scripts` | 跨平台检查仓库脚本和 skill 脚本语法。 |
| `npm run format` | 格式化 `src/` 下的 TypeScript 和 React 文件。 |

真实上游 smoke 使用以下环境变量前缀逐类配置：`IMAGE_REAL_SMOKE_ORIGINAL_*`、`IMAGE_REAL_SMOKE_GAOREN_*`、`IMAGE_REAL_SMOKE_SUB2API_*`、`IMAGE_REAL_SMOKE_SUB2API_RESPONSES_*`、`IMAGE_REAL_SMOKE_GPT2IMAGE_*`。每类至少提供 `BASE_URL` 和 `API_KEY`；Responses 场景还必须提供 `/responses` 顶层模型。可选覆盖图片 `MODEL`、`SIZE`、`QUALITY`。`BASE_URL` 必须是无凭据、无查询参数、无片段的 `http`/`https` 绝对 URL。默认不触发计费请求，必须显式加 `-- --allow-billable`。可复制 `.env.real-smoke.example` 为未跟踪的 `.env.real-smoke.local`，再通过 `-- --env-file .env.real-smoke.local` 加载；shell 环境变量优先级高于 `--env-file`，`--env-file` 优先级高于 `.env.local`。

`npm run smoke:image-upstream-local` 会临时启动仓库内置 fixture，把 5 个独立场景全部指向本机 `/v1` 兼容服务，并调用同一个 `smoke:image-upstream-real -- --require-independent-targets --allow-billable` 门禁路径。该命令用于验证本项目的 final-gate 脚本、事件归一化和本地可复现环境；输出会标记 `local_fixture=true`。它不证明原版 new-api、gaoren/new-api、sub2api 或 GPT2Image 第三方部署当前可访问，真实验收仍需配置 `.env.real-smoke.local` 后运行真实上游门禁。

若只需要验证当前 `.env.local` 中的 `OPENAI_API_KEY` 或 `OPENAI_CHANNEL_N_*` 服务端渠道，可追加 `-- --include-server-channel`。该模式不会把服务端 API Key 写入表单或输出，真实执行仍需同时追加 `--allow-billable`；可覆盖 Images JSON、Images SSE、Responses JSON、Responses SSE、Agent 内部 Images SSE 和 Agent 内部 Responses SSE 场景。可用 `IMAGE_REAL_SMOKE_SERVER_MODEL`、`IMAGE_REAL_SMOKE_SERVER_SIZE`、`IMAGE_REAL_SMOKE_SERVER_QUALITY`、`IMAGE_REAL_SMOKE_SERVER_RESPONSES_MODEL` 覆盖模型、尺寸、质量和 Responses 顶层模型。单场景默认超时 `240000ms`，可用 `--timeout-ms` 或 `IMAGE_REAL_SMOKE_TIMEOUT_MS` 调整。
服务端渠道 smoke 只证明当前配置和上游账号池在请求时可用；如果上游返回 `503` 或 `No available compatible accounts`，应归类为上游渠道当前不可用，不要把它记成本地路由或脚本成功。

dry-run 输出中的 `independent_targets` 会汇总必跑、已选、未选、已配置和缺失的独立真实上游场景，并给出最终门禁命令；`required_count` 和 `unselected_required_count` 用于区分必跑总数和未选择数量，`configuration_complete=true` 只表示 5 个必跑场景都已选中且配置齐全，不代表已经执行计费生图。顶层 `final_gate_satisfied=true` 才表示最终独立真实上游门禁已实际执行并通过。`missing_env_any` 表示每组任选一个环境变量即可补齐该缺失项。例如 `sub2api-responses-json` 的 `BASE_URL` 和 `API_KEY` 可单独配置 `IMAGE_REAL_SMOKE_SUB2API_RESPONSES_*`，也可以复用 `IMAGE_REAL_SMOKE_SUB2API_*`；它的 `/responses` 顶层模型必须使用 `IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL` 或 `OPENAI_RESPONSES_API_MODEL`，避免和图片模型 `IMAGE_REAL_SMOKE_SUB2API_RESPONSES_MODEL` 混淆。

最终验收独立真实上游时追加 `-- --require-independent-targets --allow-billable`。此时任一独立真实上游场景未被选中或被跳过都会让脚本以非零退出，并在 `unselected_required_cases`、`skipped_required_cases`、`missing_required_count` 和 `missing_required_cases` 中列出未完成的场景。若最终门禁预检发现必跑场景未选全、缺少配置或配置非法，脚本会阻断可运行目标并先失败，不触发任何真实上游计费调用。

`--include-server-channel` 只能验证当前 `.env.local` 服务端渠道，不能替代独立真实上游门禁。最终验收必须让以下 5 个独立场景都实际执行，且结果中 `skipped=false`：

| 场景 ID | 验证对象 | 必需配置 |
| --- | --- | --- |
| `original-images-json` | 原版 QuantumNous/new-api 兼容 Images API JSON | `IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL`、`IMAGE_REAL_SMOKE_ORIGINAL_API_KEY` |
| `gaoren-images-sse` | gaoren002/new-api Images API SSE/keepalive 分支 | `IMAGE_REAL_SMOKE_GAOREN_BASE_URL`、`IMAGE_REAL_SMOKE_GAOREN_API_KEY` |
| `sub2api-images-sse` | Wei-Shaw/sub2api Images API SSE | `IMAGE_REAL_SMOKE_SUB2API_BASE_URL`、`IMAGE_REAL_SMOKE_SUB2API_API_KEY` |
| `sub2api-responses-json` | sub2api Responses image_generation bridge | `IMAGE_REAL_SMOKE_SUB2API_RESPONSES_BASE_URL`、`IMAGE_REAL_SMOKE_SUB2API_RESPONSES_API_KEY` 或复用 `IMAGE_REAL_SMOKE_SUB2API_BASE_URL`、`IMAGE_REAL_SMOKE_SUB2API_API_KEY`；另需 `IMAGE_REAL_SMOKE_SUB2API_RESPONSES_RESPONSES_MODEL` 或 `OPENAI_RESPONSES_API_MODEL` |
| `gpt2image-responses-sse` | GPT2Image 风格 Responses image_generation SSE | `IMAGE_REAL_SMOKE_GPT2IMAGE_BASE_URL`、`IMAGE_REAL_SMOKE_GPT2IMAGE_API_KEY`；另需 `IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL` 或 `OPENAI_RESPONSES_API_MODEL` |

## 常见问题

### 提示未检测到 Node.js

安装 Node.js 20 或更高版本，然后重新执行对应平台的一键启动脚本。

### 依赖安装失败

通常是网络无法访问 npm。确认网络后重新运行对应平台的一键启动脚本，或手动执行 `npm install`。

### API 返回 HTML 页面

说明 API URL 填成了网页或管理后台地址。请填写 OpenAI 兼容接口根地址，通常以 `/v1` 结尾。

### 生成接口提示需要 API Key

在 `.env.local` 写入 `OPENAI_API_KEY`，或在页面右上角 `API 设置` 中填写 API Key。

### 端口被占用

原生启动和 Docker 默认都使用 `4783`。如果端口打不开，先确认是否已有旧进程或旧容器正在运行。

## 技术栈

- Next.js 16
- React 19
- OpenAI JavaScript SDK
- Tailwind CSS 4
- Radix UI
- Dexie IndexedDB

## 变更记录

版本变更和未发布改动记录在 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

MIT

## Docker 镜像运行

默认 `docker-compose.yml` 使用本地构建镜像，适合直接部署当前仓库代码：

```bash
docker compose up -d --build
```

构建出的本地镜像名为 `gpt-image-playground-customer:local`。

如果需要使用已发布的 Docker Hub 镜像，可以用 `docker run` 手动指定镜像。镜像不会内置 `OPENAI_API_KEY`、`OPENAI_API_BASE_URL` 或 `APP_PASSWORD`，运行容器时通过环境变量传入。

### docker run

Linux/macOS：

```bash
docker run -d \
  --name gpt-image-playground-customer \
  --restart unless-stopped \
  -p 4783:4783 \
  -e OPENAI_API_KEY \
  -e OPENAI_API_BASE_URL \
  -e APP_PASSWORD \
  -e AGENT_STATE_BACKEND="sqlite" \
  -e NEXT_PUBLIC_IMAGE_STORAGE_MODE="fs" \
  -v "$(pwd)/generated-images:/app/generated-images" \
  kwokyde/gpt-image-playground:latest
```

Windows PowerShell：

```powershell
docker run -d `
  --name gpt-image-playground-customer `
  --restart unless-stopped `
  -p 4783:4783 `
  -e OPENAI_API_KEY `
  -e OPENAI_API_BASE_URL `
  -e APP_PASSWORD `
  -e AGENT_STATE_BACKEND="sqlite" `
  -e NEXT_PUBLIC_IMAGE_STORAGE_MODE="fs" `
  -v "${PWD}\generated-images:/app/generated-images" `
  kwokyde/gpt-image-playground:latest
```

当前 Dockerfile 使用 Next.js standalone 输出，运行镜像只包含独立服务文件、静态资源和必要依赖，不再复制完整 `node_modules`。
