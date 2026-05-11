# AGENTS.md - 仓库执行约束

## 核心原则

- 全程使用中文沟通，结论必须基于代码、测试、构建或 git 证据。
- 禁止静默降级、隐藏回退、伪造成功路径或吞没异常后继续。
- 每次只处理一个明确任务；修改前先确认影响范围，修改后做最小充分验证。
- 不顺手修改无关问题，不提交临时文件、日志、缓存或个人配置。
- 代码、注释、日志和 Markdown 不使用 Emoji 或装饰性 Unicode 符号。

## 项目事实

- 项目是 Next.js 16 + React 19 的 `gpt-image-2` 本地图片服务。
- 默认服务端口是 `4783`。
- 包管理使用 npm，锁文件是 `package-lock.json`。
- 图片 API 入口在 `src/app/api/images/route.ts`。
- 图片校验和参数读取工具在 `src/lib/image-request-utils.ts`。
- 多渠道 API Key 路由在 `src/lib/channel-router.ts`。

## 常用命令

```bash
npm test
npm run lint
npm run build
git diff --check
```

本地开发：

```bash
npm install
npm run dev
```

Docker 验证：

```bash
docker compose up -d --build
```

## 质量要求

- API URL、文件名、上传文件、图片尺寸、输出格式等外部输入必须显式校验。
- 自定义 API URL 必须和自定义 API Key 同时提供，避免服务器密钥被转发到未知地址。
- 真实密钥只能来自环境变量或用户本地输入，禁止写入源码、文档示例或测试快照。
- 核心逻辑优先放到 `src/lib/` 并补 `node:test` 单元测试。
- 大文件优化应按行为边界拆分，先补测试再迁移逻辑。

## 提交前检查

- 运行 `npm test`、`npm run lint`、`npm run build`、`git diff --check`。
- 用 `git diff --name-only` 确认只包含本任务范围内文件。
- 若修改 README、CHANGELOG 或版本号，必须核对 `package.json`、`package-lock.json`、Git tag/release 口径是否一致。
