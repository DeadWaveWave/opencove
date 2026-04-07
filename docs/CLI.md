# CLI

本文档定义 OpenCove CLI 的架构约束与可维护规范。

CLI 的定位是：给 Agent/自动化脚本提供一个稳定入口，去驱动 OpenCove 的核心能力，并确保与 Desktop/Web 共享同一套业务真相与不变量。

## 1. 核心原则

- CLI 是 **client**，不是 owner。
- CLI 禁止直读写 DB、状态文件或 renderer store；必须通过统一的 Control Surface 访问能力（见 `docs/CONTROL_SURFACE.md`）。
- CLI 输出必须支持机器消费：优先 JSON；错误必须是结构化语义（而不是字符串拼接）。

## 2. Local-first 的连接模型（约束）

CLI 的默认运行模型应满足：

- **本机优先**：默认只连 `127.0.0.1` 的本地控制面。
- **显式授权**：使用 token（或等价机制）避免任意本地进程未经授权控制 OpenCove。
- **可发现但可撤销**：连接信息应有明确生命周期（例如随应用退出清理），并可被用户一键重置。

> 具体 transport（IPC vs HTTP/WS）以实现为准，但必须满足上述约束与 `docs/ARCHITECTURE.md` 的边界规则。

## 3. 命令设计规范

- 子命令必须按业务领域分组（例如 `space/*`、`session/*`、`worktree/*`、`fs/*`），避免“一把梭”命令集。
- `query` 类命令默认 `--json` 或直接 JSON 输出；人类可读输出必须可选（例如 `--pretty`）。
- `command` 类命令必须明确其副作用与 scope（例如空间/挂载/工作目录的解析必须由 usecase/Control Surface 返回，CLI 不得自行猜测 cwd 规则）。

## 4. 对贡献者：扩展 CLI 的正确方式

当你需要新增一个 CLI 能力：

1. 先在对应 context 写好 `application/usecase`（owner 清晰）。
2. 再把它接到 Control Surface（command/query）。
3. 最后在 CLI 层只做参数解析与输出格式化，不写业务规则。

这样才能保证未来 Web/Remote 复用同一条链路，而不是每个 client 各自实现一套语义。

## 5. Multi-endpoint Orchestration（M6，实验性）

Milestone 6 引入 “Home Worker 编排多个 endpoints” 的最小 CLI 入口（client 仍只连接 Home Worker）：

- endpoint registry：`opencove endpoint list/register/ping/remove`
- mounts：`opencove mount list/create/resolve/remove`
- mount-aware filesystem：`opencove fs read-in-mount/write-in-mount/stat-in-mount/ls-in-mount`
- mount-aware session：`opencove pty spawn-in-mount` + `opencove pty attach`

示例（先连 Home Worker，再由 Home 路由到 remote）：

```bash
opencove endpoint register --hostname <host> --port <port> --remote-token <token>
opencove mount create --space <spaceId> --endpoint-id <endpointId> --root-path <remoteRootPath>
opencove pty spawn-in-mount --mount <mountId>
opencove pty attach --session <homeSessionId>
```
