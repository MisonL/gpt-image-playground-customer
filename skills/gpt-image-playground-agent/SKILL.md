---
name: gpt-image-playground-agent
description: 当用户需要通过已部署的 GPT Image Playground 生成、编辑、批量生成、转换图片格式、查询结果反馈或诊断图片接口时使用；必须优先运行本 Skill 内置 scripts/generate-image.mjs、edit-image.mjs、batch-images.mjs、convert-image-format.mjs、diagnose-request.mjs 或 probe-upstream-image.mjs，而不是临时编写 API 调用脚本。
---

# GPT Image Playground Agent

通过用户已部署的 GPT Image Playground 生成、编辑、批量处理或诊断图片接口。不要假设服务一定在本机；不要模拟网页表单；优先运行本 Skill 内置脚本，让脚本处理 Agent API 契约、capabilities、幂等键、路由选择和产物 URL。

Agent API 是给自动化客户端使用的机器接口，不是自治 Agent 平台。

## 脚本优先规则

- 生成单张或少量图片：优先运行 `scripts/generate-image.mjs`。
- 编辑图片：优先运行 `scripts/edit-image.mjs`。
- 批量 generate/edit：优先运行 `scripts/batch-images.mjs`，用 JSONL 输入和 append-only manifest 管理续跑。
- 转换本地图片格式：优先运行 `scripts/convert-image-format.mjs`。
- 查询页面请求的结果反馈或日志诊断摘要：优先运行 `scripts/diagnose-request.mjs`。
- 诊断上游图片接口：优先运行 `scripts/probe-upstream-image.mjs`。
- 不要临时编写 Node/Python/shell 脚本、curl 命令或手写 fetch/FormData 来重复实现这些脚本已经覆盖的 API 调用。
- 只有在内置脚本缺少用户明确需要的能力时，才修改或扩展 `scripts/` 内的预置脚本，并同步补测试；不要在仓库外留下 ad hoc 调用脚本。
- 先用 dry-run 或 `--contract-check` 检查请求、路由和鉴权；只有用户明确允许真实计费时才加 `--allow-billable`。
- 真实调用成功或失败后，优先读取脚本输出的 `summary`。它是面向 Agent 的机器摘要，包含 `billable`、请求 ID、幂等键、产物 URL、耗时、路由、渠道、上游 host、脱敏请求头、重试和下一步动作；不要再先手查 SQLite、Docker logs 或上游后台。

## 产品边界

Agent API 只作为自动化客户端接口，不作为首战场景或用户验证的主证明。首阶段产品判断以页面工作台上的真实发布任务、结果下载、继续编辑、复用和最近生成里的结果反馈为准。

结果反馈由页面工作台通过 `/api/feedback` 写入和清理，Agent 客户端通过 `/api/agent/page-requests/{id}/feedback` 或 `/api/agent/page-requests/feedback` 只读查询。日志查看的原始流仍是 WebUI/page API `/api/logs`，不接受 Agent token；Agent 客户端通过 `/api/agent/diagnostics/page-requests/{id}` 或 `/api/agent/diagnostics/page-requests` 查询脱敏日志摘要。诊断摘要来自本地 bounded app log，capabilities 的 `page_request_diagnostics.retention` 和诊断响应的 `diagnostics_retention` 声明当前窗口；`matched_log_count=0` 时响应会带 `diagnostics_note`，不等同于请求未发生。Agent JSON、Agent edit 和 job 的请求状态属于 Agent state，可通过 `/api/agent/diagnostics/requests/{request_id}` 或 `/api/agent/diagnostics/requests?idempotency_key=...` 只读查询，返回状态、时间线、artifact 摘要、成功响应 timing/execution、失败错误、状态后端和保留边界。灵感相册和历史复用属于页面工作台和浏览器本地体验，不作为 Agent capabilities 或机器 API 承诺。分享也是 WebUI/page API：分享使用 `/api/shares`、`/api/shares/{token}` 和 `/api/shares/{token}/content`，不进入 Agent OpenAPI，也不要和 `/api/agent/*` 鉴权混用。

## 路由规则

