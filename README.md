---
sdk: docker
app_port: 4783
---

# GPT Image Playground

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)

本地 AI 图片创作工作台，面向中文内容运营、设计草图和自动化生图流程。支持 `gpt-image-2`、OpenAI 兼容图片接口、文生图、图生图、遮罩编辑、批量任务、历史复用、费用追踪和 Agent API。

<p align="center">
  <img src="./readme-images/interface.jpg?v=20260608-07b596b" alt="GPT Image Playground 界面" width="900"/>
</p>

## 快速开始

推荐 Docker：

```bash
docker compose up -d --build --remove-orphans
```

打开：

```text
http://localhost:4783
```

可选：复制 `.env.example` 为 `.env.local`，写入默认上游。也可以启动后在页面右上角 `API 设置` 填写。

```dotenv
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE_URL=https://api.openai.com/v1
```

本地开发：

```bash
npm install
npm run dev
```

也可使用平台脚本：

```text
start-windows.bat
./start-macos.sh
./start-linux.sh
```

## 功能概览

- 图片创作：文生图、图生图、遮罩编辑、单图或多图输出。
- 输出控制：尺寸、质量、格式、压缩率、透明背景和流式策略。
- 批量生产：多提示词、多张图、显式并发、失败续跑和 manifest 记录。
- 历史工作流：继续编辑、做变体、复用提示词、下载、分享、删除和反馈。
- 费用与诊断：记录耗时、token、估算费用、实际扣费和脱敏日志摘要。
- 上游路由：支持单 key、多渠道、多 key、OpenAI 兼容接口和渠道队列。
- Agent API：为自动化客户端提供幂等请求、job polling、产物追踪和诊断查询。
- 存储模式：支持服务端文件系统、浏览器 IndexedDB、SQLite、PostgreSQL 和内存状态。

遮罩编辑示例：

<p align="center">
  <img src="./readme-images/mask-creation.jpg?v=20260608-07b596b" alt="遮罩创建" width="900"/>
</p>

历史与费用示例：

<p align="center">
  <img src="./readme-images/history.jpg?v=20260608-07b596b" alt="历史面板" width="900"/>
</p>

## 配置

完整配置说明见 [.env.example](./.env.example)。README 只列常用项。

| 场景 | 变量 | 说明 |
| --- | --- | --- |
| 默认上游 | `OPENAI_API_KEY`、`OPENAI_API_BASE_URL` | 服务端默认 OpenAI 或兼容接口配置。页面 `API 设置` 优先级更高。 |
| 页面访问码 | `APP_PASSWORD` | 设置后访问页面和受保护图片需要访问码。公网部署建议开启。 |
| Agent 鉴权 | `AGENT_API_TOKEN` | 设置后 `/api/agent/*` 需要 Bearer token。 |
| 图片存储 | `NEXT_PUBLIC_IMAGE_STORAGE_MODE` | `fs` 或 `indexeddb`。Docker 默认使用 `fs`。 |
| Agent 状态 | `AGENT_STATE_BACKEND` | `memory`、`sqlite` 或 `postgres`。Docker 默认使用 `sqlite`。 |
| 默认后端 | `IMAGE_GENERATION_BACKEND` | 默认 `images-api`；可设为 `responses-image-generation`。 |
| 流式策略 | `IMAGE_STREAMING_STRATEGY` | 默认 `auto`；可设为 `off`、`openai-sse`、`responses-sse` 等。 |
| 并发容量 | `OPENAI_MAX_STREAMS_PER_CREDENTIAL` | 单个渠道凭证允许同时执行的图片请求数，默认 `1`。 |
| 渠道队列 | `OPENAI_CHANNEL_QUEUE_ENABLED`、`OPENAI_CHANNEL_QUEUE_MAX_WAIT_MS`、`OPENAI_CHANNEL_QUEUE_MAX_SIZE` | 控制超出凭证容量时等待还是立即失败。 |
| 失败冷却 | `OPENAI_CHANNEL_FAILURE_COOLDOWN_ENABLED`、`OPENAI_CHANNEL_FAILURE_COOLDOWN_MS` | 控制失败渠道或凭证是否临时移出路由池。 |
| 上游超时 | `IMAGE_UPSTREAM_TIMEOUT_MS`、`IMAGE_STREAM_DATA_INTERVAL_TIMEOUT_MS`、`IMAGE_UPSTREAM_MAX_RETRIES` | 默认按长耗时图片请求处理，SDK 自动重试默认关闭。 |
| 日志窗口 | `APP_LOG_LEVEL`、`APP_LOG_MAX_ENTRIES` | 控制服务端日志等级和 Agent 诊断可回溯窗口。 |

