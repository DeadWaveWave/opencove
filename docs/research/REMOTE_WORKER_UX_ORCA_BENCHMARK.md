# 远程 Worker 设置体验对标报告（IA / UX 视角，OpenCove vs Orca）

- 状态：研究报告（Phase 1，**只读**，零 `src/` 改动）
- 触发：用户对现状 Settings > 远程 Worker / Endpoints 的判断是「看起来似乎还有点乱」
- 本报告的问题域：**信息架构（IA）与生命周期表达**，不是配色与间距
- 参考实现：Orca `/Users/shihaojie/Development/orca`（只读，repo id `c9c0a6a8-b949-4b26-b377-d1f38737f1ee`）
- 前置研究：`docs/research/SSH_EXPERIENCE_ORCA_BENCHMARK.md`（batch A/B，功能缺口视角）。本报告**不重复**其结论，只在必要处引用。

## 证据基线（重要，先读这一段）

PR #317 已落在 `DeadWaveWave/ssh-experience`，**尚未合入 `main`**（`main` HEAD 为 `72b7b244`，未含 #317）。本报告一律对**含 #317 的 `ssh-experience` 分支**取证。

因此行号引用分两类，请勿混淆：

| 标记 | 含义 | 取证方式 |
| --- | --- | --- |
| `文件:行` (branch) | 该文件在 #317 中被改过，行号取自 `ssh-experience` | `git show origin/DeadWaveWave/ssh-experience:<path>` |
| `文件:行` | 该文件 #317 未改动，`main` 与分支一致 | 直接读工作区 |

`git diff --stat main...origin/DeadWaveWave/ssh-experience` 显示 `src/app/renderer/shell/` **完全未被 #317 触及**，故 `RemoteEndpointStatusPanel.tsx`、`useEndpointOverviews.ts`、`endpointOverviewUi.ts`、`ProjectMountManagerRemoteSection.tsx` 的行号直接取自工作区。

**#317 已经修好的，本报告不再提**：endpoint 可编辑（`EndpointsSection.tsx:87-107` (branch) 的 `openEditWindow`）、删除确认对话框（`EndpointRemoveDialog.tsx:1-63` (branch)）、端口三态校验（`src/contexts/topology/domain/managedSshPort.ts` (branch) + `EndpointsSection.tsx:60-64` (branch)）、删除影响面 fail-closed（`topologyStore.ts:211-218` (branch)）。这些是真实进步，下文只在它们**产生新的 IA 副作用**时才提及。

---

## 0. TL;DR

**三个最严重的问题**（全部是 IA/语义问题，不是样式问题）：

1. **生命周期被压成一个布尔量。** 远程接入实际有 6 个内部阶段（`managedSshEndpointRuntime.ts:301-341` (branch)），但对外只暴露 4 态 `TunnelStatus`（`:13` (branch)），UI 最终只看到 1 个终态。用户点「连接」后最长可等 **~127.5 秒**（隧道 7.5s + bootstrap 120s，见 §4.1）而界面无任何阶段反馈，失败时只得到一句话。用户报的「runtime 损坏但 UI 只说打不开」，根因就在这里，且**recommendedAction 会给出错误的修复建议**（§4.3）。
2. **术语四套并存，且导航指向的名字在目标页面不存在。** 同一对象在导航叫「远程 Worker」（`zh-CN.settingsPanel.layout.ts:8`）、在页面标题叫「远程端点」（`zh-CN.settingsPanel.endpoints.ts:2`）、在英文 UI 叫 `Endpoints`（`en.settingsPanel.endpoints.ts:2`）、在空态引导里叫 `remote worker` 并让用户去一个**不存在的入口**「Settings → Endpoints」（`en.shell.ts:74`）。中文侧还有「手动 endpoint」这种中英混排（`zh-CN.commonRemoteEndpoints.ts:4`）。
3. **一张卡片上有 4 个动作、跨 2 个组件、无明确默认动作；而「连接成功」这条主路径上反而没有任何动作。** 主行动按钮在 `RemoteEndpointStatusPanel.tsx:125-135`，Edit/Remove 在 `EndpointsSection.tsx:321-345` (branch)，二者是不同组件渲染的两排按钮。`connected` 时推荐动作被显式抑制（`RemoteEndpointStatusPanel.tsx:64-67`），于是**健康端点只剩「重连 / 编辑 / 移除」三个破坏性动作**。

**单点最高价值改动**：把 `prepare` 的隐式阶段显式化为**契约级的分阶段进度 + 每阶段失败原因 + 每阶段推荐动作**（§4、§5.2）。它同时解决 #1 与用户报的真实故障，且顺带让 §4.3 的错误建议消失。

**总体工作量形状**：约 **7 个可独立发布的步骤**，其中 3 个是纯 presentation（可立即做，零契约风险），2 个需要新增 Control Surface Event/字段，2 个是纯 i18n/文案。最大的一块（分阶段进度）需要新增 1 个 Event 契约 + 1 个 domain 纯函数，是本报告唯一的「大」改动。

---

## 1. 到底哪里「乱」？——逐条取证

我把「乱」拆成 5 个可证伪的 IA 缺陷，并显式区分**真 IA 问题**与**纯样式**。

### 1.1【真 IA 问题】开关与它控制的列表被拆进两个平级 group

`WorkerConnectionsSection.tsx` 依次渲染 4 个平级块：

| 顺序 | 块 | 代码 | 标题（zh） |
| --- | --- | --- | --- |
| 1 | Worker 运行 | `WorkerConnectionsSection.tsx:19` | 「Worker 运行」`zh-CN.settingsPanel.layout.ts:75` |
| 2 | 远程连接（**只有一个开关**） | `:21-46` | 「远程连接」`zh-CN.settingsPanel.layout.ts:76` |
| 3 | 远程端点（**列表**） | `:48-49` | 「远程端点」`zh-CN.settingsPanel.endpoints.ts:2` |
| 4 | 浏览器访问 | `:68` | 「浏览器访问」`zh-CN.settingsPanel.layout.ts:77` |

问题：块 2 里唯一的内容是 `remoteWorkersEnabled` 开关（`WorkerConnectionsSection.tsx:33-42`），而这个开关**唯一的作用**就是决定块 3 渲染列表还是渲染占位（`:48-50`）。开关与其后果被一条 group 边界隔开，用户要在两个视觉容器之间建立因果关系。

这是标准的「控件与其作用域分离」反模式——开关应当是列表容器的属性，而不是列表的兄弟节点。

### 1.2【真 IA 问题】同一屏出现两级标题，中文下文案完全相同

`EndpointsSection.tsx:233` (branch) 渲染 `SettingsGroup title={t('settingsPanel.endpoints.title')}`，紧接着 `:249-252` (branch) 渲染 `SettingsModule title={t('settingsPanel.endpoints.list.title')}`。

`SettingsGroup` 输出 `<h3>`（`SettingsGroup.tsx:32-34`），`SettingsModule` 输出 `<h4>`（`SettingsGroup.tsx:85-87`），二者之间除了 error 区（`EndpointsSection.tsx:234-248` (branch)，通常不渲染）没有任何内容。

中文下两个 key 的值**逐字相同**：

- `settingsPanel.endpoints.title` = `'远程端点'`（`zh-CN.settingsPanel.endpoints.ts:2`）
- `settingsPanel.endpoints.list.title` = `'远程端点'`（`zh-CN.settingsPanel.endpoints.ts:4`）