- 先读取 `GET /api/agent/capabilities` 的 `routing_rules`，按机器可读规则选择端点。
- 默认 WebP edit 使用页面端 `POST /api/images` form-data SSE 路径，因为 Agent edit 不接收输出格式字段。需要 Responses image_generation edit 时也必须使用页面 SSE，不要用 `--agent`。显式 `--agent` 才使用 `/api/agent/images/edit` Agent multipart 最终 JSON，输出格式固定为 Agent 契约；如果页面流式不可用或失败，先诊断结构化错误，再显式决定是否用 Agent edit 对照。
- 复杂 UI 批量出图优先使用页面端 `POST /api/images` SSE；需要并发时显式设置 `--concurrency N` 或页面“并发批量”开关，并记录切换原因、失败清单和续跑锚点。
- 长图恢复或需要续跑锚点的生产请求优先使用页面端 `POST /api/images` SSE，保留局部进度和缺最终图诊断。
- 普通小图单次文生图使用 `/api/agent/images/generate`；`max_edge>2048` 的单次文生图默认优先走页面端 `/api/images` SSE，流式失败后先诊断，再显式选择 Agent JSON 或 job 路径，不自动回退。
- 单张文生图使用 `--responses-model`/`--gpt-model`、`--thinking`、`--prompt-optimization` 或 `--force-web` 时走页面端 `/api/images` SSE，因为这些是页面高级字段，不属于 Agent JSON schema。`--responses-model` 必须同时设置 `--image-backend responses-image-generation` 或兼容别名 `responses`；显式 `--agent`、`--job`、`stream_mode=non_stream` 或 `streaming_strategy=off` 会被脚本前置拒绝。
- 同一个已进入终态 `failed` 的 `Idempotency-Key` 只会回放失败；重新尝试必须先诊断原因，再创建新的业务操作和新的 key。

## 执行流程

1. 先按任务类型选择内置脚本，不要从零写 API 调用代码。
2. 定位服务基础地址。优先使用用户明确提供的 URL；其次使用 `GPT_IMAGE_PLAYGROUND_URL`；都没有时尝试默认地址 `http://localhost:4783`。
3. 让脚本请求 `GET /api/agent/capabilities`。如果默认地址不可达、404、不是 JSON 或不是 Agent capabilities 响应，向用户询问实际部署地址、端口、域名和是否需要鉴权。
4. 读取 capabilities 中的认证方式、模型、模型级限制、`image_transport`、`routing_rules`、Agent 流式边界、页面 SSE 鉴权、后端 runtime enablement、状态后端和端点路径；不要硬编码假设部署方式。
5. 为每个业务操作生成稳定的 `Idempotency-Key`。网络中断、运行中轮询或非终态重试复用原 key；同一 key 已进入 `failed` 终态后不再用于触发新执行，必须先诊断原因，再创建新的业务操作和新的 key。
6. 文生图使用 `POST /api/agent/images/generate`，请求体为 JSON。该 Agent 端点对外始终返回最终 `AgentImageResponse` JSON；如 capabilities 声明 `agent_streaming.upstream_sse.supported=true`，可通过 `image_backend`、`stream_mode`、`streaming_strategy`、`partial_images` 控制内部上游 SSE 消费。不要把 `responsesModel`、`thinking`、`promptOptimization` 或 `force_web` 发送到 Agent JSON；这些字段需要页面端 `/api/images` form-data 路径。
7. 图片编辑若走 Agent edit，使用 `POST /api/agent/images/edit`，请求体为 `multipart/form-data`，源图字段必须使用从 `image_0` 开始的连续字段，最大数量以 capabilities 的 `limits.upload_images.max` 为准；跳号、超过当前 profile 上限、`image_01` 或 `image_foo` 会被显式拒绝。该 Agent 端点同样是非流式端点；上游 SSE 字段按 `agent_streaming.upstream_sse.request_fields_by_mode.edit` 发送，不要给 Agent edit 传 `image_backend`。需要 `image_backend=responses-image-generation` 或页面表单字段 `image_streaming_strategy=responses-sse` 的 edit，一律走页面端 `/api/images` form-data SSE；脚本参数仍写作 `--streaming-strategy responses-sse`。
8. 默认使用 `response_mode: "path"`，只在用户明确需要图片内联数据时使用 `base64` 或 `both`。
9. 不要把页面端 `POST /api/images` 当成普通 Agent JSON 路径。它是页面表单和 SSE 路径，capabilities 会以 `agent_streaming.page_sse` 单独声明；仅在 `routing_rules` 命中高分辨率 edit、大图单次文生图、复杂 UI 批量、长图恢复、显式页面参数或明确诊断后切换。
10. 读取 `agent_jobs`。job 路径只在显式选择时使用；`max_edge>2048` 的单次文生图默认优先走页面端 `/api/images` SSE。
11. 处理失败时读取结构化 `error.code`、`error.retryable`、`error.diagnostics` 和 `Retry-After`。仅当 `retryable=true` 时等待后重试。
12. 返回结果时优先给出 `summary`、`content_url`、`metadata_url`、`absolute_content_url`、`absolute_metadata_url`、产物 ID、尺寸、格式和是否命中幂等缓存。回答“4K 非流式花了多久”时优先读 `summary.elapsed_ms`，服务端返回 timing 时也读 `summary.server_elapsed_ms`。
13. 需要查询页面请求后的人工反馈或日志摘要时，使用页面 SSE 的 `clientRequestId` 或脚本复用的 `Idempotency-Key` 调用 `scripts/diagnose-request.mjs --client-request-id ...`；不要直接调用 `/api/logs`。需要查询 Agent state 请求状态时，使用 `scripts/diagnose-request.mjs --agent-request-id ...` 或 `--idempotency-key ...`。

