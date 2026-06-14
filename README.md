---
sdk: docker
app_port: 4783
---

# GPT Image Playground

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)

面向中文内容运营者的本地 AI 图片创作工作台。它支持 `gpt-image-2` 和 OpenAI 兼容接口，可在浏览器里完成文生图、图生图、遮罩编辑、批量生成、历史复用、费用追踪和结果反馈。

<p align="center">
  <img src="./readme-images/interface.jpg?v=20260608-07b596b" alt="GPT Image Playground 界面" width="900"/>
</p>

## 快速开始

推荐使用 Docker：

```bash
docker compose up -d --build --remove-orphans
```

打开：

```text
http://localhost:4783
```

可选：在 `.env.local` 中配置默认上游；也可以启动后在页面右上角 `API 设置` 填写。

```dotenv
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE_URL=https://api.openai.com/v1
```

原生启动：

```bash
npm install
npm run dev
```

一键脚本：

```text
start-windows.bat
./start-macos.sh
./start-linux.sh
```

## 功能

- 文生图：用提示词生成单图或多图。
- 图生图：上传最多 10 张参考图继续编辑。
- 遮罩编辑：在源图上绘制或上传 PNG mask。
- 批量生成：逐条或显式并发执行多提示词任务。
- 结果工作流：下载、继续编辑、做变体、复用提示词、对比和分享。
- 历史记录：保存提示词、参数、耗时、token、费用估算和实际扣费信息。
- 结果反馈：最近生成可标记为 `可用` 或 `需修改`。
- Agent API：为自动化客户端提供幂等请求、结构化错误和产物追踪。
- 多渠道路由：支持多个 OpenAI 兼容接口和多个 API Key。
- 存储模式：支持服务端文件系统和浏览器 IndexedDB。

## 编辑与遮罩

编辑模式会把参考图、提示词、尺寸、质量、输出格式和可选 mask 一起提交。绘制遮罩后先保存 mask，再发起编辑请求。

<p align="center">
  <img src="./readme-images/mask-creation.jpg?v=20260608-07b596b" alt="遮罩创建" width="900"/>
</p>

## 历史与费用

历史面板记录每次生成或编辑的参数和结果。接口返回 usage 或上游扣费日志时，页面会展示 token 明细、估算费用和实际扣费。

<p align="center">
  <img src="./readme-images/history.jpg?v=20260608-07b596b" alt="历史面板" width="900"/>
</p>

<p align="center">
  <img src="./readme-images/cost-breakdown.jpg?v=20260608-07b596b" alt="费用明细" width="900"/>
</p>

## 配置

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | 服务端默认 API Key；也可在页面 `API 设置` 中填写。 |
| `OPENAI_API_BASE_URL` | OpenAI 兼容接口根地址，通常以 `/v1` 结尾。 |
| `APP_PASSWORD` | 设置后，页面和受保护图片访问需要访问码。 |
| `AGENT_API_TOKEN` | 设置后，`/api/agent/*` 需要 Bearer token。 |
| `NEXT_PUBLIC_IMAGE_STORAGE_MODE` | 图片存储模式：`fs` 或 `indexeddb`。 |
| `AGENT_STATE_BACKEND` | Agent 状态后端：`memory`、`sqlite` 或 `postgres`。 |
| `IMAGE_STREAMING_STRATEGY` | 默认流式策略，默认 `auto`；可设为 `off`、`openai-sse`、`responses-sse` 等。 |
| `IMAGE_GENERATION_BACKEND` | 默认图片后端，默认 `images-api`；可设为 `responses-image-generation`。 |
| `OPENAI_MAX_STREAMS_PER_CREDENTIAL` | 单个渠道凭证允许同时执行的图片请求数，默认 `1`。页面并发批量和服务端队列都会使用该容量。 |
| `OPENAI_CHANNEL_QUEUE_ENABLED` | 渠道凭证并发队列开关，默认 `true`。开启后超出凭证容量的请求会等待可用槽位，而不是立即打到上游。 |
| `OPENAI_CHANNEL_QUEUE_MAX_WAIT_MS` | 渠道凭证并发队列最大等待时间，默认 `420000`。超时返回可重试的队列错误。 |
| `OPENAI_CHANNEL_QUEUE_MAX_SIZE` | 每个渠道凭证的最大等待队列长度，默认 `50`。队列满时返回可重试的队列错误。 |
| `OPENAI_CHANNEL_FAILURE_COOLDOWN_ENABLED` | 渠道或凭证失败冷却开关，默认 `true`；设为 `false` 时失败只记录，不移出路由池。 |
| `OPENAI_CHANNEL_FAILURE_COOLDOWN_MS` | 全局失败冷却时间，默认 `30000`；`OPENAI_CHANNEL_N_FAILURE_COOLDOWN_MS` 可覆盖单个渠道。 |
| `IMAGE_UPSTREAM_TIMEOUT_MS` | 图片上游请求超时，默认 `900000`。必须是正整数。 |
| `IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS` | 已建立图片流的单次数据空闲超时，默认 `900000`；设为 `0` 可禁用。 |
| `IMAGE_UPSTREAM_MAX_RETRIES` | OpenAI SDK 图片请求自动重试次数，默认 `0`，避免长耗时生图超时后重复计费。 |
| `APP_LOG_MAX_ENTRIES` | 服务端本地应用日志保留条数，默认 `300`，可用于扩大 Agent 诊断可回溯窗口。 |

