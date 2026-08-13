# 仓库贡献指南

## 项目结构

图像手记是基于 Next.js 16 和 React 19 的本地优先图片创作工作台。`src/app/` 包含应用路由页面、共享页和路由处理器；主工作台为 `src/app/page.tsx`，图片接口位于 `src/app/api/images/route.ts`，智能体接口位于 `src/app/api/agent/`。将可复用的领域逻辑放在 `src/lib/`，将界面组件放在 `src/components/`，基础界面组件位于 `src/components/ui/`。`scripts/` 存放构建、部署和诊断脚本，`database/` 保存 SQLite/Postgres 数据库模式，`docs/` 保存产品、部署和审查资料。

## 开发、构建与验证

使用 Node.js `>=22.15.0`、npm 和提交的 `package-lock.json`。首次安装运行 `npm ci --strict-allow-scripts`；运行 `npm run dev` 在 `http://localhost:4783` 启动 Turbopack 开发服务。常用命令如下：

```bash
npm test                              # 全部单元与契约测试
npm test -- src/lib/image-service.test.ts  # 定向测试
npm run lint                          # ESLint 检查 src/
npm run format:check                  # Prettier 检查
npm run build                         # 生产构建
npm run verify                        # 提交前完整基线
```

需要连接真实 Postgres 时，使用 `npm run verify -- --postgres` 并提供测试数据库。`npm run start` 必须在构建后使用，不要直接运行 `.next/standalone/server.js`。

## 架构与变更边界

页面工作台、页面 SSE 接口和智能体 JSON 接口是不同的调用边界；不要因为某一路径可用就推断其他路径或真实上游也已通过。路由、流式传输、幂等键、产物分享和状态后端的行为应由服务端契约决定，客户端脚本只做薄封装。实现变更时先定位受影响的路由处理器、`src/lib/` 领域逻辑和对应测试，再做最小修改；不要为了让测试通过加入静默回退、伪造上游响应或吞掉错误。

## 代码与测试规范

使用 TypeScript 严格模式和 `@/` 路径别名。保持现有四空格缩进、单引号、分号和 120 列宽；执行 `npm run format` 处理格式和导入排序。组件使用 PascalCase 导出，文件使用 kebab-case。测试与被测模块同目录放置：`*.test.ts`、`*.test.tsx` 或 `scripts/*.test.mjs`；使用 `node:test` 与 `tsx`，覆盖成功、边界和失败分支。修改接口、流式响应、路由或状态模式时，同步更新契约测试。仓库面向人的 Markdown、技能说明和环境变量样例注释统一使用中文；命令、路径、接口字段和协议值保持原样。

## 智能体、配置与安全

复制 `.env.example` 为本地配置，绝不提交 `.env*`、真实密钥、`generated-images/` 或 `artifacts/`。自定义上游地址必须与自定义 API 密钥成对使用。涉及图片生成、编辑、批量处理或渠道诊断时，先阅读 `skills/visual-journal-image-agent/SKILL.md`，复用其中脚本以及智能体能力声明和 OpenAPI 契约；任何真实上游计费调用都必须显式传入 `--allow-billable`。

## 提交与合并请求

近期提交使用约定式提交格式；示例中的提交文本保留仓库实际历史用语：`fix(images): validate payload`、`refactor(skill): rename agent`、`docs: clarify deployment`。一个提交只处理一个可验证任务。合并请求说明应列出改动范围、验证命令及结果；界面改动附桌面和移动端截图，配置或数据库模式改动说明迁移和部署影响。提交前运行 `git diff --check`，避免混入无关生成物或格式改动。
