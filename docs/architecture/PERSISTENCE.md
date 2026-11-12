# Persistence

OpenCove 当前使用 SQLite 保存 app/workspace durable state，并使用独立 topology 文件保存 Worker endpoints 和 mounts。

## Stores

SQLite:

- DB 文件：`opencove.db`
- Store：`src/platform/persistence/sqlite/PersistenceStore.ts`
- Schema：`src/platform/persistence/sqlite/schema.ts`
- Migration：`src/platform/persistence/sqlite/migrate.ts`
- 当前 `DB_SCHEMA_VERSION = 16`
- schema 14：managed Claude resume ledger 与 retired IDs；schema 15：node lineage；schema 16：未激活的 task authority
- Agent/Terminal node Worker binding：`nodes.worker_binding_json`
- Terminal durable recovery：`terminal_recovery_records`
- Legacy terminal presentation/scrollback mirror：`node_scrollback`（兼容读取，不是独立 truth owner）

Topology files:

- `worker-topology.json`：remote endpoint records 和 mount records。
- `worker-endpoint-secrets.json`：endpoint token secrets。
- 文件格式定义：`src/app/main/controlSurface/topology/topologyFileV1.ts`。

Renderer 不直接访问 DB 或 topology 文件；必须通过 preload/IPC 或 Control Surface。

`nodes.worker_binding_json` 保存 node-owned `endpointId + mountId`。它是恢复路由的 durable
truth：恢复优先使用该 binding，并通过 topology registry 解析 endpoint/mount；只有旧数据中
该列为 `NULL` 或缺少合法 binding 时才从 Space `targetMountId` 推导。Remote binding 无法解析
时必须保留原 binding 并返回显式恢复问题，不能将 remote path 作为本地 cwd 启动。

## SQLite Versioning

用户机器上的迁移不依赖 drizzle-kit migration 文件。当前策略：

1. SQLite `PRAGMA user_version` 表示当前 schema version。
2. `DB_SCHEMA_VERSION` 表示目标版本。
3. `migrate()` 创建/更新表结构，执行必要数据迁移。
4. 成功后写入 `PRAGMA user_version = DB_SCHEMA_VERSION`。

Schema 变更属于 Large Change，必须写清旧数据迁移、失败恢复和验证。

SQLite `PRAGMA user_version` 是 OpenCove 的应用级 schema 版本标记，不是数据库
自动迁移系统。它只能说明“上次代码认为迁移到了哪个版本”，不能替代启动期结构
repair。Electron 的 `userData` 目录是安装版和 dev 版数据隔离的 durable profile；
安装版默认读 `%APPDATA%/opencove`，dev 默认读 `%APPDATA%/opencove-dev`，所以必须单独
验证安装版升级路径。

## Migration Safety

迁移要求：

- 幂等：重复执行不破坏数据。
- 兼容读取：旧数据缺字段时 normalize。
- 启动 repair：即使 `user_version` 已经等于当前版本，也必须检查并补齐 additive
  columns、indexes、metadata 等当前读取代码依赖的结构。
- 事务优先：可组合的数据搬迁放在事务内。
- 回归覆盖：至少覆盖旧版本数据、安装版 profile 形状、缺字段数据和迁移失败路径。

启动行为：

- `user_version < DB_SCHEMA_VERSION` 时先备份 `opencove.db` 为 `opencove.db.bak-<timestamp>`。
- 对高于当前 schema 的 DB，在任何 repair 前拒绝打开，保留原文件；这不属于 corruption，不进入自动重建。
- 其他打开或迁移失败时将原 DB 隔离为 `opencove.db.corrupt-<timestamp>`，创建新库继续启动。
- Renderer 会收到一次性恢复提示，说明原因是 corrupt DB 或 migration failure。

读取失败不能被当作“没有 durable state”。如果 `readAppState()`、IPC、Control Surface
或 remote persistence transport 捕获异常，只能作为错误/不可用路径处理；不得让
Renderer 用默认空状态覆盖原 DB。对任何会让读取失败回落到 `null` 的改动，必须补一条
证明不会静默覆盖已有 durable state 的测试或断言。共享发布使用乐观并发控制，Worker 的 `sync.writeState` 契约保持不变。