服务端多渠道示例：

```dotenv
OPENAI_ROUTING_STRATEGY=round_robin

OPENAI_CHANNEL_1_ID=official
OPENAI_CHANNEL_1_BASE_URL=https://api.openai.com/v1
OPENAI_CHANNEL_1_API_KEYS=sk-primary

OPENAI_CHANNEL_2_ID=backup
OPENAI_CHANNEL_2_BASE_URL=https://your-compatible-api.example.com/v1
OPENAI_CHANNEL_2_API_KEYS=sk-backup-a,sk-backup-b

OPENAI_CHANNEL_3_ID=matsca
OPENAI_CHANNEL_3_BASE_URL=https://img.matsca.com/v1
OPENAI_CHANNEL_3_API_KEYS=sk-matsca
OPENAI_CHANNEL_3_UPSTREAM_PROFILE=matsca
# Matsca App 模式才需要；直连模式不要设置。
# OPENAI_CHANNEL_3_MATSCA_APP_ID=your-app-id
# OPENAI_CHANNEL_3_MATSCA_APP_SECRET=your-app-secret
```

优先级：

```text
页面 API 设置 > OPENAI_CHANNEL_N_* 渠道池 > OPENAI_API_KEY 单 key 默认配置
```

自定义 API URL 必须同时填写自定义 API Key，避免服务端密钥被发送到未知地址。

图片默认输出格式是 `webp`，默认 `output_compression=100`；需要无损归档或透明边缘复核时，可在页面或脚本里显式选择 `png`。

Matsca 渠道会使用 `matsca` upstream profile：`n` 支持 `1..4`，Images API 流式 `partial_images` 支持 `0..4`，`gpt-image-2` 允许 `transparent` 背景和正整数 `WIDTHxHEIGHT` 尺寸；上传编辑图最多 8 张，单图 10 MB，总量 80 MB。Responses image backend 仍按 `limits.partial_images_by_backend["responses-image-generation"]` 约束，当前不会继承 Matsca 的 `0..4` 范围。`OPENAI_CHANNEL_N_BASE_URL=https://img.matsca.com/v1` 或 `OPENAI_CHANNEL_N_ID=matsca` 会自动识别，也可以显式配置 `OPENAI_CHANNEL_N_UPSTREAM_PROFILE=matsca`。

上游请求头由服务端统一规范。默认 `User-Agent` 是 `gpt-image-playground/<package-version>`；可用 `OPENAI_UPSTREAM_USER_AGENT` 或 `UPSTREAM_USER_AGENT` 覆盖全局 UA，也可用 `OPENAI_CHANNEL_N_USER_AGENT` 和 `OPENAI_CHANNEL_N_UPSTREAM_HEADERS_JSON` 覆盖单渠道安全 header。`Authorization`、`Accept`、`Content-Type`、`Content-Length` 和 `Host` 等协议头不可由 extra headers 覆盖。capabilities、runtime status 和 diagnostics 只暴露 `user_agent_effective`、`has_extra_headers`、`allowed_header_names`、`configured_header_names`，不输出 secret 值。

