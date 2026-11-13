# ARCHITECTURE

本文档只定义 OpenCove 的**架构标准与组织方法**，不承担“展示完整目标目录”或“列举具体模块内容”的职责。

架构文档回答两件事：
- 代码应按什么规则组织。
- 不同层与不同 context 分别负责什么、禁止什么。

具体落地结构应以当前代码为准。

> 当前 Project / Space / Endpoint / Mount / Session 能力链路见 `docs/architecture/WORKSPACE_CAPABILITY_ARCHITECTURE.md`。

## 1. 核心原则

OpenCove 采用：
- **DDD 划分领域**：先确定 context、owner、边界，再决定代码放哪。
- **Clean 约束依赖**：先确定依赖方向与层职责，再决定实现方式。

一句话：**先按领域切边界，再按 Clean 收紧依赖。**

## 2. 一级组织规则

- `context` 是一级业务组织单位。
- `app/main`、`app/preload`、`app/renderer` 只负责进程边界与组合，不是业务 owner。
- 不再以“进程目录 + 杂糅业务逻辑”作为最终业务结构。

## 3. Context 规则（DDD）

每个 context 都必须先回答四个问题：
- 它拥有哪类业务真相。
- 它不拥有哪类业务真相。
- 哪些状态是 durable fact，哪些只是 runtime observation 或 UI projection。
- 它与其他 context 通过什么边界协作。

强制要求：
- 一个业务真相只能有一个 owner。
- 跨 context 只能传递事实、引用、命令或受控事件，不能直接改写对方 owner state。
- `persistence` 不是业务 owner；它只是事实的持久化承载方式。

## 4. 分层模板（Clean）

每个 context 按以下模板组织：
- `domain`
- `application`
- `infrastructure`
- `presentation`

### `domain`
- 放业务规则、不变量、状态模型、值对象、领域服务。
- 不允许依赖 `React / Electron / CLI / DB / FS / network / window.opencoveApi`。

### `application`
- 放 usecase、用户意图、跨对象编排、端口定义。
- 只依赖 `domain`、抽象端口与共享 contract/type。
- 不直接依赖具体技术实现。

### `infrastructure`
- 实现 `application` 所需端口。
- 负责 `Electron / IPC / watcher / PTY / CLI / DB / FS / network` 对接。
- 不拥有业务规则，只负责技术接入。

### `presentation`
- 负责边界转换与展示。
- `main-ipc`：校验、映射、调用 usecase。
- `renderer`：组件、store、view-model、事件转发。
- 不定义 durable truth。

## 5. 依赖规则

只允许向内依赖：

```text
domain <- application <- presentation
          ^
          |
    infrastructure
```

强制要求：
- `domain` 不能依赖外层。
- `application` 不能 import 具体技术实现。
- `infrastructure` 只能实现端口，不能反向定义业务规则。
- `presentation` 不能绕过 `application` 直接改写业务 owner。
- `shared` contract/runtime 不能依赖任何 context，包括 type-only import；共享结构必须由内层 contract 自身定义。
- 一个 context 不能直接依赖另一个 context 的 `infrastructure` 或 `presentation`。
- context 之外的代码（其他 context、`src/app/*`、`src/platform/*`）只能通过目标 context 的公开入口（public entry）import 它，不能 deep import 内部文件。公开入口是每个 layer 目录根下只做具名 re-export 的 `index.ts`，且只有这五个路径有效：`src/contexts/<ctx>/domain/index.ts`、`application/index.ts`、`infrastructure/index.ts`、`presentation/main-ipc/index.ts`、`presentation/renderer/index.ts`；import 时写 layer 目录本身，例如 `@contexts/filesystem/domain`。其他 context 只能 import `domain` 与 `application` 入口；`infrastructure`、`presentation/main-ipc`、`presentation/renderer` 入口只留给组合根（`src/app/*`）使用。入口只允许 `export { ... } from` 与 `export type { ... } from`，且只能 re-export 自己 layer 目录内的文件；入口在有使用方时才创建；context 内部文件不得 import 自己的入口。type-only import 同样计入。

这些规则的可执行形式在 `harness/architecture/rules.json`，由 `pnpm arch:check` 在 `verify:quick` 和 CI 中强制执行。

