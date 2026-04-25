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

## 3. Worker 生命周期命令

Worker 生命周期属于运行时进程管理问题。参考 [Docker CLI `container stop`](https://docs.docker.com/reference/cli/docker/container/stop/) 的成熟心智：停止命令必须指向明确目标，优先 graceful stop，必要时才强制结束。

OpenCove 的本地转译规则：

- **拓扑名**：跑在本机的 worker 统一叫 **Local Worker / 本机 Worker**；不要在用户文案里引入 Home Worker。
- **生命周期 owner**：connection file 可标记 `startedBy=cli | desktop`；旧 connection file 缺失时视为 `unknown`。
- **默认 stop 规则**：`opencove worker stop` 只停止 `startedBy=cli` 的本机 Worker。
- **保护 Desktop-owned worker**：若目标是 `startedBy=desktop` 或 `unknown`，CLI 默认拒绝；只有显式 `--force` 才允许停止。
- **目标选择**：如果发现多个本机 Worker，CLI 必须要求 `--user-data <dir>` 或 `--pid <pid>`，禁止猜测。
- **发现范围**：CLI lifecycle 命令只读取 worker connection file（`worker-control-surface.json`），不把 Desktop 自己的 control surface 当成 Worker。
- **重复启动**：同一 `userData` 下重复执行 `opencove worker start` 不会创建第二个 Worker；Worker 会输出现有 connection 并退出。

关键不变量：

1. CLI 默认不得误停 Desktop 启动/拥有的 Local Worker。
2. 同一 `userData` 下最多一个 Worker；跨 `userData` 的多个 Worker 必须显式选目标。
3. Stop 先发送 `SIGTERM`，超时且用户显式 `--force` 时才允许升级为强制结束。

## 4. 命令设计规范

- 子命令必须按业务领域分组（例如 `space/*`、`session/*`、`worktree/*`、`fs/*`），避免“一把梭”命令集。
- `query` 类命令默认 `--json` 或直接 JSON 输出；人类可读输出必须可选（例如 `--pretty`）。
- `command` 类命令必须明确其副作用与 scope（例如空间/挂载/工作目录的解析必须由 usecase/Control Surface 返回，CLI 不得自行猜测 cwd 规则）。

## 5. 对贡献者：扩展 CLI 的正确方式

当你需要新增一个 CLI 能力：

1. 先在对应 context 写好 `application/usecase`（owner 清晰）。
2. 再把它接到 Control Surface（command/query）。
3. 最后在 CLI 层只做参数解析与输出格式化，不写业务规则。

这样才能保证未来 Web/Remote 复用同一条链路，而不是每个 client 各自实现一套语义。
