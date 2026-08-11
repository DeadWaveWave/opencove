# SSH 使用与连接体验对标报告（OpenCove vs Orca）

- 状态：研究报告（Phase 1，只读调研，未改动 `src/`）
- 参考实现：`/Users/shihaojie/Development/orca`（只读）
- 本仓：`/Users/shihaojie/orca/workspaces/opencove/ssh-experience`
- 方法：遵循 `docs/development/REFERENCE_RESEARCH_METHOD.md` 的 `Research -> Synthesize -> Adapt -> Verify`
- 证据规则：所有现状断言均带 `文件路径:行号`。未能验证的写「未确认」。

> 术语对齐：Orca 的用户概念叫 **SSH target**（`src/shared/ssh-types.ts:9`）；OpenCove 的对应概念叫 **managed_ssh Endpoint**（`src/shared/contracts/dto/topology.ts:2`）。二者不是同一抽象层：Orca 的 SSH target 是「一台可连的机器」，OpenCove 的 Endpoint 是「一个可执行 Worker 的落点」，SSH 只是它的一种 access kind。本报告的所有建议都建立在这个差异之上，不建议把 Orca 的模型整体搬过来。

---

## 1. 结论摘要（TL;DR）

1. **两者的问题类不同，但「配置一台远程机器」这段体验是同一问题类**。OpenCove 的 SSH 只是 Endpoint 的一种 access（`src/shared/contracts/dto/topology.ts:2`、`:15`），Orca 的 SSH 是一等公民（`src/shared/ssh-types.ts:9-58`）。可迁移的是**配置流与状态可见性**，不可迁移的是 Orca 的 relay/PTY 模型。
2. **P0：注册后无法编辑**。OpenCove 只有 `endpoint.register / registerManagedSsh / remove`，**没有任何 update/edit 命令**（`docs/architecture/CONTROL_SURFACE.md:50-56`；全仓搜索 `endpoint.update|endpoint.edit` 无结果）。改一个端口号必须删除重建，而删除会连带丢掉该 endpoint 上的 mount 绑定。Orca 有完整的 `updateTarget`（`src/renderer/src/components/settings/SshPane.tsx:96`、`src/main/ssh/ssh-connection-store.ts:78-86`）。
3. **P0：SSH 断线后不会自动重连，也不会告诉用户**。OpenCove 的隧道子进程退出后只把 record 标成 `error` 并等下一次人工触发（`src/app/main/controlSurface/topology/managedSshEndpointRuntime.ts:306-318`），**没有 backoff 重连**。Orca 有 9 级退避重连状态机（`src/main/ssh/ssh-connection.ts:1210-1251`、`src/main/ssh/ssh-connection-utils.ts:34`）。
4. **P0：状态是纯拉取的，主进程从不推送**。OpenCove 的 overview 只在组件挂载和本地 `window` 事件时 reload（`src/app/renderer/shell/hooks/useEndpointOverviews.ts:156-183`），没有任何 main→renderer 的 SSH/endpoint 状态事件。Orca 有 `ssh:state-changed` 全局广播（`src/preload/index.ts:4188`、`src/renderer/src/hooks/useIpcEvents.ts:2939`）。结果：OpenCove 用户在设置页之外**完全看不到**远程连接是否还活着。
5. **P0：端口校验存在真实缺陷**。`canRegisterManaged` 写的是 `managedPortValue !== 0`（`src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection.tsx:64`），而 `parseOptionalPort` 对非法输入（如 `abc`、`70000`）返回 `null` 而非 `0`（`:24-31`、`:14-22`）。因此**非法端口能通过前端校验**并作为 `null` 提交，被后端当成「未填写」而静默回落到默认端口。用户输入的错误被无声吞掉。
6. **P1：认证能力缺口大**。OpenCove 全仓无 `identityFile / passphrase / ProxyJump / proxyCommand / askpass / BatchMode` 任何处理（全仓 rg 无结果）。Orca 支持 identity file、identity agent、IdentitiesOnly、ProxyCommand、ProxyJump、GSSAPI（`src/shared/ssh-types.ts:20-37`），并有交互式 passphrase/password 对话框与凭据队列（`src/renderer/src/components/settings/SshPassphraseDialog.tsx:17-19`、`:104-110`）。需要 key passphrase 的用户在 OpenCove 里会卡死且无提示。
7. **P1：无 `~/.ssh/config` 导入**。Orca 在打开面板时自动同步 config 并提供显式 Import（`src/renderer/src/components/settings/SshPane.tsx:68-84`、`:280-296`；`src/main/ssh/ssh-connection-store.ts:121-222`）。OpenCove 要求用户手工重复输入已在 config 里的信息。
8. **P1：删除是「静默孤儿化」**。OpenCove 的 remove 直接调用命令，无确认对话框、不告知有多少 mount/project 依赖它（`src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection.tsx:170-190`）。Orca 会先算出受影响 workspace 数量再决定走哪个对话框（`src/renderer/src/components/settings/SshPane.tsx:137-152`、`src/renderer/src/components/sidebar/ssh-host-remove-resolution.ts:22-54`），并用 tombstone 支持「删了再加回来」时重新认领孤儿 workspace（`src/main/ssh/ssh-connection-store.ts:100-107`）。
9. **P2：无连接测试、无高级选项分组、无设置内搜索条目**。Orca 有 Test 按钮（`src/renderer/src/components/settings/SshTargetCard.tsx:330-343`）、可折叠高级分区（`SshTargetAdvancedConnectionSection.tsx:21-30`）与搜索索引（`ssh-search.ts:5-54`）。
10. **OpenCove 有一处明显优于 Orca**：`prepare` 用 `inFlightPrepare` map 做了同 endpoint 并发合流（`managedSshEndpointRuntime.ts:373-376`、`:429-434`），且 token 落盘带 `mode: 0o600`（`src/app/main/controlSurface/topology/topologyStore.ts:100-101`）。这两点应保留，不要在改造中丢失。

---

## 2. Orca 现状拆解

### 2.1 SSH target 数据模型

