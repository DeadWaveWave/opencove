# 终端稳定性对标报告：cleancode -> OpenCove

- 状态：Phase 1 研究报告（只读调研，未改动任何 `src/` 代码）
- 参考实现：`/Users/shihaojie/Development/cleancode`（只读）
- 目标实现：本 worktree `/Users/shihaojie/orca/workspaces/opencove/terminal-stability`
- 方法：按 `docs/development/REFERENCE_RESEARCH_METHOD.md` 的 `Research -> Synthesize -> Adapt -> Verify` 执行
- 引用约定：`文件路径:行号`。cleancode 路径以 `cc:` 前缀标记，OpenCove 路径无前缀。未验证的内容一律标注「未确认」。

---

## 1. 结论摘要（TL;DR）

1. **cleancode 的终端稳定性首先来自「PTY 不住在会崩的进程里」。** 普通终端 PTY 与权威屏幕模型都住在一个独立的、带协议版本与认证的 Terminal Provider 进程中，Electron 应用只是它的 controller（`cc:src/contexts/run/infrastructure/provider/TerminalProviderControllerLifecycle.ts:31`）。应用崩溃/重启不等于终端死亡，因此「恢复」在多数情况下退化为 **warm attach**，而不是「从持久化重建屏幕」。OpenCove 的本地 PTY 住在 Worker 的 ptyHost 子进程里，Worker 又靠 `--parent-pid` 轮询绑定桌面进程生命周期（`src/app/worker/index.ts:234-243`），所以本地终端 **必然** 随 App 退出而死，只能走 checkpoint 重建这条更难的路。这是最大的结构性差异，也是很多「感觉更稳」的根源。

2. **单一 PTY shutdown authority + 有界、可诊断的关闭协调。** 整个应用退出只向 Provider 提交一次 detach（`cc:src/contexts/run/application/use-cases/TerminalSessionService.ts:243-249`），由 `TerminalProviderShutdownCoordinator` 作为 release 完成与每会话 checkpoint/stop/retire 的唯一协调 owner，每个动作都有独立 deadline（`cc:.../TerminalProviderShutdownCoordinator.ts:87,94,103,153`）。关键是它 **不伪造成功**：任何失败都进入 `failedSessions` 并把结果标为 `partial-failure`（`cc:.../TerminalProviderShutdownCoordinator.ts:101,141`），保留 owner 与证据，controller 保持 `releasing` 拒绝后继 claim。

3. **「当前性」不是布尔值，而是一个可比较的完整运行身份。** `TerminalRunScope = projectId + workspaceId + owner{kind,id} + sessionId + runId + generation`（`cc:src/contexts/run/domain/value-objects/TerminalRunScope.ts:14-25`），槽位 key 由规范画布身份派生（`cc:.../TerminalRunScope.ts:31-45`）。所有输出/退出/视图回调都必须先过 `isCurrentGeneration`（`cc:src/contexts/run/application/use-cases/TerminalSessionService.ts:694-700`）。这一条结构性地消灭了「旧 generation 迟到事件覆盖新会话」这一整类 bug，而不是靠逐个回调打补丁。

4. **恢复类型在领域层就是封闭枚举，且互斥条件由聚合强制。** `fresh | warm | historical | ended`，`warm` 必须有活进程、`historical` 必须没有进程，聚合直接抛错（`cc:src/contexts/run/domain/aggregates/TerminalSession.ts:8,73-85`）。这让「把只读历史伪装成可输入的活终端」在类型和运行时两层都不可能发生。

5. **启动准入是一个显式的运行时状态机 + epoch，而不是「尽力而为」。** `initializing -> ready | unavailable -> shutting-down`，非 ready 一律拒绝启动并返回 `TERMINAL_RUNTIME_NOT_READY`（`cc:src/contexts/run/application/use-cases/RunLifecycleService.ts:384-392`）；每次重新 ready 递增 runtime epoch（`cc:.../RunLifecycleService.ts:79-85`）。这防住了「对账没完成，终端节点抢先自动 spawn 新 shell，把 warm 身份挤掉」这个恢复场景的头号杀手。**OpenCove 的终端路径当前没有等价 gate（rg 未搜到 `NOT_READY`/readiness 状态机，见第 6 节）。**

6. **每个槽位串行、每个会话串行、每条协议 lane 串行。** 槽位操作队列（`cc:.../TerminalSessionService.ts:69,203`）、生命周期租约（`cc:.../RunLifecycleService.ts:246-300`）、Provider 请求按 `control | settings | session:<id>` 分 lane 且有 1024 上限（`cc:src/contexts/run/infrastructure/provider/TerminalProviderRequestScheduler.ts:3,34-40`）。并发被"结构化"掉了，而不是靠 flag 和 if 去猜。

7. **幂等 + 条件写是默认姿势，不是特例。** 终止未知 session 返回空而不是报错（`cc:.../TerminalSessionService.ts:606-608`）；重复终止共享同一 Promise（`cc:.../TerminalSessionService.ts:625-651`）；heartbeat 只做条件撤销、pulse 期间取消撤销、已撤销文件绝不由旧 owner 重建（`cc:tests/unit/contexts/run/run.terminal-provider-heartbeat.spec.ts:144,159,189,221`）。

8. **Windows 被当作一等公民建模，而不是「兼容分支」。** ConPTY 首屏前关闭、重复关闭、native handle 失败重试、pre-ready exit、Store Alias 解析、spawn 同步回退 —— 每一条都有专门的单测与集成测试（`cc:tests/unit/contexts/run/run.node-pty-windows-exit.spec.ts:64-172`、`run.windows-conpty-warmup.spec.ts:40-225`）。

9. **诚实说明（不要包装成优点）：cleancode 的部分「稳」来自更小的需求范围。** 它没有 OpenCove 的 multi-client attach（桌面 + Web 同时接同一 session）、没有 remote worker 路由、没有画布 zoom raster、没有 controller/viewer 授权 epoch 协商。cleancode 的视图模型是 **一个 session 同一时刻至多一个 view**（`cc:docs/contexts/run/terminal-session.md` 视图生命周期第 1-3 条）。OpenCove 的 `PtyStreamHub` 必须处理多客户端授权移交、CAS geometry、远程 replay overflow —— 这是 **本质更难的问题**，不是 OpenCove 做得差。

10. **真正可迁移的不是 Provider 进程，而是四件事**：`TerminalSession` 领域聚合 + 完整运行身份 fencing、启动准入 epoch gate、有界且不伪造成功的 shutdown 协调、以及把终端会话生命周期从 `presentation/main-ipc` 下沉到 `domain/application`。这些与 OpenCove 的 multi-client / remote 约束 **不冲突**。

---

## 2. cleancode 终端架构拆解

### 2.1 分层与职责