## 鉴权

Agent JSON、Agent edit、job 和 artifact 端点的鉴权以 `auth.schemes` 为准。如果服务端配置了 `AGENT_API_TOKEN`，发送：

```text
Authorization: Bearer <token>
```

此时 Agent 端点只接受 Bearer token，不会回退到访问码哈希。如果未配置 `AGENT_API_TOKEN` 但配置了页面访问码 `APP_PASSWORD`，Agent 端点发送 `X-App-Password-Hash`。下载或删除产物时必须复用 capabilities 声明的同一 Agent 鉴权方式。

页面端 `/api/images` SSE 是独立页面契约，读取 `agent_streaming.page_sse.auth`。当该字段声明 `required=true` 时，必须在 form-data 中发送 `passwordHash`；脚本侧对应环境变量是 `GPT_IMAGE_APP_PASSWORD_HASH`。即使 `auth.schemes` 只返回 `bearer`，混合配置下 page SSE 仍可能需要这个表单访问码哈希。页面 SSE 还会把同一业务 key 写入 form-data `clientRequestId`，长度不得超过 `agent_streaming.page_sse.client_request_id.max_length`。

## 调用约束

- 不要把 API Key、token 或访问码写入源码、文档示例、日志或测试快照。
- Skill 必须保持自包含和可迁移：脚本、示例和说明不得写入本机绝对路径或仓库绝对路径；运行脚本时以当前已安装 Skill 目录为根解析 `scripts/`，不要依赖某台机器上的 checkout 位置。
- Skill 必须兼容 Windows、Linux 和 macOS：脚本只用 Node.js 20+、跨平台 `node:` 标准库和 `package.json` 声明依赖；文档示例用 `node "<skill-root>/scripts/..."`，不依赖 bash、sh、chmod、可执行位、POSIX inline env 或反斜杠续行。
- 不要把 `localhost:4783` 当作唯一部署位置；它只是无明确地址时的探测默认值。
- 不要在模型上下文中展开大体积 base64，除非用户明确要求。
- 不要把 `error.message` 当成唯一判断依据；稳定分支以 `error.code` 和 HTTP 状态为准。
- 不要在没有 `Idempotency-Key` 的情况下调用生成或编辑接口。
- 不要对同一个已进入终态 `failed` 的 `Idempotency-Key` 继续重试。终态失败回放会返回 `retryable=false`；需要重新尝试时，先确认失败原因，再创建新的业务操作和新的 `Idempotency-Key`。
- 不要把 `agent_streaming.page_sse.supported=true` 解读为 `/api/agent/images/generate` 会对客户端返回 SSE；Agent generate/edit 对外仍是最终 JSON。`agent_streaming.upstream_sse` 仅表示服务端内部可消费上游 SSE 并保存最终 artifact。
- 不要调用 job endpoints，除非 capabilities 明确返回 `agent_jobs.supported=true` 且 `mode=job_polling`。
- 不要把一次高分辨率、高质量长耗时失败归纳为全局不可用。优先查看 `error.diagnostics.upstream_status`、`upstream_event_type`、`partial_image_count`、`transport_error`、`selected_channel_id`、`channel_cooldown_scope` 和 `retry_after_seconds`。
- 不要在 `error.retryable=false` 时依据历史 `retry_after_seconds` 继续重试同一个 key；终态失败需要新业务操作和新 key。
- 不要把 `/api/runtime-capabilities`、`/api/feedback`、`/api/shares`、`/api/logs` 或 `/api/image-delete` 当成 Agent API。它们是页面运行态或页面工作流端点，鉴权和字段契约与 `/api/agent/*` 不同；反馈和诊断的 Agent 只读入口是 `/api/agent/page-requests/{id}/feedback`、`/api/agent/page-requests/feedback`、`/api/agent/diagnostics/page-requests/{id}` 和 `/api/agent/diagnostics/page-requests`。

