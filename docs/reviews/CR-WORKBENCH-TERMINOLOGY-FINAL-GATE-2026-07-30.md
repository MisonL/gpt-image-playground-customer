# 工作台与术语调整最终回归记录

日期: 2026-07-30

范围: 已继承的工作台响应式改造、图片编辑和历史面板交互、请求参数边界、Agent API 与 Skill 契约、用户可见术语，以及 standalone 和 Docker 运行时打包。

## 结论

- 本地自动化、真实 PostgreSQL、production build、standalone 打包和 Docker 运行态检查均已通过。
- Docker 当前运行最终工作区构建的镜像，容器健康，首页、静态资源、运行时能力接口和非计费 Agent 诊断均可访问。
- 真实上游图片生成尚未验收。独立 smoke 配置缺少全部六个必需目标的 Base URL，门禁正确拒绝通过，且未发送任何计费请求。

## 自动化证据

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm test` | 0 | 1492 通过、0 失败、1 跳过；跳过项是未配置环境变量的 PostgreSQL 子套件。 |
| `npm run test:postgres` | 0 | 101 通过、0 失败，覆盖真实 PostgreSQL 行为。 |
| `npm run lint` | 0 | ESLint 通过。 |
| `npm run lint:scripts` | 0 | Node 脚本语法检查通过。 |
| `npm run format:check` | 0 | TypeScript 与 TSX 格式检查通过。 |
| `npm run version:check` | 0 | 版本元数据一致。 |
| `npm run install-scripts:check` | 0 | 安装脚本白名单检查通过。 |
| `npm run npm-install-policy:check` | 0 | npm 安装策略检查通过。 |
| `npm run dependencies:check` | 0 | 依赖安装完整性检查通过。 |
| `npm run build` | 0 | Next.js production build、standalone runtime 和 sharp 运行依赖补齐通过。 |
| `npm run smoke:image-upstream-local` | 0 | 6 个本地 fixture 兼容目标全部通过。 |
| `git diff --check` | 0 | 未发现空白或补丁格式错误。 |

## Docker 与界面证据

| 检查 | 结果 |
| --- | --- |
| `docker compose up -d --build` | 0；最终工作区重新构建并替换容器。 |
| `docker compose ps` | `gpt-image-playground-customer` 为 `healthy`，仅发布到 `127.0.0.1:4783`。 |
| `GET /` | 200，页面 HTML 正常返回。 |
| 静态 CSS | 200，standalone 静态资源未丢失。 |
| `GET /api/runtime-capabilities` | 200，当前有效请求方式为 `images-non-stream` 和 `images-sse`。 |
| `npm run agent:doctor -- --base-url http://127.0.0.1:4783` | 0；capabilities、契约校验、runtime 和 SQLite state backend 通过，计费 smoke 按设计跳过。 |
| 浏览器检查 | 桌面 1280px 与移动 390px 页面完成加载；无横向溢出，工作台、预览、历史面板和移动主操作均可见。 |

## 真实上游门禁

执行命令:

```bash
npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable
```

结果: 退出码 1，属于预期的配置不完整门禁失败，而不是上游请求失败。`configured_count=0`、`missing_count=6`，以下目标均因缺少 Base URL 而跳过：

- `original-images-json`
- `gaoren-images-sse`
- `sub2api-images-sse`
- `sub2api-responses-json`
- `gpt2image-responses-sse`
- `matsca-images-sse`

没有使用 `.env.local` 作为独立 smoke 凭据来源，也没有构造替代目标或伪造成功结果。只有在提供独立目标配置并明确授权计费后，才能运行真实图片生成验证。

## 范围边界

- 本记录证明本地代码、Docker 打包、页面可达性和非计费协议契约，不证明真实上游、Hugging Face Space 或计费图片生成可用。
- 工作区仍包含本次功能的未提交改动；本记录不代表已提交、已合并或已发布。
