---
name: gpt-image-playground-agent
description: 当用户需要通过已部署的 GPT Image Playground 生成、编辑、批量生成、转换图片格式、查询结果反馈或诊断图片接口时使用；必须优先运行本 Skill 内置 scripts/generate-image.mjs、edit-image.mjs、batch-images.mjs、convert-image-format.mjs、diagnose-request.mjs 或 probe-upstream-image.mjs，而不是临时编写 API 调用脚本。
---

# GPT Image Playground Agent

通过用户已部署的 GPT Image Playground 生成、编辑、批量处理或诊断图片接口。不要假设服务一定在本机；不要模拟网页表单；优先运行本 Skill 内置脚本，让脚本处理 Agent API 契约、capabilities、幂等键、服务端编排入口和产物 URL。

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
- 先用 dry-run、`--check-remote` 或 `--contract-check` 检查请求、路由、鉴权和服务声明的默认编排入口；只有用户明确允许真实计费时才加 `--allow-billable`。
- 真实调用成功或失败后，优先读取脚本输出的 `summary`。它是面向 Agent 的机器摘要，包含 `billable`、请求 ID、幂等键、产物 URL、耗时、耗时拆分、路由、渠道、上游 host、脱敏请求头、重试和下一步动作；Agent JSON 失败时脚本会按幂等键做一次只读 Agent state 诊断补采样，补充 `agent_diagnostics_checked`、`agent_diagnostics_found`、`agent_diagnostics_unavailable_reason`、`agent_diagnostics_http_status`、`request_id`、渠道和上游 host。不要再先手查 SQLite、Docker logs 或上游后台。
- 新增 probe、diagnostics、路由健康或请求旅程能力时，先在服务端定义机器 API 契约，并通过 `GET /api/agent/capabilities`、`GET /api/agent/openapi.json` 或明确的 `/api/agent/diagnostics/*` 端点声明；Skill 脚本只做薄封装，不能复制页面 API、运行态 API 和 Agent API 的边界判断。

## 产品边界

Agent API 只作为自动化客户端接口，不作为首战场景或用户验证的主证明。首阶段产品判断以页面工作台上的真实发布任务、结果下载、继续编辑、复用和最近生成里的结果反馈为准。

结果反馈由页面工作台通过 `/api/feedback` 写入和清理，Agent 客户端通过 `/api/agent/page-requests/{id}/feedback` 或 `/api/agent/page-requests/feedback` 只读查询。日志查看的原始流仍是 WebUI/page API `/api/logs`，不接受 Agent token；Agent 客户端通过 `/api/agent/diagnostics/page-requests/{id}` 或 `/api/agent/diagnostics/page-requests` 查询脱敏日志摘要。诊断摘要来自本地 bounded app log，capabilities 的 `page_request_diagnostics.retention` 和诊断响应的 `diagnostics_retention` 声明当前窗口；`matched_log_count=0` 时响应会带 `diagnostics_note`，不等同于请求未发生。Agent JSON、Agent edit 和 job 的请求状态属于 Agent state，可通过 `/api/agent/diagnostics/requests/{request_id}` 或 `/api/agent/diagnostics/requests?idempotency_key=...` 只读查询，返回状态、时间线、artifact 摘要、成功响应 timing/execution、失败错误、状态后端和保留边界。灵感相册和历史复用属于页面工作台和浏览器本地体验，不作为 Agent capabilities 或机器 API 承诺。Agent artifact 原始下载 URL 仍需要 Agent 鉴权；需要给用户浏览器访问时，使用 `POST /api/agent/artifacts/{id}/share` 或生成脚本 `--share` 显式创建分享链接。分享链接使用 `/share/{token}` 和 `/api/shares/{token}/content` 的随机 token/访问码模型，不把 Agent token 放进 URL。

## 路由规则

- 先读取 `GET /api/agent/capabilities` 的 `orchestration` 与 `routing_rules`。普通文生图默认提交业务意图到 `orchestration.endpoint`，当前为 `POST /api/agent/image-requests`；服务端负责选择内部执行路径、上游策略和 job polling。Agent 客户端不要按尺寸、远端 HTTPS 或流式策略自行选择 `/api/images`、`/api/agent/images/generate` 或 job endpoint。
- `capabilities.supported.request_modes`、`capabilities.upstream_request_headers.channels[].request_modes` 和 `capabilities.request_mode_controls` 是服务端管理员配置的渠道请求方式白名单与诊断控制面；Agent 客户端不要据此绕过 `orchestration.endpoint` 自行挑选 Images、Responses、SSE 或非流式路径。

执行决策表：

| 场景 | Agent 输入 | 服务端职责 | 结果字段 |
| --- | --- | --- | --- |
| 普通文生图 | prompt、尺寸、质量等业务意图 | 通过 `orchestration.endpoint` 选择 Agent/job、渠道、Images/Responses、SSE/非流式 | `summary.transport`、`summary.route_mode`、`summary.channel_request_mode`、`summary.route_decision` |
| 自动上游流式 | `stream_mode=auto` 或默认值 | 若 SSE 渠道不可用，可在服务端显式退到非流式并标记 fallback | `summary.channel_request_mode_fallback_applied=true` |
| 显式流式诊断 | `stream_mode=stream` 或显式 `--page-sse` | 失败必须显式返回错误，不静默改成非流式 | `summary.route_decision.no_channel_reason` 或结构化错误 |
| 管理员渠道白名单 | `OPENAI_UPSTREAM_REQUEST_MODES`、`OPENAI_CHANNEL_N_REQUEST_MODES` | 只约束服务端可选渠道，不授权 Agent 客户端自选 endpoint | `capabilities.request_mode_controls`、`agent:doctor.summary.request_modes` |

