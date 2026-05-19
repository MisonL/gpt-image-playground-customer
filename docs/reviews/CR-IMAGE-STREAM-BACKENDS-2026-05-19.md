# CR-IMAGE-STREAM-BACKENDS-2026-05-19

## 范围

- 固化 Images API 上游流式事件适配层。
- 抽取 `/api/images` 服务端流式处理公共逻辑。
- 补充路由级流式契约测试。
- 增加 provider dialect 诊断，不记录 API key 或原始 base64。
- 增加受 `ENABLE_RESPONSES_IMAGE_BACKEND` 保护的实验 Responses API 图片后端。
- 收敛 `route.ts` 复杂度，保持单文件低于 300 行。

## 已验证行为

- 官方 OpenAI Images 流式事件可归一化为前端稳定 SSE 事件。
- OtokAPI `image.generation.chunk` / `image.generation.result` 可归一化为前端稳定 SSE 事件。
- SDK 丢失 `event:` 名称时，仍能识别带图片数据的 fallback payload。
- 多图 result、无 partial、缺最终图、上游流中断均有路由级契约测试覆盖。
- 未知 completed-like payload 不伪造成功；无最终图会显式返回 `error` SSE。
- Responses API 后端默认关闭；只有开启开关、显式传 `imageBackend=responses` 并配置独立 `/responses` 顶层模型才调用 `/responses`。
- Responses API 实验后端只读取 `image_generation_call.result`，缺结果或失败状态会显式报错。

## GPT2Image 评估结论

- 可借鉴：对话历史、多变体展示、瀑布并发、参考图上下文。
- 暂不照搬：浏览器保存 API key、纯前端直连上游、把 Responses API 直接替换现有 Images API 主链路。
- 后续若要做对话式生图，应新增独立页面或模式，不混入现有生成、编辑、Agent API 与批量流式路径。

## 验证记录

- `npm test`：通过，256 pass；默认测试中的 Postgres live 用例因未设置 `AGENT_POSTGRES_TEST_DATABASE_URL` 跳过。
- `npm run test:postgres`：通过，31 pass；脚本拉起真实 PostgreSQL 容器并执行 live gate。
- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- `docker compose up -d --build`：通过，镜像 `gpt-image-playground-customer:local` 用最新代码重建并启动。
- Docker HTTP smoke：`/`、`/api/runtime-capabilities`、`/api/agent/capabilities`、`/api/auth-status` 均返回 200；`/api/logs` 在未配置 `APP_PASSWORD` 时返回 403，符合预期。
- Docker 内 OpenAI 兼容假上游 smoke：非流式 `/api/images` 返回 1 张图片；流式 `/api/images` 返回 `partial_image -> completed -> done`。
- 浏览器 smoke：Chrome 打开 `http://127.0.0.1:4783/` 成功，首页可访问。
- 真实上游探针：当前 `.env.local` 渠道 `/v1/models` 和 `/api/images` 均返回 429 `DAILY_LIMIT_EXCEEDED`，确认真实成功出图受上游日限额阻塞。

## 未覆盖

- 未完成真实 OpenAI 或 OtokAPI 成功出图；当前上游返回 429 `DAILY_LIMIT_EXCEEDED`，需要可用额度后复验。
- 未实现对话式生图、多轮编辑、多变体产品界面。
