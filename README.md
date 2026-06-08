---
sdk: docker
app_port: 4783
---

# GPT Image Playground

![Version](https://img.shields.io/badge/version-2.0.0-blue)
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
| `IMAGE_STREAMING_STRATEGY` | 默认流式策略：`off`、`auto`、`openai-sse` 等。 |
| `IMAGE_GENERATION_BACKEND` | 默认图片后端：`images-api` 或 `responses-image-generation`。 |

服务端多渠道示例：

```dotenv
OPENAI_ROUTING_STRATEGY=round_robin

OPENAI_CHANNEL_1_ID=official
OPENAI_CHANNEL_1_BASE_URL=https://api.openai.com/v1
OPENAI_CHANNEL_1_API_KEYS=sk-primary

OPENAI_CHANNEL_2_ID=backup
OPENAI_CHANNEL_2_BASE_URL=https://your-compatible-api.example.com/v1
OPENAI_CHANNEL_2_API_KEYS=sk-backup-a,sk-backup-b
```

优先级：

```text
页面 API 设置 > OPENAI_CHANNEL_N_* 渠道池 > OPENAI_API_KEY 单 key 默认配置
```

自定义 API URL 必须同时填写自定义 API Key，避免服务端密钥被发送到未知地址。

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
| `npm run lint` | 检查 `src/` 代码。 |
| `npm run lint:scripts` | 检查仓库脚本和 skill 脚本语法。 |
| `npm run verify` | 运行提交前基线。 |
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
