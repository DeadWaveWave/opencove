# Website Window Node（画布网页窗口节点）Spec

## 目标

在画布（Canvas）中提供一种**高性能**的“网页窗口节点（Website Window Node）”，让用户把网页当作一个可拖拽、可布局、可持久化的节点使用；同时通过“激活/回收”策略控制资源占用，保证整体体验稳定、丝滑。

## 核心体验（类比现代浏览器）

本功能的生命周期模型参考浏览器的 **Active Tab / Background Tab / Tab Discard**：

- `Active`（激活态）：节点可交互且可见，底层有真实 `webContents`，并绑定到窗口视图树中渲染。
- `Warm`（温态）：节点暂未激活（不可交互），但底层 `webContents` 仍保留（类似后台标签页），以便快速恢复。
- `Cold`（冷态）：节点长时间未使用后，底层 `webContents` 被销毁以释放资源；再次激活时**重新创建并加载**。冷态默认显示一次性快照（见下文）。

> 用户心智：像浏览器一样——常用网页切换很快；很久不用的会被“丢弃”，再次打开会重新加载，但仍保持节点在画布中的位置与配置。

## 创建入口（两个都要）

1. **画布/Pane 右键菜单**：提供“New Website / 新建网页窗口”。
2. **粘贴 URL 自动创建**：用户在画布内粘贴 `https://...` / `example.com` 等 URL 文本时，自动创建一个 Website Node 并导航到该 URL。

## 会话（Session / Profile）

- 默认：所有网页窗口共享会话（Shared Session）。
- 支持：
  - **无痕模式（Incognito）**：独立临时 session，不落盘。
  - **不同 Profile**：使用不同持久化 partition（用于多账号/隔离 Cookie）。

## 资源策略（高性能与“优雅回收”）

### 激活预算（Active Budget）

- 默认同一时刻只允许 `1` 个 Website Node 处于 `Active`。
- 超出预算时使用 **LRU** 回收：最久未激活的 Active 自动降级到 Warm。
- 该数值可在设置中调整（例如 `1~4`）。

### 冷态回收（Cold Discard）

- Warm 状态持续闲置达到阈值（设置项）后，自动转为 Cold，释放 `webContents`。
- 冷态再次激活时：重建 `webContents` 并加载最后一次持久化的 URL（等价于“重新打开该标签页”）。

### 保活（Pinned / Keep-Alive）

- 节点级别：用户可将某个 Website Node 设为“保持活跃”（Pinned），使其**不进入 Cold**（长期保留 Warm）。
- 规则级别：支持在设置中维护 `keepAliveHosts` 白名单（host pattern 匹配），命中的网站默认不进入 Cold（用于 Slack/Figma 等常驻型网站）。

## Cold 状态快照（Snapshot）

- Website Node 进入 `Cold` 时，尝试抓取一次**内存快照**作为视觉占位。
- 冷态 UI：显示快照 + “已回收，点击重新加载”提示，确保用户不会面对空白块。
- 快照**不持久化到磁盘**；应用重启后冷态节点显示占位壳（以最后 URL 为提示），再次激活加载。

## 持久化数据（Single Source of Truth）

持久化（可恢复）的仅包含用户意图与配置：

- `url`（最后一次显式导航/输入）
- `pinned`
- `session`（shared/incognito/profile + profileName）
- 节点位置/尺寸（由画布系统既有机制持久化）

不持久化：

- `webContents` 的运行时状态、DOM、滚动位置、JS 内存状态等
- 快照图片数据

## 安全与边界

- `Main` 负责创建/销毁与策略执行；`Renderer` 仅负责 UI 与用户意图编辑；跨层通过 IPC。
- Electron 安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- IPC 输入必须校验；不允许 renderer 任意执行主进程能力。

## 验收标准（Acceptance Criteria）

- 能通过右键菜单与粘贴 URL 两种方式创建 Website Node。
- 默认只激活 1 个网页节点；切换激活时旧的网页进入 Warm，新网页进入 Active。
- Warm 长时间未使用后进入 Cold；Cold 显示快照占位；再次激活会重新加载。
- 默认共享会话；可切换无痕/不同 profile，且能稳定隔离 Cookie/登录态。
- Pinned 与 keepAliveHosts 生效：被保活的节点不进入 Cold。
- 设置项变化可实时作用于策略（无需重启）。

## 非目标（Non-Goals）

- 不承诺“恢复 JS 运行态/滚动位置/表单状态”等浏览器级完整恢复。
- 不做快照磁盘持久化、历史回放、扩展系统、开发者工具集成等。

