---
name: gpt-image-playground-agent
description: 调用已部署的 GPT Image Playground Agent API，面向 Codex、Claude Code、Gemini 等自动化 Agent 的图片生成与图片编辑任务。适用于用户部署了本项目的任意实例，包括本机一键脚本、Docker、局域网服务器、云服务器、域名或自定义端口，并需要先定位服务地址，再通过 /api/agent/* 处理 Idempotency-Key、结构化 AgentError、可重试错误、产物 metadata/content URL、Bearer token 或 password-hash 鉴权，以及 response_mode path/base64/both 的场景。
---

# GPT Image Playground Agent

通过用户已部署的 GPT Image Playground `/api/agent/*` 接口生成或编辑图片。不要假设服务一定在本机；不要模拟网页表单；直接使用 Agent API 契约、幂等键和产物 URL。

## 执行流程

1. 先定位服务基础地址。优先使用用户明确提供的 URL；其次使用 `GPT_IMAGE_PLAYGROUND_URL`；都没有时尝试默认地址 `http://localhost:4783`。
2. 用候选基础地址请求 `GET /api/agent/capabilities`。如果默认地址不可达、404、不是 JSON 或不是 Agent capabilities 响应，向用户询问实际部署地址、端口、域名和是否需要鉴权。
3. 读取 capabilities 中的认证方式、模型、限制、状态后端和端点路径；不要硬编码假设部署方式。
4. 为每个业务操作生成稳定的 `Idempotency-Key`。同一操作重试时复用原 key；不同操作不要复用。
5. 文生图使用 `POST /api/agent/images/generate`，请求体为 JSON。
6. 图片编辑使用 `POST /api/agent/images/edit`，请求体为 `multipart/form-data`，源图字段使用 `image_0..image_9`。
7. 默认使用 `response_mode: "path"`，只在用户明确需要图片内联数据时使用 `base64` 或 `both`。
8. 处理失败时读取结构化 `error.code`、`error.retryable` 和 `Retry-After`。仅当 `retryable=true` 时等待后重试。
9. 返回结果时优先给出 `content_url`、`metadata_url`、产物 ID、尺寸、格式和是否命中幂等缓存。

## 鉴权

如果服务端配置了 `AGENT_API_TOKEN`，发送：

```text
Authorization: Bearer <token>
```

如果服务端使用 `APP_PASSWORD`，发送 `X-App-Password-Hash`。下载或删除产物时必须复用同一鉴权方式。

## 调用约束

- 不要把 API Key、token 或密码写入源码、文档示例、日志或测试快照。
- 不要把 `localhost:4783` 当作唯一部署位置；它只是无明确地址时的探测默认值。
- 不要在模型上下文中展开大体积 base64，除非用户明确要求。
- 不要把 `error.message` 当成唯一判断依据；稳定分支以 `error.code` 和 HTTP 状态为准。
- 不要在没有 `Idempotency-Key` 的情况下调用生成或编辑接口。

## 可用脚本

- `scripts/generate-image.mjs`：JSON 文生图调用。
- `scripts/edit-image.mjs`：multipart 编辑调用。

脚本读取以下环境变量：

- `GPT_IMAGE_PLAYGROUND_URL`：服务基础地址，可指向本机、局域网、云服务器或域名；脚本未设置时默认尝试 `http://localhost:4783`。
- `GPT_IMAGE_AGENT_TOKEN`：Bearer token。
- `GPT_IMAGE_AGENT_IDEMPOTENCY_KEY`：跨脚本进程恢复同一操作时复用的幂等键。
- `GPT_IMAGE_AGENT_MAX_ATTEMPTS`：最大尝试次数，默认 `3`。

## 参考

需要字段结构、响应示例或错误码列表时，读取 `references/api.md`。