| 层 | 关键文件 | 职责 |
| --- | --- | --- |
| Domain | `cc:src/contexts/run/domain/aggregates/TerminalSession.ts:46` | 会话状态机、退出保留策略、恢复类型合法性 |
| Domain (VO) | `cc:src/contexts/run/domain/value-objects/TerminalRunScope.ts:22` | 完整运行身份、槽位 key、owner 归一化 |
| Application | `cc:src/contexts/run/application/use-cases/TerminalSessionService.ts:60` | 槽位仲裁、generation 分配、身份 fencing、模型/视图协调 |
| Application | `cc:src/contexts/run/application/use-cases/RunLifecycleService.ts:34` | 启动准入 gate、runtime epoch、硬清理租约与 quarantine |
| Infrastructure (PTY) | `cc:src/contexts/run/infrastructure/pty/NodePtyTerminalProcessAdapter.ts` (667 行) | node-pty 接入、跨平台 shell 差异 |
| Infrastructure (Provider) | `cc:src/contexts/run/infrastructure/provider/TerminalProviderServer.ts` (676 行) | 独立进程服务端、会话托管 |
| Infrastructure (Model) | `cc:src/contexts/run/infrastructure/terminal-model/HeadlessTerminalModelAdapter.ts:52` | 权威 headless 屏幕模型、背压 |
| Persistence | `cc:src/contexts/run/infrastructure/persistence/FileTerminalRecoveryStore.ts:63` | checkpoint + 追加输出记录 |

**关键结构事实**：终端会话的业务真相住在 `domain` + `application`，`presentation` 只做投影。这与 OpenCove 当前把 `TerminalSessionManager` 放在 `presentation/main-ipc/sessionManager.ts:45` 形成直接对比（见第 6 节）。

### 2.2 PTY / 进程边界

三层进程：

```
Electron main (controller)
   |  本机帧协议 v9（认证 + 协议版本 + instanceId + controller lease）
   v
Terminal Provider（独立进程，可跨应用存活）
   |  node-pty
   v
PTY / shell
```

- 协议常量：`cc:src/contexts/run/infrastructure/provider/TerminalProviderProtocol.ts:1-6`（`version=9`，最低兼容 `8`，帧上限 32 MiB，输出块 256 KiB，默认请求 deadline 30s）。
- 应用只是 controller，不是 owner：`claimController` 串行迁移 `unclaimed -> active -> releasing -> unclaimed`（`cc:.../TerminalProviderControllerLifecycle.ts:31,69,146`）。

### 2.3 session 模型

状态机（`cc:src/contexts/run/domain/aggregates/TerminalSession.ts:4`）：

```
idle -> running -> stopping -> exited
  \-> failed        \------> exited
```

- `recordInput` 只在 `running` 允许，否则抛 `TERMINAL_SESSION_NOT_RUNNING`（`cc:.../TerminalSession.ts:142-150`）。
- `markExited` 自动把非 `historical` 的 recoveryKind 收敛为 `ended`（`cc:.../TerminalSession.ts:171-177`）——终态语义由聚合保证，不靠调用方记得。
- 退出保留策略对 `workflow` 与 agent-owned 一律拒绝，**新设置与 revive 两条路径共用同一个断言**（`cc:.../TerminalSession.ts:72,161,204-222`）。这正是「fallback 路径比 happy path 更早写状态」类 bug 的结构性防线。

### 2.4 provider / controller 生命周期

- claim 时若现任 controller 的 socket 已 destroyed、PID 相同（应用重启复用 PID）、或进程已死，先强制 release 再拒绝本次 claim（`cc:.../TerminalProviderControllerLifecycle.ts:44-56`）。
- release 是**共享 Promise**：并发 detach/断连复用同一个 release（`cc:.../TerminalProviderControllerLifecycle.ts:69-99,127-140`）。
- 只有 release 真正完成且无存活 live 会话才允许后继 claim（`cc:.../TerminalProviderControllerLifecycle.ts:142-153`）。

### 2.5 shutdown 顺序

文档化顺序（`cc:docs/contexts/run/terminal-session.md`「应用正常退出时」段）：

```
关闭 Run 启动准入 -> 释放视图租约 -> Agent/workflow prepare
  -> 一次性把全部 PTY 交给 Provider -> 两上下文 complete -> 清本地引用
```

- Electron 侧总预算 5 秒，且**预算只限制 Electron 阻塞退出的时间，不取消已提交的 Provider release**。
- 协调器按 release 开始时捕获的精确 identity 处理，默认并发 8（`cc:.../TerminalProviderShutdownCoordinator.ts:11,148-151`）。
- 保留会话 checkpoint 失败 -> 立即降级为终止候选（`cc:.../TerminalProviderShutdownCoordinator.ts:126-129`），**不承诺做不到的跨应用恢复**。

### 2.6 恢复语义

四类恢复，互斥且由聚合强制（`cc:.../TerminalSession.ts:8,73-85`）：

| recoveryKind | 进程 | 含义 |
| --- | --- | --- |
| `fresh` | 新建 | 全新会话 |
| `warm` | 必须有 | Provider 仍存活，直接 attach 真实 PTY |
| `historical` | 必须无 | 只读历史，禁止写入/中断 |
| `ended` | 无 | 自然结束 |

`initializeRuntime` 的接受流程（`cc:.../TerminalSessionService.ts:88-190`）：workflow 与非 warm/historical 直接 retire -> scope 校验失败 retire -> generation 落后 retire -> 替换同槽旧会话 -> revive -> 绑定回调（回调内仍做 `isCurrentRunningSession` / `isCurrentGeneration` 检查，`cc:.../TerminalSessionService.ts:166-184`）。

---

## 3. cleancode 的状态所有权表与不变量

### 3.1 状态所有权表

| state | owner | write entry | restart source of truth |
| --- | --- | --- | --- |
| 会话状态机 (`idle/running/stopping/exited/failed`) | `TerminalSession` 聚合 | `markRunning/markStopping/markExited/markFailed` (`cc:.../TerminalSession.ts:130,166,171,179`) | Provider `listSessions` + checkpoint |
| 槽位 -> 当前 sessionId | `TerminalSessionService` | `sessionIdsBySlot` 仅在 `startInSlot` / 退出 / 终止写 (`cc:.../TerminalSessionService.ts:66,290,375`) | Provider 对账 |
| generation（单调） | `TerminalSessionService` | `generationsBySlot` 仅在 `startInSlot` 自增 (`cc:.../TerminalSessionService.ts:68,279-280`) | 恢复快照的 `generation` |
| 退出保留策略 | `TerminalSession` 聚合（Provider 镜像） | `setRetentionPolicy`，失败回滚 (`cc:.../TerminalSessionService.ts:216-231`) | checkpoint record |
| 屏幕/光标/滚动历史 | `TerminalModelPort` 权威 headless 模型 | `acceptOutput`，单调 `sequence` (`cc:.../TerminalSessionService.ts:352-360`) | Provider snapshot -> checkpoint |
| PTY 进程 | Terminal Provider 进程 | `TerminalProcessPort.start/stop/disposeAll` | Provider 自身 |
| controller 归属 | `TerminalProviderControllerLifecycle` | `claim` / `beginRelease` (`cc:.../TerminalProviderControllerLifecycle.ts:31,69`) | Provider 内存 + metadata |
| Provider 存活 | heartbeat 文件 + `ProcessEpochLiveness` | 条件撤销 (`cc:.../ProcessEpochLiveness.ts:37,59`) | metadata + heartbeat 文件 |
| 启动准入 phase / epoch | `RunLifecycleService` | `beginRuntimeInitialization/markRuntimeReady/markRuntimeUnavailable` (`cc:.../RunLifecycleService.ts:72,79,88`) | 每次启动重新计算 |
| renderer xterm | Presentation | 可丢弃投影 | **不是事实源** |