`SshTarget` 是一个扁平的、带来源标记的持久化结构（`src/shared/ssh-types.ts:9-58`）：

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `id / label / host / port / username` | `ssh-types.ts:10-19` | 基本身份 |
| `configHost` | `ssh-types.ts:16` | OpenSSH 别名，用 `ssh -G` 解析 |
| `identityFile / identityAgent / identitiesOnly` | `ssh-types.ts:21-26` | 密钥认证 |
| `gssapiAuthentication` | `ssh-types.ts:30` | Kerberos，强制走 system ssh |
| `proxyCommand / jumpHost` | `ssh-types.ts:32-34` | 跳板/隧道 |
| `source: 'ssh-config' \| 'manual'` | `ssh-types.ts:41` | **决定 import 是否可覆盖它** |
| `relayGracePeriodSeconds` | `ssh-types.ts:44` | 断开后远程终端存活时长，0=直到 reset |
| `lastRequiredPassphrase` | `ssh-types.ts:49` | 持久化，供启动时**分流** eager/deferred 重连 |
| `portForwards` | `ssh-types.ts:52` | 重连后自动恢复 |
| `owner` | `ssh-types.ts:13` | 内部 runtime 拥有的 target，对用户隐藏 |

关键设计：`source` 字段让「用户手输的」和「从 config 同步的」互不覆盖（`ssh-connection-store.ts:36-38`、`:138-150`）。`RemovedSshTargetTombstone`（`ssh-types.ts:64-76`）记录被删 target 的身份，使重新添加同一主机时能把孤儿 repo 重新指向新 id（`ssh-connection-store.ts:41-49`）。

### 2.2 Settings 配置流（新增/编辑/校验/保存/删除）

- **入口与列表**：`SshPane.tsx:301-341` 渲染 header（Import + Add Target）与 target 卡片列表；空态有专门文案（`:353-360`）。
- **自动同步**：面板打开时自动跑一次 `importConfig()`，失败不阻塞列表加载（`SshPane.tsx:68-84`）。这是「零配置也能看到已有主机」的关键。
- **表单**：`SshTargetForm.tsx:57-140`，主区 4 字段（Label / Host or alias / Username / Port）+ Identity File，其余收进两个可折叠分区（`:129-140`）。
- **智能解析**：Host 输入框 `onBlur` 时调用 `applyParsedSshHostInput`（`SshTargetForm.tsx:78`），支持 `server`、`deploy@server:2222`、`ssh://server`、IPv6 字面量（`ssh-target-draft.ts:69-95`、`:159-196`、`:206-232`）。解析出的 username/port 只在用户没填时才回填（`ssh-target-draft.ts:97-115`）。非法端口**故意保留原文**让用户能看到并修正（`ssh-target-draft.ts:99-103`）。
- **校验**：集中在 `buildSshTargetSavePayload`（`ssh-target-save-payload.ts:20-87`），返回判别联合 `{ok:true,payload} | {ok:false,error}`。三条规则：host 必填（`:22-31`）、port ∈ [1,65535]（`:33-41`）、grace period 合法（`:43-52`）。**校验与 UI 分离，可独立单测**（`ssh-target-save-payload.test.ts` 存在）。
- **保存**：`SshPane.tsx:86-119`。新增走 `addTarget` 并记录 repo 重认领（`:97-99`），编辑走 `updateTarget`（`:95`）。更新时**显式传 undefined 以清除继承自 config 的可选字段**（`ssh-target-save-payload.ts:74-84`）——这是一个容易漏的细节。
- **删除**：三层。① `requestRemoveTarget` 先算受影响 workspace（`SshPane.tsx:137-152`）；有 workspace 就走 workspace-aware 的 `HostRemoveDialog`，否则走普通确认。② 确认对话框由 `SshTargetDestructiveActions` 统一管理，带 per-target in-flight 互斥（`SshTargetDestructiveActions.tsx:43-46`、`:50-63`、`:83-85`）。③ 实际删除是 best-effort：远程清理失败**绝不阻塞本地删除**（`ssh-target-remove.ts:14-37`，注释直接引用了 issue #2626）。

### 2.3 凭据与 passphrase 处理

- 主进程通过 `ssh:credential-request` 事件推送请求，renderer 用队列消费（`src/preload/index.ts:4265`、`SshPassphraseDialog.tsx:17`）。
- 对话框在**渲染期**重置表单而非 useEffect，避免多渲染一帧旧密码（`SshPassphraseDialog.tsx:29-39`，注释明确说明原因）。
- z-index 提到 140/150，确保盖住 popover 与 menu（`SshPassphraseDialog.tsx:113-120`）。
- 取消 = 提交 `value: null`，让主进程能干净地失败而不是挂起（`SshPassphraseDialog.tsx:88`）。
- `lastRequiredPassphrase` 持久化后用于启动时分流，避免对需要交互的 target 做无谓的连接尝试（`ssh-types.ts:45-49`）。

### 2.4 连接与重连状态机

- 8 态：`disconnected / connecting / auth-failed / deploying-relay / connected / reconnecting / reconnection-failed / error`（`ssh-types.ts:96-104`）。
- 退避表 9 级：`[1000,2000,5000,5000,10000,10000,10000,30000,30000]` ms（`ssh-connection-utils.ts:34`）。
- `scheduleReconnect` 有重入保护（`ssh-connection.ts:1211-1213`），超出次数转 `reconnection-failed`（`:1215-1217`）。
- **错误分类决定是否继续重试**：auth 错误直接停（`:1240-1242`），非瞬时错误直接停（`:1244-1246`），只有瞬时错误才递增重试（`:1248-1249`）。这是「保守自动化」的典型体现。
- 连接池层面用 `connectingTargets` Set 防止同一 target 并发连接互相孤儿化（`ssh-connection-manager.ts:12-15`、`:34-38`）。

### 2.5 断连提示与恢复入口

- **终端覆盖层**：`TerminalSshReconnectOverlay.tsx`。按 status 给不同文案（`:39-74`），只在可连状态显示 Connect（`:35-37`、`:89`）。target 已被删除时**不显示 Connect**，改为「移除 workspace」（`:88-89`、`:180-191`）。连接失败后主动 resync target 列表，避免「永远提供一个必然失败的 Connect」（`:117-131`，引用 STA-1468）。
- **spawn 闸门**：`ssh-pane-connect-gate.ts:17-50` 决定 pane 是否必须先连接再 spawn，避免 `pty:spawn` 撞上「No PTY provider」错误（注释在 `:12-16`）。
- **重连后重试**：`ssh-reconnect-pane-retry.ts:10-22` 判定哪些 pane 是「stranded」需要重挂载。

### 2.6 状态可见性

