# 维护清理与质量门禁审计

日期: 2026-07-27

基线: `6590d91`

分支: `codex/maintenance-cleanup-tests-docs`

范围: 未使用代码和直接依赖清理、核心验证计划补测、源码格式统一、CI 门禁和维护文档。

## 清理结论

- 删除未被生产代码、测试或脚本引用的 `toggle.tsx` 和 `toggle-group.tsx`。
- 删除随上述组件失去用途的 `@radix-ui/react-toggle`、`@radix-ui/react-toggle-group` 直接依赖。
- 删除未被 ESLint 配置直接使用的 `@eslint/eslintrc` 直接依赖；lockfile 中由 ESLint 引入的传递依赖继续保留。
- 保留 `brace-expansion` 兼容包，其仍由安全兼容层、Docker 构建和测试使用。
- 保留 `happy-dom`，其仍由 `src/test-utils/react-dom.ts` 使用。
- 未根据 Knip 的未使用文件报告批量删除文件。当前自定义测试入口和 Next.js 隐式路由会被该类静态扫描误报，删除前仍需逐项结合引用和框架约定确认。

## 测试与格式门禁

- 新增 `format:check`，以只读方式校验 `src/` 下 TypeScript 和 TSX 文件的 Prettier 格式。
- `npm run verify` 的 full 和 skip-build 计划均包含 `format:check`，quick 计划保持轻量，不隐藏 full gate。
- 命令中心测试覆盖普通 full、skip-build 和 full with PostgreSQL 三种计划中的格式检查顺序。
- CI 在源码 lint 后执行 `format:check`，格式漂移会显式失败。
- 对现有 `src/` TypeScript 和 TSX 文件执行一次统一格式化；改动仅涉及导入排序、换行、空白和 Tailwind class 排序。

## 自动化证据

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm test -- scripts/command-center.test.mjs` | 0 | 46 个命令中心测试通过，包含新增格式门禁计划断言。 |
| `npm test -- --experimental-test-coverage --test-reporter=dot` | 0 | 全量测试在 Node 覆盖率插桩模式下通过；本次不设覆盖率百分比门槛。 |
| `npm run verify -- --postgres` | 0 | 版本、安装策略、依赖、全量测试、lint、格式、脚本语法、生产构建、真实 PostgreSQL gate 和 diff 检查均通过。 |
| `npm audit --audit-level=high` | 0 | 报告 `found 0 vulnerabilities`。 |
| 固定 digest 的 actionlint 容器 | 0 | GitHub Actions 工作流语法和语义检查通过。 |
| `docker build --check .` | 0 | Dockerfile 检查完成，无警告。 |
| `docker compose config --quiet` | 0 | 默认 SQLite Compose 配置成功渲染。 |
| `docker compose -f docker-compose.yml -f docker-compose.memory.yml config --quiet` | 0 | memory overlay 配置成功渲染。 |
| `docker compose -f docker-compose.yml -f docker-compose.postgres.yml config --quiet` | 0 | PostgreSQL overlay 配置成功渲染。 |

## 独立审查

- OMP 17.0.6 使用默认模型在隔离 worktree 中审查 `6590d91..HEAD`，未发现 P0、P1、P2 或 P3 问题。
- OMP 独立核对删除引用、lockfile 根依赖、格式门禁接线、quick 计划、格式化语义、文档和 CI，并复跑依赖安装、格式检查、命令中心测试、actionlint 和 diff 检查。
- OMP 未复跑的全量 verify、真实 PostgreSQL gate、依赖安全审计、Dockerfile 和 Compose 检查，均由主工作区的自动化证据覆盖。

## 范围边界

- 本次不修改图片生成、渠道路由、认证、存储或 Agent API 的业务行为。
- 覆盖率插桩用于确认核心测试仍实际执行，不将覆盖率数字作为本次删除代码的依据。
- 本次未执行计费图片请求，也未将自动化测试结果表述为真实上游渠道或 Hugging Face Space 已验证。