### 3.2 提炼的 invariants（我的措辞 + 代码证据）

**I1 — 只有「当前 generation 且仍是槽位当前 session」的运行才能改变可见状态。**
任何输出、退出、视图、快照回调在生效前都必须通过 `isCurrentGeneration`（`cc:.../TerminalSessionService.ts:694-700`），迟到的旧 generation 事件被静默丢弃（`cc:.../TerminalSessionService.ts:166-184,352-380`）。测试：`cc:tests/unit/contexts/run/run.terminal-session-service.spec.ts:372`「ignores output and exit callbacks from an older generation after replacement」。

**I2 — 声称"活"必须有进程证据；声称"历史"必须没有进程。**
聚合在 `revive` 入口直接拒绝矛盾组合（`cc:.../TerminalSession.ts:73-85`）。测试：`cc:tests/unit/contexts/run/run.terminal-session.spec.ts:120,140`。

**I3 — 运行时未 ready 时，任何终端都不能启动。**
`assertStartAllowed` 在 `runStart` 入口与 `await` 之后各检查一次（`cc:.../RunLifecycleService.ts:103,116,384-392`），防的是「排队期间 phase 变了」。测试：`cc:tests/unit/contexts/run/run.terminal-runtime-recovery.spec.ts:13`「keeps starts blocked after a failed reconciliation and opens one new runtime epoch on retry」。

**I4 — 关闭失败必须留下证据，不能伪造成功。**
stop/retire 失败 -> 进入 `failedSessions`、补偿 checkpoint、结果标 `partial-failure`（`cc:.../TerminalProviderShutdownCoordinator.ts:99-108,141`）。测试：`cc:tests/unit/contexts/run/run.terminal-provider-shutdown-coordinator.spec.ts:79`「does not retire a session whose physical stop failed and preserves its evidence」。

**I5 — 承诺不到的持久化必须立即撤销承诺，而不是继续假装。**
checkpoint 失败 -> 保留会话立即转终止候选（`cc:.../TerminalProviderShutdownCoordinator.ts:126-129`）；durable recovery 不可用 -> 主动撤销用户可见的保留策略并通知（`cc:.../TerminalSessionService.ts:95-108`）。测试：`cc:tests/unit/contexts/run/run.terminal-runtime-recovery.spec.ts:49`。

**I6 — 同一槽位的操作严格串行。**
`enqueueTerminalSlotOperation` + `RunLifecycleService` 租约（`cc:.../TerminalSessionService.ts:203`、`cc:.../RunLifecycleService.ts:246`）。测试：`cc:tests/unit/contexts/run/run.terminal-session-service.spec.ts:336`「waits for the previous session to exit before replacing the exact slot」。

---

## 4. 「坑 -> 对策」清单

从 git 历史修复 + 测试用例反推。每条：故障现象 | 根因类别 | 结构性对策 | 证据。

| # | 故障现象 | 根因类别 | 结构性对策 | 证据位置 |
| --- | --- | --- | --- | --- |
| 1 | 替换终端后，旧 PTY 的迟到输出/退出污染新会话 | 异步乱序 + 身份缺失 | 完整运行身份 + generation fencing，所有回调前置校验 | `cc:.../TerminalSessionService.ts:694`；测试 `run.terminal-session-service.spec.ts:372` |
| 2 | 应用重启后终端节点抢先 spawn 新 shell，挤掉本可 warm attach 的会话 | 启动准入缺失 | runtime phase 状态机 + epoch，非 ready 拒绝启动 | `cc:.../RunLifecycleService.ts:384`；测试 `run.terminal-runtime-recovery.spec.ts:13` |
| 3 | 恢复查询失败被当作「没有旧会话」，直接创建新 shell 覆盖历史 | fallback 早于 happy path 写状态 | 查询失败保持 pending，**不**降级为「无会话」 | `cc:docs/contexts/run/terminal-session.md`「恢复查询失败时继续保持 pending」 |
| 4 | 应用重启复用同一 PID，新应用被旧 controller 挡住 | ABA / PID 复用 | claim 时检测 PID 相同或进程已死则强制 release | `cc:.../TerminalProviderControllerLifecycle.ts:44-56`；测试 `run.terminal-provider-controller-lifecycle.spec.ts:45` |
| 5 | 无关进程复用 PID，导致把死 Provider 判成活的 | PID 不是身份 | generation heartbeat（`instanceId + heartbeatId`）+ 条件撤销 | 测试 `run.terminal-provider-heartbeat.spec.ts:84,122,132` |
| 6 | 旧 owner 迟到释放删掉后继 generation 的 heartbeat | 迟到清理越权 | 撤销/删除前按 generation 再确认；已撤销文件不由旧 owner 重建 | 测试 `run.terminal-provider-heartbeat.spec.ts:144,221` |
| 7 | 并发 shutdown 信号让后到者误判清理完成而提前退出进程 | 并发 + 共享完成信号缺失 | 并发关闭共享同一完成 Promise | `cc:.../TerminalProviderControllerLifecycle.ts:69-99`；测试同文件 spec:116 |
| 8 | checkpoint 挂死拖垮整个退出流程 | 无界等待 | 每操作独立 deadline，超时继续释放 controller | `cc:.../TerminalProviderShutdownCoordinator.ts:153`；测试 spec:209 |
| 9 | 物理 stop 失败仍 retire，恢复资料与 owner 证据双双丢失 | 失败被吞 | 失败即保留证据 + `partial-failure` | `cc:.../TerminalProviderShutdownCoordinator.ts:99-108`；测试 spec:79 |
| 10 | Windows ConPTY 首屏前关闭挂起 / 重复关闭崩溃 | 平台生命周期竞态 | 首屏前即可停止；重复关闭只认领一次 native shutdown，失败时撤销 guard 允许幂等重试 | 测试 `run.node-pty-windows-exit.spec.ts:64,74,87,113,140` |
| 11 | Store Alias stub 被当成真 `pwsh.exe`，终端起不来 | 平台解析歧义 | 分级解析：标准目录 -> 绝对 PATH -> readlink -> 有界 discovery；失败单次回退 inbox 并短期隔离坏路径 | `cc:.../TerminalShellExecutableResolver.ts`；测试 `run.terminal-shell-executable-resolver-alias.spec.ts:69,79,180` |
| 12 | 前一个前台任务改了 console encoding，污染下一次 launch | 跨 launch 状态泄漏 | 每次 launch 在 started 帧前重申 UTF-8 与 ConsoleColor | `cc:docs/contexts/run/terminal-session.md`「Windows 脚本必须在 started 控制帧之前重申」 |
| 13 | 视图 detach 与 renderer 销毁并发，租约被释放两次 | 生命周期清理不幂等 | 同一视图租约至多一次有效释放；未知/已退休 detach 视为已释放 | 提交 `cc:053a884 fix(terminal): make view shutdown cleanup idempotent`；测试 `run.terminal-session-model-lifecycle.spec.ts:254` |
| 14 | 应用主题切换改写了已运行会话的终端配色 | 派生值被当作可变状态 | `terminalSourceTheme` 在 generation 内不可变，由聚合持有 | `cc:.../TerminalSession.ts:57`；提交 `cc:0e61fe0 fix(terminal): pin CLI source theme` |
| 15 | 画布 zoom raster 缩放时终端出现空白帧 | 渲染层 GPU 纹理时序 | 引入 raster target/coordinator + patch 上游 webgl addon | 提交 `cc:1e1473b`，新增 `terminalXtermRasterTarget.ts`(205 行)、`terminalZoomRasterCoordinator.ts`(400 行)、`patches/@xterm__addon-webgl@0.19.0.patch` |
| 16 | 大量输出打爆内存 | 无背压 | 模型待解析 1 MiB 暂停 PTY，降到 256 KiB 恢复 | `cc:.../HeadlessTerminalModelAdapter.ts:49-50` |

