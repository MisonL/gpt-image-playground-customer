# GPT Image Playground Agent API 参考

## 目录

- [辅助脚本](#辅助脚本)
- [能力查询](#能力查询)
- [Job Polling](#job-polling)
- [生成图片](#生成图片)
- [编辑图片](#编辑图片)
- [产物元数据](#产物元数据)
- [错误](#错误)

## 辅助脚本

脚本位于当前 Skill 目录的 `scripts/` 下。不要硬编码本机安装路径或仓库 checkout 路径；由运行环境按当前 `SKILL.md` 所在目录解析脚本路径。
脚本必须通过 `node "<skill-root>/scripts/..."` 调用，以兼容 Windows、Linux 和 macOS；示例不要依赖 bash、sh、chmod、可执行位、POSIX inline env 或反斜杠续行。
生成、编辑、批量和上游诊断都应先使用这些内置脚本；不要临时编写 Node/Python/shell 脚本、curl 命令或手写 fetch/FormData 来重复实现同一套 API 调用。

- `scripts/generate-image.mjs`：JSON 文生图调用。
- `scripts/edit-image.mjs`：multipart 编辑调用。
- `scripts/batch-images.mjs`：JSONL 批量 generate/edit 调用。
- `scripts/probe-upstream-image.mjs`：上游图片接口连通性探针。

生成、编辑和批量脚本默认只做 dry-run，不触发真实生图或编辑。必须显式添加 `--allow-billable` 才会按 capabilities 路由规则调用 `/api/agent/images/generate`、`/api/agent/images/edit`、`/api/agent/jobs/images/generate` 或页面端 `/api/images` SSE。
上游探针默认只检查 DNS、TLS 和 `/models`，必须显式添加 `--allow-billable` 才会调用上游 `/images/generations`。
脚本支持 `GPT_IMAGE_AGENT_CONTRACT_CHECK=1` 或 `--contract-check` 做只读契约检查，不触发真实生图或编辑。
Agent 端点鉴权以 capabilities 的 `auth.schemes` 为准。配置 `AGENT_API_TOKEN` 时只接受 Bearer token；只有未配置 `AGENT_API_TOKEN` 且配置了 `APP_PASSWORD` 时，Agent 端点才接受访问码哈希 `GPT_IMAGE_APP_PASSWORD_HASH`。页面端 `/api/images` SSE 另看 `agent_streaming.page_sse.auth`；当其声明 `required=true` 时，form-data 必须包含 `passwordHash`。
当服务返回相对 `content_url`、`metadata_url` 或页面 SSE `path` 时，辅助脚本会额外输出 `absolute_content_url`、`absolute_metadata_url` 或 `absolute_path`。
同一个 `Idempotency-Key` 如果已经进入终态 `failed`，再次调用 generate/edit 或 job result/status 只会回放该失败，且 `retryable=false`。需要重新尝试时应创建新的业务操作和新的 `Idempotency-Key`。
页面端 `/api/images` SSE 会把同一个业务 key 复用到 `clientRequestId`，因此脚本使用的 `Idempotency-Key` 不能超过 capabilities 中 `agent_streaming.page_sse.client_request_id.max_length` 声明的字符数；超长时会直接报错，不会静默截断。
脚本会在 dry-run 和真实请求前前置校验 `--size` 或 JSONL `size`。`gpt-image-2` 支持 `auto` 或 `WIDTHxHEIGHT`，且宽高必须为 `16` 的倍数、单边不超过 `3840`、宽高比不超过 `3:1`。最低分辨率按总像素 `min_pixels=655360` 判断，最高分辨率同时受 `max_pixels=8294400` 和 `max_edge=3840` 约束。非 `gpt-image-2` 模型只接受 `auto`、`1024x1024`、`1536x1024` 或 `1024x1536`。

生成脚本参数：

- `--model`：默认 `gpt-image-2`。
- `--size`：默认 `1024x1024`。
- `--quality`：默认 `high`。
- `--n`：默认 `1`。
- `--format`：默认 `png`，`jpg` 会规范化为 `jpeg`。
- `--response-mode`：默认 `path`。
- `--image-backend`：可选，显式选择 `images-api`、`images`、`responses` 或 `responses-image-generation`。
- `--stream-mode`：可选，显式选择 `auto`、`stream` 或 `non_stream`。
- `--streaming-strategy`：可选，显式选择 `off`、`auto`、`openai-sse`、`newapi-keepalive-sse`、`responses-sse` 或 `force-sse`。
- `--partial-images`：可选，显式设置上游 SSE partial image 数量，范围 `1` 到 `3`。
- `--timeout-ms`：默认 `420000`。
- `--prompt-file`：从文本文件读取 prompt。
- `--idempotency-key`：指定稳定幂等键。
- `--page-sse`：强制使用页面端 `/api/images` form-data SSE。
- `--agent`：强制使用 `/api/agent/images/generate` 非流式 JSON。
- `--job`：强制使用 Agent job polling。
- `--dry-run`：只输出将要发送的 JSON。
- `--allow-billable`：允许真实调用生图端点。

`max_edge>2048` 的单次文生图默认优先走页面端 `/api/images` SSE；如果显式传 `--streaming-strategy off`，即使是大图也保持 `/api/agent/images/generate` 非流式 JSON 路径，用于诊断对照。

编辑脚本参数：

- `--model`
- `--size`
- `--quality`
- `--response-mode`
- `--stream-mode`
- `--streaming-strategy`
- `--partial-images`
- `--timeout-ms`
- `--idempotency-key`
- `--page-sse`
- `--agent`
- `--dry-run`
- `--allow-billable`

普通 edit 默认调用 `/api/agent/images/edit`，客户端拿到最终 JSON；`--stream-mode`、`--streaming-strategy` 和 `--partial-images` 只控制 Agent 内部上游流式兼容字段，不代表客户端响应会变成页面 SSE。
`max_edge>2048` 的高分辨率 edit 默认优先走页面端 `/api/images` form-data SSE；失败后脚本输出结构化失败和备用端点建议，由下一步用 `--agent` 显式回退到 `/api/agent/images/edit` 诊断或执行，不会在同一次请求里静默二次调用。显式 `--page-sse` 会强制页面流式；显式 `--agent` 或 `stream_mode=non_stream` / `streaming_strategy=off` 会走 Agent edit 最终 JSON。

批量脚本参数：

- `--input`：JSONL 任务文件路径，也可作为唯一位置参数。
- `--manifest`：append-only JSONL manifest 路径，默认 `<input>.manifest.jsonl`。
- `--resume`：读取 manifest 中已 `succeeded` 的 `id` 或 `idempotency_key` 并跳过。
- `--ordered-prefix`：未显式提供 `idempotency_key` 时构造稳定有序 key 的前缀，默认 `batch`。
- `--dimension-check`：读取响应 `b64_json` 或同 origin `content_url`，校验 PNG/JPEG/WebP 尺寸等于任务 `size`。
- `--timeout-ms`
- `--dry-run`
- `--allow-billable`

批量 JSONL 每行字段按 `mode` 区分。`output_format`、`format`、`output_compression`、`background`、`moderation`、`image_backend`、`responsesModel` 只适用于 `generate`；`image_path`、`image_paths`、`mask_path` 只适用于 `edit`。`responsesModel` 会选择页面 SSE 路径，且必须同时设置 `image_backend=responses-image-generation` 或兼容值 `responses`，因为 Agent JSON 不接收请求级 Responses 顶层模型。`page_sse`、`complex_ui`、`long_image`、`resume_or_recover` 必须是 JSON 布尔值，`transport` 目前只接受 `page_sse`。脚本会在 dry-run 阶段显式拒绝跨模式字段、未知字段和无效路由控制字段，避免参数被真实接口忽略。

上游探针脚本参数：

- `--base-url`
- `--model`
- `--prompt`
- `--size`
- `--quality`
- `--format`
- `--timeout-ms`
- `--allow-billable`

上游探针读取 `GPT_IMAGE_UPSTREAM_BASE_URL` 或 `OPENAI_API_BASE_URL` 作为上游地址，读取 `GPT_IMAGE_UPSTREAM_API_KEY` 或 `OPENAI_API_KEY` 作为上游鉴权。输出不会包含 key，也不会输出完整 base64。

## 能力查询

```http
GET /api/agent/capabilities
```

返回 API 版本、支持的模型、通用限制、模型级限制、Agent 流式边界、鉴权方式、存储模式、状态后端、幂等设置和端点路径。响应不会公开服务端本地 SQLite 文件路径。

关键字段：

- `auth.required`：Agent 端点是否需要鉴权。
- `auth.schemes`：Agent 端点当前实际接受的鉴权方案。`AGENT_API_TOKEN` 优先于 `APP_PASSWORD`，两者同时配置时只返回 `bearer`。
- `model_limits.gpt-image-2.max_edge`：最大单边像素，当前为 `3840`。
- `model_limits.gpt-image-2.max_pixels`：最大总像素，当前为 `8294400`。
- `model_limits.gpt-image-2.edge_multiple`：宽高必须是该值的倍数，当前为 `16`。
- `model_limits.gpt-image-2.max_aspect`：最大长短边比例，当前为 `3`。
- `model_limits.gpt-image-2.min_pixels`：最小总像素，当前为 `655360`。
- `model_limits.gpt-image-2.recommended_presets`：推荐尺寸预设。
- `model_limits.gpt-image-2.large_image_risk`：大尺寸请求的长耗时风险说明，当前适用于 `max_edge>2048`。
- `agent_streaming.generate.mode`：当前为 `non_streaming_only`。
- `agent_streaming.edit.mode`：当前为 `non_streaming_only`。
- `agent_streaming.upstream_sse`：Agent generate/edit 内部消费上游 SSE 的能力，客户端响应仍是最终 `AgentImageResponse` JSON。
- `agent_streaming.upstream_sse.supported`：布尔值；当服务端支持 Agent 内部上游 SSE 消费时为 `true`，否则为 `false`。客户端只在为 `true` 时发送上游流式控制字段。
- `agent_streaming.upstream_sse.request_fields`：兼容旧客户端的字段合集，当前为 `image_backend`、`stream_mode`、`streaming_strategy`、`partial_images`。
- `agent_streaming.upstream_sse.request_fields_by_mode.generate`：generate 可发送的上游 SSE 控制字段，当前为 `image_backend`、`stream_mode`、`streaming_strategy`、`partial_images`。
- `agent_streaming.upstream_sse.request_fields_by_mode.edit`：edit 可发送的上游 SSE 控制字段，当前为 `stream_mode`、`streaming_strategy`、`partial_images`。
- `agent_streaming.upstream_sse.image_backends`：支持 `images-api`、`responses-image-generation`。
- `agent_streaming.upstream_sse.enabled_image_backends`：当前运行时可直接使用的 Agent 上游 SSE 后端；`responses-image-generation` 只有在所需环境变量齐备时才出现。
- `agent_streaming.upstream_sse.streaming_strategies`：支持 `off`、`auto`、`openai-sse`、`newapi-keepalive-sse`、`responses-sse`、`force-sse`。
- `agent_streaming.upstream_sse.stream_modes`：支持 `auto`、`stream`、`non_stream`。
- `agent_streaming.upstream_sse.activation_strategies`：会真正向上游发送 `stream=true` 的策略，当前包含 `auto`、`openai-sse`、`newapi-keepalive-sse`、`responses-sse`、`force-sse`。
- `agent_streaming.page_sse`：页面端 `/api/images` 的 form-data SSE 能力，不代表 Agent generate/edit 支持流式。
- `agent_streaming.page_sse.auth`：页面 SSE 的独立表单鉴权。`APP_PASSWORD` 已配置时为 `required=true`、`schemes=["form-password-hash"]`、`form_field="passwordHash"`。
- `agent_streaming.page_sse.client_request_id`：页面 SSE 的请求 ID 契约。脚本会把 `Idempotency-Key` 写入 form-data `clientRequestId`，最大长度以 `max_length` 为准，当前为 `128`。
- `routing_rules.high_resolution_edit`：`edit` 且最大边大于 `2048` 时默认优先使用页面端 `/api/images` SSE，页面流式有问题时显式回退。
- `routing_rules.complex_ui_batch`：复杂 UI 批量出图推荐使用页面端 `/api/images` SSE。
- `routing_rules.long_image_recovery`：长图恢复或续跑锚点场景推荐使用页面端 `/api/images` SSE。
- `routing_rules.agent_generate_small_smoke`：普通小图单次文生图默认使用 `/api/agent/images/generate`。
- `routing_rules.page_sse_large_generate`：`max_edge>2048` 的单次文生图推荐优先使用 `/api/images` SSE，失败后先诊断，再显式选择 `/api/agent/images/generate` 或 job 路径。
- `routing_rules.retry_recovery`：终态失败不会用同一 `Idempotency-Key` 重新执行，必须诊断后创建新的业务操作和新的 key。
- 批量 JSONL 路由控制字段：`page_sse`、`complex_ui`、`long_image`、`resume_or_recover` 必须是 JSON 布尔值，`transport` 目前只接受 `page_sse`；脚本会在 dry-run 阶段拒绝字符串布尔值和未知 transport。
- `defaults.image_backend`：Agent generate 默认 `images-api`。
- `defaults.stream_mode`：Agent generate 默认 `auto`。auto 会先尝试内部上游 SSE；无法产出最终图时显式回退并暴露可观测标记。
- `defaults.streaming_strategy`：Agent generate 默认 `auto`。
- `defaults.partial_images`：Agent generate 默认 `2`，在 `stream_mode` 不为 `non_stream` 时使用。
- `supported.image_backends`：机器可读的图片后端枚举。
- `supported.enabled_image_backends`：当前运行时可直接使用的图片后端。
- `supported.image_backend_requirements`：每个图片后端的 required env、missing env 和 enabled 状态；Responses 后端需要 `ENABLE_RESPONSES_IMAGE_BACKEND` 与 `OPENAI_RESPONSES_API_MODEL`。
- `supported.streaming_strategies`：机器可读的流式兼容策略枚举。
- `supported.stream_modes`：机器可读的 `auto`、`stream`、`non_stream` 枚举。
- `agent_jobs.supported`：当前为 `true`，表示可使用 job polling。
- `agent_jobs.mode`：当前为 `job_polling`。
- `agent_jobs.endpoints`：路径为 `POST /api/agent/jobs/images/generate`、`GET /api/agent/jobs/{id}`、`GET /api/agent/jobs/{id}/result`。
- `agent_jobs.states`：状态机为 `queued`、`running`、`succeeded`、`failed`、`expired`。

当 `agent_jobs.supported=true` 且 `mode=job_polling` 时，job 路径仍然可用，但普通大图单次文生图的默认路径已经切到页面端 `/api/images` SSE。高分辨率 edit 和复杂 UI 批量生产默认优先按 `routing_rules` 使用页面端 `/api/images` SSE；页面流式有问题时，先诊断再显式选择 Agent JSON、Agent edit 或 job 路径。当前 job polling 是同一服务实例内的后台任务，结果和错误写入 Agent 状态后端；它不是跨实例持久队列。大图页面流式失败后不自动回退，先诊断再显式选新路径。

## Job Polling

```http
POST /api/agent/jobs/images/generate
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
Content-Type: application/json
```

请求体与 `POST /api/agent/images/generate` 相同。创建成功后返回：

```json
{
  "job": {
    "id": "job-request-uuid",
    "request_id": "job-request-uuid",
    "idempotency_key": "stable-key",
    "mode": "generate",
    "state": "running",
    "created_at": "2026-05-20T00:00:00.000Z",
    "updated_at": "2026-05-20T00:00:00.000Z",
    "expires_at": "2026-05-21T00:00:00.000Z",
    "result_url": "/api/agent/jobs/job-request-uuid/result",
    "retry_after_seconds": 5
  }
}
```

轮询状态：

```http
GET /api/agent/jobs/{id}
```

读取结果：

```http
GET /api/agent/jobs/{id}/result
```

`/result` 在运行中返回 `request_in_progress` 和 `Retry-After`；成功后返回标准 `AgentImageResponse`；失败时返回结构化 `AgentError`。失败 job 是终态，`error.retryable` 固定为 `false`，但保留原始错误的 `code`、`message`、`upstream_status` 和 `diagnostics` 用于排查。不存在返回 `job_not_found`，过期返回 `job_expired`。

`GET /api/agent/jobs/{id}` 在 `state=failed` 时，`job.error` 也会返回 `retryable=false`，并携带同样的 `code`、`message`、`upstream_status` 和 `diagnostics` 排障字段；`request_id` 已在 `job.request_id` 中提供。

如果服务进程在 job 结束前重启，客户端应按 `GET /api/agent/jobs/{id}` 返回的状态继续处理；必要时使用相同 `Idempotency-Key` 重新创建同一 job，避免重复业务操作。同一个 key 命中终态 failed job 时只会返回该失败状态，不会触发新执行；需要重新尝试时应创建新的业务操作和新的 `Idempotency-Key`。

## 生成图片

```http
POST /api/agent/images/generate
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
Content-Type: application/json
```

请求：

```json
{
  "prompt": "a product photo of a ceramic mug",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "background": "auto",
  "moderation": "auto",
  "response_mode": "path",
  "image_backend": "images-api",
  "stream_mode": "auto",
  "streaming_strategy": "auto",
  "partial_images": 2
}
```

Agent 生成端点对外始终返回最终 JSON，不会对客户端返回 SSE。不要向该端点发送 `stream: true`。

- 页面 SSE 使用独立的 `POST /api/images` form-data 路径。
- 若 capabilities 中 `agent_streaming.upstream_sse.supported=true`，generate 可通过 `request_fields_by_mode.generate` 声明的字段控制服务端内部上游 SSE 消费。`image_backend=responses-image-generation` 当前只支持 generate。
- Agent 生成端点最终响应仍是 `AgentImageResponse`。
- `stream_mode=stream` 强制流式并直接暴露失败。
- `stream_mode=non_stream` 直接非流式。
- `stream_mode=auto` 允许显式可观测回退。

响应：

```json
{
  "request_id": "uuid",
  "idempotency_key": "stable-key",
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
      "width": 1024,
      "height": 1024
    }
  ],
  "usage": {},
  "created_at": "2026-05-12T00:00:00.000Z"
}
```

## 编辑图片

```http
POST /api/agent/images/edit
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
Content-Type: multipart/form-data
```

字段：

- `prompt`：必填。
- `model`：默认 `gpt-image-2`。
- `n`：`1..10`，默认 `1`。
- `size`：`auto` 或支持的尺寸。
- `quality`：`low`、`medium`、`high` 或 `auto`。
- `response_mode`：`path`、`base64` 或 `both`。
- `stream_mode`：可选，`auto`、`stream` 或 `non_stream`。
- `streaming_strategy`：可选，`off`、`auto`、`openai-sse`、`newapi-keepalive-sse`、`responses-sse` 或 `force-sse`。
- `partial_images`：可选，`1..3`。
- `image_0..image_9`：源图片。类似 `image_10`、`image_01` 或 `image_foo` 的图片字段会被显式拒绝。
- `mask`：可选 PNG 遮罩。

Agent edit 不接受 `image_backend`/`imageBackend`、`output_format`/`outputFormat`/`format`、`output_compression`/`outputCompression`、`responses_model`/`responsesModel`、`background` 或 `moderation`。编辑输出格式固定为 PNG；Responses image_generation 后端当前只支持 generate。

当 `size` 的最大边大于 `2048` 时，默认按 `routing_rules.high_resolution_edit` 使用页面端 `/api/images` form-data SSE 路径；如果页面流式不可用或失败，可显式回退到 Agent edit 最终 JSON 路径进行诊断或执行。

## 产物元数据

```http
GET /api/agent/artifacts/{id}
GET /api/agent/artifacts/{id}/content
DELETE /api/agent/artifacts/{id}
```

所有产物端点都需要和生成接口相同的鉴权。

## 错误

错误使用结构化格式：

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
    "diagnostics": {
      "elapsed_ms": 1234,
      "selected_channel_id": "default",
      "upstream_host": "api.example.test",
      "upstream_status": 524,
      "upstream_event_type": "image_generation.partial_image",
      "partial_image_count": 1,
      "transport_error": false,
      "retry_after_seconds": 15,
      "channel_cooldown_scope": "channel",
      "response_headers": {
        "date": "Wed, 20 May 2026 00:00:00 GMT",
        "cf-ray": "example"
      }
    },
    "request_id": "uuid"
  }
}
```

`diagnostics` 只包含脱敏诊断字段和白名单响应头，不包含 API key、token、完整上游响应体或图片 base64。SDK/网络层只有 `Connection error.` 时，`transport_error` 会是 `true`，但不会伪造 `upstream_status`。

常见错误码：

- `validation_error`
- `unauthorized`
- `configuration_error`
- `idempotency_key_required`
- `idempotency_conflict`
- `request_in_progress`
- `artifact_not_found`
- `job_not_found`
- `job_expired`
- `upstream_rate_limited`
- `upstream_auth_failed`
- `upstream_unavailable`
- `unexpected_error`
