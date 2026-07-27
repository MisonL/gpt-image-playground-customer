# 部署加固回归门禁

日期: 2026-07-27

范围: Docker 本地部署、Hugging Face Space memory smoke、PostgreSQL overlay、CI 运行时检查、部署脚本和部署文档。

## 已审查变更

- 默认 Compose 发布限制为 `127.0.0.1:4783`。
- 非回环 Compose 发布必须设置非空 `APP_PASSWORD`。
- Docker 镜像提供 OCI revision label 和 healthcheck。
- 本地部署校验干净的 Git revision、镜像身份、发布端口和选定的状态/存储模式。
- PostgreSQL overlay 在使用 Docker secret 文件前清空直连数据库凭证变量。
- HF Space 和本地端点轮询不会在最后一次失败后继续等待。
- CI 校验实际 Docker 入口点的回环分支、健康状态、端点响应和镜像 revision。

## 自动化证据

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run verify` | 0 | 版本、安装策略、依赖、测试、lint、脚本语法、生产构建和 diff 检查均通过。 |
| `npm run test:postgres` | 0 | 101 个测试通过，包含真实 PostgreSQL 并发和 schema 契约。 |
| `npm run smoke:hf-space-local` | 0 | 最新 Docker 镜像通过 memory/indexeddb 运行态和非计费 Agent 契约检查。 |
| `docker build --check .` | 0 | 无 Dockerfile 警告。 |
| `docker compose ... config --quiet` | 0 | SQLite、memory 和 PostgreSQL Compose 配置均成功渲染。 |
| CI 固定 digest 的 actionlint 容器 | 0 | GitHub Actions 工作流语法和语义通过 actionlint。 |
| 非回环 Docker 入口点检查 | 预期退出码 1 | 容器拒绝 `GIP_COMPOSE_DEPLOYMENT= TRUE `、`GIP_BIND_HOST=0.0.0.0` 且未设置 `APP_PASSWORD` 的启动。 |

## 审查证据

- CodeRabbit 审查全部已修改和未跟踪文件后未发现问题。
- Claude Code 使用默认模型且未传 `--model`，报告未发现 P0-P3 问题。
- OMP 仅识别出本地部署和 CI 的最后一次轮询延迟。两条路径均已改为仅在仍有下一次尝试时等待，并为本地探针补充回归覆盖。

## 范围边界

- 本门禁不执行计费的图片生成或编辑请求。
- 真实本地 Docker 和 Hugging Face Space 发布检查属于独立部署验证步骤，因为它们需要干净的已提交 revision 和实时服务状态。