---

## 5. 测试策略拆解

### 5.1 分层分布

| 层 | 位置 | 证明什么 |
| --- | --- | --- |
| Unit / Domain | `cc:tests/unit/contexts/run/run.terminal-session.spec.ts` | 状态迁移、退出策略合法性、恢复类型互斥 |
| Unit / Service | `run.terminal-session-service.spec.ts`（20 例）、`run.terminal-owner.spec.ts`、`run.terminal-session-model-lifecycle.spec.ts`（11 例） | 槽位仲裁、身份 fencing、视图交接 |
| Unit / Provider | `run.terminal-provider-heartbeat.spec.ts`（12 例）、`...-shutdown-coordinator.spec.ts`（6 例）、`...-controller-lifecycle.spec.ts`（4 例） | ABA/PID 复用、并发关闭、部分失败 |
| Unit / Host | `run.node-pty-windows-exit.spec.ts`（8 例）、`run.windows-conpty-warmup.spec.ts`（11 例） | 平台竞态与资源泄漏 |
| Integration | `tests/integration/contexts/run/*`（15 个文件） | 真实 node-pty、真实文件锁、真实协议 |
| Contract | `tests/contract/contexts/run/run.terminal-view-ipc.spec.ts` | IPC snapshot/身份/定向输出 |
| E2E | `run-terminal-sessions.e2e.spec.ts`、`terminal-runtime-recovery.e2e.spec.ts` | 跨应用重启、warm/historical 区分 |

### 5.2 测试替身策略（这是关键，不是「测试多」）

1. **真实子进程 fixture，不是 mock**：`cc:tests/fixtures/contexts/run/conptyCloseRaceChild.cjs`、`conptyConnectFailureChild.cjs` —— 用真实进程复现 ConPTY 竞态，因为这类 bug mock 不出来。
2. **假终端程序**：`cc:tests/fixtures/contexts/run/fakeTerminalPrograms.ts` —— 确定性输出，避免依赖真实 shell 的时序。
3. **端口替身而非类替身**：应用层只依赖 `TerminalProcessPort` / `TerminalModelPort`（`cc:src/contexts/run/application/ports/`），单测注入内存实现，所以 20 个 service 用例全部是纯内存、无 IO、可确定性断言。
4. **注入时钟/deadline**：`TerminalProviderShutdownCoordinator` 的所有 deadline 都可注入（`cc:.../TerminalProviderShutdownCoordinator.ts:22-27`），因此「超时不结算」可以被稳定测试。

### 5.3 被显式覆盖的故障模式

| 故障模式 | 覆盖证据 |
| --- | --- |
| 乱序 | `run.terminal-session-service.spec.ts:10`（启动返回前的输出）、`:372`（旧 generation 迟到） |
| 重复 | `run.node-pty-windows-exit.spec.ts:74,101`（重复 kill 合并/只结算一次）、`run.terminal-session-model-lifecycle.spec.ts:226`（并发硬终止幂等） |
| 关闭中 | `run.terminal-session-service.spec.ts:176,197`（shutdown 后不再查询、取消在途查询）、`run.terminal-session.spec.ts:34`（stopping 期间拒绝输入） |
| 重启 | `run.terminal-runtime-recovery.spec.ts:13`、`run.terminal-provider-controller-lifecycle.spec.ts:45`（PID 复用） |
| 部分失败 | `run.terminal-provider-shutdown-coordinator.spec.ts:79,132,209` |
| 跨平台 | 整个 `windows-*` 系列 + `run.terminal-shell-executable-resolver-alias.spec.ts` |
| 资源泄漏 | `run.windows-conpty-warmup.spec.ts:100,120,157,211`（不泄漏 timer/listener，至多 kill 一次） |

### 5.4 OpenCove 可直接借鉴的测试清单

1. `ptyHost` 崩溃时，**所有活跃 session 是否都收到恰好一次 exit**（对标 `handleHostExit` 遍历，见第 6 节风险）。
2. spawn 响应丢失后重试，**是否产生孤儿 PTY**（对标 `supervisor.ts:381-389`）。
3. 关闭中的 resize / write / attach 是否幂等且不访问已释放 runtime。
4. checkpoint 失败时，是否**撤销**「可恢复」的用户可见承诺，而不是静默保留。
5. 注入 deadline 的 shutdown drain 测试：`freeze -> drain -> flush -> cutoff -> flush` 每一步都能超时且不吞错。
6. Worker 重启复用 PID 时，durable binding 是否被错误复用。

---

## 6. OpenCove 终端现状拆解

> 说明：OpenCove 的文档质量与严谨度与 cleancode 相当（`docs/terminal/MULTI_CLIENT_ARCHITECTURE.md` 有 17 条 invariants、`docs/architecture/RECOVERY_MODEL.md` 有 9 条）。差距不在「有没有想清楚」，而在**部分承诺没有落到领域层的强制结构上**，以及**若干具体实现点与文档承诺不符**。

### 6.1 同维度对比