### 冲突合并与发布不变量

- **S1（不静默回退）**：对共享内容路径 p，若 candidate[p] 与 ancestor[p] 相等，
  合并结果取 latest[p]。普通对象递归按键三方合并，数组作为原子值；真正同字段冲突取 local。
  workspaces、nodes、spaces 按 id 合并，祖先已有而任一侧删除的实体保持删除；新实体保留，
  排序为 latest 顺序加 local 独有项。成员关系按 node 的 space id 三方合并。
  `viewport`、`isMinimapVisible`、`activeSpaceId` 和 `activeWorkspaceId` 是客户端视图状态，
  合并保留 latest 的共享占位值，不参与共享内容冲突决策。
- **S2（精确祖先）**：Renderer 的 synced base 由接受的 snapshot 或自身非合并成功发布推进，
  保存 portKind、canonical content 和 revision。读取但拒绝应用的 snapshot 不推进此基线。
  IPC 同次返回 state/revision；适配器保存最近 16 个 revision 的 normalized snapshot，
  发布首先 CAS against baseRevision，冲突重试始终使用同一个祖先，最多三次写尝试。
  缺失或被淘汰的基线使用既有最近 snapshot 回退；显式 revision 缺失缓存时进程内告警一次。
  该有界缓存回退不提供精确祖先保证；本地 SQLite 无 Worker 时忽略 baseRevision。
- **S3（不回声发布）**：Renderer 以共享 normalizer 和稳定键序比较 candidate 与 synced base，
  相等则不调用 IPC。冲突合并与 latest 内容相等时不再写、不增加 revision。
  合并返回 `merged: true`，Renderer 不推进基线，也不抑制该 revision 的同步刷新；
  待接受合并后的 snapshot 才推进基线。
  此期间 writer 单独保存已合并发布的 candidate；后续 candidate 与它比较，而不是与旧基线
  比较。若有后续编辑（包括撤销至旧基线），先读取 revisioned latest，再将相对前一 candidate
  的变化合并到 latest，并以该 revision CAS。读失败保留 pending 状态并报告失败，不丢弃编辑。
  重放后的内容仍未应用到 Renderer，因此保持刷新且不推进 synced base。
  Worker refresh 在相同的生命周期和本地编辑检查后，将 settings 与 workspace 内容一起应用，
  再接受 snapshot revision；不能确认尚未应用的共享字段。
  节点 sync-overwrite guard 不阻止整个 snapshot 应用。投影读取 writer 已缓存的 accepted base，
  对基线中已有的 guarded node，在 canonical persisted-node 表示上执行
  `mergeValue(latestNode, localNode, baseNode)`，再走既有 shell conversion：保留真正的本地字段编辑，
  同时立即应用该节点的其他外部字段、其他节点更新及新节点。无基线的 guarded 本地创建保留；
  基线已有而 latest 删除的节点删除。应用后立即确认原始 snapshot 的 revision/content，
  store 与它的差异仅表示待发布的本地编辑；保护持续续期也不延后刷新。
  Guarded node 的 Space 归属也以每个 node 的单一 space id（含无归属）做三方合并，
  不把旧、新 Space 的 nodeIds 取并集。未修改的本地归属接受外部移动或移除；真正的本地
  归属修改及无基线的本地创建保留。重建成员列表时按 latest 顺序后接 local-only 成员，
  排除已删除节点与 Space，确保每个节点最多属于一个 Space。
  Shared settings 是 synced base 的一部分，refresh 必须同时应用 `readPersistedStateWithMeta`
  通过 `normalizeAgentSettings` 得到的 `AgentSettings`，否则后续 publication 会回退外部设置。
  Refresh 先 flush 排队的本地修改；失败不应用 snapshot，读取期间发生本地修改则拒绝该次读取。
  因此已排队但尚未发布的 settings 编辑先持久化，再接受新快照。
  Settings 内容未变时保留原对象：settings 驱动整个外壳，每次刷新都换新对象会让画布重新挂载，
  打断用户正在输入的编辑器。
  Canonical content 使用 UTF-16 code-unit 键序；writer 缓存 synced base 字符串，投影按该字符串
  缓存解析后的基线，不在每次候选比较时重新规范化或序列化基线。