即中文用户会看到 **h3「远程端点」紧跟 h4「远程端点」**。英文侧稍好（`Endpoints` / `Remote endpoints`，`en.settingsPanel.endpoints.ts:2`、`:4`），但仍是冗余嵌套。

这不是样式问题——这是层级结构本身多了一层，屏幕阅读器也会读出两遍。

### 1.3【真 IA 问题】一张卡片 4 个动作，跨 2 个组件，无默认动作

单张 endpoint 卡片的动作来自两处：

**第一排**（`RemoteEndpointStatusPanel.tsx:123-149`）：
- 推荐动作按钮，`--primary`（`:128`）
- 「重连」按钮，`--ghost`（`:139`），条件是 `overview.isManaged`（`:136`）

**第二排**（`EndpointsSection.tsx:321-345` (branch)）：
- 「编辑」按钮，`.secondary`（`:326` (branch)）
- 「移除」按钮，`.secondary`（`:336` (branch)）

于是一张 managed 卡片在 `disconnected` 时同时呈现：**连接 / 重连 / 编辑 / 移除**。其中「连接」与「重连」在语义上高度重叠——两者都进 `prepareEndpoint`，只是 `reason` 不同（`EndpointsSection.tsx:119-124` (branch) vs `:141-146` (branch)），底层区别仅是 `restartTunnel`（`endpointHealthService.ts:350` (branch)）。**用户没有任何线索判断该点哪个。**

更严重的是**成功路径上没有动作**：`connected` 时 `recommendedAction` 是 `browse`（`endpointHealthService.ts:167-168` (branch) 的 `case 'connected': return 'browse'`），但 `RemoteEndpointStatusPanel.tsx:64-67` 显式抑制了 `browse` 与 `show_details`：

```ts
const showRecommendedAction =
  recommendedAction !== null &&
  overview.recommendedAction !== 'browse' &&
  overview.recommendedAction !== 'show_details'
```

在设置页里抑制 `browse` 本身合理（浏览属于挂载流程），但结果是**一个健康的、刚配好的 endpoint，界面上只剩「重连」「编辑」「移除」——三个都是打断或破坏性动作**。用户配好之后，界面不告诉他下一步该去哪。这是最典型的「IA 断头路」。

### 1.4【真 IA 问题】状态是拉取的，且「刷新」被摆成了常驻主控件

工具栏（`EndpointsSection.tsx:254-283` (branch)）左侧是「数量: N」+ 一句推荐提示，右侧是「刷新」+「添加远程端点」。

「刷新」之所以必须常驻，是因为状态不会自己更新——`useEndpointOverviews` 只在挂载与两个 **renderer 本地** window 事件时 reload（`useEndpointOverviews.ts:176-177`），没有 main→renderer 推送。这一点前置研究已定性（`SSH_EXPERIENCE_ORCA_BENCHMARK.md` §3.6），此处只补充 **IA 后果**：一个本应由系统维护的状态，把维护成本转嫁成了用户必须常按的按钮，并且它占据了与「添加」同级的视觉位置。

另外「数量: N」（`:257` (branch)）是低信息量元数据——用户能直接数出卡片数。真正该出现在这个位置的是**聚合健康度**（几个已连接 / 几个异常），Orca 正是这么做的（§2.4）。

### 1.5【真 IA 问题 + 真缺陷】表单弹窗点背景即丢弃，且无脏数据保护

`EndpointsRegisterDialog.tsx:82-84` (branch)：

```tsx
<div className="cove-window-backdrop" data-testid="..." onClick={onCancel}>
```

`onCancel` 即 `closeRegisterWindow`（`EndpointsSection.tsx:109-117` (branch)），它无条件 `resetRegisterForm()`。一个填了 4 个字段的表单，误点背景就全部丢失，且**没有任何确认**。

Orca 对同一问题有显式防护（`SshTargetForm.tsx:93-100`）：

```ts
const preventOutsideDismiss = (event: Event): void => {
  // Why: outside click is easy to hit by accident with a long multi-field form;
  // keep Escape / Cancel / × as explicit discard paths.
  if (isSshTargetFormDirty(formRef.current, baselineRef.current)) {
    event.preventDefault()
  }
}
```

`EndpointRemoveDialog.tsx:21-23` (branch) 同样点背景关闭。该对话框 `role="alertdialog"`（`:27` (branch)）——按 WAI-ARIA，alertdialog 不应可被随意 dismiss。不过此处 dismiss 等于「取消删除」，属于安全方向，**严重度低于注册表单**。

### 1.6【真缺陷，且违反 #317 自己写下的契约】repair 成功后 `dependentMountCount` 静默归零

这是本次审查中发现的**唯一一个功能性回归风险**，且它就在 #317 的作用域边缘。

`CONTROL_SURFACE.md:120-122` (branch) 明确要求：

> Interactive `endpoint.remove` callers must send the `expectedMountCount` from the overview they presented so a concurrent binding change fails closed.

`endpointHealthService.ts` 的 `repairEndpoint` 在**成功分支**构造 overview 时（`:409-416` (branch)）**漏传了 `dependentMountCount`**：

```ts
overview: buildOverview(access.endpoint, {
  status: probed.status,
  details: probed.details,
  runtime: probed.runtime,
  recommendedAction: recommendedActionForAccessStatus(access, probed.status),
  canBrowse: probed.status === 'connected',
  // ← 没有 dependentMountCount
}),
```

`buildOverview` 对该字段的兜底是 `?? 0`（`:67` (branch)）。对比同文件的 `prepareEndpoint` 成功分支（`:362` (branch)）与 repair 的失败分支（`:428` (branch)），**都正确传了** `impact.mountCount`——所以这是遗漏，不是设计。

后果链：

1. 用户对一个挂了 3 个 mount 的 endpoint 点「重连隧道 / 安装 runtime」等 repair 动作并成功；
2. `applyOverview` 用返回值**整体替换**列表中的该条目（`useEndpointOverviews.ts:59-61` + `replaceOverview` `:17-36`）；
3. 此时内存中 `dependentMountCount === 0`；
4. 用户接着点「移除」，`EndpointRemoveDialog` 显示 **「此操作会解除该端点上的 0 个挂载」**（`EndpointsSection.tsx:385` (branch) 传入 `pendingRemoval.dependentMountCount`；文案 `zh-CN.settingsPanel.endpoints.ts:49`）——**影响面提示错误，正是 #317 想解决的问题**；
5. 用户确认后，`handleRemove` 把 `expectedMountCount: 0` 发给后端（`EndpointsSection.tsx:220` (branch)）；
6. 后端 fail-closed 守卫命中（`topologyStore.ts:211-218` (branch)），抛错；
7. 错误经 `toErrorMessage`（`workerSectionUtils.ts:1-7`，直接 `error.message`）原样上屏，用户看到**未翻译的英文 debug 文案** `'Endpoint mount bindings changed. Refresh before removing the endpoint.'`（`topologyStore.ts:217` (branch)）。

即：**先 repair 再 remove，必定失败一次，且提示是英文技术文案。** 好消息是 fail-closed 守卫挡住了误删——这说明 #317 的后端设计是对的，被守卫兜住了。修法极小（补一个字段），见 §6-S1。

> 「未确认」：我没有实际运行应用复现该序列，结论由代码路径推导得出。建议按 §6-S1 补一条单测直接钉死。

### 1.7 明确划归「纯样式，不在本报告范围」