- **Status bar**：`SshStatusSegment.tsx:139-405`。聚合 SSH target 与 runtime host，算出 `connected/partial/disconnected/connecting` 总态（`:31-46`），下拉里**已连接的排前面**（`:337-357`），底部固定「Manage Remote Hosts…」直达设置（`:365-377`）。
- **Sidebar**：`SshTargetRow.tsx:34-59`，带 in-flight 去重的 Connect。
- **Settings 卡片**：`SshTargetCard.tsx:263-282`，状态点 + 文案 + endpoint 摘要 + 错误行。

---

## 3. OpenCove 现状拆解

三态标记：**缺失** / **存在但体验差** / **已对齐**。

### 3.1 数据模型 — 存在但体验差

`WorkerEndpointManagedSshDto` 只有 5 个字段：`host / port / username / remotePort / remotePlatform`（`src/shared/contracts/dto/topology.ts:5-11`）。

- **缺失**：identityFile、passphrase、jumpHost、proxyCommand、config alias、source 标记、tombstone、port forwards。
- **已对齐**：`remotePlatform: 'auto'|'posix'|'windows'` 的跨平台建模（`:3`）比 Orca 的 `SshRemotePlatform`（`ssh-types.ts:106`）更早介入配置阶段，这是 OpenCove 的优点。
- remote port 未指定时随机分配 40000-60999（`src/app/main/controlSurface/topology/managedSshRemotePort.ts:3-15`），设计合理。

### 3.2 Settings 配置流 — 大面积缺失

- **新增**：`EndpointsSection.tsx:33-339` + `EndpointsRegisterDialog.tsx`。有 managed/manual 双模式分段控件（`EndpointsRegisterDialog.tsx:87-105`），managed 模式 4 个字段（`:130-197`）。**已对齐**：推荐路径（managed）作为默认，文案清楚（`zh-CN.settingsPanel.endpoints.ts:22-27`）。
- **编辑：缺失**。无 `endpoint.update` 契约（`docs/architecture/CONTROL_SURFACE.md:50-56`），UI 上也没有任何 Edit 入口（`EndpointsSection.tsx:257-275` 只有 Remove 按钮）。
- **校验：存在但有缺陷**。
  - 前端：`canRegisterManaged = managedHost.trim().length > 0 && managedPortValue !== 0`（`EndpointsSection.tsx:64`）。因为 `parseOptionalPort` 非法时返回 `null`（`:24-31`），`null !== 0` 为真，**非法端口通过校验**，随后作为 `null` 提交（`:147`），后端当作未填写。
  - 后端：`normalizeRegisterManagedSshEndpointPayload` 只在字段存在时才校验端口（`src/app/main/controlSurface/handlers/topologyHandlerPayloads.ts:130-139`），拿到 `null` 不会报错。
  - 结论：用户输入 `abc` 或 `70000`，得到的是一个静默连到 22 端口的 endpoint，且**无法编辑修正**（叠加 3.2 编辑缺失，用户只能删除重来）。
  - 无 host 格式解析（不支持 `user@host:port` 粘贴），无重复 endpoint 检测。
- **保存**：`handleRegister`（`EndpointsSection.tsx:132-176`）。**已对齐**：有 `registerBusy` 防重复提交（`:134`、`:174`）、错误落到 `localError`（`:172`）。
- **删除：存在但体验差**。`handleRemove`（`:178-196`）直接执行，**无确认对话框、无影响面提示、无 tombstone**。对照 DEVELOPMENT.md「Renderer 反馈统一用应用内消息」的要求，这里连应用内确认都没有。

### 3.3 凭据与 passphrase — 完全缺失

全仓 rg `passphrase|askpass|BatchMode|identityFile` 无任何结果。隧道进程以 `stdio: ['ignore','ignore','pipe']` 启动（`managedSshEndpointRuntime.ts:180`），**stdin 被 ignore**，意味着 OpenSSH 无法交互式索要 passphrase；若密钥有密码且 agent 未加载，进程会失败，用户只能从 stderr tail（`:290-292`）里猜原因。

manual 模式的 token 是明文 input（`EndpointsRegisterDialog.tsx:239`用了 `type="password"`，**已对齐**），落盘带 `mode: 0o600`（`topologyStore.ts:100-101`，**已对齐**）。

### 3.4 连接与重连状态机 — 部分缺失

- 状态枚举其实**比 Orca 更细**（`topology.ts:66-75`）：`connected/connecting/disconnected/auth_failed/tunnel_failed/needs_setup/version_mismatch/error`，且额外带 `recommendedAction`（`:77-88`）——**这个「状态→建议动作」的建模优于 Orca**，应保留并强化。
- 内部隧道 record 只有 4 态：`idle/connecting/ready/error`（`managedSshEndpointRuntime.ts:16`）。
- **重连：缺失**。`child.once('exit')` 只写 `status='error'` + `lastError`（`:306-318`），**没有 scheduleReconnect**。已启用 `ServerAliveInterval=15 / ServerAliveCountMax=3`（`:171-173`）能让 ssh 自己发现死连接并退出，但退出后无人接管。
- **已对齐**：`inFlightPrepare` 做了同 endpoint 并发合流（`:373-376`、`:429-434`），等价于 Orca 的 `connectingTargets`；`stopTunnel` 有 SIGTERM→2.5s→SIGKILL 的规范降级（`:238-262`）。

### 3.5 断连提示与恢复入口 — 缺失

无终端覆盖层、无 spawn 闸门、无重连后重试。`RECOVERY_MODEL.md:38-40` 已把「remote endpoint 当前是否可达」归为 runtime observation，但当前没有任何组件消费它来做恢复提示。

### 3.6 状态可见性 — 缺失

`useEndpointOverviews` 只在三处被使用：Settings、AddProjectWizard、ProjectMountManager（`EndpointsSection.tsx:5`、`useAddProjectWizardRemoteEndpoints.ts`、`ProjectMountManagerWindow.tsx`）。

- **无 status bar 等常驻指示**（`src/app/renderer/shell/components` 下无 StatusBar 组件）。
- **无 main→renderer 推送**：reload 只由挂载和 `TOPOLOGY_CHANGED_EVENT / ENDPOINT_OVERVIEWS_CHANGED_EVENT` 两个 **renderer 本地** window 事件触发（`useEndpointOverviews.ts:156-183`）。隧道在后台挂掉，UI 不会有任何变化，直到用户手动点 Refresh。
- **已对齐**：`requestCounterRef` 做了过期响应丢弃（`useEndpointOverviews.ts:70`、`:82-84`、`:88-90`），这是正确的 async gap 处理。

---

## 4. 差距矩阵

