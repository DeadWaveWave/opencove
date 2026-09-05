# Current Architecture

本文档概述 OpenCove 当前已实现的运行时能力和主要 owner。更细的规则见同目录专题文档。

## Runtime Topology

Desktop 启动时要求存在本机 Worker endpoint；正常运行时不再依赖 main-owned standalone PTY/runtime fallback。Worker 暴露 Control Surface，Desktop、CLI 和 Web UI 都作为 client 调用同一套 command / query / event contracts。

当前拓扑包含：

- `local` endpoint：本机 Worker。
- `remote_worker` endpoint：支持 manual hostname/port/token 注册，也支持 managed SSH access record；managed SSH 由 Desktop / Home Worker 在本地建立 loopback tunnel，并按需触发远端 Worker bootstrap。
- project mounts：每个 mount 绑定 `projectId`、`endpointId`、`rootPath/rootUri` 和排序。

拓扑持久化在 `worker-topology.json`，endpoint token 单独保存在 `worker-endpoint-secrets.json`。SQLite 保存 workspace/app durable state；拓扑文件保存 endpoint/mount registry。

## Control Surface

Control Surface 是外部能力入口，支持：

- HTTP `/invoke`：command / query 调用。
- HTTP `/events`：事件流。
- WebSocket `/pty`：PTY stream attach、input、resize、control events。
- Worker Web access listener：同源 Full Web Canvas、调试 shell、cookie auth 与 Control Surface routes。

Desktop-managed Worker 的 private loopback listener 在 Worker 生命周期内保持稳定；Web listener 独立应用 enable、port、LAN 和 password 配置。两者委派到同一个 Control Surface runtime、PTY Hub 与 presentation，Web listener 切换不重启 Worker。鉴权支持 private bearer token、一次性 ticket 换 cookie、以及启用 LAN access 时的 Web UI password cookie。CLI、Desktop 和 Web UI 不直接读写 DB 或 renderer store。完整 lifecycle 见 `docs/runtime/WORKER_WEB_ACCESS_LIFECYCLE.md`。

## Remote Endpoints

Remote endpoint health 通过 `endpoint.overview.list`、`endpoint.prepare` 和 `endpoint.repair`
投影为 `connected / connecting / disconnected / auth_failed / tunnel_failed / needs_setup /
version_mismatch / error`。Managed SSH 是当前推荐产品路径；manual endpoint registration
保留为 advanced path。Managed SSH prepare/repair 先返回 accepted overview，安装与隧道连接由
Worker 的 `ManagedSshEndpointOperationOwner` 通过 preparation port 执行，不占用通用 HTTP
请求 timeout。冷启动先 bootstrap、后开 tunnel；phase/revision 仅是运行时状态。

AppShell composition 提供一个 `EndpointOverviewProjectionOwner` 给所有远端 UI。它串行查询
`endpoint.overview.list`，只在有 active consumer 和 operation 时以 500ms settlement-to-next-query
间隔观察；关闭重开 UI 不取消安装，Picker 就绪后自动加载目录。更新/删除/shutdown 的 generation
fence 先于本地 child abort，迟到结果不能复活旧配置；下次 prepare 通过 probe-first bootstrap
收敛远端状态。详细契约见 `CONTROL_SURFACE.md` 与 `RECOVERY_MODEL.md`。

Add Project、Manage Mounts 和 remote directory picker 的浏览流程统一走目标 Worker 的
`endpoint.homeDirectory` / `endpoint.readDirectory`，而不是在 Desktop 侧猜测远端路径。

## Files And Mounts

Filesystem 使用 URI-first contracts。普通 `filesystem.*` 访问本机 approved roots；`filesystem.*InMount` 先解析 mount，再将请求路由到本机或远端 Worker。

当前 mount-aware 操作包括：

- `readFileTextInMount`
- `readFileBytesInMount`
- `statInMount`
- `readDirectoryInMount`
- `writeFileTextInMount`
- `createDirectoryInMount`
- `deleteEntryInMount`
- `copyEntryInMount`
- `moveEntryInMount`
- `renameEntryInMount`

所有 mount-aware 文件访问都必须位于 mount root 内；本机 mount 还必须通过 approved roots 门禁。

## Canvas Capabilities

Space 的执行与文件访问以 `targetMountId` 为主。`directoryPath` 仍存在，用于兼容、显示和部分 fallback，但 mount-aware 路径中不应把它当作唯一执行真相。

