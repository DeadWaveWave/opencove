# REFACTOR PLAN

本文档定义本轮 OpenCove **完全重构**的落地计划。

它不是通用架构规范；通用规范看 `docs/ARCHITECTURE.md`。
它回答的是：**这一次重构要重构到什么结构、按什么顺序完成、以什么标准验收。**

## 1. 目标

本轮重构只做一件事：

- 以 **DDD** 重新划分业务 context。
- 以 **Clean** 重新收紧依赖方向。
- 彻底拆开 `durable fact / runtime observation / UI projection`。
- 彻底消除当前“按进程目录组织 + 业务逻辑分散在 hook / ipc / infrastructure / store 中”的结构性问题。
- 一次性切到目标结构，不保留长期双轨架构。

## 2. 非目标

以下内容不属于本轮目标，除非为完成重构所必需：

- 不顺手做视觉改版。
- 不顺手扩展产品功能。
- 不为了“兼容旧结构”而长期保留双写、双读、双路由。
- 不保留无法解释 owner 的过渡状态表。

## 3. 强制不变量

这是本轮重构最核心的验收基线；实现可以调整，但不变量不能破。

1. **可恢复真相必须有唯一 owner**
   - 任何会影响 `restart / hydration / resume / reopen` 的状态，必须存在唯一 owner。
   - `renderer store`、`watcher event`、`cleanup path` 不能与 owner 并列成为真相来源。

2. **恢复依赖 durable fact，不依赖偶然运行时**
   - App 重启后能否恢复会话，只能由持久化事实与明确业务规则决定。
   - `process exit`、`watcher noise`、`late event`、`fallback` 不能静默覆盖恢复依据。

3. **Task / Agent / Session 绑定必须可单独重建**
   - 不允许只有 UI 节点还记得关系，而 durable state 无法重建。
   - “窗口类型正确但会话恢复错”“第一次打开窗口但未发消息无法恢复”这类问题，必须从模型上消失。

4. **Presentation 不定义业务结论**
   - `renderer component / hook / store` 与 `main ipc register` 只做映射、展示、转发。
   - 业务判定必须进入 context 的 `application` 或 `domain`。

5. **所有 runtime 资源都必须有 owner 和 dispose 路径**
   - watcher、pty、subscription、timer、ipc listener、window binding 都必须能追溯 owner。
   - 不允许无 owner 的进程级状态表长期存在。

## 4. 目标架构总图

最终代码按三层组织：

- `src/app`：进程入口、装配、生命周期、边界组合。
- `src/contexts`：真正的业务 owner；按 DDD 划分 context，并按 Clean 分层。
- `src/platform`：技术驱动与共享基础设施实现，只服务于 context 的 infrastructure。
- `src/shared`：共享 contract、内核类型、基础错误与 ID；不放业务 owner 逻辑。
- `tests`：按测试层级重组，而不是按旧目录影子映射。

## 5. 目标目录

### 5.1 源码目录

```text
src/
  app/
    main/
      bootstrap/
      composition/
      ipc/
      lifecycle/
      windows/
      index.ts
    preload/
      bridge/
      index.ts
    renderer/
      bootstrap/
      providers/
      shell/
      main.tsx
      index.html

  contexts/
    workspace/
      domain/
      application/
        ports/
        usecases/
      infrastructure/
        persistence/
      presentation/
        renderer/
        main-ipc/

    task/
      domain/
      application/
        ports/
        usecases/
      infrastructure/
        persistence/
      presentation/
        renderer/
        main-ipc/

    agent/
      domain/
      application/
        ports/
        usecases/
      infrastructure/
        cli/
        persistence/
        watchers/
      presentation/
        renderer/
        main-ipc/

    terminal/
      domain/
      application/
        ports/
        usecases/
      infrastructure/
        pty/
        persistence/
      presentation/
        renderer/
        main-ipc/

    worktree/
      domain/
      application/
        ports/
        usecases/
      infrastructure/
        git/
      presentation/
        renderer/
        main-ipc/

    settings/
      domain/
      application/
        ports/
        usecases/
      infrastructure/
        persistence/
      presentation/
        renderer/
        main-ipc/

  platform/
    electron/
    persistence/
      sqlite/
      migrations/
    process/
      pty/
    cli/
    git/
    fs/
    os/

  shared/
    kernel/
    contracts/
      ipc/
      dto/
    ids/
    errors/
    types/
```

### 5.2 测试目录

```text
tests/
  unit/
    contexts/
    shared/
  contract/
    ipc/
    platform/
  integration/
    recovery/
    persistence/
    lifecycle/
    context-collaboration/
  e2e/
  support/
```

## 6. Context 所有权定义

### `workspace`

拥有：
- workspace 集合与 active workspace
- canvas 视口、space、node 布局、选择与空间归属
- workspace 级 UI 可恢复投影