Worker 是共享 durable state owner；Renderer 拥有待发布本地编辑及已接受基线；适配器缓存
只用于祖先查找，不是共享状态 owner。重启仍以 Worker/SQLite 为准，不恢复内存缓存。
跨进程 raw/legacy 结构由 `persistedAppState.ts` 描述，merge-ready 结构由
`normalizedPersistedAppState.ts` 描述；Settings domain 通过 normalizer 提供 canonical settings。
Adapter 保留原始读取结果给 hydration/migration；不能规范化的冲突 snapshot 或 candidate
必须失败，不能降级为未合并覆盖。Hydration 将终端 durable `agent` 绑定投影到
`terminalAgentBinding`；canonical normalizer 必须先将它还原到 `agent`，再移除投影字段。
接受基线、发布与 guarded rebase 使用同一 durable 表示，不能把恢复绑定当作可丢弃的 UI 数据。
Guarded rebase 重新解析 workspace 前，未受保护的节点也必须转换为 durable 表示，
避免旁边节点的 guard 清空终端恢复绑定。
没有 ancestor 的调用仍使用兼容合并规则；它不具备 S1 的完整三方保证。

## Installed Upgrade Contract

安装版升级时同时存在两份状态：磁盘上的 SQLite profile，以及可能仍在运行的本地
Worker。Worker 是 Desktop 的 persistence/control-surface owner；因此升级后不能只看
连接文件是否可 ping。

硬性不变量：

- 当前代码必须能打开所有仍支持的已安装 `user_version`，并在首次打开时 repair 到当前
  schema。
- `workspace_spaces` 这类 additive 字段必须可幂等补齐；读取代码新增依赖前，必须先有
  对应 repair。
- Desktop-started local Worker 必须和当前 Desktop `appVersion` 一致；缺失
  `startedBy` 或 `appVersion` 的旧连接文件视为不可复用，必须重启 Worker。
- CLI-started 或 remote Worker 走协议兼容检查；不要把 Desktop 本地升级闸门套到用户
  显式管理的远端 Worker。
- `pnpm dev` 通过不代表安装版升级安全，因为 dev 默认使用独立 `userData` 且通常没有
  旧安装 Worker 残留。

每个 SQLite schema version 都必须有安装版升级链路测试。`tests/contract/platform/
persistenceStore.installedUpgrade.spec.ts` 里的矩阵覆盖所有仍支持的
`user_version < DB_SCHEMA_VERSION`，并通过 guard 断言覆盖列表必须等于
`1..DB_SCHEMA_VERSION-1`。任何 PR 只要提升 `DB_SCHEMA_VERSION`，必须同步新增上一版
安装 profile fixture/shape，并证明它能打开、repair、读回 project/space，最终升级到当前
schema。缺这个测试时不得合并。

新增或修改 SQLite schema / Control Surface contract / Worker durable owner 时，最低
回归矩阵必须包含：

- 旧安装版 DB 形状：重建或 fixture 覆盖最近仍支持版本的真实表结构。
- 每个仍支持 schema version 的安装升级入口：`SUPPORTED_INSTALLED_UPGRADE_SOURCE_VERSIONS`
  必须随 `DB_SCHEMA_VERSION` 增长同步扩展。
- migration readback：打开旧 DB 后先读回 project/space/node，再断言 `PRAGMA
  user_version` 和必需列。
- schema-current repair：`user_version == DB_SCHEMA_VERSION` 但缺 additive 字段时仍能
  repair。
- Worker upgrade gate：Desktop-started 连接文件 `appVersion` 缺失或不一致时不能复用；
  同版本连接仍可复用。
- transport/read failure：remote/IPC 读取失败路径必须可诊断，并证明不会把旧 durable
  state 当成空状态写回。

## Downgrade / Rollback Contract

OpenCove 的 SQLite migration 是前向升级链路，不是双向迁移系统。除非某个版本显式写
入并测试了 rollback support，否则用户从新版本退回旧版本不属于保证可用路径。

当前代码与已发布旧版本的行为：

- 当前版本打开更高 schema 时拒绝启动，且不会执行 repair、隔离或重建。
- 已发布旧 App 打开更高 `user_version` 的 DB 时，不会执行 down migration，也不会把
  `user_version` 降回旧版本。