- 默认 WebP edit 使用页面端 `POST /api/images` form-data SSE 路径，因为 Agent edit 不接收输出格式字段。需要 Responses image_generation edit 时也必须使用页面 SSE，不要用 `--agent`。显式 `--agent` 才使用 `/api/agent/images/edit` Agent multipart 最终 JSON，输出格式固定为 Agent 契约；如果页面流式不可用或失败，先诊断结构化错误，再用新的 `Idempotency-Key` 显式决定是否用 Agent edit 对照。Agent edit 只是对照路径，不保证与页面 SSE 的输出格式和像素尺寸完全一致；尺寸敏感任务必须用 `--dimension-check` 或下载后校验。
- `capabilities` 里声明的 `page_sse_supported=true`、`agent_streaming.upstream_sse.supported=true` 只表示路径被声明支持，不表示当前渠道每次实测都能成功；如果页面 SSE、Responses 路径或服务端编排入口返回 `503`、断流，或 `summary` 里 `selected_channel_id`、`upstream_host` 为空，先诊断结构化错误，再用新的 `Idempotency-Key` 显式选择诊断路径，不自动回退。
- 复杂 UI 批量出图优先使用页面端 `POST /api/images` SSE 和 `scripts/batch-images.mjs`；不要手动并行启动多个单张脚本，因为这会绕过 manifest、`--resume`、`capacity_feedback` 和尺寸门禁。需要并发时显式设置 `--concurrency N` 或页面“并发批量”开关，并记录切换原因、失败清单和续跑锚点。
- 真实批量并发前先看 `GET /api/runtime-capabilities` 的 `channelQueue.capacityPerCredential` 和 `streamingBatch.recommendedConcurrency`。如果服务端建议并发为 `1`，或返回 `channel_capacity_queue_aborted` / `retry_after_seconds`，同一渠道任务保持 `--concurrency 1`，不要用多个 shell 进程绕过限流。
- 复杂 UI、长 prompt、高质量图生图遇到 5 分钟级超时、连接中断或上游 503 时，不要把失败归因到提示词质量；先读 `summary` 和诊断，再用新 key 显式尝试压缩 prompt 或改为 `quality=medium` 的对照请求，并记录这是稳定性取舍。
- 长图恢复或需要续跑锚点的生产请求优先使用页面端 `POST /api/images` SSE，保留局部进度和缺最终图诊断。
- 普通单次文生图默认使用 `POST /api/agent/image-requests`。`--agent`、`--job`、`--page-sse` 是显式诊断或兼容开关：`--agent` 直连 `/api/agent/images/generate`，`--job` 直连 `/api/agent/jobs/images/generate`，`--page-sse` 直连页面端 `/api/images` SSE。不要把这些显式开关当成默认自动路由。
- 单张文生图使用 `--responses-model`/`--gpt-model`、`--thinking`、`--prompt-optimization` 或 `--force-web` 时仍提交到服务端编排入口，由服务端选择 Responses image_generation、Images API、SSE 或非流式执行方式。`--responses-model` 覆盖本次请求的 Responses 顶层模型；未传时使用服务端 `OPENAI_RESPONSES_API_MODEL`。该字段只影响本项目 `responses-image-generation` 路径，不改变兼容上游自身 Images API 桥接层内部选择的模型。`--responses-model` 必须同时设置 `--image-backend responses-image-generation` 或兼容别名 `responses`；显式 `--page-sse` 才直连页面端 `/api/images` SSE 做诊断。
- 同一个已进入终态 `failed` 的 `Idempotency-Key` 只会回放失败；重新尝试必须先诊断原因，再创建新的业务操作和新的 key。

## 执行流程

