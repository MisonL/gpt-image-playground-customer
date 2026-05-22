# CR-IMAGE-UPSTREAM-COMPAT-2026-05-21

## 范围

- 多上游图片生成兼容层阶段验证。
- 区分本地 mock 覆盖、当前真实上游 smoke、以及本机未配置的上游类型。
- 记录 2026-05-21 在 `codex/image-upstream-compat` 分支上的验证口径。

## 当前真实上游范围

`.env.local` 当前只配置了 `superapi.buzz` 这一类真实上游，共 7 个服务端渠道。没有可直接区分的原版 QuantumNous/new-api、gaoren002/new-api、Wei-Shaw/sub2api 或独立 GPT2Image 部署地址。因此“原版 new-api / gaoren / sub2api / GPT2Image”差异主要由本地契约测试覆盖，真实 smoke 只能证明当前 `superapi.buzz` 上游在对应协议路径下的表现。

当前独立真实上游配置检查：`.env.local` 没有 `IMAGE_REAL_SMOKE_*` 键，`.env.real-smoke.local` 不存在。仓库提供 `.env.real-smoke.example` 作为可提交模板，真实凭据仍应写入未跟踪的 `.env.real-smoke.local`。`npm run smoke:image-upstream-real` 当前返回 `independent_targets.configured_count=0`、`missing_count=5`。`npm run smoke:image-upstream-real -- --require-independent-targets` 当前以退出码 `1` 按预期失败，`skipped_required_cases` 为 `original-images-json`、`gaoren-images-sse`、`sub2api-images-sse`、`sub2api-responses-json`、`gpt2image-responses-sse`。

## 真实 smoke 结果

运行方式：在当前 worktree 启动 `npx next dev --turbopack -p 4784`；Responses 路径使用 `ENABLE_RESPONSES_IMAGE_BACKEND=true OPENAI_RESPONSES_API_MODEL=gpt-5.4` 重启同端口服务。所有输出均只记录状态、事件类型、图片数量和 base64 长度，不记录 API key 或完整图片数据。

| 场景 | 结果 | 证据摘要 |
| --- | --- | --- |
| Images API 普通 JSON | 通过 | `/api/images` 返回 `200 application/json`，`image_count=1`，`first_b64_length=1045668`，耗时 `19921ms`。 |
| Images API SSE / keepalive 策略 | 通过 | `/api/images` 返回 `200 text/event-stream`，事件为 `partial_image, partial_image, completed, done`，`done_image_count=1`，耗时 `29615ms`。 |
| Responses image_generation 非流式 | 当前真实上游未通过 | `/api/images` 返回 `500 application/json`，错误为 `Responses API 未返回已完成的 image_generation_call.result。`。该结果说明当前真实上游的非流式 `/responses` 返回结构不满足本项目 final image 契约。 |
| Responses image_generation SSE 初测 | 暴露缺口后已修复 | 初测事件为 `partial_image, completed, error`，错误为 `response.output_item.done` 缺少图片 payload。修复后无图的 Responses output item done 会被忽略，仍要求整条流最终有 final image。 |
| Responses image_generation SSE 去重复测 | 通过 | `/api/images` 返回 `200 text/event-stream`，事件为 `partial_image, completed, done`，`done_image_count=1`，耗时 `46624ms`。 |
| Agent 内部 Images SSE | 通过 | `/api/agent/images/generate` 返回 `200 application/json`，`image_count=1`，产物 URL 为 `/api/agent/artifacts/.../content`，未返回客户端 SSE，耗时 `96081ms`。 |

## 2026-05-22 脚本化真实复验

运行方式：`npm run smoke:image-upstream-real -- --include-server-channel` 先做 dry-run，确认 5 个独立真实目标因缺少专用 `IMAGE_REAL_SMOKE_*_BASE_URL` 跳过，当前 `.env.local` 服务端渠道只在追加 `--allow-billable` 后执行。随后使用 `--timeout-ms 180000` 对当前服务端渠道逐项真实调用。输出只记录 host、状态、事件类型、数量和 base64 长度。