- 旧 App 只会按自己知道的 schema 运行启动期 repair。它不会理解新版本新增的列、表或
  语义约束。
- 如果新版本只是 additive schema，并且旧代码所有写入都能绕开新字段，退回旧版本可能
  仍能启动；但这只是兼容性结果，不是产品承诺。
- 如果新版本引入了 destructive migration、必填新列、语义搬迁、协议/Worker owner
  变化，旧版本可能读失败、写失败，或写回旧格式导致新版本数据语义丢失。

版本回退规范：

- 默认策略是 `forward-compatible upgrade only`。回退旧版本只能作为 best-effort，不得
  在 release note 或支持文档中承诺“可正常使用”。
- 若某次发布必须支持从版本 N 回退到版本 N-1，必须在该 PR 中新增专门的 downgrade
  fixture/matrix，证明旧版本能打开升级后的 profile，并明确哪些新数据会被保留、忽略或
  丢弃。
- 对破坏性 schema 变更，必须优先设计兼容窗口或启动期 guard；不能依赖旧版本默默读写
  高版本 DB。

## Topology Persistence

Endpoint/mount registry 不写入 SQLite：

- remote endpoint token 与 topology 分开保存。
- secrets 文件权限按平台尽量收紧。
- local endpoint 不作为普通 remote endpoint 记录持久化。
- mount record 保存 `projectId`、`endpointId`、`rootPath`、`rootUri` 和排序。

Topology 文件 normalize 会丢弃无效 endpoint/mount record，避免坏记录阻塞启动。

## Terminal Recovery Records (v11)

`terminal_recovery_records` 是普通 Terminal presentation 恢复的 Worker-owned durable source。
每个 Terminal node 至多有一条记录，内容包括：

- format version 与单调递增的 `generation`；
- 当前 session/route 的 `binding_json` 与 `runtime_epoch`；
- 单调递增的 `checkpoint_revision` 与 stream `applied_seq`；remote checkpoint 还包含与当前
  serialized presentation 配对的 `downstreamReplayCursor`；
- 包含 current checkpoint、bounded `archivedEpochs` static previews 与 `historyTruncated` 的
  canonical presentation envelope；
- epoch-local bounded `raw_tail`、`raw_truncated`、覆盖完整 envelope 的 checksum 与更新时间。

Worker 先 reserve generation，再一次性绑定 runtime；之后只允许 generation、完整 binding
都匹配且 revision 更新的 checkpoint commit。这组 compare-and-set 规则会拒绝已被替换的
local session 或 remote route 的 late output。Remote binding 中 `homeWorkerInstanceId` 只表示
当前 transport locality；Home 重启可以在同一 generation/runtime epoch 上刷新它。Durable
remote epoch 由 `endpointId + remoteSessionId + targetWorkerInstanceId` 判等，重连必须通过 target
instance fence，不能静默附着到另一个 Worker instance。一次 route lookup 暂时失败时，reconcile
会 preserve 该 active node，而不是把不可观测误判为移除或 replacement。

Archive envelope、checkpoint、checksum 与 raw tail 在同一个 immediate SQLite transaction 内
写入。对 remote session，current serialized presentation 与 downstream replay cursor 作为同一个
checkpoint envelope/CAS 一起提交。Presentation port 在真实 capture 入口同步冻结已接收输出的
operation boundary；若先等待 remote reset transition，则在等待完成后的 boundary 回调中同时截取
raw fallback，再冻结 Home presentation chain。Scheduled checkpoint 每批只提交一次并重新 debounce；
显式 flush/retire 才 drain 到 cutoff，避免持续输出导致 revision 混合或 SQLite 紧循环。Repository 把
`archived static previews + current serialized checkpoint` 的组合结果 mirror 到 `node_scrollback` 供旧
reader 使用。Generic app-state write 必须保留 recovery-owned mirror row；Renderer scrollback publish
不得成为第二个 durable writer。