## Job Polling

当 `agent_jobs.supported=true` 时，显式 job 路径可使用：

1. `POST /api/agent/jobs/images/generate` 创建 job，仍必须提供 `Idempotency-Key`。
2. `GET /api/agent/jobs/{id}` 轮询状态。
3. `GET /api/agent/jobs/{id}/result` 在 `state=succeeded` 后读取标准 `AgentImageResponse`。

`GET /result` 在 job 运行中会返回 `request_in_progress` 和 `Retry-After`；不存在返回 `job_not_found`；过期返回 `job_expired`。同一业务操作重试创建 job 时复用原 `Idempotency-Key`，服务会返回同一个 job。

当前 job polling 是同一服务实例内的后台任务，结果和错误写入 Agent 状态后端；它不是跨实例持久队列。若服务进程在 job 结束前重启，客户端应按状态和错误码继续轮询或重新创建同一 `Idempotency-Key` 的 job。若 job 已进入 `failed` 终态，`GET /result` 和状态摘要都会返回 `retryable=false`，并保留 `code`、`message`、`upstream_status` 和 `diagnostics` 用于定位原因，但同一个 key 不会触发新执行。需要重新尝试时，先确认失败原因，再以新的业务操作和新的 `Idempotency-Key` 创建 job。默认大图单次文生图已经切到页面端 `/api/images` SSE，job 不是默认路径。

## 可用脚本

以下脚本都位于当前 Skill 目录的 `scripts/` 下。不要硬编码本机安装路径；由运行环境按当前 `SKILL.md` 所在目录解析脚本路径。

- `scripts/generate-image.mjs`：JSON 文生图调用。默认 dry-run，不消耗额度；必须添加 `--allow-billable` 才会真实生图。
- `scripts/edit-image.mjs`：multipart 编辑调用。默认 dry-run，不消耗额度；必须添加 `--allow-billable` 才会真实编辑。
- `scripts/batch-images.mjs`：JSONL 批量 generate/edit 调用。默认 dry-run，不消耗额度；必须添加 `--allow-billable` 才会真实执行，支持 append-only manifest、`--resume`、`--ordered-prefix`、`--dimension-check`、`--max-attempts`、`--concurrency` 和顺序执行下的 `--max-consecutive-failures`。`--concurrency` 默认 `1`，大于 `1` 时并发执行并按输入顺序输出结果。
- `scripts/convert-image-format.mjs`：本地 PNG/JPEG/WebP 互转。默认输出 WebP，质量 `100`；JPEG 会把透明背景铺成白色，PNG/WebP 保留透明。
- `scripts/diagnose-request.mjs`：按一个或多个页面 `clientRequestId` 只读查询结果反馈和脱敏日志诊断摘要，也可按 Agent `request_id` 或 `idempotency_key` 查询 Agent state 请求诊断；支持读取批量 manifest，不触发生图计费。
- `scripts/probe-upstream-image.mjs`：直接探测上游图片接口连通性。默认只检查 DNS、TLS 和 `/models`，必须添加 `--allow-billable` 才会真实调用 `/images/generations`。