| 场景 | 结果 | 证据摘要 |
| --- | --- | --- |
| 当前服务端渠道 Images JSON 首次 | 显式失败 | `server-channel-images-json` 返回 `500 application/json`，`error=Connection error.`，耗时 `186537ms`，无图片。 |
| 当前服务端渠道 Images JSON 复测 | 通过 | `server-channel-images-json` 返回 `200 application/json`，`image_count=1`，`first_b64_length=1332092`，耗时 `164893ms`。 |
| 当前服务端渠道 Images SSE | 通过 | `server-channel-images-sse` 返回 `200 text/event-stream`，事件为 `partial_image, partial_image, partial_image, completed, done`，`done_image_count=1`，`first_b64_length=1573772`，耗时 `10843ms`。 |
| 当前服务端渠道 Responses SSE | 通过 | `server-channel-responses-sse` 返回 `200 text/event-stream`，事件为 `partial_image, partial_image, completed, done`，`done_image_count=1`，`first_b64_length=1157276`，耗时 `3232ms`。 |
| 当前服务端渠道 Agent 内部 Images SSE | 通过 | `server-channel-agent-images-sse` 通过 `npm run smoke:image-upstream-real -- --include-server-channel --allow-billable --timeout-ms 180000 --case server-channel-agent-images-sse` 验证，返回 `200 application/json`，`image_count=1`，产物 URL 为 `/api/agent/artifacts/.../content`，未内联 base64，耗时 `59243ms`。 |
| 当前服务端渠道 Agent 内部 Responses SSE | 通过 | `server-channel-agent-responses-sse` 通过 `npm run smoke:image-upstream-real -- --include-server-channel --allow-billable --timeout-ms 180000 --case server-channel-agent-responses-sse` 验证，返回 `200 application/json`，`image_count=1`，产物 URL 为 `/api/agent/artifacts/.../content`，未内联 base64，耗时 `19270ms`。 |

## 本地契约覆盖

