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

第一次配置或换机器后，先跑只读就绪检查。它不会写配置、输出密钥或触发真实生图：

```bash
npm run first-run
```

检查公网或 Space 服务时显式传地址；给脚本消费时加 `--json`：

```bash
npm run first-run -- --base-url https://your-space.hf.space
npm run first-run -- --json --base-url https://your-space.hf.space
```

本地服务推荐用 Docker：

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

开发模式：

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
| Responses 顶层模型 | `OPENAI_RESPONSES_API_MODEL` | 仅在 `responses-image-generation` 后端生效；作为 `/responses` 的顶层 `model`，例如 `gpt-5.4`。 |
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
- Responses image backend 需要 `ENABLE_RESPONSES_IMAGE_BACKEND=true` 和 `OPENAI_RESPONSES_API_MODEL`。页面请求也可以用 `responsesModel`、`responses_model`、`gptModel` 或 `gpt_model` 覆盖单次 `/responses` 顶层模型；这些字段只影响本项目的 `responses-image-generation` 路径，不会改变兼容上游自身 `/v1/images/generations` 桥接层内部选择的模型。
- Matsca、extra headers、provider manifest、真实上游 smoke 等高级配置以 [.env.example](./.env.example) 为准。

## Agent API

Agent API 是机器接口，不是自治 Agent 平台。自动化客户端应先读取 capabilities，再按返回的认证、路由和端点能力选择路径。

常用入口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/agent/capabilities` | 查询模型、限制、认证方式和路由规则。 |
| `GET /api/agent/openapi.json` | 获取 OpenAPI 描述。 |
| `POST /api/agent/images/generate` | JSON 文生图。 |
| `POST /api/agent/images/edit` | multipart 图片编辑，支持源图和 mask。 |
| `POST /api/agent/jobs/images/generate` | 创建文生图 job。 |
| `GET /api/agent/jobs/{id}` | 查询 job 状态。 |
| `GET /api/agent/jobs/{id}/result` | 读取成功 job 的标准图片响应。 |
| `GET /api/agent/artifacts/{id}/content` | 下载产物图片。 |
| `POST /api/agent/diagnostics/page-requests` | 批量读取页面请求的脱敏日志诊断摘要。 |
| `GET /api/agent/diagnostics/requests` | 按 request id 或幂等键查询诊断。 |

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

脚本默认 dry-run，不触发真实计费请求；真实生成必须显式添加 `--allow-billable`：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --size 1024x1024 \
  --response-mode path \
  "a product photo of a ceramic mug"
```

### AI Agent 典型使用方式

AI Agent 集成时优先调用 skill 脚本，不要临时手写 fetch、curl 或表单提交逻辑。脚本会处理 capabilities、鉴权、幂等键、路由、超时、产物 URL 和结构化失败摘要。

1. 只读检查当前服务能力，不触发计费：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --contract-check \
  --base-url http://localhost:4783 \
  "capability check"
```

2. dry-run 单张文生图，确认请求字段和路由：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --base-url http://localhost:4783 \
  --size 1024x1024 \
  --quality high \
  --response-mode path \
  --idempotency-key agent-demo-generate-001 \
  "a clean product photo of a ceramic mug"
```

3. 用户明确允许后执行真实请求：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --base-url http://localhost:4783 \
  --allow-billable \
  --timeout-ms 420000 \
  --size 1024x1024 \
  --quality high \
  --response-mode path \
  --idempotency-key agent-demo-generate-001 \
  "a clean product photo of a ceramic mug"
```

4. 图生图：

```bash
node skills/gpt-image-playground-agent/scripts/edit-image.mjs \
  --base-url http://localhost:4783 \
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
  --base-url http://localhost:4783 \
  --input tasks.jsonl \
  --manifest runs/product-set.manifest.jsonl \
  --resume \
  --ordered-prefix product-set
```

6. 失败或结果需要追踪时，用诊断脚本读摘要：

```bash
node skills/gpt-image-playground-agent/scripts/diagnose-request.mjs \
  --base-url http://localhost:4783 \
  --idempotency-key agent-demo-generate-001
