# ARCHITECTURE

本文档只定义 OpenCove 的**架构标准与组织方法**，不承担“展示完整目标目录”或“列举具体模块内容”的职责。

架构文档回答两件事：
- 代码应按什么规则组织。
- 不同层与不同 context 分别负责什么、禁止什么。

具体落地结构应以当前代码为准。

> 本次重构（Landing 阶段）的“必要目录结构与 owner 落点”见 `docs/LANDING_ARCHITECTURE.md`。该文档只覆盖 Landing 必需结构。

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
- 一个 context 不能直接依赖另一个 context 的 `infrastructure` 或 `presentation`。

## 6. 进程边界规则

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
- 在 `main` 进程内直接承载高风险 native/外部运行时（例如 PTY），导致单点崩溃/白屏，缺失故障隔离与可恢复语义。