生成和编辑脚本的 dry-run 输出会包含 `routing_guidance`，用于在真实计费前检查当前请求应走 Agent JSON、页面 SSE，或在页面流式失败后先诊断再手动选定后续路径。真实执行输出会包含 `summary`；成功摘要含 `ok=true`、`billable`、`request_id`、`idempotency_key`、`artifact_ids`、`content_urls`、`cached`、`elapsed_ms`、`server_elapsed_ms`、`transport`、`endpoint`、`route_mode`、`image_backend`、`stream_mode`、`streaming_strategy`、`selected_channel_id`、`upstream_host` 和脱敏 `request_headers`。失败摘要含 `transport_error_kind`、`retry_after_ms`、`cooldown_until`、`cooldown_target`、`retryable` 和 `next_action`。
所有生成、编辑、批量和探针脚本在 dry-run 或真实请求前都会校验尺寸参数。`gpt-image-2` 支持 `auto` 或任意正整数 `WIDTHxHEIGHT`；默认 OpenAI-compatible 上游的更严格尺寸边界由服务端 profile 或真实上游显式报错。非 `gpt-image-2` 模型只接受 `auto`、`1024x1024`、`1536x1024` 或 `1024x1536`。生成、页面编辑、批量页面 SSE 和上游探针默认请求 `output_format=webp`、`output_compression=100`；普通 Agent edit 不发送输出格式字段，输出格式固定为 Agent 契约。

如果当前上下文位于仓库根目录，管理员侧优先使用顶层命令：

- `npm run status`：只读查看 git、Space 目标、Agent API、Skill 入口和独立真实图片上游 smoke 配置摘要；会自动读取 `.env.real-smoke.local`，不输出 URL 或 API Key。
- `npm run doctor`：统一诊断本机与 HF Space 配置，不写 Secret。
- `npm run verify`：运行提交前基线；需要真实 PostgreSQL gate 时加 `-- --postgres`。
- `npm run deploy:local`：重建本地 Docker 服务并探测真实 HTTP 端点；加 `-- --memory` 会断言 memory/indexeddb overlay 生效。
- `npm run deploy:space`：部署干净 git HEAD 到固定 Space，并做只读公网验证。
- `npm run agent:doctor`：执行非计费分层诊断，覆盖 capabilities、Agent contract、runtime backend、state backend 和 Responses/GPT2Image readiness；真实 1K/2K smoke 必须显式加 `-- --allow-billable`。

生成脚本常用参数：

```text
node "<skill-root>/scripts/generate-image.mjs" --size 2048x2048 --quality high --response-mode path --idempotency-key stable-operation-key "a product photo of a ceramic mug"
```

常用 preset 可先 dry-run 展开真实参数，不触发计费：

```text
node "<skill-root>/scripts/generate-image.mjs" --preset 1k-smoke-agent "a product photo of a ceramic mug"
node "<skill-root>/scripts/generate-image.mjs" --preset 4k-agent-nonstream "a cinematic landscape"
node "<skill-root>/scripts/generate-image.mjs" --preset 4k-page-sse "a cinematic landscape"
node "<skill-root>/scripts/generate-image.mjs" --preset 4k-upstream-sse-newapi "a cinematic landscape"
```

启用 Agent 内部上游 SSE 时，必须显式传策略字段；脚本仍只输出最终 JSON：

```text
node "<skill-root>/scripts/generate-image.mjs" --allow-billable --image-backend images-api --stream-mode auto --streaming-strategy newapi-keepalive-sse --partial-images 2 --size 3840x2160 --quality high "a product photo of a ceramic mug"
```

真实生图必须显式开启：