多渠道示例：

```dotenv
OPENAI_ROUTING_STRATEGY=round_robin

OPENAI_CHANNEL_1_ID=official
OPENAI_CHANNEL_1_BASE_URL=https://api.openai.com/v1
OPENAI_CHANNEL_1_API_KEYS=your-primary-key

OPENAI_CHANNEL_2_ID=backup
OPENAI_CHANNEL_2_BASE_URL=https://your-compatible-api.example.com/v1
OPENAI_CHANNEL_2_API_KEYS=your-backup-key-a,your-backup-key-b

OPENAI_CHANNEL_3_ID=matsca
OPENAI_CHANNEL_3_BASE_URL=https://img.matsca.com/v1
OPENAI_CHANNEL_3_API_KEYS=your-matsca-key
OPENAI_CHANNEL_3_UPSTREAM_PROFILE=matsca
```

优先级：

```text
页面 API 设置 > OPENAI_CHANNEL_N_* 渠道池 > OPENAI_API_KEY 单 key 默认配置
```

注意：

- 自定义 API URL 必须同时填写自定义 API Key，避免服务端密钥被发送到未知地址。
- Docker compose 本身不把默认图片后端改成 Responses；未在 `.env.local` 显式配置时仍是 `images-api` 和 `auto`。
- Responses image backend 需要 `ENABLE_RESPONSES_IMAGE_BACKEND=true` 和 `OPENAI_RESPONSES_API_MODEL`。
- Matsca、extra headers、provider manifest、真实上游 smoke 等高级配置以 [.env.example](./.env.example) 为准。

## Agent API

Agent API 是机器接口，不是自治 Agent 平台。自动化客户端应先读取 capabilities，再按返回的认证方式、路由规则、状态后端和端点能力选择路径。

常用入口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/agent/capabilities` | 查询模型、限制、认证方式、状态后端和路由规则。 |
| `GET /api/agent/openapi.json` | 获取 OpenAPI 描述。 |
| `POST /api/agent/images/generate` | JSON 文生图。 |
| `POST /api/agent/images/edit` | multipart 图片编辑，支持源图和 mask。 |
| `POST /api/agent/jobs/images/generate` | 创建文生图 job。 |
| `GET /api/agent/jobs/{id}` | 查询 job 状态。 |
| `GET /api/agent/jobs/{id}/result` | 读取成功 job 的标准图片响应。 |
| `GET /api/agent/artifacts/{id}/content` | 下载产物图片。 |
| `POST /api/agent/diagnostics/page-requests` | 批量读取页面请求的脱敏日志诊断摘要。 |
| `GET /api/agent/diagnostics/requests` | 按 Agent request id 或幂等键查询 Agent state 请求诊断。 |

生成示例：

```bash
curl -s http://localhost:4783/api/agent/images/generate \
  -H "Authorization: Bearer your-agent-token" \
  -H "Idempotency-Key: demo-$(date +%s)" \
  -H "Content-Type: application/json" \
  --data '{"prompt":"a product photo of a ceramic mug","model":"gpt-image-2","response_mode":"path"}'
```

仓库内置 skill 和脚本：

- [skills/gpt-image-playground-agent/SKILL.md](./skills/gpt-image-playground-agent/SKILL.md)
- [Agent API 参考](./skills/gpt-image-playground-agent/references/api.md)

脚本默认 dry-run，不触发真实计费请求；真实生成必须显式添加 `--allow-billable`。

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --size 1024x1024 \
  --response-mode path \
  "a product photo of a ceramic mug"
```

### AI Agent 典型使用方式

AI Agent 集成时优先调用 skill 内置脚本，而不是临时手写 fetch、curl 或表单提交逻辑。脚本会先读取 capabilities，自动处理鉴权、幂等键、路由选择、超时、产物 URL 和结构化失败摘要。

1. 只读检查当前服务能力，不触发计费：