以下**不**构成 IA 问题，列出以免后续改动误伤：卡片圆角/间距、状态点颜色、按钮 hover 态、`--cove-*` token 取值。用户说的「乱」不是这些引起的。

---

## 2. Orca 如何组织同一件事

关键前提：Orca 的 SSH target 与 OpenCove 的 Endpoint **不是同一抽象层**（前置研究已述）。以下只提炼**组织方式**，不提议搬运结构。

### 2.1 单层扁平列表，一个页面只讲一件事

`SshPane.tsx:335-365`：header（标题 + 一句说明 + `Import` + `Add Target`）→ 列表 → 空态。**没有嵌套 group/module**，没有 §1.2 的双层标题，也没有 §1.1 的「开关在别处」。

标题与说明是一对（`:341-348`）：`SSH hosts` + `Add an existing machine over SSH so projects and workspaces can run there.`——**说明句直接回答「这是干什么用的」**，而 OpenCove 的对应文案是 `Remote targets that OpenCove can connect to, repair, browse, and mount.`（`en.settingsPanel.endpoints.ts:5`），罗列了 4 个动词却没说清用户为什么要它。

### 2.2 卡片：一行身份 + 一行摘要 + 一行错误，动作按状态**互斥**呈现

`SshTargetCard.tsx:284-307` 的卡片结构：

```
[icon] label ●status_dot status_text
       endpoint · identityFile · terminalPersistence
       error（仅失败时，红色）
```

动作区（`:309-350`）是 **`if/else if/else` 三选一**，不是全部并排：

| 状态 | 呈现 | 代码 |
| --- | --- | --- |
| `connected` | 次要图标动作 + **Disconnect** | `:310-323` |
| `connecting` | 次要图标动作 + **Connecting**（禁用+spinner） | `:324-331` |
| 其他 | 次要图标动作 + **Test** + Connect | `:332-350` |

对比 §1.3：Orca 任一时刻**只有一个文字主动作**，其余降级为图标按钮（Remove 是 `variant="ghost" size="icon"` + tooltip，`:258-280`）。这就是「有明确默认动作」的具体做法——不是靠颜色，是靠**同一时刻只给一个文字按钮**。

**推理**：动作可见性绑定状态机，而非全量渲染后再靠 `disabled` 区分。`disabled` 传达的是「现在不能点」，隐藏传达的是「这个状态下它不相关」——后者认知负担低得多。

### 2.3 渐进式披露：主区 4-5 字段，其余折叠

`SshHostAdvancedFields.tsx:19-40` 用 `Collapsible` + 旋转 chevron 收纳 proxy / jump host / 连接复用 / 终端持久化。默认开合状态由**是否已有高级值**决定（`SshTargetForm.tsx:57-58`、`:83`）——已配过的用户回来时它自动展开。

OpenCove 目前 managed 模式 4 个字段全部平铺（`EndpointsRegisterDialog.tsx:143-232` (branch)），字段少时尚可，但其中「远程 worker 端口（可选）」（`zh-CN.settingsPanel.endpoints.ts:35`）**已经是一个不该出现在主区的实现细节**——它的帮助文案自己都说「留空则由 OpenCove 自动分配」（`:36`）。这个字段是 §3 术语问题的一个缩影：把内部机制暴露成了主表单字段。

### 2.4 连接状态住在哪：常驻 + 聚合 + 可直达

`SshStatusSegment.tsx:31-46` 把多个 target 聚合成 4 个总态（`connected/partial/disconnected/connecting`），下拉里已连接的排前面（`:337-357`），底部固定一条「Manage Remote Hosts…」直达设置（`:365-377`）。

**推理**：连接状态是**跨表面的全局事实**，不是设置页的局部状态。放在常驻位置，用户不进设置页也知道；反过来，设置页因此不需要「刷新」按钮（对比 §1.4）。

### 2.5 Orca 也没做好的地方（避免过度崇拜参考实现）

- **术语同样不一致**：header 叫 `SSH hosts`（`SshPane.tsx:341`），按钮叫 `Add Target`（`:362`），空态叫 `No SSH targets configured.`（`:379-381`），对话框标题又叫 `Add SSH host`（`SshTargetForm.tsx:124`），删除的 aria-label 叫 `Remove target`（`SshTargetCard.tsx:267`）。**host/target 在同一屏混用**，与 OpenCove 的 worker/endpoint 混用是同一类病。所以 §3 的建议不能是「照抄 Orca 的词」。
- **反馈依赖 toast**：`handleTest` 成功/失败都走 toast（`SshPane.tsx:266-275`）。toast 会消失，诊断信息留不住。OpenCove 把诊断留在卡片上（`RemoteEndpointStatusPanel.tsx:109-121`）**更好**，见 §7。

---

## 3. 术语审计

### 3.1 现状盘点

用户可见面上，同一个概念至少有 4 个名字：

| 出现位置 | 中文 | 英文 | 证据 |
| --- | --- | --- | --- |
| 设置导航项 | 「Worker 与连接」 | `Worker & Connections` | `zh-CN.settingsPanel.layout.ts:7`、`en.settingsPanel.layout.ts:7`（经 `settingsPageRegistry.ts:101` 引用） |
| 页面描述 | 「配置 Worker 运行方式、访问与远程端点。」 | `Configure Worker runtime, access, and remote endpoints.` | `zh-CN.settingsPanel.layout.ts:41`、`en.settingsPanel.layout.ts:41` |
| Group 标题 | 「远程端点」 | `Endpoints` | `zh-CN.settingsPanel.endpoints.ts:2`、`en.settingsPanel.endpoints.ts:2` |
| Module 标题 | 「远程端点」 | `Remote endpoints` | `zh-CN.settingsPanel.endpoints.ts:4`、`en.settingsPanel.endpoints.ts:4` |
| 主按钮 | 「添加远程端点」 | `Add remote endpoint` | `zh-CN.settingsPanel.endpoints.ts:12` |
| 挂载器空态标题 | 「还没有远程 Worker」 | `No remote workers` | `zh-CN.shell.ts:70`、`en.shell.ts:73` |
| 挂载器空态引导 | 「请先到**「设置 → 远程 Worker」**添加一个远程 Worker。」 | `Add a remote worker in **Settings → Endpoints**.` | `zh-CN.shell.ts:71`、`en.shell.ts:74` |
| 挂载器空态按钮 | 「添加远程 Worker…」 | `Add remote worker…` | `zh-CN.shell.ts:72`、`en.shell.ts:75` |
| access 类型标签 | 「**手动 endpoint**」 | `Manual` | `zh-CN.commonRemoteEndpoints.ts:4` |
| 表单字段 | 「远程 **worker** 端口（可选）」 | `Remote worker port (optional)` | `zh-CN.settingsPanel.endpoints.ts:35` |
| 状态摘要 | 「这个远程 **Worker** 当前未连接。」 | — | `zh-CN.commonRemoteEndpoints.ts:23` |
| 状态摘要 | 「OpenCove 暂时无法准备好这个 **endpoint**。」 | — | `zh-CN.commonRemoteEndpoints.ts:28` |
| 动作标签 | 「安装 **runtime**」/「更新 **runtime**」 | `Install runtime` | `zh-CN.commonRemoteEndpoints.ts:37-38` |

### 3.2 具体缺陷

**A. 导航指向一个不存在的入口（最硬的 bug）**

`en.shell.ts:74` 让用户去 `Settings → Endpoints`。但设置导航里**没有** `Endpoints` 这一项——导航项叫 `Worker & Connections`（`en.settingsPanel.layout.ts:7` + `settingsPageRegistry.ts:101`）。用户按字面找不到。