不拥有：
- task 业务语义
- agent 会话恢复真相
- terminal runtime 真相
- worktree 技术实现

说明：
- `workspace` 只拥有“画布与容器组织”，不拥有 task/agent/terminal 的业务内部状态。
- 画布节点只保存必要引用与布局，不保存别的 context 的真相副本。

### `task`

拥有：
- task 实体、标题、优先级、描述等业务字段
- task 与 agent/terminal/worktree 的业务关联意图

不拥有：
- 节点坐标、space 归属、viewport
- PTY 运行时状态

说明：
- “task 开了哪个 agent 窗口、理论上应关联哪个恢复记录”属于 task/agent 受控协作结果，不能只存在 UI store。

### `agent`

拥有：
- agent launch / resume 意图
- durable session binding
- provider/model 选择在 agent 侧的业务含义
- 会话恢复规则、运行时观测归一化规则

不拥有：
- task 布局
- terminal 原始 PTY 驱动
- renderer UI 层展示状态

说明：
- `agent` context 是本轮重构的高风险核心之一。
- “agent 窗口存在”“session 记录存在”“当前 watcher 观测到什么”必须分离建模。

### `terminal`

拥有：
- terminal session 生命周期
- scrollback、snapshot、attach/detach 语义
- terminal metadata 与 runtime state reduction

不拥有：
- agent 恢复业务规则
- task 业务语义

### `worktree`

拥有：
- git worktree 列表、创建、删除、rename、建议名
- 与 workspace/task 协作时需要暴露的受控事实

不拥有：
- workspace 画布状态
- task 或 agent 恢复真相

### `settings`

拥有：
- 用户偏好、默认 provider/model、UI 偏好等

不拥有：
- 任何运行时恢复真相

## 7. 平台层职责

`platform` 只解决“怎么接技术”，不解决“业务上意味着什么”。

例如：
- `platform/process/pty`：只负责 PTY 驱动能力。
- `platform/persistence/sqlite`：只负责 SQLite 访问、migration、事务与 repository 基座。
- `platform/cli`：只负责与外部 CLI 进程或文件布局对接。
- `platform/electron`：只负责 BrowserWindow、app lifecycle、ipc 桥接工具。

强制要求：
- `application` 不能直接 import `platform`。
- `platform` 不反向定义 context 业务规则。
- 若某技术实现只服务单一 context，也优先放在该 context 的 `infrastructure` 下，而不是滥建共享平台层。

## 8. 旧目录到新目录的迁移原则

### 直接淘汰的旧结构

以下目录在完成重构后应被清空并删除：

> 注：此处列的是重构前 legacy 目录（例如旧 `main`/`preload` 结构）；当前目标入口目录见 §5 的 `src/app/*`。

- `src/main/modules`
- `src/main/infrastructure`
- `src/main/ipc`
- `src/preload`
- `src/renderer/src/app`
- `src/renderer/src/features`
- `src/renderer/src/stores`
- `src/renderer/src/utils`

### 映射规则

- 旧 `main/modules/*/ipc` -> 对应 context 的 `presentation/main-ipc`
- 旧 `main/infrastructure/*` -> 对应 context 的 `infrastructure/*` 或 `src/platform/*`
- 旧 `renderer/features/*` 组件与 hook -> 对应 context 的 `presentation/renderer`
- 旧 `renderer` 中的持久化工具 -> 对应 context `application` + `infrastructure/persistence`
- 旧 `shared/types/api.ts` -> 拆为 `src/shared/contracts/ipc/*`
- 旧 `shared/constants/ipc.ts` -> 保留为 contract 层统一出口，但按 context 分文件

## 9. 完全重构的执行方式

本轮采用 **big-bang branch cutover**：

- 在重构分支内可以分提交推进。
- 但合并前必须达到最终目标结构。
- 不允许把“新旧结构长期并存”当作最终状态。
- 不允许保留双向同步的临时兼容层进入主干。

允许存在的临时过渡，仅限：
- 重构分支开发过程中的短期编译中间态。
- 为了分提交而存在、但在合并前必删的 adapter/facade。

## 10. 执行顺序

### Phase 0：冻结模型与验收基线

产物：
- context owner 表
- `durable fact / runtime observation / UI projection` 表
- 恢复路径不变量清单
- 关键回归清单

必须先明确的高风险真相：
- task 与 agent window 的 durable 关联是什么
- session 恢复到底依赖什么 key
- “首次打开但未发送消息”的 session 是否应被持久化、何时持久化、由谁持久化
- watcher/state detector 只能上报什么，不能直接降级什么

### Phase 1：建立新骨架与构建入口

产物：
- `src/app` / `src/contexts` / `src/platform` / `src/shared` 新骨架
- `electron.vite.config.ts`、`tsconfig*`、测试 alias 调整到新入口
- renderer / main / preload 新入口可空转编译

