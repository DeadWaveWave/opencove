# Current Architecture

本文档概述 OpenCove 当前已实现的运行时能力和主要 owner。更细的规则见同目录专题文档。

## Runtime Topology

Desktop 启动时要求存在本机 Worker endpoint；正常运行时不再依赖 main-owned standalone PTY/runtime fallback。Worker 暴露 Control Surface，Desktop、CLI 和 Web UI 都作为 client 调用同一套 command / query / event contracts。

当前拓扑包含：

- `local` endpoint：本机 Worker。
- `remote_worker` endpoint：通过 hostname、port、token 注册的远端 Worker。
- project mounts：每个 mount 绑定 `projectId`、`endpointId`、`rootPath/rootUri` 和排序。

拓扑持久化在 `worker-topology.json`，endpoint token 单独保存在 `worker-endpoint-secrets.json`。SQLite 保存 workspace/app durable state；拓扑文件保存 endpoint/mount registry。

## Control Surface

Control Surface 是外部能力入口，支持：

- HTTP `/invoke`：command / query 调用。
- HTTP `/events`：事件流。
- WebSocket `/pty`：PTY stream attach、input、resize、control events。
- Worker 同源 Web UI：Full Web Canvas 与调试 shell。

鉴权支持 bearer token、一次性 ticket 换 cookie、以及启用 LAN access 时的 Web UI password cookie。CLI、Desktop 和 Web UI 不直接读写 DB 或 renderer store。

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

当前画布能力包括：

- Space Explorer：通过 mount root 浏览、创建、删除、复制、移动、重命名和打开文件。
- Document Node：基于文件 URI 编辑文本文件，并在 mount 上下文中读写。
- Image / media preview：从文件 bytes 创建画布预览或媒体窗口。
- CLI node control：通过 `node.*` 和 `canvas.focus` 管理 Note、Task、Website、Agent、Terminal 节点。

## Terminal And Sessions

Worker 维护 PTY runtime、stream hub 和 terminal presentation session。`session.presentationSnapshot` 提供 worker-owned baseline，client 使用 `snapshot -> attach(afterSeq)` 恢复或重连。

当前终端几何仍有一个实现约束：resize 必须由当前 controller client 发起，并且 reason 只能是 `frame_commit` 或 `appearance_commit`。Viewer attach、focus 和普通输入不应主动改变 PTY size。

## Persistence And Recovery

SQLite schema 当前版本为 `8`。启动迁移使用 `PRAGMA user_version`，迁移前会备份旧 DB，打开或迁移失败时会隔离 corrupt DB 并创建新库继续启动。

恢复路径区分：

- durable fact：workspace、spaces、nodes、settings、session metadata。
- runtime observation：PTY alive/exited、watcher observation、外部 CLI 状态。
- UI projection：badge、selection、hover、临时恢复提示。

冷启动 runtime 恢复通过 worker `session.prepareOrRevive`；renderer 负责消费 worker result 和展示恢复状态，不拥有恢复真相。

## CLI And Standalone Runtime

CLI launcher 可由 Desktop 内置安装或 standalone server installer 安装。Standalone server bundle 覆盖 macOS、Linux、Windows，并使用同一套 Worker + Web UI runtime 语义。

CLI 默认作为 client 调用 Control Surface；它可以管理 Worker 生命周期、调用 filesystem/mount/PTY 能力，以及通过 node control 管理画布节点。

## Current Constraints

- Remote endpoint 注册和 tunnel/网络可达性仍需要用户提供稳定连接信息。
- 大文件 bytes 读取和媒体预览会经过 renderer/runtime 内存路径，调用方应避免把它当作无限制传输通道。
- `targetMountId` 与 `directoryPath` 并存，触达相关代码时必须保持 mount owner 清晰，避免 split truth。
- Control Surface 有少量 handler 仍直接编排 persistence/topology；新增能力应优先下沉到 context application/usecase。