1. 先按任务类型选择内置脚本，不要从零写 API 调用代码。
2. 定位服务基础地址。用户明确提供 URL 时直接使用该 URL；否则先检查 `GPT_IMAGE_PLAYGROUND_URL`，再探测默认本地地址 `http://localhost:4783`。
3. 交互式任务中，如果只发现环境变量或本地默认地址，先把发现到的地址、服务可达性和鉴权需求告诉用户，并确认是否使用它；不要把自动发现到的本地服务直接当成用户意图。如果用户随后提供其他服务地址，以用户提供的地址为准。
4. 非交互式任务无法向用户确认时，按“用户提供 URL > `GPT_IMAGE_PLAYGROUND_URL` > 默认本地探测地址”的顺序执行，并在输出里标明服务地址来源和是否只是自动发现。
5. 位于仓库根目录且用户是首次配置、换机器、服务地址不确定或 token 不确定时，先运行 `npm run first-run`。该命令只读、非计费、不写 env 文件，默认输出中文摘要；`-- --json` 输出机器可读 JSON。它会报告 `service_base_url_source`、`interactive_confirmation_required`、服务可达性、当前进程是否拿到 Agent 鉴权、页面 SSE 鉴权是否可用，以及 `.env.agent.local` 是否存在私有鉴权配置。Agent CLI 默认从当前仓库根目录自动读取 `.env.agent.local`，shell 环境变量优先；如需禁用自动读取，设置 `GPT_IMAGE_AGENT_LOAD_ENV_FILE=0`。
6. 让脚本请求 `GET /api/agent/capabilities`。如果所选地址不可达、404、不是 JSON 或不是 Agent capabilities 响应，交互式任务中向用户询问实际部署地址、端口、域名和是否需要鉴权；非交互式任务中显式失败并输出下一步动作。
7. 读取 capabilities 中的认证方式、模型、模型级限制、`image_transport`、`orchestration`、`routing_rules`、Agent 流式边界、页面 SSE 鉴权、后端 runtime enablement、状态后端和端点路径；不要硬编码假设部署方式。
8. 为每个业务操作生成稳定的 `Idempotency-Key`。网络中断、运行中轮询或非终态重试复用原 key；同一 key 已进入 `failed` 终态后不再用于触发新执行，必须先诊断原因，再创建新的业务操作和新的 key。
9. 文生图默认使用 `POST /api/agent/image-requests`，请求体为 JSON 业务意图，服务端返回 job 状态并由脚本轮询 `job.result_url`。服务端内部仍会返回标准 `AgentImageResponse`，并在 `execution` 中暴露真实执行路径。`responsesModel`、`thinking`、`promptOptimization` 和 `force_web` 是 generate 意图字段；脚本默认把它们交给服务端编排入口处理，不因此自行改用页面端 `/api/images`。
10. 图片编辑若走 Agent edit，使用 `POST /api/agent/images/edit`，请求体为 `multipart/form-data`，源图字段必须使用从 `image_0` 开始的连续字段，最大数量以 capabilities 的 `limits.upload_images.max` 为准；跳号、超过当前 profile 上限、`image_01` 或 `image_foo` 会被显式拒绝。该 Agent 端点同样是非流式端点；上游 SSE 字段按 `agent_streaming.upstream_sse.request_fields_by_mode.edit` 发送，不要给 Agent edit 传 `image_backend`。需要 `image_backend=responses-image-generation` 或页面表单字段 `image_streaming_strategy=responses-sse` 的 edit，一律走页面端 `/api/images` form-data SSE；脚本参数仍写作 `--streaming-strategy responses-sse`。
11. 默认使用 `response_mode: "path"`，只在用户明确需要图片内联数据时使用 `base64` 或 `both`。
12. 不要把页面端 `POST /api/images` 当成普通 Agent JSON 路径。它是页面表单和 SSE 路径，capabilities 会以 `agent_streaming.page_sse` 单独声明；generate 只在显式 `--page-sse` 或页面工作台诊断时使用它，默认 WebP edit、Responses edit、长图恢复或需要原始 SSE 日志的 edit 仍可使用页面 SSE。
13. 读取 `agent_jobs` 只用于理解服务端编排结果和显式 `--job` 诊断路径。普通 generate 不再由 Agent 客户端根据本地/远端或尺寸选择 Agent JSON、page SSE 或 job。
14. 处理失败时读取结构化 `error.code`、`error.retryable`、`error.diagnostics` 和 `Retry-After`。仅当 `retryable=true` 时等待后重试。页面 SSE 返回 `503`、断流，或 `summary` 里的 `selected_channel_id`、`upstream_host` 为空时，先按结构化失败诊断，再用新 key 显式换路径，不要把它当成已自动回退成功。
15. 返回结果时优先给出 `summary`、`content_url`、`metadata_url`、`absolute_content_url`、`absolute_metadata_url`、产物 ID、尺寸、格式和是否命中幂等缓存。需要用户直接在浏览器打开图片时添加 `--share`，并返回 `summary.share_urls` 和 `summary.direct_content_urls`；其中 `share_urls` 是分享页入口，公开分享可直接打开 `direct_content_urls`，设置访问码时优先给用户 `share_urls`，二者都不是需要 Bearer token 的 artifact `content_url`。回答“4K 非流式花了多久”时优先读 `summary.elapsed_ms`，服务端返回 timing 时也读 `summary.server_elapsed_ms`。
16. 需要查询页面请求后的人工反馈或日志摘要时，使用页面 SSE 的 `clientRequestId` 或脚本复用的 `Idempotency-Key` 调用 `scripts/diagnose-request.mjs --client-request-id ...`；不要直接调用 `/api/logs`。需要查询 Agent state 请求状态时，使用 `scripts/diagnose-request.mjs --agent-request-id ...` 或 `--idempotency-key ...`。

## 鉴权

Agent JSON、Agent edit、job 和 artifact 端点的鉴权以 `auth.schemes` 为准。如果服务端配置了 `AGENT_API_TOKEN`，发送：

```text
Authorization: Bearer <token>
```

此时 Agent 端点只接受 Bearer token，不会回退到访问码哈希。如果未配置 `AGENT_API_TOKEN` 但配置了页面访问码 `APP_PASSWORD`，Agent 端点发送 `X-App-Password-Hash`。下载或删除产物时必须复用 capabilities 声明的同一 Agent 鉴权方式。

页面端 `/api/images` SSE 是独立页面契约，读取 `agent_streaming.page_sse.auth`。当该字段声明 `required=true` 时，必须在 form-data 中发送 `passwordHash`；脚本侧对应环境变量是 `GPT_IMAGE_APP_PASSWORD_HASH`。即使 `auth.schemes` 只返回 `bearer`，混合配置下 page SSE 仍可能需要这个表单访问码哈希；`GPT_IMAGE_AGENT_TOKEN` 不能替代页面 SSE 表单鉴权。页面 SSE 还会把同一业务 key 写入 form-data `clientRequestId`，长度不得超过 `agent_streaming.page_sse.client_request_id.max_length`。

## 调用约束

