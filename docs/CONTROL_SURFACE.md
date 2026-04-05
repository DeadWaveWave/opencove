# CONTROL SURFACE（统一控制面）

本文档定义 OpenCove 的 **Control Surface** 标准：把可被外部驱动的一切能力收敛为一套 `command / query / event`，并允许在不同 transport 上复用（IPC、HTTP/WS 等）。

目标是让 `Desktop(IPC)` / `CLI` / `Web UI` / `Remote Worker` 共享同一套业务入口，从工程结构上避免：

- 业务真相散落在 renderer hooks
- 外部工具通过直读写 DB 或状态文件“黑入”
- 通过解析终端 TUI 文本推断结构化结果

本标准是架构约束，不等于“当前已完整实现”。实现落地以代码为准。

## 1. 定义

- `Query`：只读查询，不得产生副作用（不写 durable truth，不启动长生命周期运行时）。
- `Command`：产生可观察副作用的意图输入（写 durable truth、启动/停止 session、创建/绑定 worktree 等）。
- `Event`：用于 push 更新的事件流（例如 session 状态、pty 数据、任务进度）。

约定：**读写分离**。同一能力若既需要读也需要写，拆成 command + query，而不是“一个大接口全做”。

## 2. 所有权与依赖方向

Control Surface 本身不是业务 owner，它只是一层 **application-level facade**：

- durable truth 的 owner 仍然在各 context（DDD + Clean）。
- Control Surface 只能调用 `contexts/*/application/usecases`（或等价入口）。
- Control Surface 禁止直连 DB、直改 renderer store、或调用别的 context 的 `infrastructure/presentation`。

任何新增的外部能力（CLI/Web/Remote）都必须经由 Control Surface，否则视为架构违规。

## 3. 输入校验与错误语义

强制要求：

- 所有从边界进入的 payload（IPC/HTTP/CLI）必须 `runtime validate`。
- 所有错误必须映射为稳定的结构化语义（例如 `AppErrorDescriptor`），调用方禁止依赖错误字符串做分支判断。
- 不允许把“内部异常形态”直接透出给外部 client。

## 4. Contracts 形状（v0 约束）

本阶段只定义最小可落地约束，具体字段以实现为准。

- 请求必须是可序列化 JSON（不传函数、类实例、Buffer 等）。
- 响应必须是可序列化 JSON，并区分 `ok/value` 与 `ok/error`。
- `Query` 返回的 value 必须不包含进程内对象引用（例如直接返回 `BrowserWindow`、`child_process` 句柄等）。

建议（非强制）：

- 为每个 command/query 定义稳定的 `id`（字符串），用于跨 transport 的路由。
- 保持“强类型 + runtime validate”双轨：类型用于开发期，validate 用于边界安全。

## 5. Transport 适配原则

Control Surface 与 transport 解耦：

- `IPC`：`main-ipc handler` 做 validate/mapping，然后调用 Control Surface。
- `HTTP/WS`：server handler 做 validate/mapping，然后调用 Control Surface。

任何 transport 都不能在 handler 内承载长流程业务编排；长流程必须进入 `application/usecases` 或 Control Surface 下游的 usecase。

## 6. 给贡献者：如何新增一个可被 CLI 调用的能力

新增能力时，按以下顺序落地（避免倒灌与双写）：

1. 在对应 context 的 `domain/application` 中定义事实与 usecase（owner 清晰）。
2. 在 Control Surface 注册一个 `command` 或 `query`，只负责调用 usecase 并做跨 context 的最小编排。
3. 为该能力补 `contract test`（至少覆盖 validate 与错误语义）。
4. 再在 transport 层接入（IPC/HTTP/CLI），transport 只做 mapping，不写业务规则。

相关架构总规范见 `docs/ARCHITECTURE.md` 与 `docs/LANDING_ARCHITECTURE.md`。

## 7. Remote Worker（SSH-first，Phase 4 v0）

> 目标：不改变 contracts 的前提下，把 Control Surface 通过 SSH tunnel 带到远端。

最小工作流（示例）：

1. 先构建一次（保证 `out/main/worker.js` 可用）：

```bash
pnpm build
```

2. 在远端机器启动 worker（默认只监听 `127.0.0.1`，需要 token）：

```bash
node out/main/worker.js --port 16661 --token <token> --approve-root <workspacePath>
```

3. 本地通过 SSH 建立 tunnel：

```bash
ssh -L 16661:127.0.0.1:16661 <host>
```

4. 本地 CLI 通过 tunnel 调用同一套 contracts：

```bash
opencove ping --endpoint http://127.0.0.1:16661 --token <token>
```

可选（用于验证/调试）：

- Worker 启动后可访问 `http://127.0.0.1:<port>/` 打开 Worker 同源托管的 Web UI（Full Web Canvas）。
- Debug shell 位于：`http://127.0.0.1:<port>/debug/shell`（用于快速验证 transport/权限/调用链路）。
- 鉴权（以代码实现为准，以下为 v0 约束）：
  - 程序化调用：`/invoke` 使用 `Authorization: Bearer <token>`。
  - 浏览器访问（避免在 URL 暴露 token）：
    - 默认（loopback/tunnel）：Desktop 可签发一次性 `/auth/claim` ticket 并换取 cookie session。
    - 开启 LAN Access 后：要求走 `/auth/login` 输入 Web UI 密码（cookie session）。

开发模式提示（避免内网白屏/CORS）：

- 当存在 `ELECTRON_RENDERER_URL`（Vite dev server）时，仅对 loopback host（`localhost/127.0.0.1/::1`）使用 dev origin（保留 HMR）。
- 对 LAN host（例如 `192.168.x.x`）一律回落到 worker 同源托管的 build 产物（需要先 `pnpm build`）。

原则：

- 远端 worker 默认不暴露公网端口；SSH/tunnel 是保守默认路径。
- CLI/Web/Desktop 只作为 client；durable truth 与副作用由 worker owner。