Space 的 `parentSpaceId` 只表示画布上的视觉组织关系。child Space 可以作为 parent Space 内的组织区域存在，也可以在满足约束后成为独立 Space Worktree；执行目录、mount 和 Git cleanup 不能从视觉包含关系隐式推断。完整生命周期规则见 `docs/canvas/SPACE_LIFECYCLE_SPEC.md`。

`session.launchAgent`、`session.spawnTerminal` 这类只携带 `spaceId` 的通用 intent，当前也会先按 Space 的 mount 上下文解析执行目录；当 Space 绑定了 mount 时，handler 会内部委派到 `session.launchAgentInMount` 或 `pty.spawnInMount`，而不是继续把 `directoryPath` 当成纯本机 cwd 直接执行。

Renderer 侧的 task / agent / terminal 启动入口与 main / node-control 共享同一套 mount 解析语义：如果旧数据里的 `targetMountId` 缺失或失效，但 `directoryPath` 仍能落在某个 project mount 内，调用方会先把 Space 修复为该 mount root/working directory，再继续发起 launch。

当前画布能力包括：

- Space Explorer：通过 mount root 浏览、创建、删除、复制、移动、重命名和打开文件。
- Document Node：基于文件 URI 编辑文本文件，并在 mount 上下文中读写。
- Image / media preview：从文件 bytes 创建画布预览或媒体窗口。
- CLI node control：通过 `node.*` 和 `canvas.focus` 管理 Note、Task、Website、Agent、Terminal 节点；其按 Space 定位 endpoint / working directory 时，也使用同一套 mount-aware 解析规则。

## Terminal And Sessions

Worker 维护 PTY runtime、stream hub 和 terminal presentation session。`session.presentationSnapshot` 提供 worker-owned baseline，client 使用 `snapshot -> attach(afterSeq) -> exact role/authority ACK` 恢复或重连。Browser socket open 本身不授权 write、resize 或 Agent re-entry。

终端几何只有一个 Worker-owned canonical grid：resize 必须由当前 controller client 发起，并且 reason 只能是 `frame_commit` 或 `appearance_commit`。Viewer attach、focus 和普通输入不应主动改变 PTY size。客户端显示校准只调整各自字体 metrics；如果稳定 grid 提案变化，仍必须通过 Worker geometry transaction。

## Persistence And Recovery

SQLite schema 当前版本为 `8`。启动迁移使用 `PRAGMA user_version`，迁移前会备份旧 DB，打开或迁移失败时会隔离 corrupt DB 并创建新库继续启动。

恢复路径区分：

- durable fact：workspace、spaces、nodes、settings、session metadata。
- runtime observation：PTY alive/exited、watcher observation、外部 CLI 状态。
- UI projection：badge、selection、hover、临时恢复提示。

冷启动 runtime 恢复通过 worker `session.prepareOrRevive`；renderer 负责消费 worker result 和展示恢复状态，不拥有恢复真相。

## CLI And Standalone Runtime

CLI launcher 可由 Desktop 内置安装或 standalone server installer 安装。Desktop launcher
使用 Electron runtime；standalone bundle 覆盖 macOS、Linux、Windows，使用内置 Node
runtime 和对应 Node ABI 的原生模块，不依赖 Desktop/Electron 共享库。两种分发仍使用同一套
Worker + Web UI 业务语义。

CLI 默认作为 client 调用 Control Surface；它可以管理 Worker 生命周期、调用 filesystem/mount/PTY 能力，以及通过 node control 管理画布节点。

## Current Constraints

- Managed SSH 已经是主路径，但仍依赖本机 `ssh` 可用性以及远端 bootstrap/install 假设；manual endpoint registration 仍然用于显式管理 token/tunnel 的高级场景。
- 大文件 bytes 读取和媒体预览会经过 renderer/runtime 内存路径，调用方应避免把它当作无限制传输通道。
- `targetMountId` 与 `directoryPath` 并存，触达相关代码时必须保持 mount owner 清晰，避免 split truth。
- malformed topology / secret record 的 backup / repair metadata 仍然有限，health UI 目前主要反映已解析出的当前状态。
- Control Surface 有少量 handler 仍直接编排 persistence/topology；新增能力应优先下沉到 context application/usecase。
