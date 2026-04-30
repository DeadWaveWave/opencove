# External Executable Resolution Spec

状态：Spec。本文定义 OpenCove 对外部可执行文件（例如 `codex`、`claude`、`gemini`、`opencode`、`gh`）的统一发现、解析、诊断与 override 架构。

## 1. 问题类型

这属于成熟的 GUI app / Electron / devtools 问题类：应用从 Finder、Dock、Launcher 或系统入口启动时，运行时环境往往不等于用户交互 shell 中的环境；如果再叠加 `npm -g`、`pnpm`、`Homebrew`、自定义 prefix、shell framework、Windows `cmd`/`bat` 包装，单纯依赖进程 `PATH` 或一次性 shell hydrate 很容易失真。

OpenCove 当前真正不稳定的承诺是：

- 同一台机器上，OpenCove 有时能发现某个外部 CLI，有时不能。
- `provider availability`、`model list`、真实 `launch` 这三个入口并不总是共享同一个解析结果。
- 出问题时，系统通常只能告诉用户“没找到”或“启动失败”，但不能解释自己查了哪里、为什么失败、下一步该改哪里。

`#197` 暴露的是这个 bug class 的一个具体切面：为 `~/.npm-global/bin` 再补一条 fallback，可以修掉一类安装拓扑，但不能消除“每换一种安装来源就再补一条目录”的结构性问题。

## 2. 外部参考

### zsh startup files

参考：<https://zsh.sourceforge.io/Intro/intro_3.html>

- 承诺：
  - `.zshenv` 在所有 shell 启动时读取。
  - `.zprofile` 只在 login shell 读取。
  - `.zshrc` 只在 interactive shell 读取。
- 可迁移原则：
  - 只跑 `zsh -l -c` 不能代表用户平时在交互 shell 中看到的完整环境。
  - 不能假设用户把 PATH 配置放在“正确的” dotfile；现实里大量配置就在 `.zshrc`。

### shell-env

参考：<https://github.com/sindresorhus/shell-env>  
参考实现：<https://raw.githubusercontent.com/sindresorhus/shell-env/main/index.js>

- 承诺：
  - GUI app 需要显式从 shell 捕获环境。
  - 捕获时使用 `-ilc`，也就是 interactive + login shell。
  - 需要对常见 shell framework 副作用做保护，例如禁用 oh-my-zsh 自动更新和 tmux 自动启动。
- 可迁移原则：
  - Shell 环境捕获应该是一个独立能力，不应散落在具体业务调用点。
  - 捕获过程必须有 marker、timeout、fallback shell 和副作用防护，不能直接把 shell stdout 当成稳定协议。

### fix-path

参考：<https://github.com/sindresorhus/fix-path>  
参考实现：<https://raw.githubusercontent.com/sindresorhus/fix-path/main/index.js>

- 承诺：
  - GUI app 里的 `PATH` 修复是必要的，但它本质上是环境归一化，不是业务层 authority。
- 可迁移原则：
  - `PATH hydrate` 有价值，但只能作为 resolver 的输入之一，不能直接等价于“外部 CLI 一定可用”。

## 3. 可迁移原则

综合外部参考，OpenCove 应遵守以下原则：

1. `PATH hydrate` 是 best-effort normalization，不是最终 owner。
2. “能否使用某个外部 CLI” 应由统一 resolver 决定，而不是由各调用点各自 `which` 一次。
3. 真实执行前必须先得到绝对路径或已校验的 invocation，而不是把裸命令名传给多个调用点各自碰运气。
4. 自动探测默认保守：高置信才判定为可用，失败时给出诊断和手动 override，而不是继续盲猜。
5. 查询、模型探测、真实启动必须共享同一条解析链路和同一份诊断。

## 4. OpenCove 当前问题

当前实现中，外部可执行文件发现分散在多处：

- `src/platform/os/CliEnvironment.ts`
  - 负责启动时 PATH/locale hydrate。
- `src/contexts/agent/infrastructure/cli/AgentCliAvailability.ts`
  - 直接 `which`/`where.exe` 判定 provider 是否存在。
- `src/contexts/agent/infrastructure/cli/AgentModelService.ts`
  - 启动真实 CLI 拉取模型。
- `src/contexts/agent/infrastructure/cli/CodexModelCatalog.ts`
  - 启动 `codex app-server`。