| 维度 | 状态 | 证据 |
| --- | --- | --- |
| 会话领域聚合 | **缺失** | `src/contexts/terminal/domain/` 下只有 `recovery/terminalRecovery.ts`，无 session 聚合。会话生命周期在 `presentation/main-ipc/sessionManager.ts:45`，用 14 个并行 Map/Set 表达状态 |
| 会话状态机 | **缺失** | `resolveSessionLifecycleState` 只有 `active/terminated/unknown` 三态，由两个 Set 推导（`sessionManager.ts:136-146`），没有 `stopping`/`failed`，没有迁移约束 |
| 完整运行身份 + generation fencing | **存在但分裂** | Hub 侧有 `authorityEpoch` / `geometryRevision`（`docs/terminal/MULTI_CLIENT_ARCHITECTURE.md` Geometry 段）；recovery 侧有 `generation + binding + checkpointRevision`（`RECOVERY_MODEL.md` invariant 6）；但**本地 session 层没有 generation**，`sessionManager` 只按 `sessionId` 索引 |
| 启动准入 gate | **缺失** | `rg "NOT_READY\|runtimeReady\|initializing"` 在 `src/contexts/terminal` 与 `src/app/main/controlSurface/ptyStream` 下无命中。没有 cleancode 式「对账未完成拒绝一切启动」的统一 gate |
| 跨应用 PTY 存活 | **缺失（架构决定）** | 本地 Worker 靠 `--parent-pid` 每秒轮询，父进程消失即自杀（`src/app/worker/index.ts:234-243`）；`stopChild` SIGTERM->7.5s->SIGKILL（`src/app/main/worker/localWorkerManager.ts:104-129`） |
| Shutdown 有界协调 | **存在但脆弱** | `RECOVERY_MODEL.md` invariant 7 描述了完整 `freeze -> drain -> flush -> cutoff -> flush` 顺序，但 `PtyHostSupervisor.dispose()` 只是 `postMessage(shutdown)` + `kill()`，无等待、无 drain、无 deadline（`src/platform/process/ptyHost/supervisor.ts:470-497`） |
| 恢复类型枚举 | **存在但弱** | 有 generation/epoch/archive 语义（`RECOVERY_MODEL.md`），但没有 cleancode 式 `warm/historical` 领域级互斥断言 |
| 背压 | **缺失（本地路径）** | `sessionManager.ts:35` 只有 1,000,000 字符的 replay 窗口（丢弃旧块），**不是**对 PTY 的流控；没有 pause/resume PTY 的等价物 |
| 多客户端授权 | **已对齐（且更强）** | controller/viewer + `authorityEpoch` + CAS geometry，cleancode 无此能力 |
| 远程路由 fencing | **已对齐（且更强）** | `endpointId + remoteSessionId + targetWorkerInstanceId`（`RECOVERY_MODEL.md` Remote recovery 段） |
| 测试规模 | **已对齐** | 130 个终端/PTY 相关测试文件 |

### 6.2 发现的具体实现缺陷（带证据）

**D1 — `headlessPtyRuntime.resize` 丢弃 host ACK 的真实几何，回显请求值。**

```ts
await supervisor.resize(input.sessionId, input.cols, input.rows)
return { ..., status: 'accepted', changed: true,
         geometry: { cols: input.cols, rows: input.rows, revision: null }, ... }
```
`src/app/worker/headlessPtyRuntime.ts:98-106`。而 `supervisor.resize` **确实返回了** host 确认的 `{cols, rows}`（`src/platform/process/ptyHost/supervisor.ts:433-437`，`cols: response.result.cols ?? cols`）。上游 Hub 又用 `runtimeResult?.geometry ?? plan.geometry` 作为 `acceptedRuntimeGeometry` 并据此提交 presentation（`src/app/main/controlSurface/ptyStream/ptyStreamHub.resize.ts:331,343`）。

这**直接违反** `MULTI_CLIENT_ARCHITECTURE.md` invariant 7「PTY runtime ACK precedes presentation commit」与 invariant 17「local xterm、Worker presentation、PTY runtime 三者一致」——ACK 在时序上发生了，但**内容被丢弃**，等于没有 ACK。若 host 侧对 cols/rows 做了钳制或平台调整，presentation 会与真实 PTY 永久不一致。这与 `WIN10_CODEX_SCROLL_DIAGNOSTICS` 类症状高度相关（未确认因果，需实测）。

**D2 — `supervisor.spawn` 的 host-lost 重试缺少可确认的启动身份。**
Phase 2 复核纠正：普通 `spawn timeout` 只会拒绝当前调用，**不会**触发重试；Phase 1
把它写成“超时后无条件重试”是错误的。真实风险在 `src/platform/process/ptyHost/supervisor.ts`
的 host-lost 分支：进程/transport error 会把 host 标为 lost，但该路径此前既没有稳定 launch
identity，也没有证明旧 child 已退出；若错误发生在请求已生效、响应未确认之后，盲目重试可能
让仍存活的旧 host 留下无人引用的 PTY。cleancode 的可迁移原则仍是 launch identity + 确认后
重试，但 OpenCove 应让歧义 transport loss 失败关闭，而不是引入 Provider 文件锁。

**D3 — host 崩溃时对每个 active session 发 exit，但 exitCode 是 host 的退出码，不是 PTY 的。**
`src/platform/process/ptyHost/supervisor.ts:145-152`。语义上把「host 死了」与「你的命令退出了」混为一谈，下游无法区分「shell 正常退出 0」与「host 崩溃恰好 code 0」。cleancode 在协议层用独立事件区分（未在 OpenCove 找到等价区分，**未确认**是否有上层补偿）。

**D4 — 终端会话生命周期住在 `presentation` 层，违反本仓架构标准。**
`docs/architecture/ARCHITECTURE.md:60-64` 明确要求 `presentation` 「不定义 durable truth」、`domain` 放「业务规则、不变量、状态模型」。但 `TerminalSessionManager`（500 行，14 个 Map/Set）在 `src/contexts/terminal/presentation/main-ipc/sessionManager.ts:45`，同时承担状态判定 + 订阅路由 + 数据广播 + replay 缓冲。这命中 `DEVELOPMENT.md`「架构执行触发器」第 2 条（同一文件多个独立变更原因）。

### 6.3 与 `CASE_STUDY_CANVAS_JITTER_AND_TERMINAL_DURABILITY.md` 的显式对照

该案例总结了 4 个结构性根因，逐条回答「cleancode 的做法能否结构性地避免」：