Remote Home Hub 同时维护两种明确分离的 presentation：renderer-facing snapshot 是
`archived display prefix + current screen`，recovery snapshot 则只含 current screen。Archived prefix
不会进入 current checkpoint 或 epoch-local raw tail，因此跨多次 Home restart 也不会被重复归档。
旧 checkpoint 缺少有效 `downstreamReplayCursor` 时必须 fail closed：不把旧 serialized screen/raw
tail 与无边界 replay 叠加，而是清空不相关 fallback 并从 Remote Hub 可用窗口重建。

Archived epoch 是不可分割的 ANSI envelope。总预算严格限制为 `400_000` chars；超限时整包淘汰
最老 epoch，单个超大 envelope 整包省略并设置 `historyTruncated`，不在 ANSI escape sequence
中间截断。组合 legacy mirror/display history 时，旧 alternate screen 会先 staticize，再附加
alternate-buffer exit、xterm DECSTR 与显式 mode reset，保证下一 runtime epoch 从 normal buffer 和
默认交互模式开始。

Output checkpoint 采用 bounded trailing debounce。PTY output 以及任何实际改变 presentation 的
geometry commit 都会标记 dirty；geometry-only 变化也会持久化 cols/rows/geometry revision。新
binding 通常立即产生 initial checkpoint；surviving remote route 重绑延迟 initial checkpoint，等待
replay/live output，避免空 Home snapshot 覆盖旧 preview。

Replace/remove/exit 统一先 retire（output cutoff -> drain/join in-flight flush -> forget）。Degraded
retire 不会重新开放 output ingress；它保留 state 并安排一个 delayed single-flight retry，同时阻止
replacement reserve 越过未持久化的终帧。Remote session 已退出时，恢复先用 authoritative snapshot
在旧 generation 提交 final checkpoint；之后 replacement reserve 才把终帧归档到 archived epochs。
若 final snapshot 不可用，`prepareOrRevive` 失败并阻止破坏性 replacement。

Remote stream overflow 采用 per-session single-flight snapshot reset。Reset 期间 downstream cursor
保持不变、live data/exit 暂存；authoritative current presentation 应用成功后才发布 cursor，按 seq
排序、去除 snapshot 已覆盖事件并一次性 replay 剩余数据/exit，同时建立新的 Home replay fence。
失败则丢弃暂存事件并从未推进的 cursor 重连，不能提交 replay gap。

Shutdown durability ordering 是：

```text
freeze client ingress
  -> drain complete per-session command queues
  -> start flush with runtime events live（不先等待持续 dirty drain）
  -> drain/stop presentation resets and re-drain session queues
  -> detach runtime listeners (runtime-event cutoff)
  -> await in-flight flush -> flush post-cutoff dirtiness again
  -> close transport/runtime -> close repository/store
```

Flush 失败时必须记录并返回 degraded，不能静默当作 durable shutdown 成功。

## Write Ownership

Sidebar root-canvas and Space-group disclosure preferences live in settings as
`sidebarCollapsedSpaceGroupIds`, using the workspace-scoped group identity
(`workspaceId:groupId`; the root-canvas group ID is `project-root`). The single-project
navigation opens from the project icon rail and has no project disclosure control.
`sidebarCollapsedWorkspaceIds` is retained for legacy data compatibility but does not
hide the active project's navigation. Only `true` entries are retained; missing or
invalid legacy values default to expanded. Explicit expansion removes that group's
collapsed entry without changing other projects or legacy project records. Sidebar
mounting, project switching, and temporary tree absence must not reset these records.
The existing app-state hydration, write scheduling, and quit flush own their durability;
the Sidebar does not maintain a second local persistence store.

- Workspace/app state：SQLite persistence store。
- Endpoint/mount registry：Worker topology store。
- Approved local roots：approved workspace store。
- Runtime PTY/session state：Worker runtime 和 stream hub；只有可恢复 metadata 才进入 durable store。
- Terminal recovery generation/binding/checkpoint/raw tail：Worker terminal recovery owner；SQLite
  repository is the only durable write path.
- `node_scrollback` terminal rows：Worker repository compatibility mirror；generic persistence may
  read them but must not overwrite recovery-owned rows.
- Browser profile data：客户端本地 SQLite browser profile store；历史、书签、下载记录、主页和权限决定默认不进入 Worker/WebUI 同步。

## Required Checks For Persistence Changes