- `src/contexts/agent/infrastructure/cli/AgentCliInvocation.ts`
  - 只处理 Windows `.cmd/.bat` 包装。
- `src/contexts/integration/infrastructure/github/GitHubPullRequestGhService.ts`
  - 再次独立探测 `gh`。
- `src/contexts/workspace/infrastructure/openers/workspacePathOpeners.ts`
  - 再次独立探测打开器命令。

风险不在于“代码分散”本身，而在于 authority 分散：

- 谁负责解释用户机器上的 shell 环境，不清晰。
- 谁负责决定某个命令是否可用，不清晰。
- 谁负责向用户提供修复路径，不清晰。
- 一旦某个新安装拓扑失效，最容易出现的修法就是再补一个 fallback 目录或再加一个局部 `which`。

## 5. 目标

1. 对同一 provider / tool，`availability`、`model list`、`launch` 使用同一份解析结果。
2. 对同一 app session，外部可执行解析有明确 owner、统一诊断和可解释的 source。
3. 支持手动 override，可跨重启稳定生效。
4. 保留保守 fallback，但把它降级为最后兜底，而不是主路径。
5. Phase 1 先覆盖 agent providers；抽象本身可复用于 `gh` 和其他外部命令。

## 6. 非目标

1. 不负责安装外部 CLI。
2. 不负责管理版本管理器本身（`asdf`、`mise`、`nvm`、`fnm` 等）的生命周期。
3. 不在启动期无限尝试各种 shell 或 package manager 命令。
4. 不把所有平台差异都隐藏成“完全相同的行为”；Windows 的 `.cmd/.bat` 包装语义仍需单独处理。
5. Phase 1 不要求立刻把所有外部命令都迁移完；先以 agent CLI 为回归最高的主路径。

## 7. 状态与所有权

| State | 类型 | Owner | Write Entry | Restart Source |
| --- | --- | --- | --- | --- |
| `process.env.PATH` / locale hydrate | runtime normalization | `CliEnvironment` | app startup | runtime only |
| `shellEnvSnapshot` | runtime observation | `ShellEnvironmentService` | lazy capture / refresh | runtime only |
| `executablePathOverrideByTool` | user intent, durable | settings context | settings update | persisted app state |
| `resolvedExecutableByTool` | runtime fact | `ExecutableLocator` | resolve / invalidate | recompute on app restart |
| `toolAvailabilityProjection` | UI derived state | query layer | derived only | derived only |

关键约束：

- 用户 override 是 durable truth。
- shell 环境是 runtime observation，不得直接覆盖用户 override。
- `resolvedExecutableByTool` 只在本次 app session 内 memoize；重启后重新解析，避免把过时路径当 durable fact。
- UI 中的“可用 / 不可用 / 需要修复”只是 projection，不得反向写入 resolver truth。

## 8. 不变量

1. 对同一工具，在一个 app session 内，`availability`、`probe`、`launch` 必须共享同一个 resolved executable record。
2. 除 resolver 之外，任何调用点不得自行 `which`、自行拼 PATH、或直接 `spawn` 未解析的裸命令名。
3. 若存在有效的用户 override，resolver 必须优先使用它；shell env 和 fallback 不得覆盖它。
4. 若 resolver 无法高置信找到可执行文件，系统必须返回结构化诊断，而不是继续盲猜。
5. Windows 的 batch/executable 包装只允许在统一 invocation 适配层处理，不能散落在业务模块。

## 9. 总体设计

### 9.1 ShellEnvironmentService

职责：

- 按需捕获一份 shell 感知的环境快照。
- 为 resolver 提供标准化输入，但不直接宣布任何工具“可用”。

建议行为：

- 非 Windows 平台按需执行一次 shell capture，默认使用用户 shell；失败时退回 `/bin/zsh`、`/bin/bash`。
- shell capture 使用 `-ilc`，并使用 marker 包裹输出。
- 注入副作用防护环境变量，至少覆盖：
  - `DISABLE_AUTO_UPDATE=true`
  - `ZSH_TMUX_AUTOSTARTED=true`
  - `ZSH_TMUX_AUTOSTART=false`
- 全流程有 timeout；失败时保留诊断并退回当前 `process.env`。
- capture 结果包含：
  - `PATH`
  - locale 相关变量
  - shell path
  - source（default shell / fallback shell / process env fallback）
  - diagnostics

`CliEnvironment.ts` 未来职责应收敛为：