- `npm run smoke:image-upstream-compat` 启动临时本地 mock 上游并直接调用当前 `/api/images` route，覆盖原版 new-api Images API JSON、sub2api Images API JSON、gaoren new-api Images SSE keepalive、gaoren JSON-as-SSE completed、sub2api Images SSE、sub2api Responses image_generation bridge JSON、GPT2Image Responses image_generation SSE。
- `npm run smoke:image-upstream-real` 提供真实上游 smoke 入口，默认只检查 `IMAGE_REAL_SMOKE_*` 配置，不加 `-- --allow-billable` 不会触发生图。当前运行结果为 5 个独立真实目标均跳过，原因是未配置独立真实上游 `BASE_URL` 环境变量。脚本已支持 `--include-server-channel`，可复用当前 `.env.local` 的服务端渠道跑 Images JSON、Images SSE、Responses JSON、Responses SSE、Agent 内部 Images SSE 和 Agent 内部 Responses SSE smoke，且不把服务端 API Key 写入表单或输出；单场景默认超时 `240000ms`。dry-run 会返回 `independent_targets` 和 `missing_env_any`，汇总必跑、已选、未选、已配置与缺失的独立目标，并用 `required_count`、`unselected_required_count`、`configuration_complete` 和顶层 `final_gate_satisfied` 明确 5 个必跑场景是否全部已实际执行并通过；非计费阶段会拒绝带凭据、查询参数或片段的 `BASE_URL`；最终验收可加 `--require-independent-targets --allow-billable`，让任何独立真实上游未被选中或被跳过都以非零退出，并写入 `unselected_required_cases`、`skipped_required_cases`、`missing_required_count` 和 `missing_required_cases`。脚本支持 `--env-file <path>` 加载独立真实 smoke 凭据文件，shell 环境变量优先级高于 `--env-file`，`--env-file` 优先级高于 `.env.local`，便于把原版 new-api、gaoren、sub2api、GPT2Image 的真实目标与主服务渠道配置隔离。`.env.real-smoke.example` 是可提交模板，`.env.real-smoke.local` 继续被 `.gitignore` 排除。`scripts/smoke-image-upstream-real.test.mjs` 覆盖默认非计费、配置后仍需显式授权、当前服务端渠道 dry-run 不泄漏 API key、独立上游准备度摘要、独立上游必跑门禁、缺失 env 诊断、unsafe `BASE_URL` 预检、超时参数校验、未知场景显式失败、显式 env 文件加载优先级、测试隔离 `.env.local` 私有渠道配置，以及本地 billable Agent smoke 后清理 `generated-images/.real-smoke` 新增图片产物。
- `src/lib/image-stream-events.test.ts` 覆盖 OpenAI Images、OtokAPI、Responses partial、Responses partial `b64_json` 兼容字段、Responses image_generation_call completed marker、顶层 completed result、Responses output item done、Responses completed、远程 URL-only 显式失败、`response.failed` 显式失败、`response.completed` 内 `image_generation_call.status=failed` 显式失败、`image_generation_call.status=failed` 显式失败、keepalive/非对象忽略。
- `src/lib/responses-image-backend.test.ts` 覆盖 Responses image_generation 非流式后端：读取 `image_generation_call.result`、接受省略 `status` 但提供 `result` 的兼容响应、拒绝远程 URL-only 结果、显式暴露 failed `image_generation_call` 错误、提取 data URL base64、以及流式请求参数。
- `src/app/api/images/route.test.ts` 覆盖 Images API 非流式 JSON、Images API SSE、Images API 与 Responses image_generation 下 `force-sse` 在请求省略旧 `stream` 字段时仍进入上游 SSE、gaoren JSON-as-SSE completed 包装、SDK/relay 包装 SSE、stream 断开错误、Images API 非流式远程 URL-only 显式 502 失败、Responses 后端非流式、Responses 后端 SSE、以及 Responses failed `image_generation_call` 在 JSON/SSE 两条页面路径上都返回稳定 502 错误契约。
- `src/app/api/agent/agent-routes.test.ts` 覆盖 Agent 默认最终 JSON、`streaming_strategy=off` 不发送上游流式参数、Images API 与 Responses image_generation 下 `streaming_strategy=force-sse` 发送上游 stream 但对外仍返回最终 JSON、直接 generate 内部 Images SSE 消费、直接 generate 内部 Responses image_generation SSE 消费、Responses failed `image_generation_call` 归一化为 `upstream_unavailable`、job polling 内部 Images SSE 消费并保存最终 artifact、job polling 内部 Responses image_generation SSE 消费并保存最终 artifact、直接 generate 与 job polling 的 Images API / Responses image_generation partial-only 无 final image 失败。
- `src/lib/agent-api-contracts.test.ts` 覆盖 capabilities/OpenAPI 中页面 SSE、Agent 内部 upstream SSE、最终响应契约、后端枚举、流式策略枚举、真正启用上游 SSE 的 activation 策略和默认非流式 Agent 策略。
- `src/lib/image-stream-service.test.ts` 和 `src/lib/image-stream-collector.test.ts` 覆盖 Responses 流中同一 final image 跨事件重复到达、以及单个完成事件同时经 SDK/Responses 包装层重复抽取时只保存一份最终产物；同一事件内合法多图结果仍保留多张图片。
- 浏览器 UI smoke：`npm run dev -- --port 4785` 启动页面后确认默认未勾选流式预览；高级参数展示 Images API / Responses image_generation 后端与 6 个流式策略；4K/high + auto 显示流式建议；Responses 后端显示“Responses 顶层模型”；注入本地 fetch SSE keepalive stub 后，持续 keepalive 流只显示“连接保持中...”，不生成预览或成功结果。快速关闭且无 final image 的 keepalive 流会显式失败为“API 响应中没有有效图片数据或文件名。”，不伪造成功。2026-05-22 复验中，浏览器实际提交字段包含 `stream=true`、`partial_images=1`、`size=3072x2048`、`quality=high`、`image_backend=responses-image-generation`、`image_streaming_strategy=auto`；页面 DOM 中 `document.images` 为空，最终显示上述显式错误。
- 运行态 Agent contract smoke：`npm run dev -- --port 4785` 启动后，`GET /api/agent/capabilities` 返回 `defaults.streaming_strategy=off`、`agent_streaming.generate.mode=non_streaming_only`、`agent_streaming.upstream_sse.mode=internal_upstream_sse`、`final_response_contract=AgentImageResponse`，并列出 `image_backend`、`streaming_strategy`、`partial_images` 三个内部上游 SSE 请求字段；`GET /api/agent/openapi.json` 的 `GenerateRequest` schema 同样包含这三个字段，`AgentStreamingCapabilities.upstream_sse.request_fields` 与 capabilities 一致；`GET /api/runtime-capabilities` 当前显示 `responsesImageBackend.enabled=false`、`mode=experimental`。

