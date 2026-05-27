# Changelog

本文件记录项目的重要变更。

本项目参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 格式维护变更记录，并使用语义化版本管理正式发布版本。

## [未发布]

## [1.4.0] - 2026-05-27

### 新增

- 增加 API 错误排查建议，针对鉴权失败、限流、上游 5xx 和 Cloudflare 524 返回更明确的用户提示。
- 增加图片请求默认质量、错误建议和批量部分失败明细的单元测试。
- 增加上游图片流事件适配层，兼容官方 OpenAI Images 流式事件和 OtokAPI `image.generation.*` 事件。
- 增加 `/api/images` 流式路由契约测试，覆盖兼容上游 SSE 到前端稳定事件的映射、多图结果、缺图错误和上游断流。
- 增加受 `ENABLE_RESPONSES_IMAGE_BACKEND` 保护的实验 Responses API 图片后端，显式请求 `imageBackend=responses` 且配置独立 Responses 顶层模型时读取 `image_generation_call.result`。
- Agent capabilities 和 OpenAPI 增加机器可读 `routing_rules`、页面 SSE metadata、运行态启用后端和 job polling 语义，辅助脚本支持 `--page-sse`、`--agent`、`--job` 显式路由。

### 变更

- 图片生成默认质量从 `auto` 调整为 `high`，前端、Agent API 默认值和 OpenAPI 描述保持一致。
- 页面默认不发送流式请求；用户显式开启流式预览后，单图流式失败会显式展示原始错误和建议，不再自动改用非流式请求。
- 抽取服务端流式图片响应处理，生成和编辑共用同一套 SSE 输出、图片保存、provider dialect 诊断和扣费解析逻辑。
- 运行时能力接口增加实验 Responses API 图片后端开关状态，默认关闭且不影响现有 Images API 路径。
- Agent API、图片接口、脚本和文档中的用户可见错误文案统一为中文。
- Agent skill 文档改为先定位服务地址，再按 `/api/agent/*` 契约调用，避免默认假设服务只在 `localhost:4783`。

### 修复

- 移除用户错误提示中的固定第三方推广链接，保留中性的 Cloudflare 524 排查建议。
- 收紧 Responses `image_generation` 结果解析，只有标准 base64 或常见位图 `data:image/...;base64,` payload 会被当作可保存图片。

## [1.3.0] - 2026-05-12

### 新增

- 增加服务端运行时能力接口 `/api/runtime-capabilities`，用于返回流式批处理开关、推荐并发和渠道健康状态。
- 增加 `ENABLE_STREAMING_BATCH` 与 `OPENAI_MAX_STREAMS_PER_CREDENTIAL`，支持在流式模式下把 `n>1` 拆成多个 `n=1` 任务并发执行。
- 增加前端流式批处理执行链路，支持并发调度、SSE 完成事件聚合、预览图索引映射、用量合并和部分失败提示。
- 生成和编辑表单在服务端允许批处理时支持 `n>1` 开启流式预览，并补充中英文提示文案。
- 增加服务端 credential/channel 失败冷却机制，支持按渠道覆盖冷却窗口。
- 运行时能力接口增加健康 credential/channel 数量和最近失败摘要，用于前端刷新并发窗口。
- 增加流式批处理、运行时环境读取、渠道健康状态和失败分类的单元测试。

### 变更

- 前端提交图片请求前会刷新运行时能力，并按用户自填 API Key 或服务端渠道池选择不同并发窗口。
- 图片请求构造、流式响应处理和访问码重试参数改为可复用流程，批处理和单请求共用同一套错误处理。
- README 与 `.env.example` 补充流式批处理、单 credential 并发上限和渠道失败冷却配置说明。
- ESLint 配置显式绑定 Next.js 根目录，TypeScript 配置排除 `dist` 构建产物。

### 修复

- 修正 `sticky` 路由下流式批处理推荐并发被渠道数量放大的问题，避免同一 affinity key 下突破单 credential 并发上限。
- 修正服务端渠道池全部冷却时前端仍可能按旧推荐并发继续批处理的问题。
- 修正 OpenAI SDK 将连接错误放在嵌套 `cause` 中时未触发 channel 冷却的问题。
- 兼容上游错误中的 `requestID` 和 `requestId` 字段，并确保公开能力接口不返回上游错误消息。
- 修正访问码弹窗重试只保存表单数据、未保存请求模式和流式参数的问题。

## [1.2.0] - 2026-05-11

### 新增

- 通过 `OPENAI_CHANNEL_N_*` 环境变量支持服务端多渠道 API Key 路由。
- 支持 `sticky`、`round_robin`、`random` 三种服务端凭证路由策略。
- 增加渠道解析、路由选择、有效凭证解析的单元测试。
- 增加仓库执行约束文档 `AGENTS.md`。
- 增加服务端运行时工具测试，覆盖访问码哈希校验、请求来源选择、批次 ID 和图片文件名生成。
- 增加应用日志工具测试，覆盖日志等级规范化、默认等级、无效配置回退和上下文透传。
### 变更

- 统一本地服务默认使用 `4783` 端口启动。
- 抽取服务端运行时工具，复用访问码校验、输出目录和文件名生成逻辑。
- 将服务端请求路径日志收敛为可配置日志等级，生产环境默认只输出警告和错误。
- 缓存日志等级解析结果，减少热路径重复计算。

## [1.1.0] - 2026-05-10

### 新增

- 增加中英文界面文案。
- 增加客户交付打包脚本和部署文档。
- 增加主题控制和面向客户的使用说明。

### 变更

- 针对本地化客户版本优化主界面。
- 固定依赖覆盖版本，提升安装可复现性。

### 修复

- 加强图片请求校验和打包行为。
- 加强生成图片文件访问和路径处理。

## [1.0.0] - 2026-05-09

### 新增

- GPT Image Playground 初始公开版本。
- 支持基于 OpenAI 兼容 Images API 的本地图片生成和编辑流程。
- 增加 Docker 部署支持和多平台启动脚本。

[未发布]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/dc7c8f5855e80cb9507517b5748c718e7155df52...v1.1.0
[1.0.0]: https://github.com/MisonL/gpt-image-playground-customer/commit/dc7c8f5855e80cb9507517b5748c718e7155df52
