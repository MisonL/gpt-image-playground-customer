# Visual Journal DSH 插件

这个包把 Visual Journal 的 Agent API 接入 DeepSeek Harness，提供三个工具：

- `visual_journal_capabilities`：读取能力和限制，不产生图片。
- `visual_journal_generate`：默认只做 dry-run；真实请求必须同时传入 `allow_billable=true` 和稳定的 `idempotency_key`。
- `visual_journal_diagnose`：按 `request_id` 或 `idempotency_key` 读取请求诊断。

默认服务地址是 `http://localhost:4783`，也可以使用 `GPT_IMAGE_PLAYGROUND_URL` 或 profile patch 的 `baseUrl` 覆盖。服务地址只从 profile 配置和进程环境读取，工具参数不能覆盖它，避免把鉴权凭据发送到模型指定的地址。鉴权使用 `GPT_IMAGE_AGENT_TOKEN`，或使用 `GPT_IMAGE_APP_PASSWORD_HASH` 发送 `X-App-Password-Hash`。密钥只从进程环境读取，不写入请求正文、日志或仓库文件。

安装到 DSH profile 后，DSH 会根据 `dsh.bundle.patch` 自动加载 `cordis.patch.yml`。

这个目录是独立 npm 包，不属于根项目的依赖树。首次在源码目录运行测试前执行 `npm install`，然后运行 `npm test`；发布前可用 `npm pack --dry-run` 确认 tarball 包含 `lib/index.js`、`cordis.patch.yml` 和测试文件。
