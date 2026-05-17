# Persistence

OpenCove 当前使用 SQLite 保存 app/workspace durable state，并使用独立 topology 文件保存 Worker endpoints 和 mounts。

## Stores

SQLite:

- DB 文件：`opencove.db`
- Store：`src/platform/persistence/sqlite/PersistenceStore.ts`
- Schema：`src/platform/persistence/sqlite/schema.ts`
- Migration：`src/platform/persistence/sqlite/migrate.ts`
- 当前 `DB_SCHEMA_VERSION = 9`

Topology files:

- `worker-topology.json`：remote endpoint records 和 mount records。
- `worker-endpoint-secrets.json`：endpoint token secrets。
- 文件格式定义：`src/app/main/controlSurface/topology/topologyFileV1.ts`。

Renderer 不直接访问 DB 或 topology 文件；必须通过 preload/IPC 或 Control Surface。

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
- 打开或迁移失败时将原 DB 隔离为 `opencove.db.corrupt-<timestamp>`，创建新库继续启动。
- Renderer 会收到一次性恢复提示，说明原因是 corrupt DB 或 migration failure。

读取失败不能被当作“没有 durable state”。如果 `readAppState()`、IPC、Control Surface
或 remote persistence transport 捕获异常，只能作为错误/不可用路径处理；不得让
Renderer 用默认空状态覆盖原 DB。对任何会让读取失败回落到 `null` 的改动，必须补一条
证明不会静默覆盖已有 durable state 的测试或断言。

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
  `appVersion` 的旧连接文件视为不可复用，必须重启 Worker。
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

当前代码行为：

- 旧 App 打开更高 `user_version` 的 DB 时，不会执行 down migration，也不会把
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

## Write Ownership

- Workspace/app state：SQLite persistence store。
- Endpoint/mount registry：Worker topology store。
- Approved local roots：approved workspace store。
- Runtime PTY/session state：Worker runtime 和 stream hub；只有可恢复 metadata 才进入 durable store。
- Browser profile data：客户端本地 SQLite browser profile store；历史、书签、下载记录、主页和权限决定默认不进入 Worker/WebUI 同步。

## Required Checks For Persistence Changes

- 更新 `schema.ts`、`migrate.ts` 和 `DB_SCHEMA_VERSION`。
- 补充旧安装 profile 形状、缺字段 repair、迁移 readback 测试。
- 提升 `DB_SCHEMA_VERSION` 时，必须补 `persistenceStore.installedUpgrade.spec.ts` 的下一版
  fixture/matrix；guard 测试必须覆盖 `1..DB_SCHEMA_VERSION-1`。
- 明确降级策略：默认不支持 rollback；若要求支持，必须补 downgrade fixture/matrix 和
  release note 约束。
- 涉及 local Worker / Control Surface 的持久化 owner 改动时，补 Worker 版本复用测试。
- 补充 IPC/Control Surface payload validation 测试。
- 运行最低 meaningful layer；提交前按 `DEVELOPMENT.md` 执行门禁。