图片上游传输默认按长耗时生图处理：Images API、Responses image backend 和内部 SSE 收集路径都会使用 `900000ms` 超时；OpenAI SDK 自动重试默认关闭，避免一次页面请求在上游慢返回时变成多次生图计费请求。已建立的图片流如果超过 `IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS` 没有任何数据，会显式返回上游流式超时错误。`GET /api/runtime-capabilities` 和 `GET /api/agent/capabilities` 会暴露脱敏后的图片上游传输配置，供页面和脚本客户端对齐超时。

## Agent API

Agent API 是机器接口，不是自治 Agent 平台。自动化客户端应先读取 capabilities，再按返回的认证方式、路由规则、状态后端和端点能力选择路径。

| 接口 | 用途 |
| --- | --- |
| `GET /api/agent/capabilities` | 查询模型、限制、认证方式和路由规则。 |
| `GET /api/agent/openapi.json` | 获取 OpenAPI 描述。 |
| `POST /api/agent/images/generate` | JSON 文生图。 |
| `POST /api/agent/images/edit` | multipart 图片编辑，支持源图和 mask。 |
| `GET /api/agent/artifacts/{id}` | 查询产物元数据。 |
| `GET /api/agent/artifacts/{id}/content` | 下载产物图片。 |
| `DELETE /api/agent/artifacts/{id}` | 删除 Agent 产物文件和元数据。 |
| `POST /api/agent/jobs/images/generate` | 显式创建文生图 job。 |
| `GET /api/agent/jobs/{id}` | 查询 job 状态。 |
| `GET /api/agent/jobs/{id}/result` | 读取成功 job 的标准图片响应。 |
| `POST /api/agent/page-requests/feedback` | 批量读取页面请求的结果反馈。 |
| `GET /api/agent/page-requests/{id}/feedback` | 读取页面请求的结果反馈。 |
| `POST /api/agent/diagnostics/page-requests` | 批量读取页面请求的日志诊断摘要。 |
| `GET /api/agent/diagnostics/page-requests/{id}` | 读取页面请求的日志诊断摘要。 |
| `GET /api/agent/diagnostics/requests?request_id={id}` | lookup 入口，按 Agent request id 查询 Agent state 请求诊断。 |
| `GET /api/agent/diagnostics/requests?idempotency_key={key}` | lookup 入口，按 Agent 幂等键查询 Agent state 请求诊断。 |
| `GET /api/agent/diagnostics/requests/{id}` | 直接资源入口，按 Agent request id 读取 Agent state 请求诊断。 |

生成示例：

```bash
curl -s http://localhost:4783/api/agent/images/generate \
  -H "Authorization: Bearer your-agent-token" \
  -H "Idempotency-Key: demo-$(date +%s)" \
  -H "Content-Type: application/json" \
  --data '{"prompt":"a product photo of a ceramic mug","model":"gpt-image-2","response_mode":"path"}'
```

仓库内置脚本位于 [skills/gpt-image-playground-agent](./skills/gpt-image-playground-agent/SKILL.md)。默认 dry-run 不触发计费；真实生成必须显式添加 `--allow-billable`。

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --size 1024x1024 \
  --response-mode path \
  "a product photo of a ceramic mug"
