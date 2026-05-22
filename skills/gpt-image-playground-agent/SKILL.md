---
name: gpt-image-playground-agent
description: 当用户需要通过 API 调用已部署的 GPT Image Playground 批量请求图片生成时使用；支持文字生成图片、文字加图片生成图片，并返回可下载图片产物、metadata、base64 或 job 结果。
---

# GPT Image Playground Agent

通过用户已部署的 GPT Image Playground `/api/agent/*` 接口生成或编辑图片。不要假设服务一定在本机；不要模拟网页表单；直接使用 Agent API 契约、幂等键和产物 URL。

## 路由硬规则

- 先读取 `GET /api/agent/capabilities` 的 `routing_rules`，按机器可读规则选择端点。
- `edit` 且 `max(width,height)>2048` 时，必须使用页面端 `POST /api/images` form-data SSE 路径，不要走非流式 `/api/agent/images/edit`。
- 复杂 UI 批量出图优先使用页面端 `POST /api/images` SSE，并记录切换原因、失败清单和续跑锚点。
- 长图恢复或需要续跑锚点的生产请求优先使用页面端 `POST /api/images` SSE，保留局部进度和缺最终图诊断。
- 普通小图单次文生图使用 `/api/agent/images/generate`；`quality=high` 且 `max_edge>=3072` 的单次文生图优先使用 Agent job polling。
- 同一个已进入终态 `failed` 的 `Idempotency-Key` 只会回放失败；重新尝试必须先诊断原因，再创建新的业务操作和新的 key。

## 执行流程

1. 先定位服务基础地址。优先使用用户明确提供的 URL；其次使用 `GPT_IMAGE_PLAYGROUND_URL`；都没有时尝试默认地址 `http://localhost:4783`。
2. 用候选基础地址请求 `GET /api/agent/capabilities`。如果默认地址不可达、404、不是 JSON 或不是 Agent capabilities 响应，向用户询问实际部署地址、端口、域名和是否需要鉴权。
3. 读取 capabilities 中的认证方式、模型、模型级限制、`routing_rules`、Agent 流式边界、状态后端和端点路径；不要硬编码假设部署方式。
4. 为每个业务操作生成稳定的 `Idempotency-Key`。网络中断、运行中轮询或非终态重试复用原 key；同一 key 已进入 `failed` 终态后不再用于触发新执行，必须先诊断原因，再创建新的业务操作和新的 key。
5. 文生图使用 `POST /api/agent/images/generate`，请求体为 JSON。该 Agent 端点对外始终返回最终 `AgentImageResponse` JSON；如 capabilities 声明 `agent_streaming.upstream_sse.supported=true`，可通过 `image_backend`、`streaming_strategy`、`partial_images` 显式启用内部上游 SSE 消费。
6. 图片编辑使用 `POST /api/agent/images/edit`，请求体为 `multipart/form-data`，源图字段使用 `image_0..image_9`。该 Agent 端点同样是非流式端点。
7. 默认使用 `response_mode: "path"`，只在用户明确需要图片内联数据时使用 `base64` 或 `both`。
8. 不要把页面端 `POST /api/images` 当成 Agent 默认路径。它是页面表单和 SSE 路径，capabilities 会以 `agent_streaming.page_sse` 单独声明；仅在 `routing_rules` 命中高分辨率 edit、复杂 UI 批量或明确诊断后切换。
9. 读取 `agent_jobs`。若 `supported=true` 且 `mode=job_polling`，4K/high 或长耗时任务优先走 job/polling。
10. 处理失败时读取结构化 `error.code`、`error.retryable`、`error.diagnostics` 和 `Retry-After`。仅当 `retryable=true` 时等待后重试。
11. 返回结果时优先给出 `content_url`、`metadata_url`、`absolute_content_url`、`absolute_metadata_url`、产物 ID、尺寸、格式和是否命中幂等缓存。

## 鉴权

如果服务端配置了 `AGENT_API_TOKEN`，发送：

```text
Authorization: Bearer <token>
```

此时服务端只接受 Bearer token，不会回退到访问码哈希。如果未配置 `AGENT_API_TOKEN` 但配置了页面访问码 `APP_PASSWORD`，发送 `X-App-Password-Hash`。下载或删除产物时必须复用 capabilities 声明的同一鉴权方式。