| 案例根因 | cleancode 能否结构性避免 | 理由 |
| --- | --- | --- |
| **1. 同一真相多个写者**（viewport / session binding / scrollback） | **能，且是它的核心设计** | 屏幕真相只有一个 owner（Provider 内权威模型），renderer xterm 被文档明确定义为「可丢弃投影，不是输出历史、屏幕状态或恢复资格的事实来源」（`cc:docs/contexts/run/terminal-session.md`）。输出只进模型一次再带 `sequence` 分发（`cc:.../TerminalSessionService.ts:352-360`） |
| **2. 输入 -> 持久化 -> replay 回灌覆盖在途交互** | **能** | checkpoint 由 Provider 侧模型产生，renderer 从不参与写回；attach 时先 pause 输出、生成 snapshot、再按 `sequence` 接续（视图生命周期第 1-2 条），不存在 replay 与在途输入竞争同一状态 |
| **3. durable truth owner 生命周期会被 throttle** | **能，且更彻底** | durable owner 是**独立进程**，完全不受 renderer 可见性/后台节流影响。OpenCove 已经把 owner 从 renderer 挪到 Worker（案例中的修复方向正确），但 Worker 仍随桌面进程死亡，cleancode 的 Provider 不会 |
| **4. 热路径跨边界工作** | **部分能** | 有背压（1 MiB/256 KiB，`cc:.../HeadlessTerminalModelAdapter.ts:49-50`）、有 16ms 输入合并、有请求 lane 限流。但 cleancode **没有** OpenCove 的画布 zoom + 多客户端广播热路径，所以这一条**不能直接说它更强**——它只是没遇到同等压力 |

**结论**：案例中的前 3 类根因，cleancode 的架构确实能结构性避免，且 OpenCove 当前修复方向（把 owner 移到 Worker）与之一致，**只差最后一步——owner 进程的生命周期独立性**。第 4 类是 OpenCove 独有的更难问题，cleancode 无参考价值。

---

## 7. 差距矩阵

| 维度 | cleancode | OpenCove | 差距等级 | 用户可感知影响 |
| --- | --- | --- | --- | --- |
| resize ACK 内容被采信 | 采信 runtime 返回值 | **丢弃并回显请求值**（`headlessPtyRuntime.ts:98-106`） | **P0** | TUI 错行/串行、Codex 显示错乱、shrink 后残影 |
| spawn 重试幂等 | launch lock + 身份确认 | host-lost 重试缺稳定 launch identity/退出确认（普通 timeout 不重试） | **P0** | 幽灵进程占用 CPU/端口；用户"关不掉的终端" |
| 启动准入 gate | phase 状态机 + epoch（`RunLifecycleService.ts:384`） | 无等价 gate | **P0** | 重启后新 shell 抢占本可恢复的 session，历史丢失 |
| 会话领域聚合与状态机 | `TerminalSession` 聚合 5 态 | presentation 层 3 态 + 14 个 Map | **P1** | 边界状态（stopping/failed）无处表达，异常路径靠调用方自觉 |
| shutdown 有界 drain | 每操作 deadline + partial-failure（`ShutdownCoordinator.ts:153`） | 文档有承诺，`supervisor.dispose()` 无等待（`supervisor.ts:470-497`） | **P1** | 退出时最后输出丢失；下次打开缺一段历史 |
| PTY 背压 | 1 MiB 暂停 / 256 KiB 恢复 | 仅 replay 窗口裁剪，无 PTY 流控 | **P1** | 海量输出时内存涨、UI 卡顿 |
| host 崩溃 exit 语义 | 协议区分 | host exitCode 冒充 PTY exitCode（`supervisor.ts:145-152`） | **P1** | 误报"命令已完成"；任务状态错误 |
| 跨应用 PTY 存活 | 独立 Provider 进程 | Worker 随桌面死（`worker/index.ts:234`） | **P2**（架构取舍） | 重启后终端必然是重建而非续接 |
| 会话生命周期分层 | domain/application | presentation/main-ipc | **P2** | 演进成本、测试成本高 |
| 多客户端授权 | 无此能力 | controller/viewer + epoch + CAS | — | OpenCove 领先 |
| 远程路由 fencing | 无此能力 | 三元组 fence | — | OpenCove 领先 |

---

## 8. 可迁移原则 vs 不可照搬

按 `REFERENCE_RESEARCH_METHOD.md` 要求的五类信息提炼。

### 8.1 可迁移

**A. 完整运行身份 fencing（承诺 / owner / invariant / fallback / trade-off）**
- 承诺：任何迟到回调都不能改变新一代会话的可见状态。
- owner：session 层（OpenCove 应放在新建的 `contexts/terminal/domain` 聚合）。
- invariant：只有 `当前 generation && 当前槽位 session` 的事件生效。
- fallback：不匹配则静默丢弃 + 计数诊断。
- trade-off：需要在所有回调加校验，代码略啰嗦；换来一整类 bug 消失。
- **与 OpenCove 约束兼容**：Hub 的 `authorityEpoch` 管的是「哪个客户端有写权」，session generation 管的是「哪一代运行」，两者正交，可共存。

**B. 启动准入 gate + runtime epoch**
- 承诺：对账完成前不创建任何新 shell。
- owner：新增 `TerminalRuntimeAvailability`（Worker 侧）。
- invariant：非 ready 一律 `TERMINAL_RUNTIME_NOT_READY`；每次重新 ready 递增 epoch；renderer 按 epoch 决定是否自动启动。
- fallback：失败不得把终端永久锁死，用户重试或成功恢复必须开新 epoch。
- trade-off：启动路径多一次状态检查。

**C. 有界、不伪造成功的 shutdown 协调**
- 承诺：关闭要么完成，要么留下可诊断的 `partial-failure` 证据。
- invariant：任何 drain/flush 都有 deadline；失败不吞、不伪造。
- **OpenCove 的 `RECOVERY_MODEL.md` invariant 7 已经写对了顺序，缺的是把它落到 `supervisor.dispose()` 与 deadline 上。**

**D. 领域聚合承载状态机与合法性断言**
- 把 `TerminalSessionManager` 的状态判定部分下沉到 `contexts/terminal/domain`，订阅路由/广播留在 presentation。

### 8.2 不可照搬（必须给替代设计）

| cleancode 做法 | 为何不能照搬 | OpenCove 替代设计 |
| --- | --- | --- |
| **独立 Terminal Provider 进程持有 PTY 并跨应用存活** | OpenCove 的 Worker 同时承载远程能力与 Web UI，且远程 worker 本就独立于桌面。把本地 PTY 再拆一个常驻进程会与 Worker 职责重叠，并使「本地/远程」出现两套恢复语义 | **不拆新进程**。改为：(a) 让本地 Worker 可选「detached 常驻」模式（用户设置，默认关闭），复用现有 `home-worker.json` 的 `mode` 概念；(b) 默认路径继续靠 checkpoint 重建，但**补齐 D1/D2/shutdown drain**，让重建质量接近 warm attach |
| **同一 session 至多一个 view，attach 时 pause PTY 生成 snapshot** | OpenCove 必须支持桌面 + Web 同时 attach 同一 session | 保持现有 `presentationSnapshot + attach(afterSeq)` 多播模型；只借鉴「snapshot 生成期间的输出进有界队列、按 seq 接续」这一点（OpenCove 已有，见 `MULTI_CLIENT_ARCHITECTURE.md` Attach 段） |
| **controller lease 由 Provider 进程仲裁** | OpenCove 的 controller 仲裁天然在 Hub，且要处理远程转发 | 保持 Hub 仲裁。仅借鉴「claim 时检测现任 controller 已死/PID 复用则强制 release」的**活性检测**思路，用 transport 断连 + epoch 置 `null` 实现（OpenCove 已有该规则，需确认落地） |
| **文件锁 + heartbeat 做 Provider 单例** | OpenCove 用 `singleInstanceLock.ts` + endpoint 注册 | 沿用现有机制，不引入文件 heartbeat |
| **权威模型在 Provider 内，renderer 完全无缓存** | OpenCove 有 workspace 热切换缓存与 placeholder 需求 | 保持现有「renderer cache 仅 UX、永不成为正确性来源」的规则（`MULTI_CLIENT_ARCHITECTURE.md` Forbidden 段），不改 |

