# External Executable Resolution

OpenCove 需要启动外部 CLI，例如 `codex`、`claude`、`gemini`、`opencode` 和 `gh`。GUI app 从 Finder、Dock 或系统入口启动时，进程环境经常不同于用户交互 shell，因此外部可执行文件和交互式终端启动必须有明确 owner，不能在各调用点散落 `which` / `where.exe`。

本问题不是“如何多补几个 PATH 目录”，而是“谁拥有 command runtime environment”。如果 `availability`、`model list`、`launch`、`session locator`、`task/worktree AI helper` 分别各自读取不同的 PATH 或 shell 状态，就会出现：

- 找得到 `codex`，但真正执行时 shebang 里的 `node` 找不到；
- provider availability 显示可用，但 model list 失败；
- provider availability 宿主探测不可用，但终端 profile 启动实际可用；
- GUI 启动、CLI 启动、Worker 启动表现不一致。

## Current Components

Shell environment:

- `src/platform/os/ShellEnvironmentService.ts`
- 非 Windows 使用用户 shell 的 `-ilc` 捕获环境，并带 marker、timeout 和副作用防护。
- Windows 使用当前进程环境。
- 结果在 app session 内缓存，可显式 dispose。

Command environment:

- `src/platform/os/CommandEnvironmentService.ts`
- 负责决定本次 app session 的 command env owner：
  - Windows：当前进程环境。
  - test mode：当前进程环境。
  - 显式 `OPENCOVE_TRUST_PROCESS_ENV=1`：当前进程环境。
  - 其它 POSIX GUI/desktop 场景：shell-derived env。
- 当 owner 是 Windows `process_env` 时，仍会把常见稳定 shim/bin 目录正规化进 PATH，避免能解析到 `codex.cmd` / `claude.cmd`，但 wrapper 再找 `node` 时失败。
- 会清理 shell capture 期间注入的保护性环境变量，避免把捕获辅助变量泄漏到真实 CLI。

Executable locator:

- `src/platform/process/ExecutableLocator.ts`
- 解析顺序是 explicit override、command env PATH、process PATH、fallback directories。
- 返回 `executablePath`、`source`、`status` 和 diagnostics。

Agent executable resolver:

- `src/contexts/agent/infrastructure/cli/AgentExecutableResolver.ts`
- 将 provider 映射到命令名。
- 复用 `ExecutableLocator`。
- 对同一 provider + override 在 app session 内缓存解析结果。
- 输出 availability、resolved executable、spawn invocation 以及 command environment snapshot。
- availability 是宿主侧诊断，不是交互式 agent launch 的硬闸门。

Agent launch spawn resolver:

- `src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver.ts`
- 真实 agent launch / resume 复用 `TerminalProfileResolver.resolveCommandSpawn()`。
- Windows 上即使用户未显式选择 profile，也会走检测到的默认终端 profile（当前稳定默认是 PowerShell），让 PowerShell profile、Git Bash login shell、WSL distro 的启动语义与 OpenCove terminal 保持一致。
- 只有显式传入的 session env 会被注入 WSL 内部命令；宿主 command env 只用于启动 `wsl.exe`，避免把整个 Windows 环境展开到 `wsl.exe env ...`。

Invocation adapter:

- `src/contexts/agent/infrastructure/cli/AgentCliInvocation.ts`
- 处理 Windows `.cmd/.bat` 等包装语义。

Hydration:

- `src/platform/os/CliEnvironment.ts`
- packaged app / worker 启动时，使用同一份 command env owner 去补 PATH / locale，而不是再单独跑另一套 shell 读取逻辑。

## Status Values

Resolver 返回的状态：

- `resolved`：已找到可执行文件。
- `not_found`：自动解析未命中。
- `invalid_override`：用户配置了 override，但该路径不可执行。

Agent provider availability 将这些状态映射为：

- `available`
- `unavailable`
- `misconfigured`

## Sources

`source` 表示解析来源：

- `override`
- `shell_env_path`
- `process_path`
- `fallback_directory`

用户 override 是 durable user intent；自动解析结果是 runtime observation，不持久化为 truth。

## Owner Model

### Single Source Of Truth

OpenCove 区分两类 owner：

1. `CommandEnvironmentService` 是宿主侧 executable discovery、model list、session locator、task/worktree helper 的 env owner。它决定：

- 哪份 env 才是本次 app session 的 authoritative runtime env；
- executable discovery 应该看哪份 PATH；
- 非交互式 `spawn / execFile` 应该继承哪份 env。

2. `TerminalProfileResolver` 是交互式 terminal / agent launch 的 runtime owner。它决定：

- Windows PowerShell / Git Bash / WSL profile 如何包裹命令；
- 默认终端 profile 如何在用户未显式选择时生效；
- terminal node 和 agent node 是否看到同一套 shell startup 结果。

### What Must Share The Same Owner

以下宿主诊断 / 非交互式路径必须共享 `CommandEnvironmentService`：

- provider availability
- provider model list
- session locator / session list
- task title generation
- worktree name suggestion

以下交互式路径必须共享 `TerminalProfileResolver`：

- terminal launch / command launch
- agent launch / resume
- local mount 内的 terminal / agent launch

如果某条交互式启动路径绕过 terminal profile，只继承裸 `process.env`，就视为设计错误。

## Supported Installation Patterns

OpenCove 不负责安装这些工具，但 resolver / command env 必须能兼容它们的常见安装形态。

POSIX:

- `nvm` / `fnm`
  - 主要依赖 shell 初始化脚本注入 PATH，因此要优先信任 shell-derived env。
- `Volta`
  - 稳定 shim 目录通常在 `VOLTA_HOME/bin` 或 `~/.volta/bin`。
- `asdf`
  - 稳定 shim 目录通常在 `ASDF_DATA_DIR/shims` 或 `~/.asdf/shims`。
- `mise`
  - 稳定 shim 目录通常在 `XDG_DATA_HOME/mise/shims` 或 `~/.local/share/mise/shims`。
- npm global bin
  - 常见在 `PNPM_HOME`、`~/.npm-global/bin`、`~/.local/bin` 等目录。

Windows:

- `nvm-windows`
  - 常见依赖 `NVM_SYMLINK` / `nodejs` symlink。
- `scoop`
  - 常见依赖 `~/scoop/shims` 或 `%SCOOP%\\shims`；command env 与 fallback directories 都应覆盖，确保 npm/pnpm wrapper 再次调用 `node` 时也能成功。
- `%APPDATA%\\npm`
  - npm global CLI 常见安装位置。
- `Volta`, `pnpm`, `scoop`, `chocolatey`
  - 依赖各自 shim/bin 目录在 PATH 中或被 fallback directory 覆盖。

注意：

- `nvm` / `fnm` 这类“每个 shell 动态注入 PATH”的方案，**不能**只靠硬编码 fallback 目录解决；shell-derived env 是主路径。
- `Volta` / `asdf` / `mise` 这类 shim 方案，既应被 shell-derived env 覆盖，也应在 fallback directories 中保留稳定兜底。
- Windows 上如果 CLI wrapper 本身已能被解析，但内部再次调用 `node` 仍依赖 PATH，则 command env 也必须包含对应的稳定 shim/bin 目录，不能只在 discovery 阶段补 fallback。

## Settings Integration

Agent settings 支持 provider 级 executable override：

- DTO 字段：`executablePathOverrideByProvider`
- Renderer 工具函数会按 provider 解析 override。
- Agent availability、model list 和 session locator 使用 executable resolver。
- Agent launch 将 override 作为 terminal-profile command 传入；未配置 override 时传入 provider 默认命令名（例如 `claude`）。

无效 override 不会静默回退到自动探测；host diagnostics 会暴露 `misconfigured`，让用户修正配置。交互式 launch 菜单只把 `misconfigured` 视为明确不可启动；普通 `unavailable` 只是宿主探测结果，不再阻止 terminal-profile launch。

## Regression Note

`v0.2.0` 的 agent launch 不做宿主 executable preflight，Windows 上会把 `claude` / `codex` 这类命令交给 shell/PTY 尝试执行。后续版本引入 `AgentExecutableResolver` 后，把 host PATH / fallback directory 的解析失败升级成 launch 前硬失败，导致某些机器上“终端能运行，但 agent 不能启动”。当前规则恢复交互式启动的终端 profile owner，同时保留 host availability 作为诊断和设置页信息。

## Invariants

1. Availability、model list、session locator、task/worktree helper 必须共享 host command env owner。
2. Agent launch / resume 必须共享 terminal profile owner，不能先用 host resolver 硬拦截。
3. 用户 override 优先于默认 provider command。
4. Resolver 失败必须返回 diagnostics，不能只给模糊错误。
5. Windows `.cmd/.bat` host invocation 语义只能在 invocation adapter 层处理；terminal-profile launch 应优先让 profile shell 自己解析命令。
6. WSL command wrapper 只注入显式 session env，不能把完整 host env 当作 Linux env 展开。
7. GUI / desktop 路径下，如果 `codex` 通过 `/usr/bin/env node` 依赖 PATH 找 `node`，非交互式路径必须共享 command env；交互式路径必须共享 terminal profile。

## Current Boundaries

- Agent providers 已接入统一 resolver。
- Agent launch 已接入 terminal-profile launch resolver。
- task title / worktree name suggestion 也应复用同一 command env owner。
- `gh` 和 workspace path openers 仍有各自探测代码；触达这些路径时应保持诊断清晰，并优先复用统一 resolver。
- Resolver 不负责安装外部 CLI，也不管理 `nvm`、`asdf`、`mise` 等版本管理器生命周期。

## Review Checklist

新增任何外部 CLI 集成时，review 至少确认：

1. executable discovery 是否走统一 resolver 或统一 command env。
2. 交互式 `spawn` 是否走 terminal profile，而不是直接拿裸 `process.env`。
3. 是否需要兼容 shell-managed PATH（`nvm` / `fnm`）与 shim-managed PATH（`Volta` / `asdf` / `mise`）。
4. 失败 diagnostics 是否能明确说明 override/source/PATH owner。
5. 如果是 GUI/desktop 启动路径，是否验证过 shebang CLI (`#!/usr/bin/env node`)。

## Verification Anchors

- `tests/unit/platform/commandEnvironmentService.spec.ts`
- `tests/unit/platform/executableLocator.spec.ts`
- `tests/unit/platform/shellEnvironmentService.spec.ts`
- `tests/unit/platform/cliEnvironment.hydration.spec.ts`
- `tests/unit/contexts/agentExecutableResolver.spec.ts`
- `tests/unit/contexts/agentLaunchSpawnResolver.windows.spec.ts`
- `tests/unit/contexts/agentCliInvocation.spec.ts`
- IPC approved workspace guard tests that cover Windows terminal-profile launch.