```text
node "<skill-root>/scripts/generate-image.mjs" --allow-billable --timeout-ms 420000 --size 2048x2048 "a product photo of a ceramic mug"
```

本地格式转换不触发生图计费：

```text
node "<skill-root>/scripts/convert-image-format.mjs" --format webp --quality 100 ./source.png
node "<skill-root>/scripts/convert-image-format.mjs" --format png --output ./source.png ./source.webp --overwrite
```

生成脚本会对 `max_edge>2048` 的单次文生图默认优先走页面端 `/api/images` SSE；如果 capabilities 未声明 `agent_streaming.page_sse.supported=true`，脚本会显式失败，不会静默降级到 Agent JSON。如果页面流式失败，脚本会返回结构化失败结果，先诊断再决定是否用 `--agent` 或 `--job` 重新执行，不会自动发起第二次请求。单张 generate 也支持 `--responses-model`/`--gpt-model`、`--thinking`、`--prompt-optimization` 和 `--force-web`；这些字段会进入页面 SSE form-data，dry-run 会显示 page SSE 路由，真实请求会发送 `responsesModel`、`thinking`、`promptOptimization` 和 `force_web`。默认 WebP edit 走页面 SSE；显式 `--agent` 才走 Agent multipart 最终 JSON，输出格式固定为 Agent 契约。Responses image_generation edit 属于页面 SSE 路径：可显式传 `--page-sse --image-backend responses-image-generation --streaming-strategy responses-sse`；如果运行时已显式配置 `IMAGE_GENERATION_BACKEND=responses-image-generation` 或兼容别名 `responses`，且 `IMAGE_STREAMING_STRATEGY=responses-sse`，也可以依赖服务端默认值。Docker compose 本身不设置这两个默认值，未配置 `.env.local` 时仍是 `images-api` 和 `auto`。不要为 Responses edit 加 `--agent`。显式传 `--streaming-strategy off` 或 `--stream-mode non_stream` 时，大图 generate 保持 Agent JSON 非流式路径；默认 WebP edit 与非流式策略冲突时脚本前置拒绝，除非显式添加 `--agent` 做 Agent JSON 对照。页面高级 edit 字段与非流式策略冲突时脚本同样前置拒绝。上游流式字段优先读取 `agent_streaming.upstream_sse.request_fields_by_mode`：generate 支持 `--image-backend`、`--stream-mode`、`--streaming-strategy`、`--partial-images`；Agent edit 只支持 `--stream-mode`、`--streaming-strategy`、`--partial-images`。页面 SSE edit 可发送 `image_backend` 和表单字段 `image_streaming_strategy`；CLI 参数是 `--streaming-strategy`，batch JSONL 字段是 `streaming_strategy`。

generate 或页面 SSE 请求包含 `image_backend` 时，`partial_images` 必须先按 `limits.partial_images_by_backend[image_backend]` 校验；capabilities 没有该字段时才退回 `limits.partial_images`。Agent edit 不接受 `image_backend`，其内部上游流式字段按默认 Images API/profile 范围校验；Responses backend edit 需要页面 SSE。不要把 Matsca `limits.partial_images=0..4` 误套到 `responses-image-generation`，Responses backend 当前使用自己的 `1..3` 范围。

批量脚本 JSONL 每行是一个 generate 或 edit 任务。示例：

```jsonl
{"id":"hero-01","mode":"generate","prompt":"a product photo of a ceramic mug","size":"1024x1024","response_mode":"path"}
{"id":"edit-01","mode":"edit","prompt":"replace the background","image_path":"./source.png","size":"1024x1024","response_mode":"path"}
```

默认 dry-run 只解析 JSONL、生成稳定幂等键并输出计划，不请求服务：

```text
node "<skill-root>/scripts/batch-images.mjs" --input tasks.jsonl --ordered-prefix product-set
```

真实批量执行必须显式允许计费。需要并发时添加 `--concurrency N`；需要严格连续失败熔断时保持 `--concurrency 1`：