```bash
GPT_IMAGE_PLAYGROUND_URL=http://localhost:4783 \
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --contract-check \
  "capability check"
```

2. 先 dry-run 单张文生图，确认请求字段和路由：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --size 1024x1024 \
  --quality high \
  --response-mode path \
  --idempotency-key agent-demo-generate-001 \
  "a clean product photo of a ceramic mug"
```

3. 用户明确允许后，再执行真实计费请求：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --allow-billable \
  --timeout-ms 420000 \
  --size 1024x1024 \
  --quality high \
  --response-mode path \
  --idempotency-key agent-demo-generate-001 \
  "a clean product photo of a ceramic mug"
```

4. 图生图默认 WebP 输出，走页面 SSE 路径：

```bash
node skills/gpt-image-playground-agent/scripts/edit-image.mjs \
  --image ./source.png \
  --format webp \
  --output-compression 100 \
  --response-mode path \
  --idempotency-key agent-demo-edit-001 \
  "replace the background with a soft studio gradient"
```

5. 批量任务使用 JSONL 和 manifest，支持续跑：

```jsonl
{"id":"hero-01","mode":"generate","prompt":"a product hero shot of a ceramic mug","size":"1024x1024","response_mode":"path"}
{"id":"edit-01","mode":"edit","prompt":"replace the background with white marble","image_path":"./source.png","size":"1024x1024","response_mode":"path"}
```

```bash
node skills/gpt-image-playground-agent/scripts/batch-images.mjs \
  --input tasks.jsonl \
  --manifest runs/product-set.manifest.jsonl \
  --resume \
  --ordered-prefix product-set
```

真实批量执行时再添加 `--allow-billable`。多张真实任务优先使用 `batch-images.mjs`、`--manifest`、`--resume` 和 `--dimension-check`；不要手动并行启动多个单张脚本，否则会绕过续跑记录、容量反馈和尺寸门禁。需要并发时添加 `--concurrency N`，并确认 `/api/runtime-capabilities` 的 `streamingBatch.recommendedConcurrency` 或 `channelQueue.capacityPerCredential` 允许；建议并发为 `1` 时保持串行。

页面 SSE 返回 503 或断流时，先用诊断脚本读取结构化摘要，再用新的幂等键显式选择备用路径。`edit-image.mjs --agent --stream-mode non_stream --streaming-strategy off` 只适合作为对照诊断；Agent edit 输出格式和尺寸可能与页面 SSE 不完全一致，尺寸敏感任务必须重新校验或用 `--dimension-check`。

排查环境配置时不要直接输出 `.env.local`、`.env*.local`、secret 文件或原始 `docker inspect .Config.Env`。Codex 会话日志会持久保存命令输出；优先运行 `npm run env:summary`，或在命令中先把 `API_KEY`、`TOKEN`、`PASSWORD`、`SECRET` 值替换为 `<redacted>`。

```bash
npm run env:summary
npm run env:summary -- --file .env.local --container gpt-image-playground-customer
```

6. 失败或结果需要追踪时，用诊断脚本读摘要：

```bash
node skills/gpt-image-playground-agent/scripts/diagnose-request.mjs \
  --idempotency-key agent-demo-generate-001
```

页面 SSE 请求通常用同一个业务 key 作为 `clientRequestId`，也可以这样查：

```bash
node skills/gpt-image-playground-agent/scripts/diagnose-request.mjs \
  --client-request-id agent-demo-edit-001
```

常用环境变量：

| 变量 | 用途 |
| --- | --- |
| `GPT_IMAGE_PLAYGROUND_URL` | 指向本机、内网或公网部署地址；默认尝试 `http://localhost:4783`。 |
| `GPT_IMAGE_AGENT_TOKEN` | Agent Bearer token，对应服务端 `AGENT_API_TOKEN`。 |
| `GPT_IMAGE_APP_PASSWORD_HASH` | 使用页面访问码部署时的访问码哈希；页面 SSE 会作为 `passwordHash` 表单字段发送。 |
| `GPT_IMAGE_AGENT_IDEMPOTENCY_KEY` | 跨脚本进程复用同一业务操作的幂等键。 |

接口边界：