## 调用约束

- 不要把 API Key、token 或访问码写入源码、文档示例、日志或测试快照。
- 不要把 `localhost:4783` 当作唯一部署位置；它只是无明确地址时的探测默认值。
- 不要在模型上下文中展开大体积 base64，除非用户明确要求。
- 不要把 `error.message` 当成唯一判断依据；稳定分支以 `error.code` 和 HTTP 状态为准。
- 不要在没有 `Idempotency-Key` 的情况下调用生成或编辑接口。
- 不要对同一个已进入终态 `failed` 的 `Idempotency-Key` 继续重试。终态失败回放会返回 `retryable=false`；需要重新尝试时，先确认失败原因，再创建新的业务操作和新的 `Idempotency-Key`。
- 不要把 `agent_streaming.page_sse.supported=true` 解读为 `/api/agent/images/generate` 会对客户端返回 SSE；Agent generate/edit 对外仍是最终 JSON。`agent_streaming.upstream_sse` 仅表示服务端内部可消费上游 SSE 并保存最终 artifact。
- 不要调用 job endpoints，除非 capabilities 明确返回 `agent_jobs.supported=true` 且 `mode=job_polling`。
- 不要把一次高分辨率、高质量长耗时失败归纳为全局不可用。优先查看 `error.diagnostics.upstream_status`、`upstream_event_type`、`partial_image_count`、`transport_error`、`selected_channel_id`、`channel_cooldown_scope` 和 `retry_after_seconds`。
- 不要在 `error.retryable=false` 时依据历史 `retry_after_seconds` 继续重试同一个 key；终态失败需要新业务操作和新 key。

## Job Polling

当 `agent_jobs.supported=true` 时，长耗时文生图可使用：

1. `POST /api/agent/jobs/images/generate` 创建 job，仍必须提供 `Idempotency-Key`。
2. `GET /api/agent/jobs/{id}` 轮询状态。
3. `GET /api/agent/jobs/{id}/result` 在 `state=succeeded` 后读取标准 `AgentImageResponse`。

`GET /result` 在 job 运行中会返回 `request_in_progress` 和 `Retry-After`；不存在返回 `job_not_found`；过期返回 `job_expired`。同一业务操作重试创建 job 时复用原 `Idempotency-Key`，服务会返回同一个 job。

当前 job polling 是同一服务实例内的后台任务，结果和错误写入 Agent 状态后端；它不是跨实例持久队列。若服务进程在 job 结束前重启，客户端应按状态和错误码继续轮询或重新创建同一 `Idempotency-Key` 的 job。若 job 已进入 `failed` 终态，`GET /result` 和状态摘要都会返回 `retryable=false`，并保留 `code`、`message`、`upstream_status` 和 `diagnostics` 用于定位原因，但同一个 key 不会触发新执行。需要重新尝试时，先确认失败原因，再以新的业务操作和新的 `Idempotency-Key` 创建 job。

## 可用脚本

- `skills/gpt-image-playground-agent/scripts/generate-image.mjs`：JSON 文生图调用。默认 dry-run，不消耗额度；必须添加 `--allow-billable` 才会真实生图。
- `skills/gpt-image-playground-agent/scripts/edit-image.mjs`：multipart 编辑调用。默认 dry-run，不消耗额度；必须添加 `--allow-billable` 才会真实编辑。
- `skills/gpt-image-playground-agent/scripts/probe-upstream-image.mjs`：直接探测上游图片接口连通性。默认只检查 DNS、TLS 和 `/models`，必须添加 `--allow-billable` 才会真实调用 `/images/generations`。

生成和编辑脚本的 dry-run 输出会包含 `routing_guidance`，用于在真实计费前检查当前请求应走 Agent JSON、Agent job polling 还是页面 SSE。

如果当前上下文位于仓库根目录，管理员侧优先使用顶层命令：

