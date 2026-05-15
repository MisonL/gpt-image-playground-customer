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

> **4K 出图提示**：如果遇到 4K 分辨率出图失败问题（状态码 `524`），请使用 [superapi 站](https://superapi.buzz/register?aff=W0rz) 提供的 `gpt-image-2` 渠道。该渠道已适配支持 4K 流式出图，价格便宜（`0.0075` 元/张）。

## 快速开始

系统推荐采用 Docker 部署。Docker 运行环境更稳定，依赖隔离更清晰，也更适合长期本地服务或内网服务。

如果不方便使用 Docker，也支持原生启动。仓库提供 Windows、macOS、Linux 三个平台的一键启动脚本，会自动检查 Node.js、创建 `.env.local`、安装依赖并启动浏览器服务。

### 推荐：Docker 部署

1. 准备 `.env.local`：

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
- 流式输出：默认开启，支持生成和编辑过程中的局部图片预览。
- 历史记录：保留提示词、参数、图片、耗时、token 使用量和估算费用。
- 发送到编辑：从生成结果或历史记录直接进入编辑模式。
- 双语和主题：支持中文、英文、亮色、暗色。
- 两种图片存储模式：服务端文件系统或浏览器 IndexedDB。

## 默认行为

- 图片生成默认使用 `quality=high`。如需降低成本或让上游自行选择质量，可在页面或 Agent 请求中显式改为 `auto`、`medium` 或 `low`。
- 页面默认开启流式预览；并发流式批处理仍默认关闭，只有设置 `ENABLE_STREAMING_BATCH=true` 后才会把 `n>1` 拆成多个流式任务。
- 流式请求失败时会显示原始错误状态和排查建议，不会自动改用非流式请求，以避免隐藏网关、限流或上游故障。

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

| 接口 | 用途 |
| --- | --- |
| `GET /api/agent/capabilities` | 查询模型、限制、认证方式、状态后端和端点列表，不公开服务端本地 SQLite 路径。 |
| `GET /api/agent/openapi.json` | 获取机器可读 OpenAPI 描述。 |
| `POST /api/agent/images/generate` | JSON 文生图，默认只返回文件路径和元数据。 |
| `POST /api/agent/images/edit` | multipart 图片编辑，支持源图和 PNG mask。 |
| `GET /api/agent/artifacts/{id}` | 查询产物元数据。 |
| `GET /api/agent/artifacts/{id}/content` | 下载产物图片内容。 |
| `DELETE /api/agent/artifacts/{id}` | 删除产物和元数据。 |

Agent 请求必须带 `Idempotency-Key`，避免超时重试造成重复出图和重复扣费。若设置 `AGENT_API_TOKEN`，请求需携带：

```text
Authorization: Bearer your-agent-token
```

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
| `OPENAI_MAX_STREAMS_PER_CREDENTIAL` | 否 | `1` | 每个服务端 credential 允许同时执行的流式任务数。 |
| `OPENAI_CHANNEL_FAILURE_COOLDOWN_MS` | 否 | `60000` | 服务端 credential 或 channel 失败后的默认冷却时间。 |
| `APP_PASSWORD` | 否 | 无 | 设置后，页面会要求输入访问密码。 |
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
| `AGENT_PUBLIC_BASE_URL` | 否 | `/` | OpenAPI `servers[0].url`，供外部 Agent 生成客户端时使用。 |
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

状态库保存 Agent 请求、幂等、产物元数据和分享元数据，不保存图片二进制。备份时需要同时备份状态库和 `generated-images/`。

如果部署到只读或临时文件系统，可以把 `NEXT_PUBLIC_IMAGE_STORAGE_MODE` 设置为 `indexeddb`。这时图片会保存在浏览器 IndexedDB 中，服务端不落盘。

## Docker 运行

SQLite 单实例默认部署：

```bash
docker compose up -d --build --remove-orphans
```

PostgreSQL 高并发部署：

```bash
GPT_IMAGE_POSTGRES_PASSWORD='<database-password>' \
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

SQLite 与 PostgreSQL 模式共享同一个 Compose project、应用容器名和图片目录。切回 SQLite 模式时使用 `--remove-orphans` 会清理 PostgreSQL service，避免保留不再属于当前配置的容器。

`GPT_IMAGE_POSTGRES_PASSWORD` 只在 PostgreSQL volume 首次初始化时生效。已有 `postgres-data` volume 的部署如果要更换密码，需要先在数据库内修改用户密码，或备份后重建 volume；仅修改环境变量不会自动轮换现有数据库密码。

SQLite 适合单实例本地服务。多实例或长期高并发 Agent 服务应使用 PostgreSQL，不要让多个容器共享同一个 SQLite 文件作为主状态库。

Hugging Face Space 免费层或其他临时容器演示可以使用纯内存状态后端：

```dotenv
AGENT_STATE_BACKEND=memory
NEXT_PUBLIC_IMAGE_STORAGE_MODE=fs
```

`memory` 模式不创建 SQLite 文件，也不连接 PostgreSQL。它只适合无持久化演示、短会话调试或可接受重启丢失 Agent 幂等状态的环境；容器重启后请求记录、artifact 元数据和 replay 状态都会清空。图片二进制仍按 `NEXT_PUBLIC_IMAGE_STORAGE_MODE` 保存，默认 `fs` 会写入当前容器文件系统。

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
| `npm run lint` | 检查 `src/` 代码。 |
| `npm run format` | 格式化 `src/` 下的 TypeScript 和 React 文件。 |

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
  -e NEXT_PUBLIC_IMAGE_STORAGE_MODE="fs" `
  -v "${PWD}\generated-images:/app/generated-images" `
  kwokyde/gpt-image-playground:latest
```

当前 Dockerfile 使用 Next.js standalone 输出，运行镜像只包含独立服务文件、静态资源和必要依赖，不再复制完整 `node_modules`。