- 更新 `schema.ts`、`migrate.ts` 和 `DB_SCHEMA_VERSION`。
- 补充旧安装 profile 形状、缺字段 repair、迁移 readback 测试。
- 提升 `DB_SCHEMA_VERSION` 时，必须补 `persistenceStore.installedUpgrade.spec.ts` 的下一版
  fixture/matrix；guard 测试必须覆盖 `1..DB_SCHEMA_VERSION-1`。
- 明确降级策略：默认不支持 rollback；若要求支持，必须补 downgrade fixture/matrix 和
  release note 约束。
- 涉及 local Worker / Control Surface 的持久化 owner 改动时，补 Worker 版本复用测试。
- Terminal recovery 改动必须覆盖 generation/binding/checkpoint CAS、multi-epoch archive composition、
  legacy mirror、remote Worker instance fence、cursor-correlated replay/overflow、retire/rebind race，
  以及 complete-queue two-phase shutdown barrier。真实 `better-sqlite3` contracts 使用 Electron
  native ABI，运行 `pnpm test:terminal-recovery:native`；默认 Node Vitest 会显式跳过这组原生套件，
  CI 必须在 Electron runtime 下单独执行该命令。不能用 Node ABI 的绿色结果替代该门禁。
- 补充 IPC/Control Surface payload validation 测试。
- 运行最低 meaningful layer；提交前按 `DEVELOPMENT.md` 执行门禁。

## Managed Claude resume ledger（schema 14）

Worker 是 managed Claude resume tuple 的 owner。`managed_claude_resume_bindings` 保存
canonical tuple、runtime、activation ID 和单调的 `node_seen`；`nodes.agent_json` 是持久化投影。
仅内部 `activateManagedClaudeRuntime` / `commitManagedClaudeRebind` 可提交绑定；Worker 默认在
符合条件的实际启动中接管，不从 provider、verified 或快照推断 ownership。schema repair 只重建表结构，
不执行 lifecycle adoption。首次接管在同一 activation 事务中比较原未拥有节点的 tuple、runtime、
执行上下文；UI restoring/结束信息/布局不影响比较。冷恢复在同一事务另拒绝并发 stopped；
显式 relaunch 不受此冷恢复限制。freeze 不移除既有 ledger 的保护。

最终 app-state writer 在同一事务内纠正 owned tuple 与非空 runtime，保留其他编辑；不兼容的
agent/kind/provider/route 或 retired ID 拒绝整次写入。真实删除将 ID 写入
`retired_managed_nodes`，两张表都不关联 node cascade。store open 只回收超过 24 小时、
`node_seen=0` 且不存在 node 的 orphan。
缺失或无效的 node binding 会继承 Space 路由，与显式 local binding 不等价；owned node
不能通过遗漏或清空 binding 撤销其显式路由。

内部写回返回 `{revision, corrected, effectiveState}`，回调与 runtime binding 消费 effective
state；wire 只增加 `corrected`。revision 是自身提交值，不在异步回调后重读。
本地 `readAppStateSnapshot` 在单一 SQLite read transaction 中返回 revision 与 state。
身份冲突使用 `persistence.owned_node_identity_conflict` 与 `{nodeId, field, reason}`：SQLite/raw/
Desktop IPC 返回与 revision conflict 相同的 `{ok:false, reason:'unknown', error}`；
revisioned sync 采用 Control Surface `{ok:false, error}`；raw sync 保留嵌套写入结果。
Remote/Web 原样返回身份冲突，不纳入 revision conflict 重试。Renderer 保留 accepted ancestor，
先读 canonical 再 rebase 合法编辑；retired ID 从 live nodes、Space membership 与 task links 清除，
且 guarded extra node 不能保留已知 retired ID。

读事务批量查询 ledger，向 owned node 投影 `managedClaudeResumeBindingOwnership`（activation ID 与
nullable runtime ID）。marker 不是独立存储事实，提交的 marker 不具备写权；最终 writer 纠正缺失或
不匹配的 marker，并去掉 unowned forgery。Renderer 在普通/guarded merge、hydration 与序列化末端
保护 owned tuple、身份与非空 runtime association。metadata 不修改 owned tuple 或发出 tuple-only flush。