## 2026-05-22 当前 worktree 基线复验

本轮补充复核：`npm test`、`npm run lint`、`npm run lint:scripts`、`npm run build`、`npm run smoke:image-upstream-compat`、`git diff --check` 均重新通过。`npm run smoke:image-upstream-real -- --include-server-channel` 以非计费 dry-run 通过；`npm run smoke:image-upstream-real -- --require-independent-targets` 继续按预期以退出码 `1` 失败，原因是 `.env.real-smoke.local` 不存在且 5 个独立真实上游目标均缺少专用 `IMAGE_REAL_SMOKE_*_BASE_URL`。本轮收尾未追加新的 `--allow-billable` 请求；表中带 `--allow-billable` 的服务端渠道记录为同日此前已记录的真实服务端渠道证据，不等同于独立真实上游最终门禁。`generated-images/.real-smoke` 目录无产物残留。

| 命令 | 退出码 | 摘要 |
| --- | --- | --- |
| `npm test` | 0 | `425` 个测试通过，`0` 个失败。PostgreSQL live 测试因 `AGENT_POSTGRES_TEST_DATABASE_URL` 未配置跳过。 |
| `npm run lint` | 0 | `eslint src` 通过。 |
| `npm run lint:scripts` | 0 | `scripts/check-node-syntax.mjs` 通过。 |
| `npm run build` | 0 | Next.js 16.2.6 production build 通过，standalone runtime patch 完成。 |
| `npm run test:postgres` | 0 | 临时 `postgres:16-alpine` 容器内 55 个测试通过，覆盖 Agent route PostgreSQL 集成、Postgres schema/live concurrency、迁移、清理和 share metadata 契约。 |
| `npx tsc --noEmit` | 0 | 测试和源码 TypeScript 静态检查通过。 |
| `npm audit --audit-level=high` | 0 | `found 0 vulnerabilities`。 |
| `npm run smoke:image-upstream-compat` | 0 | 7 个本地 mock 上游兼容场景全部通过。 |
| `node --import tsx --test scripts/smoke-image-upstream-real.test.mjs` | 0 | 20 个脚本测试通过，覆盖 help 输出列出所有独立真实上游 env 前缀、`--env-file`、当前服务端 Responses JSON 和 Agent Responses SSE dry-run、非计费阶段拒绝 unsafe `BASE_URL`、独立上游准备度摘要、显式 env 文件加载优先级、测试隔离 `.env.local` 私有渠道配置、本地 billable Agent smoke 后清理 `generated-images/.real-smoke` 新增图片产物、独立上游必跑/已选/未选场景报告、`--require-independent-targets --case ...` 子集运行不能误报通过、只选择 server-channel 场景时最终门禁不能误报通过、5 个独立目标全部实际跑通后 `final_gate_satisfied=true`，以及本地 mock billable Responses JSON 走 `/v1/responses` 并返回图片。 |
| `npm run smoke:image-upstream-real -- --help` | 0 | help 输出列出 `--env-file <path>`、`IMAGE_REAL_SMOKE_ORIGINAL_*`、`IMAGE_REAL_SMOKE_GAOREN_*`、`IMAGE_REAL_SMOKE_SUB2API_*`、`IMAGE_REAL_SMOKE_SUB2API_RESPONSES_*`、`IMAGE_REAL_SMOKE_GPT2IMAGE_*`。 |
| `npm run smoke:image-upstream-real -- --include-server-channel` | 0 | 非计费 dry-run 通过；`independent_targets.configured_count=0`、`missing_count=5`；5 个独立真实上游目标因缺少 `IMAGE_REAL_SMOKE_*_BASE_URL` 跳过；当前服务端渠道因缺少 `--allow-billable` 跳过，未触发真实生图。 |
| `npm run smoke:image-upstream-real -- --include-server-channel --case server-channel-responses-json` | 0 | 非计费 dry-run 通过；当前服务端 Responses JSON smoke 识别 `superapi.buzz` 渠道，因缺少 `--allow-billable` 跳过，未触发真实生图。 |
| `npm run smoke:image-upstream-real -- --include-server-channel --case server-channel-agent-responses-sse` | 0 | 非计费 dry-run 通过；当前服务端 Agent Responses SSE smoke 识别 `superapi.buzz` 渠道，因缺少 `--allow-billable` 跳过，未触发真实生图。 |
| `npm run smoke:image-upstream-real -- --include-server-channel --allow-billable --timeout-ms 180000 --case server-channel-agent-responses-sse` | 0 | 同日此前记录的真实服务端渠道通过；返回 `200 application/json`，`image_count=1`，`first_content_url=/api/agent/artifacts/.../content`，`has_inline_base64=false`。 |
| `npm run smoke:image-upstream-real -- --require-independent-targets` | 1 | 预期失败；`independent_targets.configured_count=0`、`missing_count=5`；`skipped_required_cases` 为 `original-images-json`、`gaoren-images-sse`、`sub2api-images-sse`、`sub2api-responses-json`、`gpt2image-responses-sse`。 |
| `npm run smoke:image-upstream-real -- --env-file .env.real-smoke.example --require-independent-targets` | 1 | 预期失败；可提交模板中的空值不会被误判为已配置真实上游，5 个独立真实目标仍全部列入 `skipped_required_cases`。 |
| `git diff --check` | 0 | 当前 diff 无 whitespace error。 |
| `find generated-images/.real-smoke ...` | 0 | 当前 `generated-images/.real-smoke` 目录无新增 `png`、`jpg`、`jpeg`、`webp` 产物残留。 |