- `/api/agent/*` 是自动化机器契约，返回最终 JSON，不向客户端返回 SSE。
- `POST /api/images` 是 WebUI form-data 路径，支持页面 SSE、页面访问码表单鉴权和高级图片字段。
- `GET /api/runtime-capabilities` 是页面运行态能力 API，不进入 Agent OpenAPI。
- 页面反馈、分享、日志和文件删除 API 使用页面鉴权或页面文件名契约，不复用 Agent Bearer token。
- 选择 `responses-image-generation` 或兼容别名 `responses` 时，`partial_images` 必须优先按 `partial_images_by_backend["responses-image-generation"]` 校验，不能套用 Matsca Images API 的范围。
- 灵感相册和历史复用是浏览器工作台体验，不作为机器 API 契约承诺。

边界矩阵：

| 能力或端点 | 归属契约 | 进入 Agent OpenAPI | 自动化口径 |
| --- | --- | --- | --- |
| `POST /api/agent/images/generate`、`POST /api/agent/images/edit`、Agent jobs、Agent artifacts | Agent API | 是 | 通过 skill 脚本和 Agent 鉴权调用。 |
| `POST /api/images` | 页面 form-data SSE API | 否 | 默认 WebP edit、页面高级字段、大图或复杂批量需要时由 skill 显式选择。 |
| `GET /api/runtime-capabilities` | 页面运行态能力 API | 否 | 只读查看流式默认值、图片上游传输、渠道健康和队列状态。 |
| `PUT/DELETE /api/feedback` | 页面结果反馈 API | 否 | 页面写入和清理反馈；Agent 只读查询用 `/api/agent/page-requests/feedback` 或 `/api/agent/page-requests/{id}/feedback`。 |
| `POST /api/agent/page-requests/feedback`、`GET /api/agent/page-requests/{id}/feedback` | Agent 结果反馈只读 API | 是 | Agent 按页面 `clientRequestId` 查询反馈。 |
| `POST /api/agent/diagnostics/page-requests`、`GET /api/agent/diagnostics/page-requests/{id}` | Agent 页面请求诊断 API | 是 | Agent 按页面 `clientRequestId` 查询脱敏日志摘要，不直接读 `/api/logs`。 |
| `GET /api/logs` | 页面日志 SSE API | 否 | 页面使用访问码哈希读取；不接受 Agent token。 |
| `POST /api/shares`、`GET /api/shares/{token}`、`POST /api/shares/{token}/content` | 页面分享 API | 否 | 使用页面 cookie、访问码和分享 token。 |
| `POST /api/image-delete` | 页面图片文件删除 API | 否 | 按页面文件名删除 `generated-images/` 文件，不删除 Agent artifact 状态。 |

## Docker 与部署

默认 Compose 使用 SQLite 状态库和本地图片目录：

```bash
docker compose up -d --build --remove-orphans
```

本地重建并探测真实端点：

```bash
npm run deploy:local
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
| `npm test` | 运行全量测试。 |
| `npm run test:postgres` | 运行真实 PostgreSQL gate。 |
| `npm run lint` | 检查 `src/` 代码。 |
| `npm run lint:scripts` | 检查仓库脚本和 skill 脚本语法。 |
| `npm run version:check` | 检查版本、README badge 和 CHANGELOG 口径。 |
| `npm run verify` | 运行提交前基线。 |
| `npm run status` | 只读查看 git、Node、部署目标和 Agent 摘要。 |
| `npm run doctor` | 运行本机和部署诊断。 |
| `npm run agent:doctor` | 非计费 Agent 分层诊断。 |
| `npm run deploy:space` | 上传干净 git HEAD 到固定 HF Space。 |

真实上游 smoke 默认不会触发计费；需要真实生图时必须显式传入 `--allow-billable`。

## 常见问题

| 问题 | 处理 |
| --- | --- |
| 未检测到 Node.js | 安装 Node.js 20 或更高版本。 |
| 依赖安装失败 | 检查 npm 网络后重新执行 `npm install`。 |
| API 返回 HTML | API URL 填成了网页或管理后台；应填写 OpenAI 兼容 `/v1` 根地址。 |
| 提示需要 API Key | 在 `.env.local` 写入 `OPENAI_API_KEY`，或在页面 `API 设置` 中填写。 |
| 端口被占用 | 默认端口是 `4783`，检查旧进程或旧容器。 |

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