- 不要把 API Key、token 或访问码写入源码、文档示例、日志或测试快照。
- 排查环境配置时不要直接输出 `.env.local`、`.env*.local`、secret 文件或原始 `docker inspect .Config.Env`。Codex 会话日志会持久保存命令输出；优先运行仓库脚本 `npm run env:summary`，或在命令中先把 `API_KEY`、`TOKEN`、`PASSWORD`、`SECRET` 值替换为 `<redacted>`。
- Skill 必须保持自包含和可迁移：脚本、示例和说明不得写入本机绝对路径或仓库绝对路径；运行脚本时以当前已安装 Skill 目录为根解析 `scripts/`，不要依赖某台机器上的 checkout 位置。
- Skill 必须兼容 Windows、Linux 和 macOS：脚本只用 Node.js 20+、跨平台 `node:` 标准库和 `package.json` 声明依赖；文档示例用 `node "<skill-root>/scripts/..."`，不依赖 bash、sh、chmod、可执行位、POSIX inline env 或反斜杠续行。
- 不要把 `localhost:4783` 当作唯一部署位置；它只是无明确地址时的探测默认值。交互式任务中，探测到本地服务后先请用户确认是否使用；用户提供其他地址时，以用户地址为准。
- subagent 或自动化任务如果用户指定 Space、云服务或内网服务，调用 `generate-image.mjs`、`edit-image.mjs`、`batch-images.mjs`、`diagnose-request.mjs` 或 `npm run agent:doctor -- --base-url <url>` 时显式传服务地址；不要依赖默认 localhost。
- 不要在模型上下文中展开大体积 base64，除非用户明确要求。
- 不要把 `error.message` 当成唯一判断依据；稳定分支以 `error.code` 和 HTTP 状态为准。
- 不要在没有 `Idempotency-Key` 的情况下调用生成或编辑接口。
- 不要对同一个已进入终态 `failed` 的 `Idempotency-Key` 继续重试。终态失败回放会返回 `retryable=false`；需要重新尝试时，先确认失败原因，再创建新的业务操作和新的 `Idempotency-Key`。
- 不要把 `agent_streaming.page_sse.supported=true` 解读为 `/api/agent/images/generate` 会对客户端返回 SSE；Agent generate/edit 对外仍是最终 JSON。`agent_streaming.upstream_sse` 仅表示服务端内部可消费上游 SSE 并保存最终 artifact。
- 不要直接调用 job endpoints，除非 capabilities 明确返回 `agent_jobs.supported=true` 且 `mode=job_polling`，并且本次是显式 `--job` 诊断或兼容场景。默认 generate 使用 `orchestration.endpoint`。
- 不要把一次高分辨率、高质量长耗时失败归纳为全局不可用。优先查看 `error.diagnostics.upstream_status`、`upstream_event_type`、`partial_image_count`、`transport_error`、`selected_channel_id`、`channel_cooldown_scope`、`error.diagnostics.cooldown_target.request_mode` 和 `retry_after_seconds`。
- 不要在 `error.retryable=false` 时依据历史 `retry_after_seconds` 继续重试同一个 key；终态失败需要新业务操作和新 key。
- 不要把 `/api/runtime-capabilities`、`/api/feedback`、页面创建分享的 `POST /api/shares`、`/api/logs` 或 `/api/image-delete` 当成 Agent API。它们是页面运行态或页面工作流端点，鉴权和字段契约与 `/api/agent/*` 不同；反馈和诊断的 Agent 只读入口是 `/api/agent/page-requests/{id}/feedback`、`/api/agent/page-requests/feedback`、`/api/agent/diagnostics/page-requests/{id}` 和 `/api/agent/diagnostics/page-requests`。Agent 只通过 `/api/agent/artifacts/{id}/share` 为已有 artifact 创建分享链接，不上传任意新图片到页面分享端点。

## Job Polling

默认 generate 不直接调用 job endpoint；服务端编排入口会在内部使用 job polling 并返回 `job.result_url`。当 `agent_jobs.supported=true` 且需要显式诊断或兼容旧流程时，job 路径可使用：

1. `POST /api/agent/jobs/images/generate` 创建 job，仍必须提供 `Idempotency-Key`。
2. `GET /api/agent/jobs/{id}` 轮询状态。
3. `GET /api/agent/jobs/{id}/result` 在 `state=succeeded` 后读取标准 `AgentImageResponse`。

`GET /result` 在 job 运行中会返回 `request_in_progress` 和 `Retry-After`；不存在返回 `job_not_found`；过期返回 `job_expired`。同一业务操作重试创建 job 时复用原 `Idempotency-Key`，服务会返回同一个 job。

当前 job polling 是同一服务实例内的后台任务，结果和错误写入 Agent 状态后端；它不是跨实例持久队列。若服务进程在 job 结束前重启，客户端应按状态和错误码继续轮询或重新提交同一业务意图与同一 `Idempotency-Key`，避免重复业务操作。若 job 已进入 `failed` 终态，`GET /result` 和状态摘要都会返回 `retryable=false`，并保留 `code`、`message`、`upstream_status` 和 `diagnostics` 用于定位原因，但同一个 key 不会触发新执行。需要重新尝试时，先确认失败原因，再以新的业务操作和新的 `Idempotency-Key` 创建 job。

## 可用脚本

以下脚本都位于当前 Skill 目录的 `scripts/` 下。不要硬编码本机安装路径；由运行环境按当前 `SKILL.md` 所在目录解析脚本路径。

- `scripts/generate-image.mjs`：文生图调用。默认 dry-run，不消耗额度；真实执行默认提交到服务端编排入口，必须添加 `--allow-billable` 才会真实生图。需要浏览器可直接打开的用户外链时添加 `--share`，可选 `--share-expires-minutes`；私密分享访问码从 `GPT_IMAGE_SHARE_ACCESS_CODE` 读取，不放进命令行参数。
- `scripts/edit-image.mjs`：multipart 编辑调用。默认 dry-run，不消耗额度；必须添加 `--allow-billable` 才会真实编辑。
- `scripts/batch-images.mjs`：JSONL 批量 generate/edit 调用。默认 dry-run，不消耗额度；必须添加 `--allow-billable` 才会真实执行，支持 append-only manifest、`--resume`、`--ordered-prefix`、`--dimension-check`、`--max-attempts`、`--concurrency` 和顺序执行下的 `--max-consecutive-failures`。`--concurrency` 默认 `1`，大于 `1` 时并发执行并按输入顺序输出结果。
- `scripts/convert-image-format.mjs`：本地 PNG/JPEG/WebP 互转。默认输出 WebP，质量 `100`；JPEG 会把透明背景铺成白色，PNG/WebP 保留透明。
- `scripts/diagnose-request.mjs`：按一个或多个页面 `clientRequestId` 只读查询结果反馈和脱敏日志诊断摘要，也可按 Agent `request_id` 或 `idempotency_key` 查询 Agent state 请求诊断；支持读取批量 manifest 和 `--base-url`，不触发生图计费。
- `scripts/probe-upstream-image.mjs`：直接探测上游图片接口连通性。默认只检查 DNS、TLS 和 `/models`，必须添加 `--allow-billable` 才会真实调用 `/images/generations`。

