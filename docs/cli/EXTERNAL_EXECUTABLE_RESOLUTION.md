# External Executable Resolution

OpenCove 需要启动外部 CLI，例如 `codex`、`claude`、`gemini`、`opencode` 和 `gh`。GUI app 从 Finder、Dock 或系统入口启动时，进程环境经常不同于用户交互 shell，因此外部可执行文件必须由统一 resolver 解析，不能在各调用点散落 `which` / `where.exe`。

## Current Components

Shell environment:

- `src/platform/os/ShellEnvironmentService.ts`
- 非 Windows 使用用户 shell 的 `-ilc` 捕获环境，并带 marker、timeout 和副作用防护。
- Windows 使用当前进程环境。
- 结果在 app session 内缓存，可显式 dispose。

Executable locator:

- `src/platform/process/ExecutableLocator.ts`
- 解析顺序是 explicit override、shell-derived PATH、process PATH、fallback directories。
- 返回 `executablePath`、`source`、`status` 和 diagnostics。

Agent executable resolver:

- `src/contexts/agent/infrastructure/cli/AgentExecutableResolver.ts`
- 将 provider 映射到命令名。
- 复用 `ExecutableLocator`。
- 对同一 provider + override 在 app session 内缓存解析结果。
- 输出 availability、resolved executable 和 spawn invocation。

Invocation adapter:

- `src/contexts/agent/infrastructure/cli/AgentCliInvocation.ts`
- 处理 Windows `.cmd/.bat` 等包装语义。

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

## Settings Integration

Agent settings 支持 provider 级 executable override：

- DTO 字段：`executablePathOverrideByProvider`
- Renderer 工具函数会按 provider 解析 override。
- Agent availability、model list、session launch 和 session locator 都使用同一 resolver 路径。

无效 override 不会静默回退到自动探测；它会暴露 `misconfigured`，让用户修正配置。

## Invariants

1. Availability、model list、launch 必须共享 resolver 结果。
2. 真实 spawn 前必须得到 resolved executable 或统一 invocation。
3. 用户 override 优先于 shell env 和 fallback。
4. Resolver 失败必须返回 diagnostics，不能只给模糊错误。
5. Windows wrapper 语义只能在 invocation adapter 层处理。

## Current Boundaries

- Agent providers 已接入统一 resolver。
- `gh` 和 workspace path openers 仍有各自探测代码；触达这些路径时应保持诊断清晰，并优先复用统一 resolver。
- Resolver 不负责安装外部 CLI，也不管理 `nvm`、`asdf`、`mise` 等版本管理器生命周期。

## Verification Anchors

- `tests/unit/platform/executableLocator.spec.ts`
- `tests/unit/platform/shellEnvironmentService.spec.ts`
- `tests/unit/contexts/agentExecutableResolver.spec.ts`
- `tests/unit/contexts/agentCliInvocation.spec.ts`
- IPC approved workspace guard tests that mock agent executable resolution.
