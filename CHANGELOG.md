# Changelog

本文件记录项目的重要变更。

本项目参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 格式维护变更记录，并使用语义化版本管理正式发布版本。

## [未发布]

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
- 图片请求构造、流式响应处理和密码重试参数改为可复用流程，批处理和单请求共用同一套错误处理。
- README 与 `.env.example` 补充流式批处理、单 credential 并发上限和渠道失败冷却配置说明。
- ESLint 配置显式绑定 Next.js 根目录，TypeScript 配置排除 `dist` 构建产物。

### 修复

- 修正 `sticky` 路由下流式批处理推荐并发被渠道数量放大的问题，避免同一 affinity key 下突破单 credential 并发上限。
- 修正服务端渠道池全部冷却时前端仍可能按旧推荐并发继续批处理的问题。
- 兼容上游错误中的 `requestID` 和 `requestId` 字段，并确保公开能力接口不返回上游错误消息。
- 修正密码弹窗重试只保存表单数据、未保存请求模式和流式参数的问题。

## [1.2.0] - 2026-05-11

### 新增

- 通过 `OPENAI_CHANNEL_N_*` 环境变量支持服务端多渠道 API Key 路由。
- 支持 `sticky`、`round_robin`、`random` 三种服务端凭证路由策略。
- 增加渠道解析、路由选择、有效凭证解析的单元测试。
- 增加仓库执行约束文档 `AGENTS.md`。
- 增加服务端运行时工具测试，覆盖密码哈希校验、请求来源选择、批次 ID 和图片文件名生成。
- 增加应用日志工具测试，覆盖日志等级规范化、默认等级、无效配置回退和上下文透传。
- 增加 `superapi.buzz` `gpt-image-2` 4K 备用渠道说明。

### 变更

- 统一本地服务默认使用 `4783` 端口启动。
- 抽取服务端运行时工具，复用密码校验、输出目录和文件名生成逻辑。
- 将服务端请求路径日志收敛为可配置日志等级，生产环境默认只输出警告和错误。
- 缓存日志等级解析结果，减少热路径重复计算。
- 在 README 中补充当前 4K 渠道价格说明。

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

[未发布]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/dc7c8f5855e80cb9507517b5748c718e7155df52...v1.1.0
[1.0.0]: https://github.com/MisonL/gpt-image-playground-customer/commit/dc7c8f5855e80cb9507517b5748c718e7155df52
