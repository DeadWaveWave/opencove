# LANDING ARCHITECTURE

本文档定义：**本次重构（Landing 阶段）** 要落地的最小架构结构。

它只聚焦这次重构必须落地的内容：

- 这次重构必须建立的 context owners
- 这次重构必须遵守的目录落点
- 这次重构必须开始收口的业务链路

通用架构规范仍以 `docs/ARCHITECTURE.md` 为准。

## 1. Landing 的一句话目标

把当前真实主业务链从 renderer/hooks 的粘连逻辑里迁出来，并且在 `src/contexts/*` 内建立可持续演进的 owners：

`Project -> Space -> (Endpoint/Target) -> Task -> Session -> Files`

> 文件与编辑能力的约束见：`docs/FILESYSTEM.md` 与 `docs/DOCUMENT_NODE.md`。

## 2. 当前代码的事实约束（Landing 必须兼容）

当前主链已经客观存在：

- `space.directoryPath` 是默认执行目录真相来源
- worktree create/archive 会改写 `space.directoryPath`
- task/session 启动链仍大量在 renderer hooks 中完成

Landing 的架构必须能做到：

- 不破坏现有单 repo/single path 形态
- 把执行上下文解析收口到 application/usecases
- 让 UI 只做意图输入与投影展示

## 3. Landing 要新增/收口的核心模型

Landing 阶段必须显式化两个概念（哪怕先是 computed/derived）：

- `WorkerEndpoint`
  - 资源到底挂在哪个执行端点上（Landing 初期只有 implicit local）
- `MountTarget`
  - 当前执行与文件访问的真实目标（Landing 初期可由 `space.directoryPath` 推导为 `file:` root）

这两个概念成立后：

- remote mounts 不会缺 owner
- 执行目录不会继续散落在 hooks

## 4. Landing 目录结构（必要最小）

顶层维持既有四层：

```text
src/
  app/
    main/
    preload/
    renderer/
  contexts/
  platform/
  shared/
```

Landing 阶段要求在 `contexts/` 中新增 owners（允许先建空壳）：

```text
src/contexts/
  project/
    domain/
    application/
    infrastructure/
    presentation/

  space/
    domain/
    application/
    infrastructure/
    presentation/

  session/
    domain/
    application/
    infrastructure/
    presentation/

  filesystem/
    domain/
    application/
    infrastructure/
    presentation/
```

并要求现有 contexts 必须补齐 `application`（至少把决策逻辑收口到 usecases）：

```text
src/contexts/worktree/application/
src/contexts/task/application/
src/contexts/agent/application/        # 迁移期允许保留，但新逻辑应逐步下沉到 session
src/contexts/terminal/application/     # 同上
```

> Landing 阶段不要求一次性消灭 `workspace/agent/terminal`，但要求：它们不再吸收新的业务语义，只做迁移壳与 adapter。

## 5. Context Owner Map（Landing 版本）

### `project`

拥有：

- project metadata
- project root
- resources registry（多 repo/path 的 identity）
- endpoints registry（Landing 初期可只有 local）

### `space`

拥有：

- spaces
- boundary（资源与能力的允许范围，Landing 可先最小化）
- mounts（Landing 初期可先 single mount）
- default mount（排序第一作为默认）
- mount target（Landing 初期由 `space.directoryPath` 推导）

### `task`

拥有：

- task durable truth（Landing 可先保持现状，但新写应逐步收口）

### `session`

拥有：

- agent/terminal session truth（status、final message、关联的 mount/target）
- execution context resolution（space + mount + target + scope 的唯一入口）

### `worktree`

拥有：

- worktree lifecycle（create/bind/archive/preflight）
- 将 mount target 切换到 worktree 的受控事实

### `filesystem`

拥有：

- URI + provider 模型（Landing 可先只支持 `file:`）
- read/write/list/stat contracts（为后续 editor/remote 打底）
- 画布内文件编辑（Doc Node）必须复用 filesystem contracts 与 guardrails（approved roots / scope）

## 6. Landing 的强制落点规则（避免继续堆 patch）

### 6.1 允许新增在哪

- 业务决策与不变量：`domain`
- usecases 与 ports：`application`
- 技术实现：`infrastructure`
- IPC/renderer mapping：`presentation`

### 6.2 禁止新增在哪

- 禁止把新的长流程决策新增进：
  - `src/contexts/workspace/presentation/renderer/hooks/*`
  - `src/app/main/*`
  - 任何直接 `window.opencoveApi` 直调链路

## 7. Landing 交付的最小验收

- renderer 不再自行解析 task 的执行目录（由 usecase 返回 execution context）
- worktree 的 create/bind/archive 规则不再依赖窗口逻辑，至少具备可复用的 application usecases
- final message 结构化，不依赖解析 TUI

## 8. 测试结构（Landing 约定）

本仓库采用 `Vitest + Playwright`，Landing 阶段维持 `tests/` 作为主入口。

测试的“主组织维度”按层级选择最稳定的轴：

- `unit`：按 **context** 组织（镜像业务 owner，便于定位与迁移；与 DDD/Clean 的边界一致）。
- `contract`：按 **边界 surface/协议** 组织（IPC/CLI/worker API 等往往横跨多个 context，按 context 反而会把同一协议的约束拆散）。
- `integration` / `e2e`：按 **主链路/用户旅程** 组织（它们天然跨 context，按 flow 更可读；必要时再在二级目录引入 context）。

### 8.1 目录约定

- `tests/unit/`
  - 单文件、可重复、无 IO 的确定性测试（domain/application 为主）。
  - **新增**：按 context 分组放入 `tests/unit/contexts/<context>/...`。
  - **存量**：允许暂留在 `tests/unit/contexts/*.spec.ts(x)`，但重构触达时逐步迁移到 `<context>/` 子目录。
- `tests/contract/`
  - 边界 contract（尤其是 IPC payload validation、端口语义、错误码/降级语义）。
  - 推荐按 surface/协议分组（例如 `tests/contract/ipc/...`）。
- `tests/integration/`
  - 组合级验证（跨多个模块/port/adapter 的联动，但仍在 test runner 进程内）。
  - 按“主链路”或“owner context”组织均可，但必须能回答“谁拥有事实、谁只做编排”。
- `tests/e2e/`
  - Playwright 端到端回归（主进程、窗口、恢复链路、用户可感知行为）。

### 8.2 命名约定

- 默认 `*.spec.ts` / `*.spec.tsx`。
- 平台差异用 `*.windows.spec.ts` / `*.mac.spec.ts` / `*.linux.spec.ts` 收口（现有规范保持一致）。