- app startup 时做最低限度的 process env normalization；
- locale hydrate；
- 为 `ShellEnvironmentService` 提供底层帮助函数；
- 不再单独承担“是否能找到 agent CLI”的最终决策。

### 9.2 ExecutableLocator

职责：

- 对任意外部工具，按统一顺序解析出“可执行路径 + invocation 适配 + 诊断”。
- 作为唯一 authority owner，统一服务给 availability、model list、launch。

推荐接口：

```ts
type ExecutableResolutionSource =
  | 'override'
  | 'shell_env_path'
  | 'process_path'
  | 'fallback_directory'

type ExecutableResolutionStatus =
  | 'resolved'
  | 'not_found'
  | 'invalid_override'
  | 'probe_failed'

interface ExecutableRequest {
  toolId: string
  command: string
  overridePath?: string | null
  fallbackDirectories?: string[]
  validateResolvedPath?: ((path: string) => Promise<boolean>) | null
}

interface ResolvedExecutable {
  toolId: string
  command: string
  executablePath: string | null
  invocationCommand: string | null
  invocationArgsPrefix: string[]
  source: ExecutableResolutionSource | null
  status: ExecutableResolutionStatus
  diagnostics: string[]
}
```

解析顺序：

1. 用户 override。
2. `ShellEnvironmentService` 提供的 `PATH`。
3. 当前 `process.env.PATH`。
4. 有界 fallback directories。
5. Windows invocation 适配。

约束：

- 每一步都记录 diagnostics。
- 找到候选路径后要做最小验证，例如文件存在、可执行、必要时 provider-specific version probe。
- 找到后产出绝对路径；后续调用点不得再回退为裸命令名。
- 结果应做 session 级 memoization，并提供显式 invalidate。

### 9.3 Tool-specific Resolver

在 `ExecutableLocator` 之上加窄适配层，而不是让业务模块各自拼规则。

Phase 1：`AgentExecutableResolver`

- 输入：`AgentProviderId`
- 输出：`ResolvedExecutable`
- 负责 provider -> command 的映射，例如：
  - `claude-code` -> `claude`
  - `codex` -> `codex`
  - `opencode` -> `opencode`
  - `gemini` -> `gemini`
- 负责 provider-specific fallback directories 与 version probe。

Phase 2：复用到其他工具

- `gh`
- workspace path opener commands
- 未来其他 external CLI

## 10. Resolution Flow

### 10.1 Availability

`agentListInstalledProviders` 不再直接返回“裸 provider 数组”作为唯一语义。

建议新增 richer query：

```ts
interface AgentProviderAvailability {
  provider: AgentProviderId
  status: 'available' | 'unavailable' | 'misconfigured'
  executablePath: string | null
  source: ExecutableResolutionSource | null
  diagnostics: string[]
}
```

旧接口如需兼容，可由 richer result 派生：

- `available` -> 保留在旧数组中
- 其他状态 -> 不在旧数组中

### 10.2 Model List

模型拉取必须先通过 `AgentExecutableResolver` 获取 resolved invocation。

例如：

- `AgentModelService`
- `CodexModelCatalog`

都应先拿到同一个 resolved executable，再进行 spawn。

### 10.3 Launch

真实 launch 必须使用 resolved invocation，而不是 `command='codex'` 这种裸命令名。

`AgentCliInvocation.ts` 的演进方向：

- 保留 Windows `.cmd/.bat` 包装逻辑；
- 输入从“裸命令名”升级为“resolved executable path + args”；
- 统一输出真正要传给 `spawn` 的 `command/args`。

## 11. 设置与手动修复路径

系统性解法必须给用户留显式兜底。

建议新增设置：

```ts
agentExecutablePathOverrideByProvider: Record<AgentProvider, string>
```

规则：

- 空字符串表示未设置。
- 非空时按路径解析并校验。
- 校验失败时 provider 状态为 `misconfigured`，而不是静默退回自动探测。
- UI 上必须明确提示：
  - 当前实际使用的可执行路径
  - 来源（override / shell env / process path / fallback）
  - 最近一次失败诊断

兼容与迁移：

- 在 `AgentSettings` 中新增该字段，默认值为空。
- 通过 settings normalization 做向后兼容；旧用户数据自动补默认值。

## 12. 与现有 provider env 的关系

`agentEnvByProvider` 继续表示“启动子进程时附加的环境变量”，不是 executable discovery owner。