## 6. 进程边界规则

`app/managedRuntime` 是按需启动的托管 runtime controller 组合根，只能依赖 application、
infrastructure 和 shared；不能依赖 renderer。部署决策属于 topology application，安装锁、
journal、快照和进程调用属于 infrastructure。CLI 只路由请求，不承载另一份部署策略。

### `main`
- 负责进程生命周期、模块装配、资源清理。
- 不负责业务判定。

### `preload`
- 负责白名单 bridge 暴露。
- 不负责业务判定。

### `renderer`
- 负责 UI 组合、交互绑定、展示状态。
- 不负责跨边界技术接入与 durable truth 判定。

### `window.opencoveApi`
- 只能出现在边界 adapter。
- 禁止出现在 `domain / application / renderer presentation`。

### `host process`（故障隔离）

当某个子系统满足任一条件时，必须使用独立进程（例如 Electron `utilityProcess` 或 Node `child_process`）承载，而不是放在 `main` 进程内：
- 会加载 **native addon**（Node-API/N-API），且其异常可能导致进程级 `abort / segfault`（典型：PTY）。
- 会执行不受信任或高复杂度的外部命令，并需要长时间保持运行（TTY/CLI daemon）。
- 其故障应被视为“可恢复的子系统不可用”，而不是“全应用退出”。

强制约束：
- `main` 只承担 **supervisor**：启动/退出、重启退避、health 状态汇总、统一日志、统一降级策略。
- renderer **禁止**直连 host process；所有跨进程通信必须经 `main-ipc` 校验与映射。
- host process 必须有可序列化、可版本化的协议（request/response + event stream），并定义“不可用/断连”的一等语义，确保 UI 可解释降级而不是白屏。

进程边界规则的可执行形式在 `harness/architecture/rules.json`，由 `pnpm arch:check` 在 `verify:quick` 和 CI 中强制执行。

## 7. 恢复与持久化规则

对 `hydration / restart / resume / watcher / persistence / fallback` 相关路径，必须先区分：
- `用户意图`
- `durable fact`
- `runtime observation`
- `UI projection`

强制要求：
- `runtime observation` 不得直接覆盖 `durable fact`，除非业务规则明确允许且有回归测试。
- 恢复逻辑恢复的是业务允许恢复的真相与投影，不是任意重建运行时状态。
- `fallback / retry / delayed async completion / watcher noise` 不得静默改写 resumable truth。

## 8. Renderer 组织规则

- `hooks` 只做 wiring、组合、绑定，不承载长流程业务 orchestration。
- 长流程必须进入 `application/usecases`。
- `store` 是 renderer 内的展示状态 owner，不等于业务 durable truth owner。
- UI 派生状态不得反向写成 durable fact。

## 9. Main / IPC 规则

- `main-ipc` 只做校验、映射、调用 usecase。
- 所有 `watcher / timer / child process / subscription` 都必须有明确 owner 和 `dispose` 路径。
- 不允许存在无 owner 的全局 runtime 状态表。
- IPC contract 必须统一、可序列化、可判定。
- 当引入 `host process` 承载高风险子系统时，必须显式建模：`unavailable`（不可用）与 `recovery`（自恢复/重试）语义；不得让调用方靠“超时/偶然报错”猜测子系统状态。

### 9.1 Control Surface（统一控制面）

OpenCove 将外部可驱动能力收敛为一套 **Control Surface**（`command / query / event`），作为 `Desktop(IPC)` / `CLI` / `Web UI` / `Remote Worker` 的共同入口。

强制要求：

- 外部 client 禁止直读写持久化、直改 renderer state、或通过“解析 TUI 输出”推断真相；必须通过 Control Surface 调用 `application/usecases`。
- IPC handler 只能做：`runtime validate -> mapping -> invoke usecase/control-surface -> map result`；不得承载长流程业务编排。
- `Query` 必须无副作用；`Command` 的副作用必须可解释、可恢复（满足恢复模型与 owner 表要求）。
- 所有输入必须 **runtime validate**，输出必须走统一的结构化错误语义（例如 `AppErrorDescriptor`），避免把异常形态泄漏给调用方。
- 长期 runtime 与可替换 transport listener 必须分离 owner：listener stop/drain 只能释放 transport 资源，不能隐式 dispose 其委派的 PTY、presentation、recovery 或其它业务 runtime。