| # | 维度 | Orca | OpenCove | 等级 | 用户可感知影响 |
| --- | --- | --- | --- | --- | --- |
| 1 | 编辑已有配置 | `updateTarget` 全字段可改（`SshPane.tsx:95`） | 无 update 契约 | **P0** | 改端口/用户名必须删除重建，连带丢失 mount 绑定 |
| 2 | 断线自动重连 | 9 级退避 + 错误分类（`ssh-connection.ts:1210-1251`） | 无（`managedSshEndpointRuntime.ts:306-318`） | **P0** | 网络抖动/休眠唤醒后远程功能静默失效 |
| 3 | 状态推送 | `ssh:state-changed` 广播（`preload/index.ts:4188`） | 仅本地拉取（`useEndpointOverviews.ts:156-183`） | **P0** | 设置页外看不到连接状态；已断开仍显示旧状态 |
| 4 | 端口校验 | 集中校验 + 明确错误（`ssh-target-save-payload.ts:33-41`） | 判据写错（`EndpointsSection.tsx:64`） | **P0** | 非法端口静默回落默认值，且无法编辑修正 |
| 5 | 删除确认与影响面 | 影响面计算 + 分流对话框（`ssh-host-remove-resolution.ts:22-54`） | 直接删除 | **P0** | 误删导致 mount/project 静默失效，无法撤销 |
| 6 | passphrase / 密钥 | 凭据队列 + 对话框（`SshPassphraseDialog.tsx`） | 无 | P1 | 带密码密钥的用户完全无法使用 |
| 7 | identity file / 跳板 | 6 类字段（`ssh-types.ts:21-34`） | 无 | P1 | 非默认密钥、需跳板的环境不可用 |
| 8 | `~/.ssh/config` 导入 | 自动同步 + 显式 Import（`SshPane.tsx:68-84`） | 无 | P1 | 重复手工录入，易错 |
| 9 | 断连恢复入口 | 终端覆盖层 + spawn 闸门（`TerminalSshReconnectOverlay.tsx`） | 无 | P1 | 断连后终端行为不可解释 |
| 10 | 连接测试 | Test 按钮（`SshTargetCard.tsx:330-343`） | 无（有 `endpoint.ping` 契约但 UI 未接） | P2 | 只能靠真实使用试错 |
| 11 | 高级选项分组 | 可折叠分区（`SshTargetFormCollapsibleSection.tsx`） | 平铺 4 字段 | P2 | 暂无影响（字段少），扩展后会成问题 |
| 12 | 设置内搜索 | 4 条搜索条目（`ssh-search.ts:5-54`） | 未确认 | P2 | 功能发现性弱 |
| 13 | 状态→建议动作 | 无此建模 | `recommendedAction`（`topology.ts:77-88`） | — | **OpenCove 领先，应保留** |
| 14 | 并发合流 | `connectingTargets`（`ssh-connection-manager.ts:15`） | `inFlightPrepare`（`managedSshEndpointRuntime.ts:373`） | — | 已对齐 |
| 15 | 凭据落盘权限 | 未确认 | `mode: 0o600`（`topologyStore.ts:100-101`） | — | **OpenCove 领先，应保留** |

---

## 5. 可迁移原则 vs 不可照搬

按 `REFERENCE_RESEARCH_METHOD.md:Step 3` 的五类信息提炼。

### 参考 A：Orca SSH 配置流（`SshPane.tsx` / `ssh-target-save-payload.ts` / `ssh-target-draft.ts`）

- **承诺**：用户在设置页录入的连接信息，随时可查看、可修改、可删除；非法输入必须在保存前以明确文案拒绝，且原始输入保留可修正。
- **state owner**：`SshConnectionStore`（main）拥有 durable target；renderer 的 `form` 只是 draft，`targets` 只是投影（`SshPane.tsx:24`、`:47-63`）。
- **authority owner**：保存合法性由纯函数 `buildSshTargetSavePayload` 独占判定（`ssh-target-save-payload.ts:20`），UI 不自行判断。
- **invariants**：
  1. 保存成功 ⇒ port ∈ [1,65535] 且 host 非空。
  2. 非法输入 ⇒ 不发 IPC，且 draft 原文不被改写。
  3. `source: 'manual'` 的 target 永不被 config import 覆盖（`ssh-connection-store.ts:141-145`）。
- **fallback / override**：label 留空时自动派生 `username@host`（`ssh-target-save-payload.ts:58`）；config 解析失败不阻塞手工录入。
- **可迁移原则**：① 校验必须是可独立单测的纯函数，与组件解耦；② 「可编辑」是配置类 UI 的基本承诺，不是增强项；③ 非法输入保留原文而非清空。
- **不能直接照搬**：Orca 把校验放在 `components/settings/` 下的同级文件。OpenCove 必须放到 `contexts/*/domain`（纯规则）或 `application`（用例编排），presentation 只做调用 —— 见 `ARCHITECTURE.md:44-76`。

### 参考 B：Orca 重连状态机（`ssh-connection.ts:1210-1251`）

- **承诺**：瞬时网络故障自动恢复，用户无需干预；非瞬时故障立刻停止并明确告知，不做无意义重试。
- **state owner**：`SshConnection` 实例独占 `state.reconnectAttempt`（`ssh-connection.ts:1214`、`:1233`、`:1248`）。
- **authority owner**：错误分类器 `isAuthError / isTransientError` 独占「是否继续重试」的决策权（`:1240-1249`）。
- **invariants**：
  1. 任一时刻同一 target 最多一个 pending reconnect timer（`:1211-1213`）。
  2. auth 类错误永不触发自动重试（`:1240-1242`）。
  3. `disposed` 后不得再写 state（`:1222-1224`、`:1236-1238`）。
- **fallback / override**：耗尽退避 → `reconnection-failed` 终态，交还给用户手动 Connect（`:1215-1217`）。
- **可迁移原则**：① 自动重试必须先分类错误，auth 失败重试是纯粹的伤害；② 必须有终态并把控制权交还用户；③ 退避上限必须有界。
- **不能直接照搬**：Orca 重连的是 `ssh2` 库的 JS 连接对象。OpenCove 重连的是**一个 `spawn` 出来的 ssh 子进程**（`managedSshEndpointRuntime.ts:167-177`），生命周期语义完全不同：需要重新 `reserveLoopbackPort`（端口可能已被占用）、重新探活、并处理「隧道活着但远端 worker 死了」这一 Orca 没有的中间态。不能照搬退避数组了事。