生成、编辑和批量脚本的 dry-run 输出会包含 `verification_scope.mode=local_planning_only`，表示只验证了本地请求构造、参数归一化和静态路由规划；它不会读取远端 capabilities，不会验证远端鉴权、渠道容量或 manifest 写入。生成 dry-run 添加 `--check-remote` 后会只读查询 `/api/agent/capabilities` 和 `/api/runtime-capabilities`，输出 `verification_scope.mode=remote_contract_and_local_planning`，仍不会发送真实生图请求。生成 dry-run 默认 `routing_guidance.transport=server_orchestrated`，表示真实请求只提交业务意图到服务端编排入口；显式 `--agent`、`--job`、`--page-sse` 才会显示对应诊断路径。批量 dry-run 还会包含 `guardrails`，提示真实执行要复用同一个 `--ordered-prefix`，固定尺寸任务是否建议加 `--dimension-check`。真实执行输出会包含 `summary`；成功摘要含 `ok=true`、`billable`、`request_id`、`idempotency_key`、`artifact_ids`、`content_urls`、`absolute_content_urls`、`share_urls`、`direct_content_urls`、`image_dimensions`、`actual_dimensions`、`cached`、`elapsed_ms`、`server_elapsed_ms`、`elapsed_source`、`elapsed_breakdown`、`transport`、`endpoint`、`route_mode`、`image_backend`、`stream_mode`、`streaming_strategy`、`channel_request_mode`、`channel_request_mode_fallback_applied`、`route_decision`、`selected_channel_id`、`upstream_host` 和脱敏 `request_headers`。失败摘要含 `route_decision`、`transport_error_kind`、`retry_after_ms`、`cooldown_until`、`cooldown_target`、`retryable`、`dimension_check_failed`、`expected_dimensions`、`actual_dimensions`、`agent_diagnostics_checked`、`agent_diagnostics_found`、`agent_diagnostics_unavailable_reason`、`agent_diagnostics_http_status` 和 `next_action`；尺寸门禁失败时还会保留已生成产物的 `artifact_ids`、`content_urls`、`absolute_content_urls` 和 `image_dimensions`，便于人工审查。
所有生成、编辑、批量和探针脚本在 dry-run 或真实请求前都会校验尺寸参数。`gpt-image-2` 支持 `auto` 或任意正整数 `WIDTHxHEIGHT`；默认 OpenAI-compatible 上游的更严格尺寸边界由服务端 profile 或真实上游显式报错。非 `gpt-image-2` 模型只接受 `auto`、`1024x1024`、`1536x1024` 或 `1024x1536`。生成、页面编辑、批量页面 SSE 和上游探针默认请求 `output_format=webp`、`output_compression=100`；普通 Agent edit 不发送输出格式字段，输出格式固定为 Agent 契约。

如果当前上下文位于仓库根目录，管理员侧优先使用顶层命令：

- `npm run first-run`：首次配置就绪检查，只读、非计费、不写 env 文件；默认输出中文摘要，加 `-- --json` 输出机器可读 JSON；用于确认 Node、依赖、服务地址、Agent capabilities、当前进程鉴权和下一步动作。
- `npm run status`：只读查看 git、Space 目标、Agent API、Skill 入口和独立真实图片上游 smoke 配置摘要；会自动读取 `.env.real-smoke.local`，不输出 URL 或 API Key。
- `npm run doctor`：统一诊断本机与 HF Space 配置，不写 Secret。
- `npm run verify`：运行提交前基线；需要真实 PostgreSQL gate 时加 `-- --postgres`。
- `npm run deploy:local`：重建本地 Docker 服务并探测真实 HTTP 端点；加 `-- --memory` 会断言 memory/indexeddb overlay 生效。
- `npm run deploy:space`：部署干净 git HEAD 到固定 Space，并做只读公网验证。
- `npm run agent:doctor`：执行非计费分层诊断，覆盖 capabilities、Agent contract、runtime backend、state backend 和 Responses/GPT2Image readiness；支持 `-- --base-url <url>`；真实 1K/2K smoke 必须显式加 `-- --allow-billable`。

首次配置和诊断输出字段速查：

| 字段 | 出现位置 | 判断口径 |
| --- | --- | --- |
| `service_base_url` / `verification_scope.service_base_url` | `first-run`、`agent:doctor`、诊断脚本为顶层；skill 脚本 dry-run 在 `verification_scope` 下 | 当前脚本准备访问的 Playground 服务地址。 |
| `service_base_url_source` / `verification_scope.service_base_url_source` | `first-run`、`agent:doctor`、诊断脚本为顶层；skill 脚本 dry-run 在 `verification_scope` 下 | `user_provided` 表示用户或命令行明确指定；`GPT_IMAGE_PLAYGROUND_URL` 表示来自环境变量；`default_local_probe` 表示默认本地探测。 |
| `interactive_confirmation_required` / `verification_scope.interactive_confirmation_required` | `first-run`、`agent:doctor`、诊断脚本为顶层；skill 脚本 dry-run 在 `verification_scope` 下 | 交互式任务中为 `true` 时，应先向用户确认是否使用该地址再发起真实请求。 |
| `agent_auth_process.has_token` | `first-run --json` | 当前进程是否已经拿到 `GPT_IMAGE_AGENT_TOKEN`。 |
| `page_sse_auth_available_to_process` | `first-run --json` | 目标服务要求页面 SSE `passwordHash` 时，当前进程是否已加载 `GPT_IMAGE_APP_PASSWORD_HASH`。 |
| `summary.page_sse_auth_ready` | `agent:doctor` | 页面 SSE 鉴权是否已满足；为 `false` 时不要运行 `--page-sse` 真实计费请求。 |
| `page_sse_real_smoke_status` | `first-run --json` | 结构化说明 `first-run` 未执行真实 `/api/images` smoke；`state=not_run` 且 `billable=false` 表示它只是只读就绪检查。 |
| `responses_image_backend_real_smoke_status` | `first-run --json` | 结构化说明 `first-run` 未执行真实 Responses image_generation smoke；不要把声明支持当作实测通过。 |
| `summary.page_sse_real_smoke` | `agent:doctor` | Page SSE 真实 smoke 的兼容聚合状态；任一 Page SSE smoke 失败为 `failed`，任一通过且无失败为 `passed`，全部跳过为 `skipped`；精确判断优先看 `summary.real_smoke_checks`。 |
| `summary.responses_page_sse_generate_smoke` | `agent:doctor` | `--allow-billable` 时对 `responses-image-generation` + page SSE + `responses-sse` 这条文生图路径的真实 smoke 状态；非计费时为 `skipped`。 |
| `summary.responses_agent_generate_smoke` | `agent:doctor` | `--allow-billable` 时对 `responses-image-generation` + Agent JSON + `responses-non-stream` 这条文生图路径的真实 smoke 状态；非计费时为 `skipped`。 |
| `summary.real_smoke_checks` | `agent:doctor` | 各真实 smoke 的状态汇总，包含 `agent_generate_1k`、`responses_page_sse_generate_1k`、`responses_agent_generate_1k`、`agent_edit_1k` 和 `page_sse_edit_2k`。 |
| `summary.request_modes` | `agent:doctor` | 管理员 request mode 的配置和真实 smoke 摘要；`billable=false` 时只能证明配置可见，不能当作真实上游通过。 |
| `request_mode_controls` | `capabilities` | 管理员 request mode 白名单控制面；包含 `OPENAI_UPSTREAM_REQUEST_MODES`、`OPENAI_CHANNEL_N_REQUEST_MODES`、真实 smoke gate 和 `agent_client_policy=diagnostics_only`。 |
| `private_agent_env.exists` | `first-run --json` | 本机是否存在 `.env.agent.local` 私有配置；Agent CLI 默认从当前仓库根目录读取该文件。 |
| `capabilities.ok` | `first-run --json`、`agent:doctor` | 目标地址是否返回 Agent capabilities；失败时先看 HTTP 状态、鉴权提示和服务地址。 |
| `diagnostics_retention` | `diagnose-request.mjs` | 页面日志诊断的保留窗口；无匹配日志不等于请求一定没发生。 |