详细约束见 `docs/architecture/CONTROL_SURFACE.md`。
Web UI / Remote Worker 等浏览器或远端入口，都是同一套 Control Surface 在不同 transport（HTTP/WS/IPC）上的适配与复用；Web listener lifecycle 见 `docs/runtime/WORKER_WEB_ACCESS_LIFECYCLE.md`，常见问题与调试见 `docs/runtime/WEB_UI_TROUBLESHOOTING.md`。

## Variants and registries

封闭的 variant 集合（agent provider、node kind）只有一个运行时列表；关于某个 variant 的静态事实写在以它的 id 为 key 的表里，
漏一项是编译错误，不是运行时默认值。调用方读取字段，不比较身份（`provider === 'codex'`、`case 'task':`）。
新增行为的最低成本做法是给 variant 的表项加一个字段，然后读取该字段。

| Variant | Id 的唯一来源 | 静态描述（所有进程可用） | 运行时行为（仅 main / worker） |
| --- | --- | --- | --- |
| Agent provider | `AGENT_PROVIDER_IDS`（`src/shared/contracts/dto/agent.ts`） | `AGENT_PROVIDER_DESCRIPTORS`（`src/shared/contracts/agentProviderDescriptors.ts`：`label`、`titlePrefix`、`capabilities`） | `AgentProviderContribution`（`src/contexts/agent/infrastructure/providers/<id>/`） |
| Node kind | `PERSISTED_WORKSPACE_NODE_KINDS`（`src/shared/contracts/persistedAppState.ts`） | 按关注点划分的 `Record<PersistedWorkspaceNodeKind, T>` 表（例如 `workspaceNodeSizing.ts`） | 无 |

- 其他列出该集合或其子集的类型都从来源派生（别名、`Extract` / `Exclude`、基于描述表的 mapped type），不再手写第二份联合类型。
  例如 `TerminalAgentShimProvider` 由 `capabilities.terminalActivityShim` 派生，`CanvasNodeKind` 由 `PersistedWorkspaceNodeKind` 派生。
- Renderer 只 import `agentProviderDescriptors.ts`（纯数据，受 `architecture.sharedNoContextDependency` 与 `architecture.rendererNoElectronRuntime` 约束）。
  可用性等运行时事实继续通过既有 IPC / Control Surface DTO 到达。
- Plugin node kind（`PluginNodeKind = string`）是开放集合，不在此范围内。

**规则**（`architecture.variantLiteralDecision.<variant>`、`architecture.variantSwitchExhaustive.<variant>`，均为 `warn`，进入 ratchet）：

- 标记：`provider === 'codex'`、`case 'pi':`、`['codex', 'pi'].includes(p)`、`data.kind === 'note'`（node kind 只在被比较表达式的名字以 `kind` 结尾时计入），
  以及不以 `assertNever` 收尾的、含有 variant `case` 的 `switch`。
- 允许：该字面量 owner 路径内的比较（provider 为 `providers/<id>/**`）、variant 的来源与描述文件、node kind 的 exit guard
  （`if (data.kind !== 'task') return` 这类没有 `else`、主体只有一条 `return` / `continue` / `break` / `throw` 的 `!==`），以及 exhaustive `switch` 的 `case` 标签。
- exit guard 必须是纯退出（`return;`、返回已有值、`continue`、`break`、`throw`）；旧写法 `const _: never = x` 不能带类型转换；只有 `src/shared/utils/assertNever.ts` 里的 `assertNever` 算数。
- 每条规则按 variant 拆成独立的规则 id（如 `architecture.variantLiteralDecision.agentProvider`），一个 variant 的下降不能抵消另一个的上升。
- 没有行内 suppress；变更 owner 只能改 `harness/architecture/rules.json`。完整语义见 `harness/architecture/README.md`。
- 已知缺口（检测不到）：字面量放进常量再比较、`new Set([...]).has(p)`、对具名数组的 `.includes` / `.indexOf`、`'codex' in table`、把 `Record` 查表结果当作分支、`provider.startsWith('codex')`、通过别名读取主体、主体改名后不以 `kind` 结尾。后续让规则感知类型（按操作数类型是否为 variant 联合类型判断）可一并关闭。