### 参考 C：Orca 删除影响面解析（`ssh-host-remove-resolution.ts:22-54`）

- **承诺**：删除一台主机前，用户先知道会影响多少 workspace，并能选择删除或仅本地遗忘。
- **state owner**：resolution 是**纯派生函数**，不拥有状态（`:22-27` 只接受只读入参）。
- **authority owner**：最终删除动作由用户在对话框中决定，代码不代替用户选择。
- **invariants**：
  1. 未连接的主机默认走「本地遗忘」而非远程删除（`:8-10` 注释）。
  2. 重复行不得虚增计数（`:36-45` 显式 dedupe）。
- **fallback / override**：远程清理失败不阻塞本地删除（`ssh-target-remove.ts:14-37`）。
- **可迁移原则**：① 破坏性操作前必须量化影响面；② 「本地遗忘」与「远程删除」是两种不同意图，必须让用户显式选；③ 清理失败不能让用户卡在删不掉的状态。
- **不能直接照搬**：Orca 的影响面是 repo/worktree，OpenCove 的是 **mount/project/space**（`WORKSPACE_CAPABILITY_ARCHITECTURE.md:8-16`）。必须重新定义解析函数的输入输出，且要尊重 `space.targetMountId` 这条主链路。

### 参考 D：Orca 状态广播（`preload/index.ts:4188`、`useIpcEvents.ts:2939`）

- **承诺**：连接状态变化在所有 UI 表面同时、一致地反映，无需用户手动刷新。
- **state owner**：main 进程的连接对象是唯一真相；renderer store 是订阅得到的投影（`useIpcEvents.ts:2822`）。
- **authority owner**：main 独占状态写权，renderer 只读（`SshPane.tsx:26-28` 注释明确说明「避免重复监听与 per-target 轮询」）。
- **invariants**：
  1. renderer 从不自行推断连接状态。
  2. 同一状态在 status bar / sidebar / settings 三处必然一致。
- **fallback / override**：`ssh.connect` 的返回值可先行写入 store，以防事件晚到（`TerminalSshReconnectOverlay.tsx:101-106`，注释明确）。
- **可迁移原则**：① 跨表面状态必须 push 而非 poll；② 命令返回值与事件广播可能乱序，需显式处理。
- **不能直接照搬**：Orca 用 `ipcRenderer.on` 直连。OpenCove 必须走 Control Surface 的 `Event` 契约（`CONTROL_SURFACE.md:9`、`:20-23`），因为同一套契约还要服务 CLI、Web UI 和 remote worker —— 这是 OpenCove 比 Orca 更强的约束，也是不能抄的根本原因。

### 转译链路总结

```text
行业共识（配置类 UI 必须 CRUD 完整 + 状态可观测 + 破坏性操作可解释）
  -> 可迁移原则（纯函数校验 / 错误分类后再重试 / 量化影响面 / push 状态）
  -> OpenCove 约束（DDD 分层 / Control Surface 单一契约 / Endpoint 而非 SSH 是一等公民 / mount 主链路）
  -> 本地设计（见第 6 节）
```

---

## 6. 建议改造方案

### P0 —— 用户每天都会撞到的问题

只放四项：**可编辑**、**自动重连**、**状态推送**、**删除确认 + 端口校验修正**。

#### P0-1 Endpoint 可编辑

改动点：

| 层 | 文件/模块 | 改动 |
| --- | --- | --- |
| contract | `src/shared/contracts/dto/topology.ts` | 新增 `UpdateManagedSshWorkerEndpointInput/Result` |
| contract doc | `docs/architecture/CONTROL_SURFACE.md:50-56` | 登记 `endpoint.updateManagedSsh`（**触发架构契约 Gate，需同步 `harness/architecture/`**） |
| main-ipc | `topologyHandlerPayloads.ts` | 新增 `normalizeUpdateManagedSshEndpointPayload` |
| main-ipc | `topologyHandlers.ts:57-62` 邻位 | 注册 command |
| store | `topologyStore.ts` | 新增 `updateManagedSshEndpoint`，保持 `endpointId` 与 `credentialRef` 不变 |
| runtime | `managedSshEndpointRuntime.ts` | 连接参数变更时必须 `stopTunnel` 并重建 |
| presentation | `EndpointsSection.tsx` / `EndpointsRegisterDialog.tsx` | 复用同一 dialog，新增 `mode: 'create'\|'edit'` |
| i18n | `zh-CN.settingsPanel.endpoints.ts` + `en.*` | 新增编辑相关文案 |

状态所有权表：

| state | owner | write entry | restart source of truth |
| --- | --- | --- | --- |
| endpoint 连接配置 | topology store (main) | `endpoint.registerManagedSsh` / `endpoint.updateManagedSsh` | `topology.json` |
| endpoint token | topology store (main) | 仅 register 时写入 | `worker-endpoint-secrets.json` |
| 编辑草稿 | renderer 组件 local state | 表单 onChange | 不持久化，重启即弃 |
| 隧道 record | `managedSshEndpointRuntime` (main) | `prepare` / `disposeEndpoint` | 无（纯 runtime，重启后重建） |

invariants：
1. `endpointId` 与 `credentialRef` 在 update 中永不变更 —— 否则已有 mount 绑定断裂。
2. 连接参数（host/port/username/remotePort）变更 ⇒ 现有隧道必须先 stop 再按新参数重建，不得复用旧 tunnel。
3. update 失败 ⇒ durable 配置保持改动前状态（先校验后写盘）。

IPC/持久化/迁移：新增 command 属于**新增契约而非破坏性变更**，旧 `topology.json` 无需迁移。但必须补「旧数据 + 新 update」的回归测试（`DEVELOPMENT.md` 兼容与迁移要求）。

跨平台：无差异（纯数据操作）。

#### P0-2 隧道自动重连

改动点：`managedSshEndpointRuntime.ts` 的 `child.once('exit')` 回调（`:306-318`）引入受控重连；建议新建 `managedSshTunnelReconnect.ts` 承载**纯策略**（退避表 + 错误分类），runtime 只做编排 —— 对应 `DEVELOPMENT.md`「先分离决策与编排」。

状态所有权表：

| state | owner | write entry | restart source of truth |
| --- | --- | --- | --- |
| `reconnectAttempt` | tunnel record (main) | 仅重连调度器 | 无（重启归零） |
| `status: idle/connecting/ready/error` | tunnel record (main) | `ensureTunnel` / exit handler | 无 |
| 重连定时器 | runtime | 调度器 | 无，进程退出即清 |