```text
node "<skill-root>/scripts/batch-images.mjs" --allow-billable --input tasks.jsonl --manifest runs/product-set.manifest.jsonl --resume --dimension-check --max-attempts 2 --max-consecutive-failures 3
node "<skill-root>/scripts/batch-images.mjs" --allow-billable --input tasks.jsonl --manifest runs/product-set.manifest.jsonl --resume --dimension-check --max-attempts 2 --concurrency 3
```

`--manifest` 使用 JSONL append-only 记录每条任务的 `index`、`id`、`idempotency_key`、`attempt`、`status`、响应或错误以及机器可读 `summary`；`--resume` 会读取已成功记录并跳过同一 `id` 或 `idempotency_key`。`--dimension-check` 会读取响应里的 `b64_json` 或同 origin `content_url`，校验 PNG/JPEG/WebP 尺寸是否等于任务 `size`。`--max-attempts` 会为第二次及以后尝试追加新的 attempt 级 idempotency key，避免复用终态失败 key；`--concurrency` 大于 `1` 时会并发执行任务并按输入顺序输出结果。`--max-consecutive-failures` 会在连续失败达到阈值后跳过后续任务并输出 `failure_summary` 与 `resume_fix_list`，且只能与顺序执行的 `--concurrency 1` 同用。任务级 `sse_log_path` 会把页面 SSE 原始事件按 JSONL 追加保存；即使 fetch 或 SSE 收集阶段失败，也会记录 `request_started`、`request_failed`、`elapsed_ms`、`client_request_id` 和 `endpoint`，便于区分上游未给终图和解析/断流问题。

批量 JSONL 字段按模式区分：`background` 只适用于 `generate`；`image_path`、`image_paths`、`mask_path` 只适用于 `edit`。默认 WebP edit 任务走页面 SSE；如需 Agent edit 固定输出，请拆成单张 `edit-image.mjs --agent`。`output_format`、`format`、`output_compression`、`moderation`、`image_backend`、`streaming_strategy`、`partial_images`、`responsesModel`/`gptModel`/`gpt_model`、`thinking`、`promptOptimization`/`prompt_optimization`、`force_web`/`forceWeb` 可用于页面 SSE 路径。edit 任务设置 `image_backend=responses-image-generation` 时会走页面 SSE；不要把它改成 Agent edit。`responsesModel` 必须同时设置 `image_backend=responses-image-generation` 或兼容值 `responses`。JSONL 字段名必须使用 `streaming_strategy`；`image_streaming_strategy` 是页面 form-data 字段名，不是 batch JSONL 字段，会被脚本在真实请求前拒绝。PNG 搭配 `output_compression` 会在 dry-run 标记 normalization，真实请求不会发送压缩字段。`page_sse`、`complex_ui`、`long_image`、`resume_or_recover` 必须是 JSON 布尔值，`transport` 目前只接受 `page_sse`。脚本会在 dry-run 阶段显式拒绝跨模式字段、未知字段和无效路由控制字段。

编辑脚本支持位置参数 `<image-path> <prompt>`，也支持 `--image <path> <prompt>` 别名；不要同时传两种图片路径。常用选项包括 `--model`、`--size`、`--quality`、`--response-mode`、`--format`、`--output-compression`、`--moderation`、`--image-backend`、`--responses-model`、`--thinking`、`--prompt-optimization`、`--force-web`、`--stream-mode`、`--streaming-strategy`、`--partial-images`、`--timeout-ms`、`--idempotency-key`、`--page-sse`、`--agent`、`--dry-run` 和 `--allow-billable`。其中 `--image-backend responses-image-generation` 只用于页面 SSE edit。

直连上游诊断：

```text
node "<skill-root>/scripts/probe-upstream-image.mjs" --base-url https://api.openai.com/v1
```

页面请求反馈和日志诊断：

```text
node "<skill-root>/scripts/diagnose-request.mjs" --client-request-id stable-operation-key --filename output.png
node "<skill-root>/scripts/diagnose-request.mjs" --manifest runs/product-set.manifest.jsonl --filename output.png
node "<skill-root>/scripts/diagnose-request.mjs" --manifest runs/product-set.manifest.jsonl --output runs/diagnosis.json
node "<skill-root>/scripts/diagnose-request.mjs" --agent-request-id req_abc
node "<skill-root>/scripts/diagnose-request.mjs" --idempotency-key stable-operation-key
```