生成脚本常用参数：

```text
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --size 2048x2048 --quality high --response-mode path --idempotency-key stable-operation-key "a product photo of a ceramic mug"
```

常用 preset 可先 dry-run 展开真实参数，不触发计费：

```text
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --preset 1k-smoke-agent "a product photo of a ceramic mug"
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --preset 4k-agent-nonstream "a cinematic landscape"
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --preset 4k-page-sse "a cinematic landscape"
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --preset 4k-upstream-sse-newapi "a cinematic landscape"
```

启用 Agent 内部上游 SSE 时，必须显式传策略字段；脚本仍只输出最终 JSON：

```text
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --allow-billable --image-backend images-api --stream-mode auto --streaming-strategy newapi-keepalive-sse --partial-images 2 --size 3840x2160 --quality high "a product photo of a ceramic mug"
```

真实生图必须显式开启：

```text
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --allow-billable --timeout-ms 420000 --size 2048x2048 "a product photo of a ceramic mug"
```

创建浏览器可直接打开的分享链接：

```text
node "<skill-root>/scripts/generate-image.mjs" --base-url https://your-space.hf.space --allow-billable --share --share-expires-minutes 1440 --size 2048x2048 "a product photo of a ceramic mug"
```

本地格式转换不触发生图计费：

```text
node "<skill-root>/scripts/convert-image-format.mjs" --format webp --quality 100 ./source.png
node "<skill-root>/scripts/convert-image-format.mjs" --format png --output ./source.png ./source.webp --overwrite
```

生成脚本默认把文生图业务意图提交到服务端编排入口 `/api/agent/image-requests`；服务端内部决定使用 Agent JSON、内部上游 SSE、job polling 或其他可观测路径。脚本不再根据 `max_edge>2048`、公网 HTTPS、页面高级字段或 `streaming_strategy=off` 自行切换默认端点。单张 generate 支持 `--responses-model`/`--gpt-model`、`--thinking`、`--prompt-optimization` 和 `--force-web`；这些字段会作为生成意图提交到服务端编排入口，由服务端选择 Responses image_generation、Images API、SSE 或非流式执行方式。`--agent`、`--job`、`--page-sse` 是显式诊断或兼容开关，使用时必须记录原因，并用新的 `Idempotency-Key` 避免混淆业务操作。默认 WebP edit 走页面 SSE；显式 `--agent` 才走 Agent multipart 最终 JSON，输出格式固定为 Agent 契约。Responses image_generation edit 属于页面 SSE 路径：可显式传 `--page-sse --image-backend responses-image-generation --streaming-strategy responses-sse`；如果运行时已显式配置 `IMAGE_GENERATION_BACKEND=responses-image-generation` 或兼容别名 `responses`，且 `IMAGE_STREAMING_STRATEGY=responses-sse`，也可以依赖服务端默认值。Docker compose 本身不设置这两个默认值，未配置 `.env.local` 时仍是 `images-api` 和 `auto`。不要为 Responses edit 加 `--agent`。默认 WebP edit 与非流式策略冲突时脚本前置拒绝，除非显式添加 `--agent` 做 Agent JSON 对照。页面高级 edit 字段与非流式策略冲突时脚本同样前置拒绝。上游流式字段优先读取 `agent_streaming.upstream_sse.request_fields_by_mode`：generate 支持 `--image-backend`、`--stream-mode`、`--streaming-strategy`、`--partial-images`；Agent edit 只支持 `--stream-mode`、`--streaming-strategy`、`--partial-images`。页面 SSE edit 可发送 `image_backend` 和表单字段 `image_streaming_strategy`；CLI 参数是 `--streaming-strategy`，batch JSONL 字段是 `streaming_strategy`。

generate 或页面 SSE 请求包含 `image_backend` 时，`partial_images` 必须先按 `limits.partial_images_by_backend[image_backend]` 校验；capabilities 没有该字段时才退回 `limits.partial_images`。Agent edit 不接受 `image_backend`，其内部上游流式字段按默认 Images API/profile 范围校验；Responses backend edit 需要页面 SSE。不要把 Matsca `limits.partial_images=0..4` 误套到 `responses-image-generation`，Responses backend 当前使用自己的 `1..3` 范围。