## 2026-05-22 运行态契约复验

运行方式：`npx next dev --turbopack -p 4785` 启动本地服务后，只读请求 `GET /api/agent/capabilities`、`GET /api/agent/openapi.json`、`GET /api/runtime-capabilities`。

| 端点 | 结果 | 摘要 |
| --- | --- | --- |
| `/api/agent/capabilities` | 通过 | `defaults.image_backend=images-api`，`defaults.streaming_strategy=off`，`defaults.partial_images=2`；`agent_streaming.generate.mode=non_streaming_only`，`agent_streaming.edit.mode=non_streaming_only`，`agent_streaming.upstream_sse.mode=internal_upstream_sse`，`request_fields=image_backend,streaming_strategy,partial_images`，`activation_strategies=openai-sse,newapi-keepalive-sse,responses-sse,force-sse`，`final_response_contract=AgentImageResponse`；`agent_streaming.page_sse.endpoint=/api/images`，`contract=page_ui_only`；`agent_jobs.mode=job_polling`。 |
| `/api/agent/openapi.json` | 通过 | `GenerateRequest` 暴露 `image_backend`、`streaming_strategy`、`partial_images`；`image_backend.enum=images-api,responses-image-generation`；`streaming_strategy.enum=off,auto,openai-sse,newapi-keepalive-sse,responses-sse,force-sse`；`partial_images` 范围为 `1..3`；`AgentStreamingCapabilities.upstream_sse.final_response_contract` 只允许 `AgentImageResponse`。 |
| `/api/runtime-capabilities` | 通过 | `responsesImageBackend.enabled=false`，`mode=experimental`；运行态流式批量能力未默认开启，当前服务端渠道健康容量为 `healthyCredentialCount=7`、`healthyChannelCount=7`。 |