边界必须保持：

- resolver 决定“可执行文件在哪里、如何调用”；
- `agentEnvByProvider` 决定“启动后给子进程追加哪些业务环境变量”；
- 二者不能互相替代。

## 13. 迁移计划

### Phase 0：文档与约束落地

- 新增本 spec。
- 在 review checklist 中明确：
  - 禁止新增散落的 `which`/`where.exe` 探测。
  - 禁止直接 `spawn` 未解析的裸命令名。

### Phase 1：Agent path 收口

最低 meaningful regression layer：unit + integration。

实施内容：

1. 引入 `ShellEnvironmentService`。
2. 引入 `ExecutableLocator`。
3. 引入 `AgentExecutableResolver`。
4. 把以下调用点收口到同一 resolver：
   - `AgentCliAvailability`
   - `AgentModelService`
   - `CodexModelCatalog`
   - agent launch path
5. 保持现有 UI 兼容，先不强依赖新设置 UI。

### Phase 2：诊断与 override UI

最低 meaningful regression layer：integration + targeted E2E。

实施内容：

1. 扩展 provider availability query，返回 richer diagnostics。
2. 新增设置项 `agentExecutablePathOverrideByProvider`。
3. 在 settings panel 暴露 override 与当前解析来源。
4. 为 misconfigured / unavailable 提供明确文案。

### Phase 3：迁移其他外部命令

最低 meaningful regression layer：unit + contract。

优先目标：

1. `gh`
2. workspace path openers
3. 其他明确依赖外部命令的基础设施

## 14. 验证方案

### Unit

- shell capture 输出解析：
  - 正常 marker
  - shell 噪声输出
  - timeout / fallback shell
- resolver 顺序：
  - override 优先
  - override 无效不静默回退
  - shell env 命中
  - process path 命中
  - fallback dir 命中
- Windows invocation：
  - `.exe`
  - `.cmd`
  - `.bat`

### Contract

- availability query 返回结构化状态与 diagnostics。
- launch failure 错误语义稳定，不依赖字符串分支。

### Integration

- 模拟 macOS `zsh` 仅在 `.zshrc` 注入 PATH 的场景，验证 interactive shell capture 能发现 CLI。
- 模拟 `~/.npm-global/bin`、`~/.local/bin`、Homebrew 目录。
- 验证同一 session 内 `availability`、`model list`、`launch` 使用同一 resolved executable。
- 验证 settings override 跨重启恢复。

### E2E

仅在 UI 发生可见变化时补充：

- 设置 override 后成功启动 agent。
- override 配错时 UI 显示 `misconfigured`，并给出可执行修复提示。

## 15. 主要 trade-off

### 为什么不继续只补 fallback 目录

- 优点：改动小。
- 缺点：每次只覆盖一个安装拓扑，authority 仍分散，长期必然复发。

### 为什么不把 interactive shell capture 作为唯一 owner

- interactive shell 更接近用户真实环境，但仍可能失败、变慢、产生副作用。
- 因此它应成为 resolver 的高优先级输入，而不是唯一 truth。

### 为什么不把 resolved path 做持久化 cache

- 自动探测得到的路径本质上是 runtime observation，可能因为 CLI 升级、重装、删除而失效。
- durable truth 只应保存用户显式 override；自动解析结果适合 session 级 memoization。

## 16. Review Checklist

涉及外部命令时，review 必查：

1. 是否复用了统一 resolver，而不是新增散落的 `which`/`where.exe`。
2. 是否在真实 `spawn` 前先拿到 resolved executable。
3. 是否把用户 override、runtime observation、UI projection 分开建模。
4. 是否给失败路径留下了结构化诊断，而不是只有一条模糊错误文案。
5. 若新增外部命令，是否先接入通用 `ExecutableLocator`，而不是局部复制一份解析逻辑。

## 17. 结论

这类问题的系统性修复，不是“把 PATH 补得更全”，而是把“外部可执行文件发现”从 scattered heuristics 收口为明确 owner：

- `CliEnvironment` / `ShellEnvironmentService` 负责环境观察与归一化；
- `ExecutableLocator` 负责统一解析与诊断；
- 具体业务只消费 resolved executable；
- 用户始终拥有显式 override 兜底。

按这个结构落地后，`#197` 这类问题会从“不断补目录”变成“resolver 新增或调整一条受控规则”，回归面和可解释性都会明显提高。