### Phase 2：抽 shared kernel 与 contracts

产物：
- ID、错误、Result、共享 DTO、IPC contracts 拆分完成
- 所有跨层输入输出有明确 contract owner
- `shared` 中不再混放业务语义与技术细节

### Phase 3：重建 settings 与 worktree context

原因：
- 这两个 context 相对独立，适合作为新结构验证样板。

产物：
- 首批完整 `domain / application / infrastructure / presentation`
- main-ipc 注册方式、renderer presenter 方式、repository 方式定型

### Phase 4：重建 terminal context 与 PTY 平台层

产物：
- PTY driver 下沉到 `platform/process/pty`
- terminal usecase、runtime reduction、scrollback persistence 明确 owner
- attach/detach/snapshot/exit/state 的 contract 测试落地

### Phase 5：重建 agent context

这是最高风险阶段。

产物：
- agent launch / resume usecase
- session binding repository
- runtime observation normalizer
- watcher adapter 与 persistence 协作边界

这里必须先解决的模型问题：
- `agent window record` 与 `session record` 是否同一聚合，不同的话边界在哪里
- 未发首条消息时，durable session intent 如何建模
- 重启恢复时，缺少运行时 watcher 的情况下怎样仅靠 durable fact 还原正确关系

### Phase 6：重建 task context

产物：
- task entity 与标题生成 usecase
- task 对 agent/worktree 的受控引用
- task 相关 renderer view-model 与编辑流转

### Phase 7：重建 workspace context 与 renderer shell

产物：
- workspace canvas、space、viewport、selection 全部收口到 workspace context
- 旧巨型 hook 拆成 presenter + usecase 调用
- App shell 只负责组合 context presenter，不再自己做业务编排

### Phase 8：重建 preload 与 main composition

产物：
- `preload` 只暴露最小 bridge
- `main` 只负责装配、生命周期、窗口与 IPC 注册
- context 之间只通过 contract / usecase / 端口协作

### Phase 9：删除旧结构与回归修正

产物：
- 删除所有旧目录与过渡适配层
- 删除旧 alias 与废弃入口
- 更新文档与测试路径

### Phase 10：完整验证与切换

必须通过：
- `git add` 后 `pnpm line-check:staged`
- `pnpm pre-commit`
- 关键恢复集成测试
- 关键 E2E 恢复路径

## 11. 必做测试矩阵

### Unit

覆盖：
- 各 context 的 invariant、状态迁移、normalizer、mapper、值对象
- `agent` 的恢复规则
- `workspace` 的 node/space/viewport 规则
- `task` 的绑定与标题规则

### Contract

覆盖：
- preload bridge 暴露
- IPC payload 校验
- platform adapter 输入输出
- 外部 CLI / watcher 到 application port 的映射

### Integration

覆盖：
- hydration
- restart/reopen
- resume binding
- persistence read/write
- watcher late event / duplicate event / out-of-order event
- app close during await

### E2E

只保留关键路径，但必须覆盖：
- 打开 agent 窗口后重启 app，正确恢复到原 task 与原 session
- 首次打开 agent 窗口、未发送消息、关闭 app、重新打开后仍能正确恢复
- 存在多个 task / 多个 agent window 时，不串 session
- terminal / workspace / worktree 基本关键流不回归

## 12. 完成定义（Definition of Done）

只有同时满足以下条件，完全重构才算完成：

- 目标目录全部落地，旧目录删除。
- 业务 owner 清晰，恢复相关真相无双写入口。
- renderer / main / preload 只剩组合与边界职责。
- `agent` 恢复问题在 unit + integration + e2e 三层均有回归覆盖。
- `pnpm pre-commit` 全量通过。
- `docs/ARCHITECTURE.md` 与实际代码组织一致，不再靠口头解释补架构。

## 13. 本轮最容易失败的点

只保留最需要提前防守的失败点：

1. **把 session 是否可恢复继续绑定到 watcher 输出**
   - 这是当前 bug 类问题的根源之一。

2. **把 task-agent 关联继续留在 renderer store 或 node data**
   - 这会导致窗口能恢复、会话却恢复错，或只恢复 UI 外壳。

3. **把“未发首条消息”视为“不存在 durable session intent”**
   - 这会直接造成首次打开窗口但未交互时无法恢复。

4. **把 platform/adapter 做成新的大杂烩**
   - 若 `platform` 重新长成新的 `infrastructure/utils`，重构等于失败。

5. **保留旧结构作长期 fallback**
   - 这会让 owner、依赖方向与测试边界再次失真。

## 14. 最终交付物

本轮重构最终应交付：

- 新目录结构与新依赖边界
- 恢复/持久化/生命周期的显式模型
- 按 context 组织的 IPC、renderer、repository、platform adapters
- 针对恢复路径的回归测试矩阵
- 与代码一致的架构文档