---

## 9. 建议改造方案

### P0（正确性缺陷，建议立即修）

**P0-1 修复 resize ACK 内容被丢弃**
- 改动点：`src/app/worker/headlessPtyRuntime.ts:96-110`（返回 `supervisor.resize` 的真实 `cols/rows`）；核对 `src/app/main/controlSurface/ptyStream/ptyStreamHub.resize.ts:343` 的 `??` 兜底是否仍需要。
- 状态所有权：`PTY 真实 geometry` owner = ptyHost；`canonical presentation geometry` owner = Worker Hub；后者**必须**由前者派生。
- invariants：(1) presentation 提交的 geometry 必须来自 runtime ACK 的返回值，不能来自请求值；(2) ACK 与请求不一致时以 ACK 为准并广播；(3) 未拿到 ACK 内容视为 `runtime_failed`。
- IPC/持久化影响：无 schema 变更。
- 跨平台：Windows ConPTY 最可能出现钳制差异，需 Windows E2E 验证。

**P0-2 spawn 幂等化，消除孤儿 PTY**
- 改动点：`src/platform/process/ptyHost/supervisor.ts:340-390`。引入调用方提供的幂等 key（如 `nodeId + generation`），host 侧按 key 去重；重试前先向 host 查询该 key 是否已有 session。
- 状态所有权：`sessionId <-> 幂等 key` 映射 owner = ptyHost。
- invariants：(1) 同一 launch identity 至多对应一个活 PTY；(2) 仅在旧 child 确认退出或请求尚未送达时重试，并复用 identity；(3) transport 状态不明时**失败关闭**，不盲目重试。
- 跨平台：Windows 进程树清理需配合 `windowsProcessTree.ts`。

**P0-3 引入终端运行时准入 gate**
- 改动点：新增 `src/contexts/terminal/application/TerminalRuntimeAvailability.ts`（phase + epoch）；接入 `src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler.ts` 与 spawn 入口；renderer 侧 `useHydrateAppState.helpers.ts` 按 epoch 决定自动启动。
- invariants：(1) 非 ready 拒绝一切 spawn；(2) 恢复查询失败保持 pending，**不**视为「无历史」；(3) 每次进入 ready 递增 epoch，失败不永久锁定。
- IPC 影响：新增 availability query + event（需更新 `docs/architecture/CONTROL_SURFACE.md`，触发架构契约 gate，须同步 `harness/architecture/`）。

### P1（稳健性）

**P1-1 shutdown 有界 drain**：给 `supervisor.dispose()` 加「发 shutdown -> 等 host 确认 -> deadline -> SIGKILL」三段式，deadline 可注入；失败产出结构化诊断而非静默。改动点 `src/platform/process/ptyHost/supervisor.ts:470-497`。

**P1-2 区分 host 崩溃与 PTY 正常退出**：`handleHostExit` 发出的 exit 事件加 `reason: 'host-crashed'`，下游任务完成判定（`usePtyTaskCompletion.ts`）必须忽略该 reason。改动点 `supervisor.ts:145-152` + 协议 `protocol.ts`。

**P1-3 PTY 背压**：在 ptyHost 侧按待发送字节量 pause/resume PTY 读取（对标 1 MiB/256 KiB）。改动点 `src/platform/process/ptyHost/entry.ts`。

### P2（架构收敛）

**P2-1 下沉会话生命周期到 domain**：新建 `src/contexts/terminal/domain/session/TerminalSession.ts`（5 态状态机 + generation + 合法性断言），`sessionManager.ts` 保留订阅路由与广播。这同时解决 `DEVELOPMENT.md` 500 行门禁风险（当前 500 行，已在临界）。

**P2-2 可选 detached 本地 Worker**：作为用户设置，默认关闭。需要独立 Spec。

---

## 10. 风险清单（对照 `DEVELOPMENT.md`「关键稳定性检查」）

| 检查项 | 风险 | 缓解 |
| --- | --- | --- |
| **Async Gap Safety** | P0-3 的 gate 在 `await` 期间 phase 可能变化 | 对标 cleancode：`await` 前后各检查一次（`cc:.../RunLifecycleService.ts:103,116`） |
| **Concurrency & Race** | P0-2 的「先查询再创建」本身有 TOCTOU 窗口 | 幂等 key 去重放在 host 侧单线程消息循环内，查询与创建原子化 |
| **State Ownership** | P0-1 改动后，geometry 出现 ptyHost/Worker/renderer 三处表达 | 明确 ptyHost 为唯一真值源，Worker 为 canonical 投影，renderer 只应用返回值（已是文档承诺，此改动是让实现符合文档） |
| **Restart Semantics** | P0-3 若把「查询失败」误判为「无历史」，会造成**数据丢失** | invariant 明确：查询失败 -> pending，不 spawn。必须有测试 |
| **IPC Security** | 新增 availability query 需校验 | 走 `src/contexts/terminal/presentation/main-ipc/validate.ts` 现有校验收口 |
| **Resource Lifecycle** | P1-1 的 deadline timer、P1-3 的 pause 状态需成对清理 | 对标 `cc:run.windows-conpty-warmup.spec.ts:100,120,211`（不泄漏 timer、至多 kill 一次） |
| **Performance** | P1-3 背压阈值不当会导致输出卡顿 | 沿用 cleancode 验证过的 1 MiB/256 KiB，并在 E2E 用大输出场景验证 |
| **Data Integrity** | P0-3 若引入新 IPC，需考虑旧 renderer 兼容 | availability 缺失时按 `ready` 降级（保持当前行为），避免旧客户端被永久 block |

**额外风险**：P0-3 触发 `docs/architecture/CONTROL_SURFACE.md` 变更 -> 必须同步 `harness/architecture/` 规则与结果，并跑 `pnpm arch:doc-sync`（`DEVELOPMENT.md`「架构契约变更 Gate」）。

---

## 11. 验证计划