- `npm run status`：只读查看 git、Space 目标、Agent API、Skill 入口和独立真实图片上游 smoke 配置摘要；会自动读取 `.env.real-smoke.local`，不输出 URL 或 API Key。
- `npm run doctor`：统一诊断本机与 HF Space 配置，不写 Secret。
- `npm run verify`：运行提交前基线；需要真实 PostgreSQL gate 时加 `-- --postgres`。
- `npm run deploy:local`：重建本地 Docker 服务并探测真实 HTTP 端点；加 `-- --memory` 会断言 memory/indexeddb overlay 生效。
- `npm run deploy:space`：部署干净 git HEAD 到固定 Space，并做只读公网验证。
- `npm run agent:doctor`：执行只读 Agent API 契约检查，不触发真实生图。

生成脚本常用参数：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --size 2048x2048 \
  --quality high \
  --response-mode path \
  --idempotency-key stable-operation-key \
  "a product photo of a ceramic mug"
```

启用 Agent 内部上游 SSE 时，必须显式传策略字段；脚本仍只输出最终 JSON：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --allow-billable \
  --image-backend images-api \
  --streaming-strategy newapi-keepalive-sse \
  --partial-images 2 \
  --size 4096x4096 \
  --quality high \
  "a product photo of a ceramic mug"
```

真实生图必须显式开启：

```bash
node skills/gpt-image-playground-agent/scripts/generate-image.mjs \
  --allow-billable \
  --timeout-ms 420000 \
  --size 2048x2048 \
  "a product photo of a ceramic mug"
```

生成脚本会在 capabilities 声明 `agent_jobs.supported=true` 后，对 `quality=high` 且最大边不小于 3072 的请求自动使用 job polling。也可以用 `--job` 强制 job polling，或用 `--no-job` 强制同步 Agent generate。上游流式字段支持 `--image-backend`、`--streaming-strategy`、`--partial-images`；默认不发送这些字段，保持服务端默认非流式基线。

编辑脚本支持 `--model`、`--size`、`--quality`、`--response-mode`、`--timeout-ms`、`--idempotency-key`、`--dry-run` 和 `--allow-billable`。

直连上游诊断：

```bash
OPENAI_API_KEY=... node skills/gpt-image-playground-agent/scripts/probe-upstream-image.mjs \
  --base-url https://api.openai.com/v1
```

诊断脚本只输出状态、耗时、脱敏错误摘要、白名单响应头和 base64 长度，不输出 API key 或完整图片数据。

上游探针脚本支持 `--base-url`、`--model`、`--prompt`、`--size`、`--quality`、`--format`、`--timeout-ms` 和 `--allow-billable`。默认读取 `GPT_IMAGE_UPSTREAM_BASE_URL` 或 `OPENAI_API_BASE_URL`，API Key 读取 `GPT_IMAGE_UPSTREAM_API_KEY` 或 `OPENAI_API_KEY`。上游 base URL 同样必须是无凭据、无查询参数、无片段的 `http`/`https` 绝对 URL。

脚本读取以下环境变量：

- `GPT_IMAGE_PLAYGROUND_URL`：服务基础地址，可指向本机、局域网、云服务器或域名；脚本未设置时默认尝试 `http://localhost:4783`。
- `GPT_IMAGE_AGENT_TOKEN`：Bearer token。
- `GPT_IMAGE_APP_PASSWORD_HASH`：使用 `APP_PASSWORD` 访问码部署时发送的 `X-App-Password-Hash`。
- `GPT_IMAGE_AGENT_IDEMPOTENCY_KEY`：跨脚本进程恢复同一操作时复用的幂等键。
- `GPT_IMAGE_AGENT_MAX_ATTEMPTS`：最大尝试次数，默认 `3`。
- `GPT_IMAGE_AGENT_CONTRACT_CHECK=1`：只检查 capabilities 和错误契约，不触发真实生图或编辑。

`GPT_IMAGE_PLAYGROUND_URL` 必须是无凭据、无查询参数、无片段的 `http`/`https` 绝对 base URL。不要把 token、访问码或其他 Secret 放进 URL。生成脚本轮询 job result 时只会携带鉴权头访问同 origin URL，避免异常服务返回外部 `result_url` 后泄露 Bearer token 或访问码哈希。

脚本会把服务返回的相对产物路径补充为绝对 URL，适合调用 Hugging Face Space、云服务器或自定义域名上的公网实例。

## 参考

需要字段结构、响应示例或错误码列表时，读取 `references/api.md`。