invariants：
1. 同一 endpoint 任一时刻最多一个 pending 重连定时器。
2. 认证类失败（stderr 命中 `Permission denied` / `Host key verification failed`）**不自动重试**，直接终态 `auth_failed` 并交还用户。
3. `disposeEndpoint` / `dispose` 之后不得再产生任何重连尝试或状态写入。
4. 退避有界；耗尽后进入终态，等待用户显式 `repair_tunnel`。

风险要点：重连必须重新 `reserveLoopbackPort`（旧端口可能已被占用），因此**重连会改变 `localPort`**，所有持有旧 connection 的调用方必须通过 `resolveConnection` 重新获取，不得缓存。

跨平台：`stopTunnel` 现用 `SIGTERM`/`SIGKILL`（`:246`、`:258`）。**Windows 上 Node 的 `kill(SIGTERM)` 实际是强制终止**，语义不同但结果可接受；需在 Windows 上单独验证隧道进程不会残留。

#### P0-3 状态推送（endpoint health event）

改动点：新增 Control Surface **Event** `endpoint.health.changed`（`CONTROL_SURFACE.md:9` 已定义 Event 类型）。runtime 状态迁移时发事件；`useEndpointOverviews.ts:167-183` 改为订阅该事件而非仅监听本地 window 事件。

状态所有权表：

| state | owner | write entry | restart source of truth |
| --- | --- | --- | --- |
| endpoint health（runtime observation） | `endpointHealthService` (main) | runtime 状态迁移 | 无，重启后重新探测 |
| renderer overview 投影 | `useEndpointOverviews` | 事件订阅 + reload | 不持久化 |

invariants：
1. renderer 不自行推断 health，只消费 main 的投影（呼应 `RECOVERY_MODEL.md:14-19` 的 runtime observation 分类）。
2. 事件丢失不导致永久错误状态 —— 保留手动 Refresh 作为兜底。
3. 事件携带单调递增序号，renderer 丢弃过期事件（复用 `requestCounterRef` 思路）。

**建议本档只做「设置页内实时」**。常驻 status bar 归入 P1，因为 OpenCove 当前没有 status bar 组件，新建属于新增 UI 表面，不符合「P0 只放每天都撞到的问题」。

#### P0-4 端口校验修正 + 删除确认

两项都小但高频：

- 校验：把 `EndpointsSection.tsx:14-31` 的解析与 `:64` 的判据下沉为 `contexts/settings/domain` 下的纯函数，返回 `{ok,value} | {ok:false,reason}` 三态（**空 / 合法 / 非法**），修正 `null` 与 `0` 混淆。invariant：*非法端口文本永不产生成功注册*。
- 删除：复用现有 `cove-window` 对话框样式（`EndpointsRegisterDialog.tsx:66-78`），显示「此 endpoint 上有 N 个 mount」。影响面解析写成纯函数放 `contexts/*/domain`，输入 mounts/projects 只读快照。invariant：*删除确认展示的 mount 数量与实际解绑数量一致*。

> 注：`DEVELOPMENT.md` 明令 renderer 禁止 `window.confirm`，因此必须用应用内对话框。

### P1

1. **凭据与密钥支持**：新增 `identityFile`，并解决 stdin 被 ignore 的问题（`managedSshEndpointRuntime.ts:180`）。建议走 `SSH_ASKPASS` + 应用内对话框，而非直接开放 stdin —— 更可控且跨平台一致。需新增 Event（凭据请求）+ Command（凭据提交）契约。
2. **`~/.ssh/config` 导入**：参考 `ssh-connection-store.ts:121-222` 的 source 分流思路，但 OpenCove 需新增 `source` 字段，属 schema 变更，要迁移策略。
3. **断连恢复入口**：在依赖远程 endpoint 的终端/文件表面加覆盖层，参考 `TerminalSshReconnectOverlay.tsx` 的「不提供必然失败的按钮」原则。
4. **常驻状态指示**：新建 status bar 段位。

### P2

1. Test connection 按钮（`endpoint.ping` 契约已存在，`CONTROL_SURFACE.md:57`，只差 UI）。
2. 高级选项折叠分区（字段增多后再做）。
3. 设置内搜索条目。
4. jumpHost / proxyCommand。

---

## 7. 风险清单

按 `DEVELOPMENT.md`「关键稳定性检查」逐条。

| 检查项 | 本方案风险 | 缓解 |
| --- | --- | --- |
| **Async Gap** | 重连定时器在 `dispose` 后触发，写已删除 record；update 的 await 期间窗口关闭 | invariant 3（dispose 后禁写）+ 显式 `disposed` 标志；沿用 `requestCounterRef`（`useEndpointOverviews.ts:70`）模式丢弃过期响应 |
| **Concurrency** | update 与 prepare 并发导致隧道用旧参数重建；重连与手动 repair 双重调度 | 复用 `inFlightPrepare`（`managedSshEndpointRuntime.ts:373`）并扩展为 per-endpoint 操作互斥；重连定时器单例 invariant |
| **State Ownership** | health 同时被 runtime 观测和 UI 事件改写，形成两个写入口 | main 独占 health 写权，renderer 只读投影；对应 `RECOVERY_MODEL.md:16-19` |
| **Restart Semantics** | 把「隧道断了」误当成「endpoint 配置无效」而写坏 durable 配置 | 严格分离：tunnel record 是 runtime observation，绝不回写 `topology.json`（`RECOVERY_MODEL.md` invariant 2） |
| **IPC Security** | 新增 update/凭据 command 的 payload 未校验 | 所有新 command 必须有 `normalize*Payload`，与 `topologyHandlers.ts:52`、`:59` 同构；凭据 command 需防重放（一次性 requestId） |
| **Resource Lifecycle** | 重连循环泄漏子进程；stderr listener 未清理 | 每次重建前必须 `stopTunnel`；沿用 `trimStderrLines`（`:88-90`）限制内存；Windows 上验证无残留进程 |
| **Performance** | 事件风暴（隧道翻动时高频发事件）导致 renderer 重渲染 | 状态迁移去重（相同 status 不重复发）+ 必要时合并窗口 |
| **Data Integrity** | update 部分写入导致配置半损；新增 `source`/`identityFile` 字段破坏旧文件读取 | 先校验后整体写盘；新字段全部 optional，补「旧 topology.json 缺字段」回归测试 |

额外风险（非清单内但重要）：