中文侧同样错位：`zh-CN.shell.ts:71` 说去「设置 → 远程 Worker」，而导航项叫「Worker 与连接」（`zh-CN.settingsPanel.layout.ts:7`）。

`settingsPanel.nav.endpoints`（zh `'远程 Worker'` / en `'Endpoints'`，`zh-CN.settingsPanel.layout.ts:8`、`en.settingsPanel.layout.ts:8`）这个 key **在全仓无任何引用**（`grep -rn "nav.endpoints" src/` 无结果）——它是孤儿字符串，很可能正是当初写引导文案时参照的那个「已经不存在的导航项」。

**B. 中英混排（仅中文侧）**

「手动 endpoint」（`zh-CN.commonRemoteEndpoints.ts:4`）、「远程 worker 端口」（`zh-CN.settingsPanel.endpoints.ts:35`）、「安装 runtime」（`zh-CN.commonRemoteEndpoints.ts:37`）、「无法准备好这个 endpoint」（`:28`）。同一个中文界面里，`endpoint`/`worker`/`runtime` 三个词未翻译，而**同文件同层级**的「隧道」「凭据」「已连接」却翻译了。这不是风格选择，是遗漏。

**C. 大小写不统一**

`Worker`（`zh-CN.commonRemoteEndpoints.ts:23`）与 `worker`（`zh-CN.settingsPanel.endpoints.ts:35`）在中文文案里并存。

**D. 内部实现词泄漏到用户界面**

- `endpoint`：这是 topology 层的建模词（`src/shared/contracts/dto/topology.ts`），它精确表达「一个可执行 Worker 的落点」，但对用户而言，「端点」不指向任何他能想象的实体。
- `topology`：**结论是好消息**——`grep` 显示 `topology` 未出现在任何用户可见字符串中，仅存在于代码与文档。**不需要处理。**
- `mount`/「挂载」：出现在删除影响提示（`zh-CN.settingsPanel.endpoints.ts:48-49`）。这个词有对应的用户可见对象（项目里的远程目录），保留可接受，但需与项目挂载管理器用词一致。
- `runtime`：用户不需要知道远端装的东西叫 runtime。

### 3.3 建议词表

原则：**用户面只保留 2 个名词**，其余降为动词或隐藏。不照抄 Orca（它自己 host/target 混用，§2.5）。

| 概念 | 建议中文 | 建议英文 | 替换掉 |
| --- | --- | --- | --- |
| 一台可跑 Worker 的远程机器 | **远程机器** | **Remote machine** | endpoint / 端点 / remote worker / target |
| 该机器上 OpenCove 能访问的目录 | **远程目录** | **Remote folder** | mount / 挂载（用户面） |
| 接入方式（SSH 托管） | **SSH 接入**（作为属性，非独立名词） | **Over SSH** | managed SSH / 托管 SSH |
| 接入方式（手填地址+token） | **手动接入（高级）** | **Manual (advanced)** | 手动 endpoint |
| 远端需要的程序 | 不出现在正常路径；失败时称 **远程组件** | **Remote components** | runtime |
| 内部落点建模 | 仅代码/文档使用 | `endpoint` | — |

**必须同步修正的 5 处**（否则改词反而更乱）：

1. `zh-CN.shell.ts:71` / `en.shell.ts:74` 的导航引导，改为实际导航名。
2. `settingsPanel.nav.endpoints` 孤儿 key（`zh-CN.settingsPanel.layout.ts:8`、`en.settingsPanel.layout.ts:8`）：删除，或启用为真实二级导航项。**二选一，不能继续悬空。**
3. `zh-CN.settingsPanel.endpoints.ts:2` 与 `:4` 的重复标题（§1.2）。
4. `zh-CN.commonRemoteEndpoints.ts:4`、`:23`、`:28`、`:37-38` 的中英混排。
5. `zh-CN.settingsPanel.endpoints.ts:35` 的「远程 worker 端口」——建议连同字段一起移入高级折叠区（§5.1）。

> 「未确认」：`common.remoteEndpoints.*` 这批 key 是否被 Web UI / CLI 等非桌面表面复用，我只验证了 renderer 侧 3 个消费点（`EndpointsSection.tsx:276` (branch)、`RemoteDirectoryPickerWindow.tsx:279`、`RemoteEndpointStatusSlot.tsx:32`）。改词前需确认无其他消费方。

---

## 4. 核心问题：生命周期没有被表达

这是本报告认为**唯一的「大」问题**，其余都是它的衍生物。

### 4.1 真实阶段 vs 暴露状态

`prepare` 内部真实经过 6 个阶段（`managedSshEndpointRuntime.ts:300-341` (branch)）：

| # | 阶段 | 代码 | 失败表现 | 最坏耗时 |
| --- | --- | --- | --- | --- |
| 1 | 探测本地 ssh 可执行文件 | `:301-311` (branch) | `record.status='error'`，`lastError` = 诊断串 | 快 |
| 2 | 建隧道并等远端就绪 | `ensureTunnel` → `ensureTunnelOnce` `:167-235` (branch) | `:226-231` (branch) | **7.5s**（`:223` (branch) `waitForCondition(..., 7_500)`） |
| 3 | 隧道内探活 | `:322-323` (branch) `probeConnection(connection, 750)` | 返回 false，进入 4 | 0.75s |
| 4 | 远端 bootstrap（装/起 runtime） | `:326-329` (branch) → `managedSshRuntimeSupport.ts:322-327` | throw，`:339-340` (branch) 捕获 | **120s**（`managedSshRuntimeSupport.ts:323`，posix；`:307` windows） |
| 5 | 重建隧道 | `:331-333` (branch) | 同 2 | 7.5s |
| 6 | 最终探活（在 health 层） | `endpointHealthService.ts:283` (branch) | 映射为终态 | 1.25s（`:80` (branch)） |

**单次「连接」最坏路径 ≈ 7.5 + 0.75 + 120 + 7.5 + 1.25 ≈ 137 秒。**

对外只有 4 态（`managedSshEndpointRuntime.ts:13` (branch)）：

```ts
type TunnelStatus = 'idle' | 'connecting' | 'ready' | 'error'
```

而 UI 拿到的是 `prepare` **返回后**的单个终态（`useEndpointOverviews.ts:100-116`，一次 await）。**过程中没有任何中间态送达 renderer。**

后果：用户点「连接」，按钮进入 busy（`RemoteEndpointStatusPanel.tsx:130` 的 `disabled={isBusy}`），然后最长两分多钟界面**完全静止**，无进度、无阶段名、无取消。这本身就足以让人觉得「坏了」。

### 4.2 阶段信息在服务端被生成，然后被丢弃

讽刺的是，**bootstrap 脚本内部有清晰的阶段划分和精确的错误文案**：

- `managedSshRuntimeSupport.ts:161`：`'OpenCove remote runtime bootstrap did not make the opencove command available.'`（安装失败，exit 127，`:162`）
- `managedSshRuntimeSupport.ts:183`：`'OpenCove worker did not become ready after SSH bootstrap.'`（启动失败，exit 1，`:186`）且**主动 `tail -n 80 "$log_file" >&2`**（`:184`）把远端日志回传