**如何新增 agent provider**：

1. 在 `AGENT_PROVIDER_IDS` 加 id；`pnpm check` 会在 `agentProviderDescriptors.ts` 与各 `Record<AgentProviderId, ...>` 表处报缺项。
2. 补 `AGENT_PROVIDER_DESCRIPTORS` 条目（`label`、`titlePrefix`、`capabilities`），再补其余 `Record` 表。
3. 在 `providers/<id>/` 新增 `AgentProviderContribution`，`displayName` 读取 `label`；运行时差异放在 contribution 里，不要在调用方比较 id。

**如何新增 node kind**：

1. 在 `PERSISTED_WORKSPACE_NODE_KINDS` 加 kind；`pnpm check` 会在 `workspaceNodeSizing.ts`、`spaceHandlers.ts`、`windowKindFamily.ts` 等 `Record` 与 `assertNever` 处报缺项。
2. 补每个表项；需要新行为时给表加字段，不要新增 `data.kind === '...'` 分支。
3. 对 kind 做 `switch` 时以 `default: return assertNever(x)` 收尾（`src/shared/utils/assertNever.ts`）。

## 10. 测试映射规则

- `domain`：unit tests 验证 invariant 与状态迁移。
- `application`：unit/contract tests 验证 usecase 编排与端口交互。
- `infrastructure`：contract/integration tests 验证 adapter、watcher、persistence、CLI。
- `recovery / hydration / resume / watcher`：必须至少有一条 integration 回归；关键用户路径保留 e2e。

## 11. 反模式

以下结构视为违规：
- 在组件或 hook 中堆 `状态判定 + 外部调用 + fallback/retry + 写回`。
- 在 renderer 业务流程文件里直接调用 `window.opencoveApi`。
- 用持久化结构反向定义业务语义。
- 让非 owner context 判定别人的 durable truth。
- 通过跨 context 直接写 store/state 传递业务真相。
- 通过比较 variant 的 id（provider、node kind）来决定行为，而不是读取它的 registry 表项（见 Variants and registries）。
- deep import 另一个 context 的内部文件（绕过它的公开入口），或让入口承载 `export *`、本地声明、跨 layer / 跨 context 的 re-export。
- 在 `main` 进程内直接承载高风险 native/外部运行时（例如 PTY），导致单点崩溃/白屏，缺失故障隔离与可恢复语义。

### Desktop public errors

Preload exposes only `createRendererBridge(api)` as `__opencoveBridge`. The Desktop bootstrap
side-effect installer installs the renderer-owned `opencoveApi` before the statically imported app
graph evaluates. The entry renders synchronously; test-only observations load afterward without
gating startup. The facade and its namespaces are frozen, while success values remain untouched.
Only that client reads the private transport or handles its result envelopes. Every new document
recreates its facade; installation neither retries operations nor owns recovery state.

Validated application failures cross the context bridge as projected data and become local
`OpenCoveAppError` instances. Invalid envelopes and transport failures remain safe native errors:
class identity cannot establish that an operation was rejected before committing. Mount launch
repair must not retry an uncertain result: it requires explicit before-spawn mount rejection evidence.
Main transport failures retain structured uncertainty through preload and renderer revival. Successful domain DTOs, callbacks and unsubscribe
functions retain their existing semantics. Each persistence flush request has one ACK after all
subscribers captured at dispatch settle; unsubscribe removes only future delivery.

Public exception projection permits only code-aware semantic fields, plus up to 2000 characters
of plugin author diagnostics for `plugin.operation_failed`. Only the plugin error formatter may
read that projected `debugMessage`; other renderer presentation must not read private diagnostics.
Plugin diagnostics remain available during local development; producers and Main/preload boundaries
are responsible for keeping OpenCove credentials and internal secret data out of those diagnostics.
This promise covers public exceptions and their display, not all data in the renderer: successful domain DTOs (including nested failure descriptors) remain unchanged, and
Web HTTP bodies are visible to the page. The facade is not an authorization or plugin isolation
boundary; Main and Worker remain responsible for authorization. Web parity covers HTTP application
failures, while native browser and PTY socket errors keep their own contracts.