### Unit
- `TerminalSession` 聚合状态迁移、非法迁移抛错（P2-1）。
- runtime availability 状态机：非 ready 拒绝、epoch 递增、失败不永久锁（P0-3）。
- `supervisor.spawn` 幂等：确认 host exit 后重试复用 launch identity；transport 状态不明时不重试（P0-2，注入假 host）。
- `supervisor.dispose` 三段式：正常确认 / 超时 SIGKILL / 重复 dispose 幂等（P1-1）。
- 背压阈值：达到高水位 pause、回落低水位 resume（P1-3）。

### Contract
- `ptyRuntimeGeometry.spec.ts` 扩展：runtime ACK 返回与请求**不同**的 cols/rows 时，presentation 必须采用 ACK 值（P0-1 的核心回归资产）。
- availability query/event payload 校验（P0-3）。

### Integration
- host 崩溃 -> 所有 active session 恰好一次 exit 且带 `reason: 'host-crashed'`（P1-2）。
- 恢复查询失败 -> 不 spawn 新 shell，节点保持 pending（P0-3，**最重要的数据丢失防线**）。
- shutdown drain：持续输出中触发退出，最后一批输出进入 checkpoint（P1-1）。

### E2E（用户可感知，必须跑 Playwright）
| 用例 | 证据要求 |
| --- | --- |
| `workspace-canvas.terminal-resize-shrink.spec.ts`（已存在，需扩展）：expand + shrink 后 renderer 行列 == Worker presentation == POSIX `stty size` | 截图 + `stty size` 输出断言 |
| Windows ConPTY resize 一致性（新增 `*.windows.spec.ts`） | Windows runner 上执行；截图 |
| `pty-host.crash-recovery.spec.ts`（已存在，需扩展）：崩溃后任务状态不被误判为完成 | 录屏 |
| 重启后终端历史不被新 shell 覆盖（对标 `recovery.terminal-worktree-reopen.spec.ts`） | 重启前后截图对比 |

> 按 `DEVELOPMENT.md`：P0-1/P0-2/P1-2 均为用户可感知行为变化，PR 必须跑 `pnpm test:e2e`（或 `pnpm pre-commit`）并在 PR 描述中上传截图/录屏。

---

## 12. 建议的实施切分

| 步骤 | 内容 | 依赖 | 验收标准 |
| --- | --- | --- | --- |
| **S1** | P0-1 resize ACK 修复 | 无 | Contract 用例：ACK 值 != 请求值时 presentation 采用 ACK；`terminal-resize-shrink` E2E 在 macOS + Windows 通过 |
| **S2** | P1-2 host 崩溃 exit 语义区分 | 无（可与 S1 并行） | Integration：崩溃后每个 session 恰好一次带 reason 的 exit；任务不误判完成 |
| **S3** | P0-2 spawn 幂等 | S2（复用 reason 协议扩展） | Unit：确认退出后重试复用 identity；歧义 transport loss 不重试；host 同 identity 去重 |
| **S4** | P1-1 shutdown 有界 drain | S3 | Integration：持续输出中退出，最后一批进 checkpoint；超时路径有结构化诊断 |
| **S5** | P0-3 启动准入 gate | S4（drain 保证 checkpoint 完整，gate 才有意义） | Integration：恢复查询失败不 spawn；E2E：重启后历史不被覆盖。**需先过架构契约 gate** |
| **S6** | P2-1 会话生命周期下沉 domain | S5 | 架构 harness 通过；`sessionManager.ts` 降到 500 行门禁以下；原有 130 个终端测试全绿 |

依赖顺序理由：S5（gate）的价值依赖 S4（checkpoint 完整），否则 gate 只是把「抢占」变成「等一个不完整的历史」。S6 是纯重构，放最后以免与前面的行为修复混淆归因。

---

## 13. 开放问题（需用户拍板）

| # | 问题 | 选项 | 推荐 |
| --- | --- | --- | --- |
| 1 | 本地终端是否要支持「关闭 App 后 PTY 继续运行」？ | (a) 不支持，靠 checkpoint 重建（现状）<br>(b) 支持，本地 Worker 可选 detached 常驻<br>(c) 支持，仿 cleancode 独立 Provider 进程 | **(a) 先不做**。先把 P0/P1 修完，重建质量提上来再评估。(c) 与 OpenCove 的 Worker 职责重叠，代价最大 |
| 2 | P0-3 的 gate 粒度？ | (a) 全局：对账未完成则所有终端不可启动<br>(b) 按 workspace<br>(c) 按 node | **(b) 按 workspace**。全局会让「一个远程 endpoint 不可达」阻塞全部本地终端；按 node 太细，无法防跨节点抢占 |
| 3 | 是否现在就做 P2-1（下沉 domain）？ | (a) 本轮做<br>(b) 推迟到 P0/P1 稳定后<br>(c) 不做 | **(b)**。`sessionManager.ts` 已 500 行触及门禁，迟早要拆；但与行为修复混在一起会让回归归因困难 |
| 4 | P0-1 修复后若 Windows ConPTY 实际返回值与请求经常不一致，如何处理？ | (a) 一律以 ACK 为准（可能出现用户拖拽后尺寸"回弹"）<br>(b) 以 ACK 为准但 UI 提示<br>(c) 记录差异先只做诊断，不改行为 | **(a) 以 ACK 为准**，但先按 (c) 加一轮诊断埋点确认差异频率，再决定是否需要 UI 反馈 |
| 5 | 是否引入 cleancode 式「协议版本号 + 最低兼容版本」到 ptyHost 协议？ | (a) 引入<br>(b) 现有 `PTY_HOST_PROTOCOL_VERSION` 精确匹配即可 | **(b) 保持现状**。ptyHost 与 Worker 同版本发布，不存在跨版本共存场景；cleancode 需要是因为 Provider 会跨应用版本存活 |

---

## 附录：本报告未覆盖 / 未确认项

- cleancode 的 `TerminalProviderServer.ts`(676 行)、`PersistentTerminalProviderClient.ts`(688 行)、`NodePtyTerminalProcessAdapter.ts`(667 行) 仅按需抽样，未逐行通读。
- OpenCove `remotePtyEndpointProxy.*`(共约 850 行) 的 overflow recovery 细节未深入，本报告对远程路径的评价主要基于 `RECOVERY_MODEL.md` 的文档承诺，**未逐条验证实现是否符合文档**。
- D3（host exitCode 冒充 PTY exitCode）**未确认**上层是否有补偿逻辑。
- cleancode `1e1473b` 的 blank-frame 修复只读了变更文件清单与 patch 规模，未分析 `patches/@xterm__addon-webgl@0.19.0.patch`(555 行) 的具体内容。
- 本报告未运行任何构建/测试命令（按任务约束）。所有「缺失」判断基于 `rg`/`grep` 搜索与文件阅读，可能存在命名不同的等价实现未被搜到。