```

边界说明：

- `/api/agent/*` 是自动化客户端机器契约，鉴权以 `GET /api/agent/capabilities` 的 `auth.schemes` 为准，响应是最终 JSON，不对客户端返回 SSE。
- 页面端 `POST /api/images` 是 WebUI form-data 路径，支持页面 SSE、`passwordHash` 表单鉴权和 Responses/GPT2Image 高级字段。它通过 capabilities 的 `agent_streaming.page_sse` 暴露给 skill 做路由参考，但不是 Agent JSON schema。
- `GET /api/runtime-capabilities`、`PUT/DELETE /api/feedback`、`POST /api/shares`、`GET /api/logs` 和 `POST /api/image-delete` 是页面 API。它们使用页面访问码、页面 cookie 或页面文件名契约，不使用 Agent Bearer token，也不进入 Agent OpenAPI。
- 最近生成的结果反馈先由页面写入 `/api/feedback`，页面删除历史时会用 `DELETE /api/feedback` 清理对应服务端反馈。Agent 客户端通过 `/api/agent/page-requests/{id}/feedback` 或 `/api/agent/page-requests/feedback` 只读查询；页面日志 SSE `/api/logs` 不接受 Agent token，Agent 客户端通过 `/api/agent/diagnostics/page-requests/{id}` 或 `/api/agent/diagnostics/page-requests` 读取脱敏诊断摘要。诊断摘要来自本地 bounded app log，事件 `diagnostics` 只返回白名单字段和匹配类型，不暴露完整日志上下文。`GET /api/agent/capabilities` 的 `page_request_diagnostics.retention` 和诊断 API 响应的 `diagnostics_retention` 会声明当前保留窗口；`matched_log_count=0` 时响应会带 `diagnostics_note`，表示当前窗口内无匹配日志，不等同于请求未发生。Agent JSON、Agent edit 和 job 请求可通过 `/api/agent/diagnostics/requests/{id}` 或 `/api/agent/diagnostics/requests?idempotency_key=...` 查询 state 诊断，返回状态、时间线、artifact 摘要、timing/execution、错误、冷却/重试摘要、状态后端和 TTL 边界。
- 灵感相册和历史复用属于浏览器工作台体验；当前不作为 Agent capabilities 或机器 API 承诺。
- Agent 产物删除使用 `DELETE /api/agent/artifacts/{id}`；页面图片文件删除使用 `POST /api/image-delete`，两者鉴权和数据模型不同。

边界矩阵：

| 前端能力或端点 | 归属契约 | 进入 Agent OpenAPI | 自动化口径 |
| --- | --- | --- | --- |
| `POST /api/agent/images/generate`、`POST /api/agent/images/edit`、Agent jobs、Agent artifacts | Agent JSON API | 是 | 通过 skill 脚本和 Agent 鉴权调用。 |
| `POST /api/images` | 页面 form-data SSE API | 否 | 默认 WebP edit、输出格式字段、大图、复杂 UI 批量、页面高级字段或路由规则要求时由 skill 显式选择。 |
| `GET /api/runtime-capabilities` | 页面运行态能力 API | 否 | 页面展示运行态默认值、图片上游传输配置、渠道健康、渠道队列和后端 enablement；不是 Agent capabilities。 |
| `PUT/DELETE /api/feedback` | 页面结果反馈写入和清理 API | 否 | 页面把最近生成的可用性标记和备注写入服务端状态；删除历史时清理对应反馈。 |
| `POST /api/agent/page-requests/feedback` | Agent 结果反馈批量只读 API | 是 | Agent 按多个页面 `clientRequestId` 批量查询最新反馈。 |
| `GET /api/agent/page-requests/{id}/feedback` | Agent 结果反馈只读 API | 是 | Agent 按页面 `clientRequestId` 查询最新反馈。 |
| `POST /api/agent/diagnostics/page-requests` | Agent 日志诊断批量只读 API | 是 | Agent 按多个页面 `clientRequestId` 批量查询脱敏日志摘要。 |
| `GET /api/agent/diagnostics/page-requests/{id}` | Agent 日志诊断摘要 API | 是 | Agent 按页面 `clientRequestId` 查询脱敏日志摘要，不直接读取 `/api/logs` SSE。 |
| `GET /api/agent/diagnostics/requests` 和 `GET /api/agent/diagnostics/requests/{id}` | Agent state 请求诊断 API | 是 | Agent 按 request id 或幂等键查询生成、编辑、job 请求状态和脱敏执行摘要。 |
| `POST /api/shares`、`GET /api/shares/{token}`、`POST /api/shares/{token}/content` | 页面分享 API | 否 | 使用页面 cookie、访问码和分享 token，不复用 Agent artifact 下载契约。 |
| `GET /api/logs` | 页面日志 SSE API | 否 | 使用页面访问码哈希的 Bearer 头，不接受 `AGENT_API_TOKEN`。 |
| `POST /api/image-delete` | 页面图片文件删除 API | 否 | 按页面文件名删除 `generated-images/` 文件，不删除 Agent 状态库 artifact。 |
| 灵感相册 | 浏览器本地工作台状态 | 否 | 只服务页面提示词复用，不作为 Agent capabilities。 |
| 历史复用 | 浏览器本地历史状态 | 否 | 只服务页面继续编辑、做变体和复用提示词。 |

## Docker 与部署

默认 Compose 使用 SQLite 状态库和本地图片目录：

```bash
docker compose up -d --build --remove-orphans
```

常见部署模式：

| 模式 | 命令或配置 | 适用场景 |
| --- | --- | --- |
| SQLite | `docker-compose.yml` | 本地单实例和长期本地服务。 |
| Memory | `docker-compose.yml` + `docker-compose.memory.yml` | Hugging Face Space 免费层或临时演示。 |
| PostgreSQL | `docker-compose.yml` + `docker-compose.postgres.yml` | 高并发、多实例或集中状态库。 |

图片默认保存在：

```text
generated-images/
```

Hugging Face Space 免费层部署见 [docs/deployment/huggingface-space-free.md](./docs/deployment/huggingface-space-free.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务，端口 `4783`。 |
| `npm run build` | 执行生产构建。 |
| `npm run start` | 启动 standalone 生产服务，需先执行 `npm run build`。 |
| `npm run test` | 运行测试。 |
| `npm run test:postgres` | 运行真实 PostgreSQL gate；未设置 `AGENT_POSTGRES_TEST_DATABASE_URL` 时会自动启动临时 `postgres:16-alpine` 容器并清理。 |
| `npm run lint` | 检查 `src/` 代码。 |
| `npm run lint:scripts` | 检查仓库脚本和 skill 脚本语法。 |
| `npm run verify` | 运行提交前基线；加 `-- --postgres` 会把真实 PostgreSQL gate 插入 diff 检查前。 |
| `npm run status` | 只读查看 git、Node、Space 目标和 Agent 摘要。 |
| `npm run doctor` | 运行本机和部署诊断。 |
| `npm run deploy:local` | 重建本地 Docker 并探测真实端点。 |
| `npm run deploy:space` | 上传干净 git HEAD 到固定 HF Space。 |
| `npm run agent:doctor` | 非计费 Agent 分层诊断。 |

真实上游 smoke 默认不会触发计费；需要真实生图时必须显式传入 `--allow-billable`。

## 常见问题

| 问题 | 处理 |
| --- | --- |
| 未检测到 Node.js | 安装 Node.js 20 或更高版本。 |
| 依赖安装失败 | 检查 npm 网络后重新执行 `npm install`。 |
| API 返回 HTML | API URL 填成了网页或管理后台；应填写 OpenAI 兼容 `/v1` 根地址。 |
| 提示需要 API Key | 在 `.env.local` 写入 `OPENAI_API_KEY`，或在页面 `API 设置` 中填写。 |
| 端口被占用 | 默认端口是 `4783`，检查旧进程或旧容器。 |
| README 图片没有刷新 | GitHub 可能缓存图片；本仓库截图 URL 带 `?v=` 参数用于刷新缓存。 |

## 文档

- 产品边界：[docs/product/product-contract.md](./docs/product/product-contract.md)
- 用户验证脚本：[docs/product/user-validation-script.md](./docs/product/user-validation-script.md)
- HF Space 部署：[docs/deployment/huggingface-space-free.md](./docs/deployment/huggingface-space-free.md)
- Agent skill：[skills/gpt-image-playground-agent/SKILL.md](./skills/gpt-image-playground-agent/SKILL.md)
- Agent API 参考：[skills/gpt-image-playground-agent/references/api.md](./skills/gpt-image-playground-agent/references/api.md)
- 版本记录：[CHANGELOG.md](./CHANGELOG.md)

## 技术栈

- Next.js 16
- React 19
- OpenAI JavaScript SDK
- Tailwind CSS 4
- Radix UI
- Dexie IndexedDB

## 许可证

MIT