这些高质量诊断被 `runCommand` 收进 stderr（`:326-327`），包成 `new Error(result.stderr.trim() || ...)`，然后在 `prepare` 里被压成一个字符串塞进 `record.lastError`（`managedSshEndpointRuntime.ts:339-340` (branch)），最后由 health 层塞进 `details[]`（`endpointHealthService.ts:371` (branch)）。

**阶段身份（是安装失败还是启动失败）在这个过程中丢失了**——只剩一段文本。UI 无法据此做任何分支。

### 4.3 于是推荐动作会给错——这正是用户报的故障

用户的实例：远端 runtime 损坏，UI 只说打不开。代码路径如下：

1. runtime 损坏 → 阶段 3 探活失败 → 进入 bootstrap（`managedSshEndpointRuntime.ts:324-325` (branch)）。
2. bootstrap 脚本第一件事是 `command -v opencove`（`managedSshRuntimeSupport.ts:149`、`:155`）。**二进制文件存在（只是坏了），所以两次检查都通过，安装步骤被完全跳过。**
3. 脚本直接 `nohup opencove worker start ...`（`:165`）。坏的二进制起不来。
4. 就绪轮询 120 次 × 0.5s = **60 秒**全部失败（`:169-178`）。
5. 脚本以 exit 1 退出，stderr 为 `'OpenCove worker did not become ready after SSH bootstrap.'` + 80 行远端日志（`:183-185`）。
6. `runBootstrap` throw（`:327`），被 `:339-340` (branch) 捕获，`record.status = 'error'`。
7. health 层映射：`snapshot.status === 'error' ? 'tunnel_failed' : 'needs_setup'`（`endpointHealthService.ts:370` (branch)），推荐动作 `snapshot.status === 'error' ? 'repair_tunnel' : 'install_runtime'`（`:372` (branch)）。
8. **UI 显示「隧道失败」（`zh-CN.commonRemoteEndpoints.ts:12`），推荐动作「重连隧道」（`:36`）。**

**隧道是好的。问题在远端程序。** UI 给出的建议不仅无用，点下去还会重跑一遍同样的 60 秒失败。

更糟的是**正确的动作也修不好**：`install_runtime` / `update_runtime` 会传 `reinstallRuntime: true`（`endpointHealthService.ts:406` (branch)），而脚本对该标志的处理只有一行 `rm -f "$state_dir/opencove"`（`managedSshRuntimeSupport.ts:145-147`）——它只删 **dev wrapper**（`$state_dir` = `~/.local/state/opencove/managed-ssh/<id>`，`:109`）。如果 runtime 是由 installer 装到 `PATH` 上其他位置的，`command -v opencove` 依然命中坏文件，重装依然是 no-op。

> 「未确认」：installer（`${installerUrl}`，`managedSshRuntimeSupport.ts:157`）实际把 `opencove` 装到哪个路径，我没有验证。若它也装进 `$state_dir` 则 `rm -f` 有效；若装进 `~/.local/bin` 或 `/usr/local/bin` 则如上所述无效。**这一点必须实测确认**，它决定「重装远程组件」这个动作是真能修还是假动作。

### 4.4 到达故障点时，用户看到的是什么

如果用户不是在设置页触发，而是在使用中撞上（打开远程目录、起终端），拿到的是：

- 错误码 `worker.unavailable`，消息 **`'Worker is unavailable.'`**（`src/shared/errors/appError.ts:10`）
- `debugMessage` = `Remote endpoint unavailable: <id>`（`filesystemMountSupport.ts:135-137`；同样模式在 `topologyHandlers.ts:110`、`:122`、`:194`、`:260`，`ptyMountHandlers.ts:261`，`sessionLaunchAgentInMountHandler.ts:218`，`sessionFinalMessageHandler.ts:70`，`remotePtyEndpointProxy.ts:172` 等 **10+ 处**）

`appError.ts:4-5` 的 `createMessageMap()` 是**硬编码英文表**，`worker.unavailable` 没有中文，也没有 `recommendedAction`。

上游成因是 `resolveConnection` 返回**裸 `null`**（`managedSshEndpointRuntime.ts:271-287` (branch)）——它在两种完全不同的情况下都返回 `null`：ssh 不可用（`:274` (branch)）、隧道未就绪（`:279` (branch)）。**返回类型本身就丢弃了原因。**

于是：ssh 缺失、认证失败、隧道断、runtime 损坏、版本不匹配——**5 种成因，1 句 `Worker is unavailable.`**。而 OpenCove 明明有全套 `recommendedAction` 建模（`endpointOverviewUi.ts:71-101`），只是它只活在设置页，从不出现在故障现场。

### 4.5 建议：把阶段变成一等公民

**领域模型**（`contexts/topology/domain/`，纯函数，零 IO）：

```ts
export type RemoteSetupStage =
  | 'ssh_reachable'      // 本地 ssh 可用 + 能连上目标机
  | 'tunnel_established' // 隧道建立
  | 'runtime_present'    // 远端组件存在且可执行
  | 'worker_ready'       // 远端 worker 应答 system.ping
  | 'protocol_compatible'// 协议版本匹配

export type StageState =
  | { kind: 'pending' }
  | { kind: 'running'; startedAt: string }
  | { kind: 'ok' }
  | { kind: 'failed'; reasonCode: StageFailureCode; detail: string | null }
  | { kind: 'skipped' }   // 例如手动接入不经过隧道阶段

export type StageFailureCode =
  | 'ssh_binary_missing' | 'ssh_auth_denied' | 'ssh_host_unreachable' | 'ssh_host_key_changed'
  | 'tunnel_port_conflict' | 'tunnel_exited'
  | 'runtime_install_failed'      // 对应 managedSshRuntimeSupport.ts:161（exit 127）
  | 'runtime_start_failed'        // 对应 managedSshRuntimeSupport.ts:183（exit 1）—— 用户实例落这里
  | 'worker_probe_timeout'
  | 'protocol_mismatch'
```

**每个 `StageFailureCode` 静态映射到唯一 `recommendedAction` + 唯一 i18n 文案。** 这是纯函数，可单测，可穷举。当前 `recommendedActionForAccessStatus`（`endpointHealthService.ts:161-184` (branch)）是从**粗粒度 status** 推动作，所以必然给错（§4.3）；改成从**细粒度 failureCode** 推，§4.3 的错误建议自动消失——`runtime_start_failed` 显然不该映射到 `repair_tunnel`。

**关键收益**：`runtime_install_failed` 与 `runtime_start_failed` 的区分**已经在 bootstrap 脚本里用 exit code 表达了**（127 vs 1，`managedSshRuntimeSupport.ts:162`、`:186`），当前只是被丢掉。捡回来几乎零成本。

**契约**：新增 Event `endpoint.setup.progress`，payload 为 `{ endpointId, attemptId, stages: Array<{stage, state}> }`。`attemptId` 用于让 renderer 丢弃过期尝试（复用 `useEndpointOverviews.ts:70`、`:82-84` 已验证的 `requestCounterRef` 思路）。

保留 `endpoint.overview.list` 作为兜底——事件丢失不得导致 UI 永久卡在中间态。

---

## 5. 建议的重设计

### 5.1 IA 草图

**当前**（`WorkerConnectionsSection.tsx:17-70`）：