corrected、merged 与未明确 attested unchanged 的成功不能把 candidate 插入 canonical cache。
cache latest 与 accepted revision 在同一 persistence scope 内单调；同 revision 不同内容保持旧值并要求刷新。
Renderer 显式保留 refresh demand，先 read 再 repair，不依赖通知。提交后的 candidate 仅作后续编辑祖先；
身份拒绝仍以旧 accepted base 作祖先。transport unknown 保留 base 与 unconfirmed draft，刷新不确认
该 draft，也不自动重放。失败结果使用 `outcome: rejected | notSubmitted | unknown` 区分
Worker 拒绝、提交前读取/endpoint 失败与提交后响应不明。后续提交失联必须保留该次真实 submission
及其 ancestry，不能继续使用先前 corrected candidate。raw replacement 同样遵循该规则。

所有显式 refresh 都保留相对于 accepted base 的本地 delta；有 active submission 时等待其 outcome，
不能从中途快照推断用户意图。较新 refresh floor 阻止 acknowledgement 时，已提交 candidate
仍作为后续编辑的 ancestor。canonical base acknowledgement 与 disclosure presentation application 分离；
view-only preferences 不参与 canonical equality。owned ledger 的两个 tuple 字段在 renderer parsing 中逐字段保留；不能沿用 unowned 的 verification 清理策略改写 canonical ID。未确认 draft 与 canonical presentation 分开记录，
后续编辑仅以 presentation delta 更新 draft，并显示保存未确认提示。

所有 renderer refresh（包括首次订阅、重连、普通事件与 corrected receipt）统一比较读取前后的本地
持久化内容；读取期间发生编辑时先丢弃 completion 再重读，不能让 connect metadata merge 绕过该检查。
删除与已经结束拖动的移动也属于编辑，不依赖短暂的 canvas guard。canonical ownership 仅在该检查后投影。

退出同时 capture 不可变 state、ancestor、revision 和 generation，只 drain 该 delta；repair read
先检查 revision floor，同字段并发冲突保留 draft 并报告失败。legacy terminal history 只迁移仍存在的
canonical terminal IDs，已有 primary state 时仍可恢复上次未完成的 history migration，不覆盖已有 history。
本节沿用原有进程边界与 owner：no executable-rule impact。

Managed launch 的读取适配器只在 clean transaction boundary 返回 definitive ledger/node/
retirement observation；同一连接仍在 transaction 中时必须报告 unavailable，不能把可见行当作
已提交事实。生命周期保留 unknown obligation，直到 definitive read 确认结果。
`onAppStateCommitted` 对比真实 node 集合，每次成功 snapshot commit 都通知（未删除时 IDs 为空），
让 fallback custody 读取已持久化的 runtime reference。raw write 只在外层提交后通知；rollback 无通知，
observer/cleanup 失败不改变成功的持久化结果。Activation receipt 使用该事务的精确 revision，
row-only activation 的 commit revision 为 null；`alreadyApplied` 的当前 revision 不冒充历史提交。
## 节点创建血缘（schema 15）

升级按 v14 ledger → v15 lineage 初始化。v13 与 v14 profile 均可升级到 v15；
v1 legacy writer 运行前两套 side table 已就绪，schema-current repair 也同时修复两套结构。
升级和 repair 均不推断或补写 ledger / lineage 记录。

Workspace application owner 从已验证的 session grant 推导 parent、root 和 depth，
在节点创建提交时通过原 SQLite 连接与 CAS node writer 同事务写入 `node_lineage`。
创建提交与普通 snapshot 共用最终 writer，保留 managed Claude gate、retirement 和
`{revision, corrected, effectiveState}` receipt；lineage 插入失败时一并回滚。
删除观察在这个外层事务成功提交后发布；lineage-aware commit 同样触发 runtime-binding
observers，投影 effective state，不以提交前的 snapshot 覆盖 ledger correction。
该表只保存 node_id、spawned_by_node_id、root_node_id、lineage_depth，insert-once；
相同记录幂等，冲突拒绝。无 FK，snapshot/raw writer 和 node deletion 不清理它。
迁移和 schema-current repair 只创建表及索引，不回填历史节点；无记录的节点投影为 root、depth 1。
Renderer snapshot 字段没有 lineage 写权；query 投影不写入数据库。移动、删除父节点和重启保持血缘。
Snapshot export 不含血缘，数据库备份包含血缘。降级仅尽力兼容，不保证安全。
带 caller node 的 grant 创建必须能读取 lineage 并原子提交 node 与 lineage；缺少任一端口
或存储不可读时，在启动进程前拒绝，不把未知来源伪装成 root。`nodeLineageV1` 同时检查
repository 与 creation commit。node-less standalone grant 不记录血缘；standalone Worker
仍使用完整 SQLite store。Desktop/Web/remote clients 将创建命令交给 owning Worker。
本节为现有 owner/边界的说明：no executable-rule impact。