批量脚本 JSONL 每行是一个 generate 或 edit 任务。示例：

```jsonl
{"id":"hero-01","mode":"generate","prompt":"a product photo of a ceramic mug","size":"1024x1024","response_mode":"path"}
{"id":"edit-01","mode":"edit","prompt":"replace the background","image_path":"./source.png","size":"1024x1024","response_mode":"path"}
```

默认 dry-run 只解析 JSONL、生成稳定幂等键并输出计划，不请求服务：

```text
node "<skill-root>/scripts/batch-images.mjs" --base-url https://your-space.hf.space --input tasks.jsonl --ordered-prefix product-set
```

真实批量执行必须显式允许计费。需要并发时添加 `--concurrency N`；需要严格连续失败熔断时保持 `--concurrency 1`：

```text
node "<skill-root>/scripts/batch-images.mjs" --base-url https://your-space.hf.space --allow-billable --input tasks.jsonl --manifest runs/product-set.manifest.jsonl --resume --dimension-check --max-attempts 2 --max-consecutive-failures 3
node "<skill-root>/scripts/batch-images.mjs" --base-url https://your-space.hf.space --allow-billable --input tasks.jsonl --manifest runs/product-set.manifest.jsonl --resume --dimension-check --max-attempts 2 --concurrency 3
```

`--manifest` 使用 JSONL append-only 记录每条任务的 `index`、`id`、`idempotency_key`、`attempt`、`status`、响应或错误以及机器可读 `summary`；Agent JSON 失败时 manifest 也会记录只读诊断补采样得到的 `agent_failure_diagnostics`。`--resume` 会读取已成功记录并跳过同一 `id` 或 `idempotency_key`。dry-run 不写 manifest，输出会声明 `manifest_written=false`、`manifest_write_reason=dry_run` 和 `guardrails`；真实执行应复用 dry-run 中的同一个 `--ordered-prefix`，否则未显式写 `idempotency_key` 的任务会生成不同 key。`--dimension-check` 会读取响应里的 `b64_json` 或同 origin `content_url`，校验 PNG/JPEG/WebP 尺寸是否等于任务 `size`；通过时成功摘要写入 `image_dimensions` 和单图 `actual_dimensions`，失败时 `error.code=dimension_check_failed`、`validation_failure_kind=generated_artifact_failed_dimension_check`、产物 URL、`summary.expected_dimensions`、`summary.actual_dimensions`、`summary.dimension_check_failed=true` 会同时写入 manifest。固定尺寸任务没有开启时，dry-run 会在 `guardrails.dimension_check_recommended` 中提示。`--max-attempts` 会为第二次及以后尝试追加新的 attempt 级 idempotency key，避免复用终态失败 key；`--concurrency` 大于 `1` 时会先读取运行态并发建议，并发执行任务并按输入顺序输出结果。服务端 `recommendedConcurrency` 或 `channelQueue.capacityPerCredential` 小于请求值时，脚本会把有效并发降到建议值并在输出中写入 `capacity_feedback`；不要再另开多个单张脚本绕过这个限制。`failure_summary` 会区分 `validation_failure_count` 和 `request_failure_count`，避免把已生成但验收失败误判为上游调用失败。`--max-consecutive-failures` 会在连续失败达到阈值后跳过后续任务并输出 `failure_summary` 与 `resume_fix_list`，且只能与顺序执行的 `--concurrency 1` 同用。任务级 `sse_log_path` 会把页面 SSE 原始事件按 JSONL 追加保存；即使 fetch 或 SSE 收集阶段失败，也会记录 `request_started`、`request_failed`、`elapsed_ms`、`client_request_id` 和 `endpoint`，便于区分上游未给终图和解析/断流问题。

批量 JSONL 字段按模式区分：`background` 只适用于 `generate`；`image_path`、`image_paths`、`mask_path` 只适用于 `edit`。批量 generate 默认提交到 `/api/agent/image-requests`，`responsesModel`/`gptModel`/`gpt_model`、`thinking`、`promptOptimization`/`prompt_optimization`、`force_web`/`forceWeb` 会作为 generate 意图字段随 JSON 发送给服务端编排入口。默认 WebP edit 任务走页面 SSE；如需 Agent edit 固定输出，请拆成单张 `edit-image.mjs --agent`。`output_format`、`format`、`output_compression`、`moderation`、`image_backend`、`streaming_strategy`、`partial_images` 和上述 Responses 控制字段仍可用于页面 SSE edit 路径。edit 任务设置 `image_backend=responses-image-generation` 时会走页面 SSE；不要把它改成 Agent edit。`responsesModel` 必须同时设置 `image_backend=responses-image-generation` 或兼容值 `responses`。JSONL 字段名必须使用 `streaming_strategy`；`image_streaming_strategy` 是页面 form-data 字段名，不是 batch JSONL 字段，会被脚本在真实请求前拒绝。PNG 搭配 `output_compression` 会在 dry-run 标记 normalization，真实请求不会发送压缩字段。`page_sse`、`complex_ui`、`long_image`、`resume_or_recover` 必须是 JSON 布尔值，`transport` 目前只接受 `page_sse`。脚本会在 dry-run 阶段显式拒绝跨模式字段、未知字段和无效路由控制字段。

编辑脚本支持位置参数 `<image-path> <prompt>`，也支持 `--image <path> <prompt>` 别名；不要同时传两种图片路径。常用选项包括 `--model`、`--size`、`--quality`、`--response-mode`、`--format`、`--output-compression`、`--moderation`、`--image-backend`、`--responses-model`、`--thinking`、`--prompt-optimization`、`--force-web`、`--stream-mode`、`--streaming-strategy`、`--partial-images`、`--timeout-ms`、`--idempotency-key`、`--page-sse`、`--agent`、`--dry-run` 和 `--allow-billable`。其中 `--image-backend responses-image-generation` 只用于页面 SSE edit。

