# Persistence

OpenCove 当前使用 SQLite 保存 app/workspace durable state，并使用独立 topology 文件保存 Worker endpoints 和 mounts。

## Stores

SQLite:

- DB 文件：`opencove.db`
- Store：`src/platform/persistence/sqlite/PersistenceStore.ts`
- Schema：`src/platform/persistence/sqlite/schema.ts`
- Migration：`src/platform/persistence/sqlite/migrate.ts`
- 当前 `DB_SCHEMA_VERSION = 8`

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

## Migration Safety

迁移要求：

- 幂等：重复执行不破坏数据。
- 兼容读取：旧数据缺字段时 normalize。
- 事务优先：可组合的数据搬迁放在事务内。
- 回归覆盖：至少覆盖旧版本数据、缺字段数据和迁移失败路径。

启动行为：

- `user_version < DB_SCHEMA_VERSION` 时先备份 `opencove.db` 为 `opencove.db.bak-<timestamp>`。
- 打开或迁移失败时将原 DB 隔离为 `opencove.db.corrupt-<timestamp>`，创建新库继续启动。
- Renderer 会收到一次性恢复提示，说明原因是 corrupt DB 或 migration failure。

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

## Required Checks For Persistence Changes

- 更新 `schema.ts`、`migrate.ts` 和 `DB_SCHEMA_VERSION`。
- 补充旧数据迁移测试。
- 补充 IPC/Control Surface payload validation 测试。
- 运行最低 meaningful layer；提交前按 `DEVELOPMENT.md` 执行门禁。