调用前按当前系统和 shell 设置 `OPENAI_API_KEY` 或 `GPT_IMAGE_UPSTREAM_API_KEY`，不要把 key 写进命令历史或文档。

诊断脚本只输出状态、耗时、脱敏错误摘要、白名单响应头、Agent state 摘要和 base64 长度，不输出 API key、完整 prompt、完整图片数据或本地文件路径。

上游探针脚本支持 `--base-url`、`--model`、`--prompt`、`--size`、`--quality`、`--format`、`--output-compression`、`--timeout-ms` 和 `--allow-billable`。默认读取 `GPT_IMAGE_UPSTREAM_BASE_URL` 或 `OPENAI_API_BASE_URL`，API Key 读取 `GPT_IMAGE_UPSTREAM_API_KEY` 或 `OPENAI_API_KEY`。上游 base URL 同样必须是无凭据、无查询参数、无片段的 `http`/`https` 绝对 URL。

脚本读取以下环境变量：

- `GPT_IMAGE_PLAYGROUND_URL`：服务基础地址，可指向本机、局域网、云服务器或域名；脚本未设置时默认尝试 `http://localhost:4783`。
- `GPT_IMAGE_AGENT_TOKEN`：Bearer token。
- `GPT_IMAGE_APP_PASSWORD_HASH`：使用 `APP_PASSWORD` 访问码部署时，Agent 端点发送为 `X-App-Password-Hash`，页面 SSE 发送为 form-data `passwordHash`。
- `GPT_IMAGE_AGENT_IDEMPOTENCY_KEY`：跨脚本进程恢复同一操作时复用的幂等键；也供 `diagnose-request.mjs` 按 Agent 幂等键查询 state。脚本不会自动重试已终态失败的 key。
- `GPT_IMAGE_AGENT_CLIENT_REQUEST_ID`：供 `diagnose-request.mjs` 读取的页面请求 ID；页面 SSE 路径通常等于脚本使用的 `Idempotency-Key`，多个 ID 可重复传 `--client-request-id`。
- `GPT_IMAGE_AGENT_REQUEST_ID`：供 `diagnose-request.mjs` 读取 Agent state 请求诊断的 Agent `request_id`。
- `GPT_IMAGE_AGENT_MAX_ATTEMPTS`：最大尝试次数，默认 `3`。
- `GPT_IMAGE_AGENT_CONTRACT_CHECK=1`：只检查 capabilities 和错误契约，不触发真实生图或编辑。

上游请求头由服务端统一生成。默认 `User-Agent` 是 `gpt-image-playground/<package-version>`；可用 `OPENAI_UPSTREAM_USER_AGENT` 或 `UPSTREAM_USER_AGENT` 覆盖全局 UA，也可用 `OPENAI_CHANNEL_N_USER_AGENT` 和 `OPENAI_CHANNEL_N_UPSTREAM_HEADERS_JSON` 覆盖单渠道安全 header。`Authorization`、`Accept`、`Content-Type`、`Content-Length` 和 `Host` 等协议头不可由 extra headers 覆盖；capabilities、status 和 diagnostics 只暴露 `user_agent_effective`、`has_extra_headers`、`allowed_header_names` 和 `configured_header_names`，不暴露 secret 值。

`GPT_IMAGE_PLAYGROUND_URL` 必须是无凭据、无查询参数、无片段的 `http`/`https` 绝对 base URL。不要把 token、访问码或其他 Secret 放进 URL。生成脚本轮询 job result 时只会携带鉴权头访问同 origin URL，避免异常服务返回外部 `result_url` 后泄露 Bearer token 或访问码哈希。

脚本会把服务返回的相对产物路径补充为绝对 URL，页面 SSE 的相对 `path` 会补充 `absolute_path`，适合调用 Hugging Face Space、云服务器或自定义域名上的公网实例。

## 参考

需要字段结构、响应示例或错误码列表时，读取 `references/api.md`。