```
┌─ h3 Worker 运行 ────────────────────────────────┐
│  模式 / CLI / 本机 worker …                      │
└─────────────────────────────────────────────────┘
┌─ h3 远程连接 ───────────────────────────────────┐
│  [x] 启用远程 Worker（实验性）   ← 开关孤立在此   │
└─────────────────────────────────────────────────┘
┌─ h3 远程端点 ───────────────────────────────────┐   ← 与下一行中文重复
│ ┌─ h4 远程端点 ─────────────────────────────┐   │   ← §1.2
│ │ 数量: 2   托管 SSH 会把隧道…   [刷新][添加]│   │   ← §1.4 刷新与添加同级
│ │ ┌───────────────────────────────────────┐ │   │
│ │ │ my-box            [未连接]            │ │   │
│ │ │ 托管 SSH · ubuntu@10.0.0.5            │ │   │
│ │ │ 已准备好从当前设备通过 SSH 连接。      │ │   │
│ │ │            [连接] [重连]              │ │   │ ← §1.3 两个重叠动作
│ │ │            [编辑] [移除]              │ │   │ ← 来自另一个组件
│ │ └───────────────────────────────────────┘ │   │
│ └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
┌─ h3 浏览器访问 ─────────────────────────────────┐
```

**建议**：

```
┌─ h3 远程机器 ───────────────────────────────────────────────┐
│  在其他机器上运行 OpenCove，把它的目录当作本地项目使用。      │  ← 说明「为什么」
│                                                              │
│  [x] 启用远程机器（实验性）        ← 开关移入本容器（§1.1）   │
│  ─────────────────────────────────────────────────────────  │
│  2 台已连接 · 1 台需要处理                    [+ 添加机器]   │  ← 聚合健康度替代「数量」
│                                              （唯一主按钮）  │  ← 刷新降级为图标/自动
│                                                              │
│  ┌─ 卡片：健康 ─────────────────────────────────────────┐   │
│  │ ● my-box                              已连接         │   │
│  │   ubuntu@10.0.0.5 · SSH · 组件 v1.2.3                │   │
│  │                        [在项目中使用…]        [⋯]    │   │  ← 主动作是「用它」
│  └──────────────────────────────────────────────────────┘   │     ⋯ = 编辑/断开/移除
│                                                              │
│  ┌─ 卡片：进行中（§4 的核心）───────────────────────────┐   │
│  │ ◐ build-01                            正在准备…      │   │
│  │   ✓ 已连上机器                                       │   │
│  │   ✓ 通道已建立                                       │   │
│  │   ◐ 正在安装远程组件…（首次约需 1-2 分钟）           │   │  ← 显式告知耗时
│  │   ○ 启动远程服务                                     │   │
│  │   ○ 版本校验                                         │   │
│  │                                          [取消]      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ 卡片：失败（用户报的那个实例）──────────────────────┐   │
│  │ ● gpu-node                        远程组件无法启动   │   │
│  │   ✓ 已连上机器   ✓ 通道已建立   ✓ 组件已安装         │   │
│  │   ✗ 启动远程服务 —— 组件已安装但启动失败              │   │
│  │      很可能是远端文件损坏。建议重新安装远程组件。     │   │  ← 说清"是什么/为什么/怎么办"
│  │              [重新安装远程组件]   [查看远端日志]      │   │  ← 主动作正确；日志可展开
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

关键变化与对应缺陷：

| 变化 | 解决 |
| --- | --- |
| 开关移入同一容器，删掉「远程连接」空 group | §1.1 |
| group/module 二选一，只留一层标题 | §1.2 |
| 卡片按状态互斥呈现动作；只留 1 个文字主动作，其余进 `⋯` | §1.3 |
| 「连接」与「重连」合并为一个按状态取名的动作 | §1.3 |
| `connected` 时主动作改为「在项目中使用…」 | §1.3 断头路 |
| 聚合健康度替代「数量: N」；刷新降级 | §1.4 |
| 分阶段清单 + 每阶段状态 | §4.1、§4.2 |
| 失败阶段自带原因与正确的推荐动作 | §4.3 |
| 「远程 worker 端口」移入高级折叠 | §2.3、§3.2-D |

### 5.2 落到 OpenCove 架构

严格按 `contexts/<ctx>/{domain,application,infrastructure,presentation}`。**不引入 Orca 的任何文件或目录结构**——Orca 把校验、解析、删除策略都平铺在 `components/settings/` 下（如 `ssh-target-save-payload.ts` 与 `SshPane.tsx` 同级），这在 OpenCove 会直接违反分层。

| 层 | 位置 | 内容 | 约束 |
| --- | --- | --- | --- |
| domain | `contexts/topology/domain/remoteSetupStage.ts`（新） | `RemoteSetupStage`、`StageState`、`StageFailureCode`；`stageFailureToAction()` 纯映射；`summarizeStages()` 推导整体态 | 纯函数，**不 import Electron/fs/net** |
| domain | `contexts/topology/domain/endpointHealthSummary.ts`（新） | 多机器聚合（「2 台已连接 · 1 台需要处理」） | 同上 |
| application | `contexts/topology/application/` | 编排 prepare 各阶段，逐阶段发 Event | 不直接碰 child_process |
| infrastructure | `src/app/main/controlSurface/topology/managedSshEndpointRuntime.ts`（改） | 在既有 6 个阶段处回调 `onStage`；解析 bootstrap exit code（127/1）为 `StageFailureCode` | 保留 `inFlightPrepare` 合流（`:290-298` (branch)） |
| contract | `src/shared/contracts/dto/topology.ts` + `docs/architecture/CONTROL_SURFACE.md` | 新增 Event `endpoint.setup.progress`；overview 增 `stages?` | **触发架构契约 Gate**，需同步 `harness/architecture/` |
| presentation | `.../settingsPanel/RemoteMachineCard.tsx`（新，替代现拼装） | 状态互斥的动作区 + 阶段清单 | 无 `window.alert/confirm/prompt` |
| presentation | `src/app/renderer/shell/components/RemoteEndpointStatusPanel.tsx`（改） | 渲染阶段清单；三处消费点共享 | 保持 3 处复用 |
| i18n | `{en,zh-CN}.commonRemoteEndpoints.ts`、`{en,zh-CN}.settingsPanel.endpoints.ts` | 每个 `StageFailureCode` 一对 en/zh 文案 | **en + zh-CN 必须同时提供** |

**外部入口一律走 Control Surface**：新事件按 `CONTROL_SURFACE.md:9` 的 Event 类型登记，不使用裸 `ipcRenderer.on`。

**顺带修正分层瑕疵**：`EndpointsSection.tsx:8` (branch) 从 settings presentation 直接相对路径 import topology domain：

```ts
import { parseOptionalManagedSshPort } from '../../../../topology/domain/managedSshPort'
```

四级相对路径跨 context。架构 harness 在该分支通过（`harness/architecture/results/summary.json` 有更新），故**当前不违规**；但新增阶段模型时会有更多这类跨 context 引用，建议顺手改为 alias 引入并确认 harness 规则。**这是观察，不是阻塞项。**

**状态所有权**：

| state | owner | 写入口 | 重启后真相 |
| --- | --- | --- | --- |
| 机器 durable 配置 | topology store (main) | `endpoint.registerManagedSsh` / `updateManagedSsh` | `worker-topology.json` |
| 阶段进度 | managed SSH runtime (main) | 仅 prepare/repair 编排器 | 无（runtime observation，重启重算） |
| renderer 阶段投影 | `useEndpointOverviews` | Event 订阅 + reload 兜底 | 不持久化 |

**不变量**：
1. 阶段进度是 runtime observation，**绝不回写 `topology.json`**（对齐 `RECOVERY_MODEL.md` 的分类）。
2. 同一 endpoint 任一时刻最多一个活跃 `attemptId`；旧 attempt 的事件必须被 renderer 丢弃。
3. 每个 `StageFailureCode` 必须有且仅有一个推荐动作与一对 en/zh 文案（可用类型穷举 + 单测钉死）。
4. 事件丢失不得使 UI 永久停在 `running`——`endpoint.overview.list` 始终可兜底。

---

## 6. 分阶段计划

按「用户可见价值 / 风险」排序。**S1-S4 是纯 presentation 或 i18n，零契约变更，可立即并行。**

| 步骤 | 内容 | 类型 | 独立可发 | 与 #317 冲突 | 价值/风险 |
| --- | --- | --- | --- | --- | --- |
| **S1** | 修 `repairEndpoint` 成功分支漏传 `dependentMountCount`（`endpointHealthService.ts:409-416` (branch)），补单测 | Bug fix（1 行 + 测试） | ✅ | **改的是 #317 引入的代码**，须在其后或直接并入 | **极高**：修的是 #317 自己的契约（`CONTROL_SURFACE.md:120-122` (branch)） |
| **S2** | 术语统一（§3.3）+ 修 `Settings → Endpoints` 死链（`en.shell.ts:74`、`zh-CN.shell.ts:71`）+ 处理孤儿 key + 消除重复标题（§1.2） | 纯 i18n | ✅ | 触碰 #317 新增的 `edit.*` 文案，需 rebase 后做 | 高/极低 |
| **S3** | IA 重组：开关移入容器、group/module 合一、聚合健康度替代「数量」、刷新降级 | 纯 presentation | ✅ | 与 #317 同文件 `EndpointsSection.tsx`，**必须 rebase 后做** | 高/低 |
| **S4** | 动作模型：状态互斥呈现；合并「连接/重连」；`connected` 主动作改「在项目中使用…」；`⋯` 收纳 | 纯 presentation | ✅ | 同上，且会移动 #317 新增的 Edit 按钮（`:321-333` (branch)）——**移动不是撤销** | 高/低 |
| **S5** | 注册表单脏数据保护（§1.5）+ 「远程 worker 端口」移入高级折叠 | 纯 presentation | ✅ | 同文件 | 中/低 |
| **S6** | **阶段模型**：domain 纯函数 + runtime 回调 + Event 契约 + 卡片阶段清单 | **契约 + 状态** | ✅（但最大） | 与在途 bootstrap fix **高度重叠**，见下 | **最高**/中 |
| **S7** | 故障现场消费 `recommendedAction`：`worker.unavailable`（`appError.ts:10`）携带阶段与建议，替换 10+ 处裸 debugMessage | 契约 + 广泛改动 | ✅ | 无直接冲突 | 高/中 |

**建议顺序**：`S1 → (S2, S3, S4, S5 并行) → S6 → S7`。

### 与 #317 的冲突面

- **不要重做**：编辑入口、删除确认、端口三态校验、`expectedMountCount` fail-closed。这些都对。
- **S3/S4/S5 全部改 `EndpointsSection.tsx`**，而 #317 对该文件改动 124 行。**必须在 #317 合入 main 后 rebase 再动**，否则冲突成本远大于收益。
- **S1 修的正是 #317 的代码**。若 #317 尚未合入，最干净的做法是**直接补进 #317**，而不是另开 PR 修它。
- S4 会把 Edit 按钮从常驻位置移进 `⋯` 菜单。**这是重排不是移除**，但需在 PR 描述里写清，避免被误读为回退 #317。

### 与在途 bootstrap fix 的冲突

**这是最需要协调的一处。** S6 需要修改 `managedSshEndpointRuntime.ts` 的 prepare 编排（`:300-341` (branch)）与 `managedSshRuntimeSupport.ts` 的 bootstrap 脚本/错误解析——这两处几乎肯定就是 bootstrap fix 的战场。

建议：

1. **S6 让路**，等 bootstrap fix 落地后再动，避免同区域双改。
2. 但**现在就把 §4.5 的 `StageFailureCode` 枚举与 `stageFailureToAction()` 纯函数交给 bootstrap fix 的作者**——那个 fix 本来就要处理「runtime 损坏」，它天然需要区分 `runtime_install_failed` 与 `runtime_start_failed`。让它在修复时**顺手把 exit code 127/1 的语义保留下来**（`managedSshRuntimeSupport.ts:162`、`:186`），成本几乎为零；而如果它按现状继续把错误压成字符串，S6 就得再改一遍同一段代码。
3. §4.3 的「未确认」项（installer 装到哪、`rm -f "$state_dir/opencove"` 是否真能重装）**应由 bootstrap fix 一并回答**，它是那个 fix 的核心问题，也是 S6 能否给出正确推荐动作的前提。

---

## 7. 反面论证：OpenCove 现在比 Orca 好的地方（改造不得回退）

前置研究已指出后端两项优势（`recommendedAction` 建模、token `0o600`）。以下是**本次新发现的 UI 侧安静优点**：

1. **诊断信息常驻卡片，而非 toast。** `RemoteEndpointStatusPanel.tsx:109-121` 把 runtime 版本、协议版本、错误详情渲染在卡片内并持续存在。Orca 的 Test 结果走 toast（`SshPane.tsx:266-275`），几秒后消失，用户无法回看。**OpenCove 更好，S3/S4 重排时必须保留这块区域。**

2. **`shouldShowDiagnostics` 的条件披露。** `RemoteEndpointStatusPanel.tsx:68-69`：compact 模式下只有 `warning/danger/info` 才展开诊断，`success` 时自动收起。这是**恰到好处的渐进披露**——健康时不吵，出问题时自动展开。Orca 无对应机制。**保留。**

3. **`SUPPRESSED_DETAILS` 噪音过滤。** `endpointOverviewUi.ts:12-17` 显式过滤掉 4 条与 summary 重复的英文技术串，`:130-133` 还过滤 `Remote runtime version ` 前缀（因为已在 `runtimeLine` 单独渲染）。这是有意识的去重。**S6 新增阶段文案时，必须同步维护这张表**，否则阶段详情会和 summary 重复刷屏。

4. **同一状态组件跨 3 个表面复用。** `RemoteEndpointStatusPanel` 被设置页（`EndpointsSection.tsx:276` (branch)）、远程目录选择器（`RemoteDirectoryPickerWindow.tsx:279`）、挂载槽位（`RemoteEndpointStatusSlot.tsx:32`）共享，且用 `compact`/`showIdentity`/`connectedHint` 参数化。Orca 的设置卡片（`SshTargetCard.tsx`）、侧栏行（`SshTargetRow.tsx`）、状态栏（`SshStatusSegment.tsx`）是**三份独立实现**。**OpenCove 的一致性更好。** S4 新建 `RemoteMachineCard` 时，必须继续复用而非再造一份。

5. **`remotePlatform: 'auto'|'posix'|'windows'` 在配置期就建模。** 前置研究已提及（该字段在 `topology.ts`）。UI 侧目前硬编码 `'auto'` 提交（`EndpointsSection.tsx:167` (branch) 的 `remotePlatform: 'auto' as const`）——**这是对的**，不要因为「字段存在」就在表单里暴露它。**S5 做高级折叠时，抵制把它加进去的冲动。**

**回退风险最高的是第 1、3 两项**：S4 重排动作区时若顺手简化诊断区，会丢掉 OpenCove 相对 Orca 的真实优势。

---

## 8. 开放问题（需拍板）

1. **「远程机器 / Remote machine」这个词接受吗？** 备选：「远程主机」（更技术）、「远程电脑」（更口语）。**推荐「远程机器」**——「主机」与 SSH host 字段易混，「电脑」在服务器语境下别扭。

2. **`settingsPanel.nav.endpoints` 孤儿 key 怎么处理？** A. 删除，引导文案改指「Worker 与连接」；B. 启用为真实二级导航项。**推荐 A**——新建二级导航是独立的导航设计决策，不该与本次改造耦合。

3. **`connected` 时主动作「在项目中使用…」跳去哪？**（编号保持） 项目挂载管理器？新建项目向导？**「未确认」**：我没有梳理这两个入口的完整前置条件（是否需先选项目）。**这一条必须先确认落点，否则又造一个断头路。**

4. **S6 的阶段进度要不要支持「取消」？** 草图里画了 `[取消]`。取消一个正在跑的远端 bootstrap 涉及子进程终止与远端半安装状态清理，**复杂度不低**。**推荐先不做**，改为显式告知预计耗时（「首次约需 1-2 分钟」），把取消留到后续。

5. **S7 要不要一次性改完 10+ 处 `worker.unavailable`？** **推荐分两批**：先改用户高频撞到的（打开远程目录 `filesystemMountSupport.ts:135-137`、起终端 `ptyMountHandlers.ts:261`），其余后续跟进。一次性改 10+ 个调用点，回归面过大。

---

## 附录：证据索引

**OpenCove（`ssh-experience` 分支，含 #317）**

- `src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection.tsx:8`（跨 context import）、`:60-64`（三态校验，#317）、`:87-107`（编辑入口，#317）、`:109-117`（无脏数据保护的关闭）、`:119-124` / `:141-146`（connect vs reconnect 重叠）、`:167`（硬编码 remotePlatform）、`:211-229`（remove + expectedMountCount）、`:233` / `:249-252`（双层标题）、`:254-283`（工具栏）、`:321-345`（第二排动作）、`:385`（mountCount 传入）
- `.../EndpointsRegisterDialog.tsx:82-84`（背景点击丢弃）、`:143-232`（4 字段平铺）
- `.../EndpointRemoveDialog.tsx:21-23`（alertdialog 背景可关）、`:27`
- `src/app/main/controlSurface/topology/endpointHealthService.ts:67`（`?? 0` 兜底）、`:161-184`（粗粒度动作映射）、`:167-168`（connected→browse）、`:283`（disconnected→needs_setup）、`:362`（prepare 正确传值）、`:370-372`（错误的 tunnel_failed 映射）、`:409-416`（**漏传 dependentMountCount**）、`:428`（失败分支正确传值）
- `src/app/main/controlSurface/topology/managedSshEndpointRuntime.ts:13`（4 态）、`:167-235`（隧道阶段）、`:223`（7.5s）、`:271-287`（裸 null）、`:290-298`（并发合流，优点）、`:300-341`（6 阶段编排）、`:324-329`（bootstrap 触发）
- `src/app/main/controlSurface/topology/topologyStore.ts:211-218`（fail-closed 守卫，#317）、`:217`（英文 debug 文案）
- `docs/architecture/CONTROL_SURFACE.md:51-61`（契约清单）、`:120-122`（expectedMountCount 要求）

**OpenCove（`main` 与分支一致）**

- `src/app/main/controlSurface/topology/managedSshRuntimeSupport.ts:109`（state_dir）、`:145-147`（reinstall 仅删 wrapper）、`:149` / `:155`（command -v 短路）、`:157`（installer）、`:161-162`（安装失败 exit 127）、`:165`（nohup 启动）、`:169-178`（60s 轮询）、`:183-186`（**启动失败 exit 1 + 日志回传**）、`:324` / `:326-327`（120s 超时与错误包装；超时值在 `:323` posix / `:307` windows）
- `src/app/renderer/shell/components/RemoteEndpointStatusPanel.tsx:64-67`（抑制 browse）、`:68-69`（条件披露，优点）、`:109-121`（常驻诊断，优点）、`:123-149`（第一排动作）
- `src/app/renderer/shell/utils/endpointOverviewUi.ts:12-17` / `:130-133`（噪音过滤，优点）、`:71-101`（动作执行映射）
- `src/app/renderer/shell/hooks/useEndpointOverviews.ts:17-36` / `:59-61`（整体替换）、`:70` / `:82-84`（过期丢弃，优点）、`:100-116`（单次 await）、`:176-177`（本地事件拉取）
- `src/app/renderer/shell/components/ProjectMountManagerRemoteSection.tsx:69-86`（术语混用空态）
- `src/app/renderer/shell/components/RemoteEndpointStatusSlot.tsx:32`、`RemoteDirectoryPickerWindow.tsx:279`（复用点，优点）
- `src/contexts/settings/presentation/renderer/settingsPanel/WorkerConnectionsSection.tsx:17-70`（4 块平级）、`:33-42`（孤立开关）、`:48-50`（开关的作用对象）
- `src/contexts/settings/presentation/renderer/settingsPanel/SettingsGroup.tsx:32-34`（h3）、`:85-87`（h4）
- `src/contexts/settings/presentation/renderer/settingsPanel/settingsPageRegistry.ts:101`（导航实际标签）
- `src/contexts/settings/presentation/renderer/settingsPanel/workerSectionUtils.ts:1-7`（原样透出 message）
- `src/shared/errors/appError.ts:4-5` / `:10`（硬编码英文表）
- `src/app/main/controlSurface/handlers/filesystemMountSupport.ts:135-137`、`topologyHandlers.ts:110` / `:122` / `:194` / `:260`、`ptyMountHandlers.ts:261`、`sessionLaunchAgentInMountHandler.ts:218`、`sessionFinalMessageHandler.ts:70`、`remotePtyEndpointProxy.ts:172`（裸 debugMessage）
- i18n：`zh-CN.settingsPanel.endpoints.ts:2` / `:4` / `:12` / `:35` / `:48-49` / `:52`、`en.settingsPanel.endpoints.ts:2` / `:4` / `:5` / `:35`、`zh-CN.commonRemoteEndpoints.ts:4` / `:12` / `:23` / `:28` / `:36-38`、`zh-CN.shell.ts:70-72`、`en.shell.ts:73-75`、`zh-CN.settingsPanel.layout.ts:7-8` / `:41` / `:75-77`、`en.settingsPanel.layout.ts:7-8` / `:41`

**Orca（`/Users/shihaojie/Development/orca`）**

- `src/renderer/src/components/settings/SshPane.tsx:266-275`（toast 反馈，缺点）、`:335-365`（扁平 header）、`:341` / `:362` / `:379-381`（**host/target 混用**）
- `src/renderer/src/components/settings/SshTargetCard.tsx:258-280`（Remove 降级为图标）、`:284-307`（卡片结构）、`:309-350`（**状态互斥动作**）
- `src/renderer/src/components/settings/SshTargetForm.tsx:57-58` / `:83`（高级区按已有值决定开合）、`:93-100`（**脏数据保护**）、`:124`（又一个名字）
- `src/renderer/src/components/settings/SshHostAdvancedFields.tsx:19-40`（渐进披露）
- `src/renderer/src/components/status-bar/SshStatusSegment.tsx:31-46`（聚合态）、`:337-357`、`:365-377`（直达设置）

---

## 变更说明

本报告为只读研究产出，**仅新增本文件，零 `src/` 改动**。
