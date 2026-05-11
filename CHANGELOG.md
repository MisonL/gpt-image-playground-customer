# Changelog

本文件记录项目的重要变更。

本项目参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 格式维护变更记录，并使用语义化版本管理正式发布版本。

## [未发布]

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

[未发布]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/MisonL/gpt-image-playground-customer/compare/dc7c8f5855e80cb9507517b5748c718e7155df52...v1.1.0
[1.0.0]: https://github.com/MisonL/gpt-image-playground-customer/commit/dc7c8f5855e80cb9507517b5748c718e7155df52