直连上游诊断：

```text
node "<skill-root>/scripts/probe-upstream-image.mjs" --base-url https://api.openai.com/v1
```

页面请求反馈和日志诊断：

```text
node "<skill-root>/scripts/diagnose-request.mjs" --base-url https://your-space.hf.space --client-request-id stable-operation-key --filename output.png
node "<skill-root>/scripts/diagnose-request.mjs" --base-url https://your-space.hf.space --manifest runs/product-set.manifest.jsonl --filename output.png
node "<skill-root>/scripts/diagnose-request.mjs" --base-url https://your-space.hf.space --manifest runs/product-set.manifest.jsonl --output runs/diagnosis.json
node "<skill-root>/scripts/diagnose-request.mjs" --base-url https://your-space.hf.space --agent-request-id req_abc
node "<skill-root>/scripts/diagnose-request.mjs" --base-url https://your-space.hf.space --idempotency-key stable-operation-key
```

调用前按当前系统和 shell 设置 `OPENAI_API_KEY` 或 `GPT_IMAGE_UPSTREAM_API_KEY`，不要把 key 写进命令历史或文档。

诊断脚本只输出状态、耗时、脱敏错误摘要、白名单响应头、Agent state 摘要和 base64 长度，不输出 API key、完整 prompt、完整图片数据或本地文件路径。

上游探针脚本支持 `--base-url`、`--model`、`--prompt`、`--size`、`--quality`、`--format`、`--output-compression`、`--timeout-ms` 和 `--allow-billable`。默认读取 `GPT_IMAGE_UPSTREAM_BASE_URL` 或 `OPENAI_API_BASE_URL`，API Key 读取 `GPT_IMAGE_UPSTREAM_API_KEY` 或 `OPENAI_API_KEY`。上游 base URL 同样必须是无凭据、无查询参数、无片段的 `http`/`https` 绝对 URL。

脚本读取以下环境变量：

- `GPT_IMAGE_PLAYGROUND_URL`：服务基础地址，可指向本机、局域网、云服务器或域名；脚本未设置时默认尝试 `http://localhost:4783`。脚本参数 `--base-url` 优先级高于该环境变量。
- `GPT_IMAGE_AGENT_TOKEN`：Bearer token。
- `GPT_IMAGE_APP_PASSWORD_HASH`：使用 `APP_PASSWORD` 访问码部署时，Agent 端点发送为 `X-App-Password-Hash`，页面 SSE 发送为 form-data `passwordHash`。公网 Space 同时配置 `AGENT_API_TOKEN` 和 `APP_PASSWORD` 时，Agent JSON 需要 `GPT_IMAGE_AGENT_TOKEN`，页面 SSE 仍需要这个哈希。
- `GPT_IMAGE_AGENT_IDEMPOTENCY_KEY`：跨脚本进程恢复同一操作时复用的幂等键；也供 `diagnose-request.mjs` 按 Agent 幂等键查询 state。脚本不会自动重试已终态失败的 key。
- `GPT_IMAGE_AGENT_CLIENT_REQUEST_ID`：供 `diagnose-request.mjs` 读取的页面请求 ID；页面 SSE 路径通常等于脚本使用的 `Idempotency-Key`，多个 ID 可重复传 `--client-request-id`。
- `GPT_IMAGE_AGENT_REQUEST_ID`：供 `diagnose-request.mjs` 读取 Agent state 请求诊断的 Agent `request_id`。
- `GPT_IMAGE_AGENT_MAX_ATTEMPTS`：最大尝试次数，默认 `3`。
- `GPT_IMAGE_SHARE_ACCESS_CODE`：仅在 `generate-image.mjs --share` 时读取，用于创建需要访问码的分享链接；不要放进命令行参数、manifest 或日志。
- `GPT_IMAGE_AGENT_CONTRACT_CHECK=1`：只检查 capabilities 和错误契约，不触发真实生图或编辑。

Hugging Face Space Secrets 只能写入和列出名称，不能从 CLI 读回 secret 值。远端配置 `AGENT_API_TOKEN` 后，本机 Agent 仍必须通过不入库的 shell 环境、keychain 或本地私有 env 文件注入 `GPT_IMAGE_AGENT_TOKEN`；Agent CLI 默认读取当前仓库根目录的 `.env.agent.local`，shell 环境变量优先。不要把 token 写进仓库、README、任务 JSONL、manifest、命令参数或日志。仓库根目录的 `.env.agent.local.example` 只作私有本机配置模板，真实 `.env.agent.local` 不入库。

上游请求头由服务端统一生成。默认 `User-Agent` 是 `gpt-image-playground/<package-version>`；可用 `OPENAI_UPSTREAM_USER_AGENT` 或 `UPSTREAM_USER_AGENT` 覆盖全局 UA，也可用 `OPENAI_CHANNEL_N_USER_AGENT` 和 `OPENAI_CHANNEL_N_UPSTREAM_HEADERS_JSON` 覆盖单渠道安全 header。`Authorization`、`Accept`、`Content-Type`、`Content-Length` 和 `Host` 等协议头不可由 extra headers 覆盖；capabilities、status 和 diagnostics 只暴露 `user_agent_effective`、`has_extra_headers`、`allowed_header_names` 和 `configured_header_names`，不暴露 secret 值。

`GPT_IMAGE_PLAYGROUND_URL` 必须是无凭据、无查询参数、无片段的 `http`/`https` 绝对 base URL。不要把 token、访问码或其他 Secret 放进 URL。生成脚本轮询 job result 时只会携带鉴权头访问同 origin URL，避免异常服务返回外部 `result_url` 后泄露 Bearer token 或访问码哈希。

脚本会把服务返回的相对产物路径补充为绝对 URL，页面 SSE 的相对 `path` 会补充 `absolute_path`，适合调用 Hugging Face Space、云服务器或自定义域名上的公网实例。

## 参考

需要字段结构、响应示例或错误码列表时，读取 `references/api.md`。
