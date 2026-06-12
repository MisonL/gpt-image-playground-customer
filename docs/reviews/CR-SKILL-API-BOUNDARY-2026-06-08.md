# CR-SKILL-API-BOUNDARY-2026-06-08

## 范围

- 补齐单张 `generate-image.mjs` 对页面 SSE 已支持的 Responses/GPT2Image 高级参数覆盖。
- 明确 Agent JSON API、页面 `/api/images` SSE、分享、日志、runtime capabilities、页面删除和前端本地体验的边界。
- 不修改 Agent API schema、OpenAPI schema、数据库 schema、真实上游门禁或页面主链实现。

## 代码与文档结论

- `generate-image.mjs` 现在支持 `--responses-model`/`--gpt-model`、`--thinking`、`--prompt-optimization` 和 `--force-web`。
- 这些字段被定义为页面 SSE 专属字段：dry-run 会显示 `/api/images` 路由，真实 page SSE form-data 会发送 `responsesModel`、`thinking`、`promptOptimization` 和 `force_web`。
- 显式 `--agent`、`--job`、`stream_mode=non_stream` 或 `streaming_strategy=off` 与上述页面高级字段同时出现时会在网络请求前失败。
- `responsesModel` 必须同时设置 `image_backend=responses-image-generation` 或兼容别名 `responses`。
- README、Skill 文档和 API reference 已明确：分享、日志、runtime capabilities、页面图片删除、结果反馈、灵感相册和历史复用不属于 Agent JSON API 或 Agent OpenAPI。
- README 和 API reference 已补充前端能力到 API 边界的对照矩阵，避免把页面工作台能力误归入 Agent JSON API。
- `agent-skill-scripts.test.mjs` 增加文档与端点边界 drift guard：页面 API 必须出现在 README、Skill 和 API reference 的边界说明中，同时不得进入 `AGENT_ENDPOINTS`。

## 验证记录

| 命令 | 结果 | 摘要 |
| --- | --- | --- |
| `node --test scripts/agent-skill-scripts.test.mjs` | 通过 | 86 个脚本测试通过，覆盖 generate 高级参数 dry-run、page SSE form-data、显式 Agent route 拒绝、关闭流式拒绝、参数校验和 WebUI/Agent 边界 drift guard。 |
| `NODE_ENV=test node --test --import tsx src/app/api/agent/agent-routes.test.ts` | 通过 | 47 个 Agent route 测试通过；PostgreSQL 子套件因 `AGENT_POSTGRES_TEST_DATABASE_URL` 未配置跳过。 |
| `NODE_ENV=test node --test --import tsx src/app/api/images/route.test.ts` | 通过 | 40 个页面 `/api/images` 流式与 Responses/GPT2Image 字段测试通过。 |
| `NODE_ENV=test node --test --import tsx src/app/api/logs/route.test.ts src/app/api/shares/route.test.ts` | 通过 | 24 个日志与分享页面 API 测试通过。 |
| `npm run lint:scripts` | 通过 | `scripts/check-node-syntax.mjs` 通过。 |
| `npm run verify` | 通过 | full profile 通过：`version:check`、`npm test`、`npm run lint`、`npm run lint:scripts`、`npm run build`、`git diff --check`、`git diff --cached --check`。 |
| `git diff --check` | 通过 | 当前 diff 无 whitespace error。 |

## 残余 gate

- `npm run verify` 本轮输出 `postgres=false`，未覆盖真实 PostgreSQL gate。
- 本轮没有执行真实上游 `--allow-billable` smoke。
- 本轮没有执行 Docker、Hugging Face Space 或生产部署 gate。