- **P0-2 的 `localPort` 变化**是最容易被忽略的破坏性副作用。任何缓存了 connection 的调用方都会在重连后指向死端口。必须审计 `resolveConnection`（`managedSshEndpointRuntime.ts:314-330`）的所有调用方。
- **P0-1 触发架构契约 Gate**：改 `CONTROL_SURFACE.md` 必须同步 `harness/architecture/`，并跑 `pnpm arch:doc-sync`（`DEVELOPMENT.md` 架构契约变更 Gate 段）。

---

## 8. 验证计划

### Unit（纯逻辑与不变量）

1. 端口解析三态：`''`→空、`'22'`→合法、`'abc'`/`'0'`/`'70000'`/`'2 2'`→非法。**直接覆盖第 3.2 节发现的缺陷。**
2. 重连策略纯函数：退避序列单调有界；`Permission denied` / `Host key verification failed` 分类为不可重试；超时/`Connection refused` 分类为可重试；耗尽后返回终态。
3. 删除影响面解析：0 mount、N mount、重复行 dedupe（对照 `ssh-host-remove-resolution.ts:36-45`）。
4. update payload normalize：非法 port 拒绝；缺字段拒绝；`endpointId` 不可变。

### Contract（IPC 边界）

5. `endpoint.updateManagedSsh`：合法 payload 成功；非法 payload 返回稳定 `AppErrorDescriptor`（`CONTROL_SURFACE.md:13`）；不存在的 endpointId 返回明确错误。
6. `endpoint.health.changed` 事件 payload 可序列化，且序号单调。
7. 现有 `endpoint.registerManagedSsh` 的非法端口回归：确保修正后**拒绝**而非静默回落。

### Integration（owner / 生命周期 / 持久化）

8. update 后隧道以新参数重建，旧子进程确实退出，`localPort` 已更新。
9. 隧道进程被外部 kill → 自动重连 → 恢复 `ready`；期间 status 迁移序列符合预期。
10. 认证失败 → **不重试** → 终态 `auth_failed`，且无残留定时器。
11. `disposeEndpoint` 在重连 pending 期间调用 → 无后续状态写入、无残留进程。
12. 旧 `topology.json`（缺新字段）能正常读取并支持 update。

### E2E（Playwright，用户可感知变化 —— 按 `DEVELOPMENT.md` 强制要求）

以下均属用户可感知变化，**必须跑 Playwright**：

13. **编辑流**：注册 → 列表出现 Edit → 改端口 → 保存 → 列表显示新端口。截图：编辑前列表、编辑对话框、保存后列表。
14. **非法端口被拒**：输入 `abc` → 提交按钮禁用或出现明确错误文案。截图：错误态。**这是当前缺陷的直接回归证据。**
15. **删除确认**：点击 Remove → 出现确认对话框并显示受影响 mount 数 → 取消后 endpoint 仍在 → 确认后消失。截图：确认对话框。
16. **状态实时更新**：隧道断开后设置页无需手动 Refresh 即反映 `tunnel_failed`。截图：断开前后对比。
17. 现有 `tests/e2e/m6.endpoints-mounts.managed-ssh.integration.spec.ts:43` 的主链路不回归。

主题验收：所有新增 UI 需在 Light/Dark 下各出一张截图，颜色走 `--cove-*` token（`docs/ui/README.md:2.2`）。

E2E 可复用现有 `tests/e2e/fake-managed-ssh.ts` 作为可控远端。

---

## 9. 建议的实施切分

| 步骤 | 内容 | 依赖 | 验收标准 |
| --- | --- | --- | --- |
| **S1** | 端口校验下沉为 domain 纯函数并修正三态判据 | 无 | Unit 1 通过；E2E 14 通过；非法端口无法注册 |
| **S2** | 删除确认对话框 + 影响面解析纯函数 | 无（可与 S1 并行） | Unit 3 通过；E2E 15 通过；截图含 Light/Dark |
| **S3** | `endpoint.updateManagedSsh` 契约 + store + handler | S1（复用校验函数） | Contract 5、7 通过；Integration 8、12 通过；`pnpm arch:doc-sync` 通过 |
| **S4** | 编辑 UI（复用 register dialog，加 mode） | S3 | E2E 13 通过；截图含编辑前后 |
| **S5** | 隧道重连策略（纯函数）+ runtime 编排接入 | 无（可与 S1-S4 并行，但建议在 S3 后合入以免冲突） | Unit 2 通过；Integration 9、10、11 通过；Windows 上验证无残留进程 |
| **S6** | `endpoint.health.changed` 事件 + renderer 订阅 | S5（有状态迁移可推送才有意义） | Contract 6 通过；E2E 16 通过 |

依赖顺序：`S1 → S3 → S4`，`S2` 独立，`S5 → S6`。建议交付顺序 `S1, S2 → S3, S4 → S5, S6`，每步独立可验证、可单独提 PR。

每步完成后按 `DEVELOPMENT.md` 提交前检查：`git add` → `pnpm line-check:staged` → `pnpm pre-commit`；用户可感知变化的步骤（S1/S2/S4/S6）需更新 `CHANGELOG.md` 的 `[Unreleased]` 并附 PR 编号。

---

## 10. 开放问题（需用户拍板）

1. **SSH 认证能力的目标边界？**
   - A. 仅依赖 ssh-agent 与无密码密钥（现状），P1 只补 `identityFile`。
   - B. 完整支持 passphrase 交互（需新增凭据 Event/Command 契约 + `SSH_ASKPASS` 方案）。
   - **推荐 B**，但排在 P0 之后。理由：带密码密钥在企业环境是常态，当前是「静默失败且无提示」，属于能力缺口而非体验缺口；但它每天撞到的用户比例低于「无法编辑」，故不入 P0。

2. **是否引入 `~/.ssh/config` 导入？**
   - A. 不做，保持手工录入。
   - B. 做只读导入（一次性复制，不持续同步）。
   - C. 做持续同步（Orca 方案，需 `source` 字段 + tombstone + schema 迁移）。
   - **推荐 B**。C 的复杂度（`ssh-connection-store.ts:121-222` 近百行仅处理同步冲突）与 OpenCove 当前 endpoint 数量级不匹配，且引入 schema 迁移风险。B 能拿走 80% 的录入收益。

3. **重连的可见性边界：静默重连还是显式告知？**
   - A. 静默重连，仅失败后提示。
   - B. 重连期间即显示 `connecting` 并展示尝试次数。
   - **推荐 B**。呼应 `REFERENCE_RESEARCH_METHOD.md:Step 5`「保守 + 可解释」；Orca 也在 status bar 显式暴露 `reconnecting`（`SshStatusSegment.tsx:24-26`）。