```

页面 SSE 请求通常用同一个业务 key 作为 `clientRequestId`：

```bash
node skills/gpt-image-playground-agent/scripts/diagnose-request.mjs \
  --base-url http://localhost:4783 \
  --client-request-id agent-demo-edit-001
```

关键规则：

- 交互式任务中，如果只发现本地服务或 `GPT_IMAGE_PLAYGROUND_URL`，先向用户确认；用户给了 URL 时以用户 URL 为准。
- 远程 Space、云服务或内网服务必须显式传 `--base-url`，避免误用本机默认服务。
- Agent CLI 默认读取当前仓库根目录的 `.env.agent.local`；shell 环境变量优先。首次配置可复制 `.env.agent.local.example`。不要提交 token、访问码或哈希。
- `GPT_IMAGE_AGENT_TOKEN` 只用于 `/api/agent/*`；页面 SSE `/api/images` 可能还需要 `GPT_IMAGE_APP_PASSWORD_HASH`。
- dry-run 只验证本地请求构造；`verification_scope.mode=local_planning_only` 不是远端已可执行。远端合同检查用 `--contract-check`，真实执行必须加 `--allow-billable`。
- 多张真实任务优先用 `batch-images.mjs`、`--manifest`、`--resume` 和 `--dimension-check`；不要手动并行启动多个单张脚本。需要并发时先看 `/api/runtime-capabilities` 的 `streamingBatch.recommendedConcurrency` 和 `channelQueue.capacityPerCredential`。
- 选择 `responses-image-generation` 或兼容别名 `responses` 时，`partial_images` 必须优先按 `partial_images_by_backend["responses-image-generation"]` 校验，不能套用 Matsca Images API 的范围。
- 页面 SSE 返回 503 或断流时，先用诊断脚本读取结构化摘要，再用新的幂等键显式选择备用路径。Agent edit 输出格式和尺寸可能与页面 SSE 不完全一致，尺寸敏感任务必须重新校验或用 `--dimension-check`。
- 排查环境配置时优先运行 `npm run env:summary`，不要直接输出 `.env.local`、`.env*.local`、secret 文件或原始 `docker inspect .Config.Env`。
- Hugging Face Space Secrets 只能写入和列出名称，不能从 CLI 读回 secret 值。
- 边界矩阵精简版：
- `/api/agent/*` 返回最终 JSON；`POST /api/images`、`GET /api/runtime-capabilities`、`/api/feedback`、`/api/shares`、`/api/logs` 和 `POST /api/image-delete` 属于页面或运行态 API，不进入 Agent OpenAPI。Agent 只读反馈和诊断入口是 `/api/agent/page-requests/feedback`、`/api/agent/page-requests/{id}/feedback`、`/api/agent/diagnostics/page-requests` 和 `/api/agent/diagnostics/page-requests/{id}`。灵感相册和历史复用是浏览器工作台体验，不作为机器 API 契约承诺。

## Docker 与部署

默认 Compose 使用 SQLite 状态库和本地图片目录：

```bash
docker compose up -d --build --remove-orphans
```

本地重建并探测真实端点：

```bash
npm run deploy:local
```

本仓库的 Compose 服务只挂载 `generated-images/`。不要用 `docker run -v "$PWD:/workspace"` 启动本地图片上游 fixture；这会把 `.git/`、`node_modules/` 和 `.next/` 暴露给 Docker Desktop 文件共享层，可能触发文件事件风暴。本地 fixture gate 使用进程内服务：

```bash
npm run smoke:image-upstream-local
```

如本机遗留了整仓挂载的 fixture 容器，可执行：

```bash
npm run docker:cleanup-fixtures
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
| `npm run docker:cleanup-fixtures` | 清理遗留的整仓挂载 Docker fixture 容器。 |
| `npm run first-run` | 首次配置就绪检查，默认中文摘要；加 `-- --json` 输出机器可读 JSON。 |
| `npm run status` | 只读查看 git、Node、部署目标和 Agent 摘要。 |
| `npm run doctor` | 运行本机和部署诊断。 |
| `npm run agent:doctor` | 非计费 Agent 分层诊断；支持 `-- --base-url <url>`。 |
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