### Managed Claude 提交通知与恢复

SQLite 的同步 post-commit observation 是 app-state invalidation 的唯一来源。普通写入、raw
外层事务、activation、settlement 和 rebind 都在 commit 后、任何 awaited consumer 前发布
exact revision；rollback、row-only activation 和 alreadyApplied 不发布新通知。
Worker composition 将通知写入有界 buffer，并分别隔离 Desktop 和 SSE sink 的失败。
HTTP 不再通过 command 前后读取 revision 来猜测提交；owner 的 attributable callback 按 revision 去重。
通知只要求重新读取 canonical snapshot，不授予 tuple authority。

pre-W8 Worker 不含 managed ledger tables；用它打开已有 owned rows 的 profile 属于不支持的
database downgrade。普通 workspace 同步不因 lookup unsupported 失败；PR1+ final writer
继续强制 ledger gate，客户端能力缺失只限制 ownership-dependent operations。


## Task/text authority 基础层（schema 16，未激活）

升级和 schema-current repair 仅创建空的 `task_field_authority`、
`task_command_receipts` 和 `task_claim_holders`，不从 snapshot 推断 authority。
生产启动目前不调用 activation，也不宣告 `taskAuthorityV1`。现有 UI 编辑行为保留。
完整 UI、draft recovery、创建/归档/恢复和 launch adapters 就绪前不得启用。

内部 `activateTaskAuthority` 只从当前 SQLite rows 同事务 adoption：有效的 managed-agent
open link 获得非过期 lease，closed link 保留历史，缺失 holder 的 open task 归一为
unclaimed todo。重复 open links 保存显式 conflict 和原 forward links，不挑选胜者或
伪造 active lease；human-only conflict resolution 可逐项解除关联。Note 原文不截断。
Archive snapshot 不作为 active authority 或 active lease 的来源。

`TaskMutationOwner` 在 immediate transaction 内再次授权，校验 authority generation、
字段 version 和 lease；mutation、snapshot projection、revision 与 compact receipt
同事务提交。Receipt 不保存正文；同 principal/operation/request ID 的异参请求失败。
Session principal 使用 project/node/current session，独立于 grant ID/token；凭证更新仍需
对当前 binding 重新授权。Runtime session 改变后的历史身份映射尚未接入，不承诺跨 session
自动重放。Human/bearer 的稳定 identity ID 必须由认证层提供，不能来自 wire payload。

Ledger 一旦存在，raw 与 structured snapshot writers 均须保护字段，拒绝 protected node
省略、kind/project 更改、retired ID 复活、未登记的 task/note 创建，以及 active holder
删除、session 或 Worker binding 更改。这个 gate 不随新命令的停用而解除。
`agent.taskId` 仅从 active forward claims 重算，closed forward link 与 run history 留在 task。
读取也投影 ledger，不能把 snapshot JSON 当作第二个 owner。

当前文本命令只针对 standalone note body。Append 保留 whitespace/Unicode，按当前末尾
决定是否插入换行；最终 1 MiB 限额允许已有 oversized 文本的 no-op/缩小替换。Replacement
要求当前 text version，拒绝 stale 后不能自动套用新版本重新提交旧文本。
这不代表 renderer draft recovery 或完整 task CLI 已交付。

回退至不认识本 ledger 的旧 binary 时，使用单独的数据目录和升级前备份；不得让旧 binary
直接写入已激活的数据库。只关闭 mutation 或 feature flag 不构成安全 downgrade。