## 2026-05-22 推送后补充复验

当前 HEAD 为 `6fa48f1 Fix agent route test error code typing`，已推送到 `origin/codex/image-upstream-compat`。PR #7 仍为 Draft/Open，`mergeStateStatus=CLEAN`。本轮只修改 `src/app/api/agent/agent-routes.test.ts` 的测试桩类型，把持久化失败用例中的错误码收敛为 `AgentErrorCode`，不改变业务运行代码。

| 命令或检查 | 退出码 | 摘要 |
| --- | --- | --- |
| `npm run verify -- --postgres` | 0 | `npm test`、`npm run lint`、`npm run lint:scripts`、`npm run build`、`npm run test:postgres`、`git diff --check`、`git diff --cached --check` 全部通过。 |
| `NODE_ENV=test node --test --import tsx src/app/api/agent/agent-routes.test.ts` | 0 | 37 个 Agent route 测试通过；PostgreSQL 子套件因该定向命令未配置 `AGENT_POSTGRES_TEST_DATABASE_URL` 跳过，完整 Postgres gate 已由 `npm run verify -- --postgres` 覆盖。 |
| `npx tsc --noEmit` | 0 | 修复后源码和测试 TypeScript 静态检查通过。 |
| `npm run smoke:image-upstream-compat` | 0 | 原版 new-api Images JSON、sub2api Images JSON、gaoren keepalive SSE、gaoren JSON-as-SSE、sub2api Images SSE、sub2api Responses bridge、GPT2Image Responses SSE 七个本地 mock 兼容场景通过。 |
| `npm audit --audit-level=high` | 0 | `found 0 vulnerabilities`。 |
| `npm run smoke:image-upstream-real -- --include-server-channel` | 0 | 非计费 dry-run 通过；5 个独立真实上游目标仍未配置，当前 `.env.local` 服务端渠道因缺少 `--allow-billable` 未触发生图。 |
| `npm run smoke:image-upstream-real -- --require-independent-targets` | 1 | 按最终门禁预期失败；`final_gate_satisfied=false`、`missing_required_count=5`，缺少 `original-images-json`、`gaoren-images-sse`、`sub2api-images-sse`、`sub2api-responses-json`、`gpt2image-responses-sse`。 |
| `npx next dev --turbopack -p 4786` + 浏览器复验 | 0 | `/api/agent/capabilities` 显示 Agent generate/edit 仍是 `non_streaming_only`，`upstream_sse.final_response_contract=AgentImageResponse`；高级参数显示 Images API / Responses image_generation 和 6 个流式策略；4K/high + auto 显示流式建议；keepalive-only SSE 期间 `document.images.length=0` 且只显示“连接保持中...”，关闭后显式报“API 响应中没有有效图片数据或文件名。”。 |
| `.env.real-smoke.local` / `.env.real-smoke.example` | 不适用 | `.env.real-smoke.local` 当前不存在；模板 `.env.real-smoke.example` 只包含空占位符和默认 `IMAGE_REAL_SMOKE_GPT2IMAGE_RESPONSES_MODEL=gpt-5.4`，不能满足最终真实门禁。 |

## 2026-05-22 status readiness 补充

在 `be9e7cb Read real smoke env files in status` 基础上继续补充 `npm run status` 的 env 文件读取与 URL 安全校验。`status` 现在按 shell 环境变量、`.env.real-smoke.local`、`.env.local` 的优先级只读判断独立真实上游 smoke 配置是否齐全；输出只包含场景 ID、配置数量、缺失 env 键、非法 env 键与原因、最终门禁命令，不输出 URL 或 API Key。`scripts/command-center.test.mjs` 已覆盖 `.env.local` 与 `.env.real-smoke.local` 合并、shell env 优先、sub2api Responses 复用 sub2api 配置、unsafe `BASE_URL` 不泄露值，以及输出不包含 URL/key。

