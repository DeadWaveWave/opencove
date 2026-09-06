# CLI

本文档定义 OpenCove CLI 的架构约束与可维护规范。

CLI 的定位是：给 Agent/自动化脚本提供一个稳定入口，去驱动 OpenCove 的核心能力，并确保与 Desktop/Web 共享同一套业务真相与不变量。

## 1. 核心原则

- CLI 是 **client**，不是 owner。
- CLI 禁止直读写 DB、状态文件或 renderer store；必须通过统一的 Control Surface 访问能力（见 `docs/architecture/CONTROL_SURFACE.md`）。
- CLI 输出必须支持机器消费：优先 JSON；错误必须是结构化语义（而不是字符串拼接）。

## 1.1 安装拓扑

`runtime inspect` 只读取构建描述，`runtime verify` 在独立进程内验证执行环境；它们不会启动
Worker 或创建用户 profile。`runtime prepare` 把经过校验的托管部署请求交给独立 runtime
controller。controller 拥有安装/激活元数据，通过 Worker 的维护协议管理生命周期，并由
persistence 基础设施生成一致快照；普通业务 CLI 仍只能通过 Control Surface 访问业务状态。
详细所有权和恢复规则见 [Managed SSH runtime](../runtime/MANAGED_SSH_RUNTIME.md)。

OpenCove 目前支持两条正式的 CLI 安装链路：

- **Desktop 内置安装**：用户在 Desktop 的 **Settings → Worker → CLI** 中点击 **Install CLI**，由已安装的 app 写入 `opencove` launcher（Windows 为 `opencove.cmd`）。
- **Standalone server 安装**：用户从包含 standalone installer 与 runtime bundle 的 GitHub Release 下载资产，并通过 release 专属 `opencove-install-v<tag>.sh` / `opencove-install-v<tag>.ps1` 写入同语义的 `opencove` launcher。stable release 额外提供 `opencove-install.sh` / `opencove-install.ps1` 作为 latest stable 别名。

当前约束：

- Desktop 安装与 standalone 安装最终都生成 runtime-backed launcher。
- Desktop launcher 使用已安装的 Electron runtime；standalone launcher 只使用 bundle 内的纯
  Node runtime，不得加载或回退到 Electron。
- standalone bundle 内的 `better-sqlite3` 与 `node-pty` 必须按所附 Node runtime 的 module
  ABI 单独构建，并在归档前由该 Node runtime 真实加载验证。
- 打包态 launcher 必须指向发布 runtime 内的 CLI entrypoint，不能依赖 repo checkout 路径。
- launcher 会记录安装 owner；两条安装链可以互相覆盖安装，但卸载时只移除自己拥有的 launcher。
- standalone release 覆盖 macOS / Linux / Windows；Windows 资产格式为 `opencove-server-windows-<arch>.zip`。
- standalone launcher 必须从 bundle 内 `package.json` 读取版本并通过 `--app-version` 传给 Worker；缺失或非法版本必须拒绝启动，不能产生身份不明的 Remote Worker。
- 公开 installer 必须从同一 release 路径读取 `SHA256SUMS.txt` 并在解压前校验 bundle；缺失 checksum、缺少本机 SHA256 工具或 hash 不一致都必须 fail closed。
- stable release 同时发布 tag-pinned installer/uninstaller 和 `latest` 通用别名；nightly 只发布 tag-pinned 版本。Managed SSH 必须按 Desktop 当前版本使用 tag-pinned installer，不能把 `latest` 当作版本一致性保证。

若 latest stable 已包含 standalone installer assets，则可使用以下通用安装命令
（macOS / Linux）：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh | sh
```

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.ps1 | Invoke-Expression"
```

如果 `releases/latest/download/opencove-install.sh` 返回 `404`，说明 latest stable
尚未发布 standalone installer；此时应改用 Desktop 安装，或等待包含这些资产的
release。

安装 nightly 或任意指定 tag 的 release 时，应改用该 release 页面中的带版本脚本：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.ps1 | Invoke-Expression"
```

当 latest stable 已包含 uninstall assets 时，可使用以下命令卸载 standalone
runtime：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.ps1 | Invoke-Expression"
```

指定 nightly 或任意指定 tag 时，应使用对应的版本化 uninstall 脚本：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.ps1 | Invoke-Expression"
```

无 Desktop 的 server 场景可直接启动 worker + Web UI：

```bash
opencove worker start --hostname 0.0.0.0 --web-ui-password 'change-me'
```

当 Web UI 暴露到 localhost 之外时，必须设置密码或等价安全门禁。

## 2. Local-first 的连接模型（约束）

CLI 的默认运行模型应满足：

- **本机优先**：默认只连 `127.0.0.1` 的本地控制面。
- **显式授权**：使用 token（或等价机制）避免任意本地进程未经授权控制 OpenCove。
- **可发现但可撤销**：连接信息应有明确生命周期（例如随应用退出清理），并可被用户一键重置。

> 具体 transport（IPC vs HTTP/WS）以实现为准，但必须满足上述约束与 `docs/architecture/ARCHITECTURE.md` 的边界规则。

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
4. Desktop 内置安装与 standalone 安装写出的 launcher 必须共享同一套 runtime 语义。
5. 打包态 CLI/Worker 必须从发布 runtime 自洽启动，不依赖源码 checkout 或外部 Desktop 进程。
6. standalone runtime 解析失败必须 fail-closed；不得静默改用 Electron 或宿主机 Node。
7. standalone Worker 的 `appVersion` 必须等于 bundle 版本，并通过 connection file 与 `system.capabilities` 可验证。

## 4. 命令设计规范

- 子命令必须按业务领域分组（例如 `space/*`、`session/*`、`worktree/*`、`fs/*`），避免“一把梭”命令集。
- `query` 类命令默认 `--json` 或直接 JSON 输出；人类可读输出必须可选（例如 `--pretty`）。
- `command` 类命令必须明确其副作用与 scope（例如空间/挂载/工作目录的解析必须由 usecase/Control Surface 返回，CLI 不得自行猜测 cwd 规则）。

## 5. 对贡献者：扩展 CLI 的正确方式

当你需要新增一个 CLI 能力：

1. 先在对应 context 写好 `application/usecase`（owner 清晰）。
2. 再把它接到 Control Surface（command/query）。
3. 最后在 CLI 层只做参数解析与输出格式化，不写业务规则。

这样才能保证 Web/Remote 复用同一条链路，而不是每个 client 各自实现一套语义。

## 6. Canvas Node Control

CLI 管理画布 Note / Task / Website / Agent / Terminal 窗口的当前能力见：
`docs/cli/CANVAS_NODE_CONTROL.md`。

## 7. Agent Playbook

如果需要让 Agent 直接用 CLI 做本地 smoke / CRUD / focus / space locator 验证，使用：
`docs/cli/AGENT_PLAYBOOK.md`。

如果需要一份可以直接复制给 Agent 的短提示词，使用：
`docs/cli/AGENT_PROMPT.md`。

## 8. External Tool Discovery

如果问题涉及 OpenCove 如何发现和解析外部命令（例如 `codex`、`claude`、`gh`），使用：
`docs/cli/EXTERNAL_EXECUTABLE_RESOLUTION.md`。