4. **是否在本轮新建常驻 status bar？**
   - A. 不建，P0 只做设置页内实时（本报告建议）。
   - B. 一并新建。
   - **推荐 A**。新建常驻 UI 表面是独立的设计决策，涉及 `docs/ui/WINDOW_UI_STANDARD.md` 的布局约定，不应与 SSH 改造耦合。

5. **`localPort` 在重连后变化，是否需要对调用方提供稳定端口？**
   - A. 接受端口变化，要求所有调用方通过 `resolveConnection` 实时获取（改动小，但需审计全部调用方）。
   - B. 引入本地固定端口代理层（改动大，语义更稳）。
   - **推荐 A**，并在 S5 中把「调用方审计」列为显式交付项。B 属于过度工程。

---

## 附录：证据索引

Orca 关键文件（`/Users/shihaojie/Development/orca`）：

- `src/shared/ssh-types.ts:9-58` — SshTarget 模型；`:64-76` tombstone；`:96-104` 状态枚举
- `src/renderer/src/components/settings/SshPane.tsx:68-84` 自动 config 同步；`:86-119` 保存；`:137-152` 删除分流
- `src/renderer/src/components/settings/ssh-target-save-payload.ts:20-87` — 集中校验
- `src/renderer/src/components/settings/ssh-target-draft.ts:69-115` — host 智能解析
- `src/renderer/src/components/settings/ssh-target-remove.ts:14-37` — best-effort 删除
- `src/renderer/src/components/settings/SshTargetDestructiveActions.tsx:43-96` — 破坏性动作互斥
- `src/renderer/src/components/settings/SshPassphraseDialog.tsx:29-39` — 渲染期重置
- `src/main/ssh/ssh-connection.ts:1210-1251` — 重连状态机
- `src/main/ssh/ssh-connection-utils.ts:34` — 退避表
- `src/main/ssh/ssh-connection-manager.ts:12-15,34-38` — 并发保护
- `src/main/ssh/ssh-connection-store.ts:78-108,121-222` — update / remove / config 同步
- `src/renderer/src/components/status-bar/SshStatusSegment.tsx:31-46,337-377` — 聚合状态
- `src/renderer/src/components/terminal-pane/TerminalSshReconnectOverlay.tsx:35-74,117-131` — 恢复覆盖层
- `src/renderer/src/components/sidebar/ssh-host-remove-resolution.ts:22-54` — 影响面解析
- `src/preload/index.ts:4188,4265` — 状态与凭据事件

OpenCove 关键文件（本仓）：

- `src/shared/contracts/dto/topology.ts:2-16,66-88` — endpoint 与 health 模型
- `src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection.tsx:14-31,64,132-196` — 校验缺陷与注册/删除
- `src/contexts/settings/presentation/renderer/settingsPanel/EndpointsRegisterDialog.tsx:130-197` — managed 表单
- `src/app/main/controlSurface/topology/managedSshEndpointRuntime.ts:167-181,238-262,306-318,373-376` — 隧道生命周期与缺失的重连
- `src/app/main/controlSurface/topology/managedSshRemotePort.ts:3-15` — 端口分配
- `src/app/main/controlSurface/topology/endpointHealthService.ts:218-283` — health 派生
- `src/app/main/controlSurface/topology/topologyStore.ts:100-101` — 0600 落盘
- `src/app/main/controlSurface/handlers/topologyHandlers.ts:50-93` — 契约注册（无 update）
- `src/app/renderer/shell/hooks/useEndpointOverviews.ts:70,156-183` — 拉取式状态
- `docs/architecture/CONTROL_SURFACE.md:50-56` — 现有 endpoint 契约清单

## Phase 2（S1-S4）实现前校验记录

本节在编码前把 Phase-1 建议与当前源码重新对齐。Phase-2 已确认的产品选项构成方案审批；本批次不引入新技术，因此无需额外 feasibility PoC。

| 步骤 | state | owner | write entry | restart source of truth |
| --- | --- | --- | --- | --- |
| S1 | SSH/remote worker 端口草稿 | renderer 组件 | 表单 `onChange` | 无 |
| S1 | 端口合法性 | topology domain 纯规则 | `parseOptionalManagedSshPort` | 由输入重新计算 |
| S2 | endpoint/mount 绑定 | topology store | `mount.create/remove`、`endpoint.remove` | `worker-topology.json` |
| S2 | 删除影响数 | topology domain 纯派生 | 只读 mount snapshot | 由 topology snapshot 重新计算 |
| S3 | managed SSH durable 配置 | topology store | `endpoint.registerManagedSsh/updateManagedSsh` | `worker-topology.json` |
| S3 | endpoint token / credentialRef | topology store | 仅 register 创建；update 只读 | `worker-endpoint-secrets.json` |
| S3 | tunnel record/localPort | managed SSH runtime | `prepare/resolve/dispose` | 无，按 durable 配置重建 |
| S4 | create/edit 草稿与 dialog mode | renderer 组件 | 用户输入、打开/关闭 dialog | 无 |

实现不变量：

1. S1：`invalid` 端口文本不得触发成功注册或更新，且原始文本保留供用户修改。
2. S2：确认框展示的 mount 数量必须由和删除动作相同的纯影响解析规则计算；snapshot 已变化时 fail closed。
3. S3/S4：update 保持 `endpointId`、`credentialRef` 与 mount 绑定不变；连接参数变化不得复用旧 tunnel；验证或持久化失败不得改变 durable 配置。

风险检查：UI 草稿只属于 renderer；IPC payload 在 main 边界全量校验；topology store 是唯一 durable writer；runtime signature 防止 update 与 prepare/resolve 的异步交错复用旧 tunnel；token 文件继续保持 `0o600`；`recommendedAction`、`requestCounterRef` 与同配置 `inFlightPrepare` 合流语义保持不变。

未确认项：

- Orca 的 `SshDisconnectedDialog.tsx` 在任务描述中被提及，但当前 Orca 代码库中**不存在该文件**（`find src -name "SshDisconnectedDialog.tsx"` 无结果）；同目录存在 `ForgetSshWorkspaceDialog.tsx`。可能已重命名或移除。
- OpenCove 是否有设置页搜索索引机制覆盖 endpoints — 未确认。
- Orca 凭据落盘的权限模式 — 未确认。