在 `40d87f9 Harden image upstream status readiness` 基础上继续补充 `npm run smoke:image-upstream-real` 的结构化 readiness 失败报告。真实 smoke 脚本现在遇到 unsafe 独立上游 `BASE_URL` 时不再只把错误写到 stderr，而是在 JSON 报告中输出 `invalid_env`、`invalid_cases`、`invalid_required_cases`，同样只包含 env 键与 reason，不输出 URL 或 API Key。若已显式开启 `--allow-billable` 但任一选中目标存在 unsafe `BASE_URL`，脚本会在 readiness 阶段用顶层 `blocked_cases` 阻断其它已配置目标；最终门禁模式额外输出 `blocked_required_cases`，避免配置非法时产生部分真实上游调用。

| 命令或检查 | 退出码 | 摘要 |
| --- | --- | --- |
| `node --test scripts/command-center.test.mjs` | 0 | 22 个脚本测试通过。 |
| `node --import tsx --test scripts/smoke-image-upstream-real.test.mjs` | 0 | 22 个真实 smoke 脚本测试通过，新增覆盖 unsafe 独立上游 `BASE_URL` 的结构化 JSON 报告、非法配置时阻断其它 billable 上游调用，以及普通 billable smoke 顶层 `blocked_cases` 汇总。 |
| `npm run status` | 0 | `image_upstream_real_smoke.configuration_complete=false`、`configured_count=0`、`missing_count=5`，并列出 5 个独立真实上游目标缺失的 `BASE_URL` env。 |
| unsafe `BASE_URL` status 探针 | 0 | 临时注入含凭据、查询参数和片段的 `IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL` 后，`status` 只输出 `IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL` 与 `must_not_include_credentials`，不输出 URL、查询 token 或 API Key。 |
| unsafe `BASE_URL` real-smoke 探针 | 1 | 临时注入含凭据、查询参数和片段的 `IMAGE_REAL_SMOKE_ORIGINAL_BASE_URL` 后，`smoke:image-upstream-real` 返回 JSON；`invalid_required_cases=original-images-json`。同时配置一个可 billable 的 gaoren 目标时，输出 `blocked_required_cases=gaoren-images-sse` 并在 1 秒内退出，证明未进入上游调用；不输出 URL、查询 token 或 API Key。 |
| `npm run verify -- --postgres` | 0 | `npm test`、lint、script lint、build、live PostgreSQL gate、diff checks 全部通过。 |
| `npm run smoke:image-upstream-compat` | 0 | 7 个本地 mock 兼容场景通过。 |
| `npx tsc --noEmit` | 0 | TypeScript 静态检查通过。 |
| `npm run smoke:image-upstream-real -- --require-independent-targets` | 1 | 按最终门禁预期失败；仍缺 5 个独立真实上游目标，`final_gate_satisfied=false`。 |

