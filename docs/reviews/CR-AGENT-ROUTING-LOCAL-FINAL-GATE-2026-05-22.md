# CR-AGENT-ROUTING-LOCAL-FINAL-GATE-2026-05-22

## 范围

- Agent 图片端点路由契约、错误诊断与终态失败语义。
- 本地图片上游 fixture 与 `smoke:image-upstream-real` final gate 复用路径。
- 本记录只证明本地 fixture、脚本门禁与当前代码契约；不证明第三方真实部署当前可访问。

## 审计结论

- `/api/agent/capabilities` 现在暴露机器可读 `routing_rules`，`schema_version=2026-05-22`。
- 高分辨率 Agent edit 请求在 route 层 `snapshotAgentEditFormData` 前被拒绝，服务层也在读取服务端 API 凭据前保留二道校验。
- partial-only 上游 SSE 失败会保留 `upstream_event_type` 与 `partial_image_count`，但不会泄漏 partial base64。
- 已进入终态 `failed` 的 Agent/job 回放会移除 `retry_after_seconds` 并返回 `retryable=false`。
- 本地 final gate 启动仓库 fixture 后复用真实 smoke 脚本，跑满 5 个独立场景并要求 `final_gate_satisfied=true`。
- 本地 final gate 会跳过 `.env.local` 加载，并清理 `IMAGE_REAL_SMOKE_*`、`OPENAI_*`、`APP_PASSWORD`、`AGENT_API_TOKEN` 等外层输入，避免 shell 凭据污染本地 fixture 验证。

## 验证记录

| 命令 | 退出码 | 摘要 |
| --- | --- | --- |
| `npm test` | 0 | 462 个测试通过；PostgreSQL live 子套件因 `AGENT_POSTGRES_TEST_DATABASE_URL` 未配置跳过。 |
| `npm run lint` | 0 | `eslint src` 通过。 |
| `npm run lint:scripts` | 0 | 脚本语法检查通过。 |
| `npm run build` | 0 | Next.js production build 通过，standalone runtime patch 完成。 |
| `node scripts/smoke-image-upstream-local-final-gate.mjs --timeout-ms 30000` | 0 | 5 个独立本地 fixture 场景全部通过，`final_gate_satisfied=true`。 |
| `git diff --check` | 0 | 当前 diff 无 whitespace error。 |
| 装饰符扫描 | 0 | 代码与 Markdown 改动中未发现 AGENTS.md 禁止的装饰性 Unicode 符号。 |
| `coderabbit review --prompt-only -t uncommitted` | 0 | CodeRabbit 返回 `findings=0`。 |

## 剩余边界

- 本轮未运行真实第三方上游 `--allow-billable` 门禁；独立真实上游仍需要 `.env.real-smoke.local` 提供 5 类真实目标后再跑 `npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable`。
- 本轮未运行 live PostgreSQL gate；数据库真实行为仍以 `npm run test:postgres` 或 `npm run verify -- --postgres` 为准。