## 完成度审计矩阵

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| 默认配置不破坏 OpenAI Images API、原版 new-api 和 sub2api 普通 JSON 基线 | `src/app/api/images/route.test.ts`、`npm run smoke:image-upstream-compat` 的 original new-api Images API JSON 与 sub2api Images API JSON 场景、`server-channel-images-json` 真实复测 | 已覆盖 |
| 流式能力只通过配置、UI 开关、Agent 显式策略或探测确认启用 | `src/lib/image-upstream-strategy.ts`、`src/lib/image-upstream-strategy.test.ts`、浏览器 UI smoke 默认未勾选流式、Agent defaults 为 `streaming_strategy=off` | 已覆盖 |
| gaoren/new-api keepalive SSE 和 JSON-as-SSE 能归一化，keepalive 不产生假预览 | `npm run smoke:image-upstream-compat` 的 gaoren keepalive 与 JSON-as-SSE 场景、`src/lib/image-stream-events.test.ts` keepalive/非对象忽略、浏览器 keepalive stub | 已覆盖，真实独立 gaoren 地址缺失 |
| sub2api Images SSE 与 Responses bridge 能归一化 | `npm run smoke:image-upstream-compat` 的 sub2api Images SSE 和 sub2api Responses bridge JSON 场景、`src/lib/image-stream-events.test.ts` Responses partial/output/completed 覆盖 | 已覆盖，真实独立 sub2api 地址缺失 |
| GPT2Image 风格 `/v1/responses` + `image_generation` 工具流式结果可兼容 | `src/lib/responses-image-backend.test.ts`、`npm run smoke:image-upstream-compat` 的 GPT2Image Responses SSE 场景、`server-channel-responses-sse` 真实复验 | 已覆盖，真实独立 GPT2Image 地址缺失 |
| partial image 只能作为进度预览，最终必须等待 completed base64 | `src/lib/image-stream-service.ts`、`src/lib/image-stream-collector.ts`、`src/app/api/agent/agent-routes.test.ts` partial-only 失败用例 | 已覆盖 |
| 缺 final base64、远程 URL-only、上游断流、Responses failed image call 必须显式失败 | `src/lib/image-stream-events.test.ts`、`src/lib/responses-image-backend.test.ts`、`src/app/api/images/route.test.ts` 的非流式 Images URL-only 502、Responses JSON/SSE failed image call 用例、`src/app/api/agent/agent-routes.test.ts` 的 Agent upstream SSE failed image call 用例、`server-channel-images-json` 首次真实 `Connection error` 显式失败记录 | 已覆盖 |
| Agent API 对外保持最终 JSON，内部可消费上游 SSE 并保存 artifact | `src/app/api/agent/agent-routes.test.ts` 的直接 generate Images SSE、直接 generate Responses SSE、job polling Images SSE + artifact content、job polling Responses SSE + artifact content 用例，以及 `server-channel-agent-images-sse` 与 `server-channel-agent-responses-sse` 脚本化真实 smoke | 已覆盖 |
| capabilities/OpenAPI/skill 文档清楚区分页面 SSE、Agent 内部 upstream SSE 和最终响应契约 | `src/lib/agent-api-contracts.test.ts`、`src/lib/agent-openapi.ts`、`skills/gpt-image-playground-agent/SKILL.md`、`skills/gpt-image-playground-agent/references/api.md`、运行态 `GET /api/agent/capabilities` 和 `GET /api/agent/openapi.json` smoke | 已覆盖 |
| 三类独立上游真实 smoke：原版 new-api、gaoren/new-api、sub2api/GPT2Image | `scripts/smoke-image-upstream-real.mjs` 已支持独立 `IMAGE_REAL_SMOKE_*` 目标和 `--env-file <path>`；当前 dry-run 证明本机未配置专用 `BASE_URL`，`independent_targets` 汇总缺失目标并给出最终门禁命令，`missing_env_any` 指出缺失 env；`--require-independent-targets` 可作为最终门禁 | 未完成，缺少独立真实上游地址和 key |

## 结论

- 当前实现保持默认 Images API JSON 基线，不会自动按仓库名启用流式能力。
- 页面默认不发送 `stream=true`；用户显式开启流式后，在没有 partial image 前只显示连接保持状态，不把 keepalive 当成预览或成功。
- 当前真实上游证明 Images JSON、Images SSE、Responses SSE、Agent 内部上游 SSE 可通过本项目稳定契约落到最终产物。
- 当前真实上游的 Responses 非流式路径未返回符合契约的 `image_generation_call.result`，本项目按设计显式失败。
- 因本机没有独立原版 new-api、gaoren new-api、sub2api 和 GPT2Image 地址，无法把这四类实现分别做真实 smoke；对应兼容行为以本地 mock 契约测试作为当前证据。
