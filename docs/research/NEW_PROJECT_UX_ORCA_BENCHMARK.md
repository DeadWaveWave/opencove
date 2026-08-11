# 新建项目流程对标报告（IA / UX 视角，OpenCove vs Orca）

- 状态：研究报告（Phase 1，**只读**，零 `src/` 改动）
- 触发：前置报告 `docs/research/REMOTE_WORKER_UX_ORCA_BENCHMARK.md` §8-开放问题 3 把「健康 endpoint 的主动作『在项目中使用…』跳去哪」标为「未确认」，并警告猜测会造出第二个断头路。用户已拍板落点方向：**连接远程后，它应当在新建项目时可选**，并要求顺带对标新建项目流程本身。
- 参考实现：Orca `/Users/shihaojie/Development/orca`（只读，repo id `c9c0a6a8-b949-4b26-b377-d1f38737f1ee`）
- 前置研究：`REMOTE_WORKER_UX_ORCA_BENCHMARK.md`（远程 endpoint 卡片 IA）、`SSH_EXPERIENCE_ORCA_BENCHMARK.md`（功能缺口）。本报告**不重复**其结论，只在接缝处引用。

本报告有两半，而**两半之间的接缝才是真正的交付物**：(a)「在项目中使用」这个动作落在哪；(b) 落过去之后，新建项目流程本身是否值得落。

## 证据基线（重要，先读这一段）

| 事实 | 取证 |
| --- | --- |
| `main` HEAD = `72b7b244`，**不含 #317** | `git log --oneline origin/main -1` |
| 本 worktree（`DeadWaveWave/new-project-ux-research`）= `72b7b244`，与 `main` 一致 | `git worktree list` |
| **#317（`DeadWaveWave/ssh-experience`）完全未触及 `src/app/renderer/shell/`，也未触及 `addProjectWizard/`** | `git diff --name-only origin/main...origin/DeadWaveWave/ssh-experience \| grep -E "shell/\|addProjectWizard"` → 空 |
| 在途 bootstrap fix 位于 `/Users/shihaojie/orca/workspaces/opencove/ssh-bootstrap-fix`，**未提交**（`git status` 显示 7 个 `src/` 文件 M 状态） | 见 §7.3 |

因此**本报告绝大多数行号取自 `main`(=本 worktree) 的工作区，与 #317 无歧义**。这比前置报告的处境干净：前置报告的战场（`EndpointsSection.tsx`）正是 #317 的战场，而本报告的战场（`addProjectWizard/`、`AddProjectWizardWindow.tsx`、`AppShell.tsx`）**#317 一行都没碰**。

行号标记约定：

| 标记 | 含义 |
| --- | --- |
| `文件:行` | 取自 `main` / 本 worktree 工作区（默认） |
| `文件:行` (bootstrap-fix) | 取自未提交的 `ssh-bootstrap-fix` 工作区，仅在 §7.3 冲突分析中使用 |
| `文件:行` (orca) | 取自 Orca 仓库 |

**#317 已修好的东西，本报告一律不碰也不提**（endpoint 可编辑、删除确认、端口三态校验、`expectedMountCount` fail-closed）。

---

## 0. TL;DR

**三个最严重的问题**：

1. **「新建项目」这个流程，对绝大多数用户根本不存在。** `experimentalRemoteWorkersEnabled` 默认为 `false`（`agentSettings.defaults.ts:66`），而 `AddProjectWizardWindow` 在该情况下**直接 `return null` 并自动弹出系统原生目录选择器**（`AddProjectWizardWindow.tsx:150-163` 的 effect + `:180` 的 `return null`）。即默认路径上没有向导、没有项目名、没有确认步骤——选完目录**立即创建**（`:141` 传 `createImmediately=true`）。这不完全是坏事（§8 反面论证会说它好在哪），但它导致：向导只在实验开关打开后才出现，**它的所有 UX 问题都从未被主流用户暴露过，也就从未被打磨过**。两条路径的落差是本报告最大的结构性发现。
2. **向导内部有一条真实的断头路，且它与前置报告发现的那条严格对称。** 向导远程分支为空时给出主按钮「添加远程 Worker…」（`AddProjectWizardDefaultLocationSection.tsx:110-121`），它调用 `onRequestOpenEndpoints` → `AppShell.tsx:426-430` → `handleOpenSettings` → **`closeTransientOverlays()`（`AppShell.tsx:301`），而该函数第 53 行 `setIsAddProjectWizardOpen(false)`（`useShellOverlayState.ts:53`）无条件销毁向导**。用户去配 endpoint，配完回来——向导没了，填过的路径全丢，且没有任何东西把他送回来。前置报告说「健康 endpoint 没有前进动作」；这里是反向的同一个洞：**向导想去拿 endpoint，就必须自杀**。
3. **~39% 的向导代码是死代码，且死掉的恰好是「多挂载点 / 高级」能力。** `AddProjectWizardAdvancedSection.tsx`（250 行）**在全仓无任何导入方**（全仓 grep `AdvancedSection` 只命中 settings 里的同名无关组件），它又是 `AddProjectWizardPlannedMountsSection.tsx`（88 行）的唯一消费者。338/870 行 = 38.9% 死代码。后果不只是体积：`AddProjectWizardWindow.tsx:117` 与 `:143` 把 `extraMounts` 硬编码为 `[]`，`useAddProjectWizardCreateProject.ts` 却完整保留了 extraMounts 的编排逻辑（`:126-134`）——**一条完整的、有回滚保护的多挂载创建路径存在于生产代码中，但没有任何 UI 能触发它**。

**单点最高价值改动**：**把 endpoint 选择从「向导里的一个下拉」升格为「贯穿流程的 Host 作用域」，并让「添加远程机器」在向导内联完成而非跳走**（§5、§6-S2）。它同时关掉问题 2 的断头路、给前置报告的「在项目中使用…」一个真实落点，并且是 Orca 唯一真正值得搬的推理（§4.2）。

**Q3 的答案（落点）**：**落到「新建项目」向导，而不是挂载管理器**，因为挂载管理器强制要求先有一个 project（`useAppShellWorkspaceActions.ts:129-138` 必须传 `workspaceId`），而「刚连好一台远程机器」的用户恰恰最可能还没有项目。详见 §5。

**Q5 的答案（模式还是独立路径）**：**一个流程内的作用域（scope），不是模式（mode），更不是独立路径。** 论证见 §6——关键论据是 remote 与 local 的差异只发生在「路径怎么选」这一步，而**不**发生在「项目是什么」这一层；把它做成 mode 会强迫用户在信息最少的时刻做选择。

**总体工作量形状**：**6 个步骤，其中 4 个可独立发布且零契约变更**。最大的一块（Host 作用域 + 内联添加）是纯 presentation + 1 个新 domain 纯函数，**不需要新 Control Surface 契约**——这比前置报告的 S6 便宜得多。

---

## 1. Q1：今天创建一个项目，到底发生了什么

### 1.1 入口盘点（不假设向导是唯一入口）

四个 UI 入口全部汇聚到同一个 `handleAddWorkspace`（`AppShell.tsx:265`）：

| 入口 | 代码 | 是否传 anchor |
| --- | --- | --- |
| 侧栏工具栏 `+` | `SidebarToolbar.tsx:39-45` | **是**（按钮的 `getBoundingClientRect()`） |
| 快捷键 / 命令面板 `onAddProject` | `AppShell.tsx:221-224` | 否 |
| 空态按钮 | `WorkspaceEmptyState.tsx:15` ← `WorkspaceMain` ← `AppShell.tsx:376` | 否 |
| CommandCenter | `CommandCenter.tsx:188` ← `AppShellPopups.tsx:106-108` ← `AppShell.tsx:438` | 否 |

`handleAddWorkspace = useAddProjectRequest(openAddProjectWizard, ...)`（`AppShell.tsx:265`），它只做一件额外的事：关掉 focus 预览（`useAddProjectWizardRequest.ts:15-16`）。

**存在第二条创建路径，且它是生产死代码**：`useAddWorkspaceAction.ts:7-35` 也能创建 workspace，但全仓只有它自己的 spec 引用它（`grep -rn "useAddWorkspaceAction" src/` 仅命中 `useAddWorkspaceAction.spec.tsx:10/30/44`）。它与向导有两处**语义分歧**：

- 它**有去重**：`store.workspaces.find(w => w.path === selected.path)` 命中就切过去而不新建（`:16-20`）。向导**没有**（详见 §1.4-D）。
- 它创建的 workspace **完全没有 mount**（`:22-30` 直接 spread `selected`，从不调 `mount.create`）。

> 「未确认」：我未能确认 `useAddWorkspaceAction` 是历史遗留还是为某条未接线的入口预留。它当前不可达，所以**不构成用户可见问题**，但它是一份与向导冲突的第二套语义，建议删除或接线，二选一。

**一个 anchor 粘滞小缺陷**：`openAddProjectWizard` 只在传了 anchor 时才 `setAddProjectWizardAnchor`（`useShellOverlayState.ts:112-114`）。四个入口里只有侧栏传 anchor。所以「先从侧栏打开一次，再从命令面板打开」，弹窗会**贴在侧栏按钮下方**而不是回到默认 `{x:24,y:64}`（`:36`）。低危，但属于「状态没有归位」。

### 1.2 两条完全不同的路径

这是 Q1 最重要的答案：**流程不是一个，是两个，由 `remoteWorkersEnabled` 岔开**。

```
用户点「+」
  │
  ├─ remoteWorkersEnabled = false（默认，agentSettings.defaults.ts:66）
  │    └─ AddProjectWizardWindow 渲染 null（:180）
  │       + effect 自动调 chooseLocalFolder(true)（:150-163）
  │       └─ 系统原生目录选择器
  │            ├─ 用户取消 → onClose()（:129-133），什么都没发生
  │            └─ 用户选中 → 立即 createProject()（:141-147）
  │                          零确认、零项目名输入、零位置类型选择
  │                          ✅ 步骤数 = 1（点「+」→ 选目录 → 完成）
  │
  └─ remoteWorkersEnabled = true
       └─ 渲染锚定弹窗（:188-283）
          ├─ 段控：本地 / 远程（DefaultLocationSection.tsx:59-77）
          ├─ 本地：路径输入框 + 浏览…（:82-102）
          │        ⚠️ 点「浏览…」→ chooseLocalFolder(true) → **也是立即创建**（:243-245）
          │           即「浏览」按钮实际是「浏览并创建」，与下方的「创建」按钮语义重叠
          └─ 远程：
             ├─ endpoint 数 = 0 → 空态 + 「添加远程 Worker…」→ 💀 断头路（§2.2）
             └─ endpoint 数 > 0 → CoveSelect + 状态槽 + 路径输入 + 浏览…
                                   点「浏览…」→ RemoteDirectoryPickerWindow
                                                └─ ⚠️ 立即触发 endpoint.prepare（§7）
```

### 1.3 必填输入与被迫决策

| 输入 | 必填？ | 用户实际要做的决策 | 本质 vs 偶然 |
| --- | --- | --- | --- |
| 位置类型（本地/远程） | 是（远程开关开时） | 「我这个项目跑在哪」 | **本质**，但**时机错了**（§6） |
| 根路径 | 是 | 选目录 | **本质** |
| endpoint（远程分支） | 是 | 选哪台机器 | **本质** |
| 项目名 | **否，且 UI 上不存在** | — | 见下 |
| 挂载点名 | 否，从 basename 推导 | — | 偶然，已正确隐藏 |

**项目名是本报告发现的一处 UI/逻辑失配**：

- 项目名**从不由用户输入**，而是从根路径 basename 推导（`AddProjectWizardWindow.tsx:96-99`）。
- 但校验层有一条 `name.length === 0` 分支，报错文案是 **「请填写项目名称，或先选择一个目录。」**（`useAddProjectWizardCreateProject.ts:62-64`，文案 `zh-CN.shell.ts:58`）。
- 界面上**没有任何项目名输入框**。i18n 里 `addProjectWizard.nameLabel`（`zh-CN.shell.ts:56`）与 `namePlaceholder`（`:57`）**全仓零引用**（`grep -rn "addProjectWizard.nameLabel" src/` 无结果）。

即：**一条要求用户做一件界面上做不到的事的错误提示**。它可达吗？可达——远程分支填一个 `/`（`basename('/')` 返回 `'/'`… 实测需确认）或路径末尾全是分隔符时 `basename` 返回空串（`pathHelpers.ts:9-13`：`'/'.replace(/[\\/]+$/,'')` → `''` → `split` 后 `filter(Boolean)` 为空 → 返回 `normalized` 即 `''`）。所以**远程分支输入 `/` 会得到一条无法执行的错误提示**。

> 「未确认」：我未运行应用复现。结论由 `pathHelpers.ts:9-13` 的字符串推导得出，建议以单测钉死而非手工验证。

同类孤儿 key：`descriptionLocalOnly`（`zh-CN.shell.ts:55`）零引用——它显然是为 §1.2 那条 local-only 路径准备的文案，但那条路径**渲染 null，根本不显示任何文案**（`AddProjectWizardWindow.tsx:180`）。`:205` 无条件用 `description`。

### 1.4 失败点与用户所见

| # | 失败点 | 用户看到 | 评价 |
| --- | --- | --- | --- |
| A | 项目名为空 | 「请填写项目名称，或先选择一个目录。」 | ❌ **不可执行**（§1.3） |
| B | 路径为空 | 「请先选择一个默认位置。」（`:74`/`:100`） | ✅ 清楚 |
| C | 路径非绝对 | 「本地/远程路径必须是绝对路径。」（`:79`/`:105`） | ⚠️ 校验本身跨平台错位，见下 |
| D | 重名项目 | **什么都没有** | ❌ 见下 |
| E | `mount.create` 抛错 | `toErrorMessage(caughtError)`（`:201`）→ 顶部红字（`AddProjectWizardWindow.tsx:210-214`） | ⚠️ 已回滚，但文案可能是英文 debug 串 |
| F | 本地路径不存在 | **创建成功** | ❌ 见下 |

**D — 重名检查是一个空 if：**

```ts
if (options.existingWorkspaces.some(workspace => workspace.name.trim() === name)) {
  // allow duplicates, but warn via subtle error messaging
}
```
（`useAddProjectWizardCreateProject.ts:123-125`）

注释承诺了 warn，**函数体是空的**。`existingWorkspaces` 这个 prop 从 `AppShellPopups.tsx:132` 一路传进来（`AddProjectWizardWindow.tsx:23`→`:105`），**唯一的用途就是喂给这个空 if**。同时按 §1.1，那条死掉的 `useAddWorkspaceAction` 反而实现了按 path 去重（`:16-20`）。所以仓库里同时存在「实现了去重的死代码」与「承诺去重但没实现的活代码」。

**F — 不存在的路径可以创建成功：** 本地分支只校验 `isAbsolutePath`（`:78`），`mount.create` 后端对 local 只做 `approvedWorkspaces.registerRoot(payload.rootPath)`（`topologyHandlers.ts:337`），而 `registerRoot` 只做 trim + 归一化 + 落盘（`ApprovedWorkspaceStoreCore.ts:160-174`），**从不 stat**。向导侧也没有任何 `existsSync`/`stat`（`grep` 无结果）。于是手输 `/nope/nope` 会创建出一个指向不存在目录的项目。

**C — `isAbsolutePath` 跨平台错位：** `pathHelpers.ts:5-7` 的正则 `/^([a-zA-Z]:[\\/]|\\\\|\/)/` 同时接受 Windows 盘符与 POSIX 绝对路径，**且远程分支复用同一个函数**（`useAddProjectWizardCreateProject.ts:104`）。于是给一个 POSIX 远程机器填 `C:\foo` 会通过校验。`topology.ts` 里明明建模了 `remotePlatform`（前置报告 §7-5 已指出），此处没用上。低频，但属于「有信息却没用」。

---

## 2. Q2：今天能在创建时选远程吗？好用吗？

**能，但它是「技术上存在、实际上不可达」的典型。** 分三层说。

### 2.1 默认不可达

`experimentalRemoteWorkersEnabled` 默认 `false`（`agentSettings.defaults.ts:66`）。为 false 时：

- 段控整个不渲染（`AddProjectWizardDefaultLocationSection.tsx:56` 的 `showRemote ? ... : null`），且 `effectiveDefaultLocationKind` 被强制为 `'local'`（`:46-48`）——**这个兜底是对的**（§8-3）。
- `useEndpointOverviews({ enabled: remoteWorkersEnabled })`（`useAddProjectWizardRemoteEndpoints.ts:32`）不拉取。
- 整个向导 `return null`（`AddProjectWizardWindow.tsx:180`）。

即：**用户必须先知道有个实验开关，才能知道有个新建项目向导。**

### 2.2 开了之后，空态是断头路（本报告最严重的可修问题）

远程分支且 `remoteEndpointsCount === 0` 时（`AddProjectWizardDefaultLocationSection.tsx:105`），渲染空态卡片 + 主按钮「添加远程 Worker…」（`:110-121`）。

追这个按钮：

```
onRequestOpenEndpoints()                       DefaultLocationSection.tsx:118
  → AppShellPopups.tsx:137 传入
  → AppShell.tsx:426-430
      handleOpenSettings(remoteWorkersEnabled ? 'endpoints' : 'worker')
  → AppShell.tsx:297-305 handleOpenSettings
      :301  closeTransientOverlays()          ← 💀
  → useShellOverlayState.ts:46-54
      :53  setIsAddProjectWizardOpen(false)   ← 💀 向导被销毁
```

**后果**：`AddProjectWizardWindow` 的 11 个 `useState`（`:33-46`）全部随卸载消失。用户填过的本地路径、选过的位置类型、输了一半的远程路径——全丢。配完 endpoint 之后，**没有任何机制把他送回向导**：`handleOpenSettings` 没有记录「我是从向导来的」，settings 关闭时（`AppShell.tsx:490` 的 `setIsSettingsOpen(false)`）也不恢复任何东西。

这与前置报告 §1.3 的发现严格对称，构成一个闭合的坏环：

```
健康 endpoint 卡片 ──（无前进动作，前置报告 §1.3）──✗
       ▲                                              
       │ 用户被迫手动导航回来（无引导）                 
       │                                              
   设置页 ◀──（向导自杀式跳转，本报告 §2.2）── 新建项目向导空态
```

**两端都断，中间没有一条完整的路。** 这正是用户「连接远程后应当能在新建项目时选到它」这个诉求的技术根因。

顺带：空态文案是 `addProjectWizard.noRemoteWorkersHint` = 「请先到『设置 → 远程 Worker』添加一个远程 Worker。」（`zh-CN.shell.ts:71`）。前置报告 §3.2-A 已证明**这个导航名不存在**（实际叫「Worker 与连接」）。但**导航目标本身是对的**：`'endpoints'` 是合法 page id，注册表把它映射到 `canonicalPageId: 'worker'` 且带 `scrollTargetId: 'settings-section-endpoints'`（`settingsPageRegistry.ts:131-134`），会自动滚到 endpoints 区。**跳转是对的，只有文案在骗人**——这个区分很重要，S1 只需改文案，不需要改跳转。

### 2.3 有 endpoint 之后，可用但有三处钝感

**做对了的**（§8 详述）：复用 `RemoteEndpointStatusSlot`（`AddProjectWizardWindow.tsx:228-243`）→ 内部就是 `RemoteEndpointStatusPanel`（`RemoteEndpointStatusSlot.tsx:32`）；下拉项带状态徽标（`useAddProjectWizardRemoteEndpoints.ts:48`）；stale 请求丢弃继承自 `useEndpointOverviews`。

**三处钝感**：

1. **自动选中第一个 endpoint，不看健康度。** `useAddProjectWizardRemoteEndpoints.ts:69`：`return remoteOverviews[0]?.endpoint.endpointId ?? ''`。列表顺序即选择依据。如果第 1 台是坏的、第 2 台是好的，用户默认落在坏的那台上。对比 Orca 的 `canSelectAddRepoHost` 三级回退（§4.3）。
2. **选中后徽标消失。** `CoveSelect` 传了 `showTriggerBadge={false}`（`AddProjectWizardDefaultLocationSection.tsx:131`），而 `CoveSelect.tsx:324` 正是靠这个 flag 决定 trigger 上要不要显示 `selectedOption.badge`。所以状态只在**展开列表时**可见（`:388`）。好在下方 `remoteStatusSlot` 补上了（`:133`），所以**不算 bug，只是徽标计算了却没在收起态用**。
3. **「浏览…」是一颗延迟地雷。** 见 §7.1。

### 2.4 诚实结论

远程选择**不是装饰**——它接线完整、能创建成功、复用了正确的状态组件。它的问题是**入口经济学**：要用到它，用户得先打开实验开关、再自己找到设置页配好 endpoint、再回到向导（而向导已被销毁一次）。**技术完成度 ≫ 可达性**，这与前置报告对 endpoints UI 的判断是同一个病灶的两个部位。

---

## 3. Q4：Orca 怎么做

只提炼**推理**，不搬文件。Orca 的抽象层与 OpenCove 不同（Repo/Host vs Project/Mount/Endpoint），照抄结构会直接违反 OpenCove 分层。

### 3.1 规模对照先摆出来

| | OpenCove | Orca |
| --- | --- | --- |
| 新建项目相关代码 | ~870 行（其中 **338 行死代码**） | `AddRepo*` 系列 ~3976 行 + `sidebar/` 若干 hook |
| 步骤模型 | 无（单屏） | 显式 `AddRepoDialogStep` 状态机（`add-repo-dialog-types.ts`，(orca)） |
| 远程参与方式 | 段控里的一个 mode | 贯穿全流程的 Host 作用域 |

**Orca 在这块投入了约 4.5 倍代码。** 这本身不是优点——但它意味着 Orca 的形状是被真实需求压出来的，值得看它把复杂度放在了哪。

### 3.2 核心推理：Host 是「作用域」，不是「模式」

这是本报告认为唯一值得搬的 Orca 推理。

`AddRepoHostSelector.tsx:53-76` (orca) 把 Host 渲染成一个**常驻在对话框顶部的小型 combobox**（`Host [my-box ▾]`），而不是一个 local/remote 二选一段控。它在**每一个步骤**都在场（`AddRepoDialog.tsx:363` (orca) 把 `AddRepoHostSelectorSlot` 传进 `AddRepoDialogStepContent`）。

**推理**：用户选的不是「本地模式还是远程模式」，而是「这个项目住在哪台机器上」。一旦确定，后续所有步骤（浏览、克隆、新建）都自动被限定在那台机器的语义里——**它是这些步骤的作用域，不是它们的兄弟选项**。

具体到主动作，`add-repo-local-start-actions.ts:36-65` (orca) 保持 `kind: 'browse'` **不变**，只换文案：

| 选中的 Host | 主动作标题 | 描述 |
| --- | --- | --- |
| local | `Browse folder` | `Local project, Git repo, or folder with many repos` |
| ssh | `Open project on SSH host` | `Existing Git repository or folder on this SSH host` |
| runtime | `Browse folder` | `Existing Git repository or folder on this host` |

**同一个动作，被作用域重新表述。** 用户的心智动作数没有增加。这是 Q5 的核心论据。

### 3.3 不可用不隐藏，而是「可见 + 禁用 + 说明为什么」

`add-repo-local-start-actions.ts:92-108` (orca) 的「Create new project」：SSH host 下 `disabled: !canCreateProject`，且**描述文案换成 `'Not available for SSH hosts yet'`**。

**推理**：能力矩阵的空洞要**说出来**。隐藏会让用户以为自己找错了地方，禁用+说明让他知道「这条路存在，只是这台机器还不行」。

注意这**与前置报告 §2.2 引用的 Orca 卡片动作互斥呈现是相反的策略**，而且两者都对：**状态**（连接中/已连接）用互斥呈现，因为它会变；**能力**（SSH 不支持新建）用禁用+说明，因为它不会随用户操作改变。前置报告没有区分这两者，此处补上。

### 3.4 渐进披露：没有远程机器时，选择器根本不存在

`AddRepoHostSelector.tsx:42-45` (orca)：

```ts
const showHostSetupActions = Boolean(onAddSshHost || onAddRemoteServer)
if (!shouldShowHostScopeControls(hosts) && !showHostSetupActions) {
  return null
}
```

`shouldShowHostScopeControls` = `hosts.some(host => host.id !== LOCAL_EXECUTION_HOST_ID)`（`sidebar-host-options.ts:98-100` (orca)）——**只有本地时整个控件消失**。

**推理**：远程能力的 UI 成本应当只由使用远程的用户支付。这与 OpenCove 用一个**全局实验开关**（`experimentalRemoteWorkersEnabled`）达到类似效果，但 Orca 的判据是**事实**（你有没有远程机器），OpenCove 的判据是**声明**（你有没有打开开关）。事实优于声明——它不需要用户先知道开关存在。

### 3.5 断头路是在「拉」侧解决的，不是「推」侧

**这是本报告对 Q3 最关键的一手证据，而且它是个反直觉的发现。**

我原本预期 Orca 的 SSH 设置卡片上会有一个「在项目中使用」。**它没有。** `SshTargetCard.tsx` (orca) 的全部动作文案是：`End remote terminals` / `Reset remote relay` / `Edit target` / `Remove target` / `Disconnect` / `Connecting` / `Test` / `Connect`（grep 该文件的 `translate()` 字面量）。**同样只有破坏性/诊断性动作，同样没有前进动作。**

Orca 解决断头路的方式是**把入口反过来**——在新建项目对话框里内联提供「添加远程主机」：

```
AddRepoHostSelector 下拉
  └─ 顶部固定项「Add remote host / SSH host or Orca server」（:84-110 (orca)）
       └─ 侧向展开二级 popover
            ├─ 「Add SSH host — Use an existing machine over SSH.」（:112-135 (orca)）
            └─ 「Add remote server — Pair with Orca running on another computer.」（:137-152 (orca)）
                 └─ onAddSshHost() → AddRepoHostSelectorSlot.tsx:22 (orca)
                      → setAddRemoteHostMode('ssh')
                      → <AddRemoteHostDialog>（同文件 :25）
```

**关键：`AddRemoteHostDialog` 是叠在新建项目对话框之上的子对话框，父对话框不关闭、状态不丢。** 对比 OpenCove 的 `closeTransientOverlays()` 直接销毁向导（§2.2）——**这就是同一个问题的两种解法，而 Orca 的解法明显正确**。

Orca **也**保留了跳全量设置页的逃生口（`use-add-repo-hosted-controller.ts:61-70` (orca) 的 `handleOpenSshSettings`），但它是次要路径，且代码里写清了为什么要先关模态：

```ts
// Why: Settings is a full page; in hosted mode the composer modal in the
// activeModal slot would otherwise stay open on top of it.
```

**推理**：设置页是「管理已有对象」的地方；创建流程需要的是「顺手补一个对象」。这两件事需求不同，不该复用同一个 UI。**「在项目中使用」这个动作之所以在 Orca 不存在，是因为它不需要存在——用户根本不必先去设置页。**

### 3.6 默认值：给一个好默认，并把它显示成人话

`create-project-defaults.ts:33-39` (orca)：`getDefaultCreateProjectParent(homeDir)` → `~/orca/projects`。
`:63-88` (orca) `formatCreateProjectParentSummary`：值等于默认值时**显示 `~/orca/projects` 而不是展开的绝对路径**。

且默认值**对远程 host 主动失效**——`getCreateProjectDefaultParentAutoFill` 在 `activeRuntimeEnvironmentId` 非空时 `return null`（`:52-54` (orca)），`formatCreateProjectParentSummary` 也为远程换一句「host folder not selected」（`:78-80` (orca)）。

**推理**：默认值必须是**在当前作用域下真实成立**的东西。本机 home 目录在远程机器上没有意义，所以宁可不填也不能瞎填。OpenCove 目前**没有任何默认路径**（`AddProjectWizardWindow.tsx:35-39` 全部初始化为 `''`），这是可改进项，但也让它自动躲过了这个坑。

### 3.7 host 切换时清空 host 作用域状态

`use-add-repo-host-change-reset.ts:23-31` (orca)：

```ts
// Why: Add Project form fields are host-path scoped, so switching hosts must
// clear typed paths and pending defaults before they can be submitted.
previousSelectedHostIdRef.current = selectedHostId
onResetHostScopedState()
```

**推理**：`/home/ubuntu/proj` 在换机器后不再有意义，留着它比清掉更危险——用户可能直接提交。这是 Q3「中途变不健康」的近亲问题，OpenCove 当前**没有对应机制**：`AddProjectWizardWindow.tsx` 的 `defaultRemoteRootPath` 在换 endpoint 时原样保留（`:250-253` 的 onChange 只在用户手输时触发）。

### 3.8 Orca 没做好的地方（避免过度崇拜参考实现）

1. **自适应排序是死的。** `add-repo-local-start-actions.ts:113-118` (orca) 用 `isSshLikely` 决定把 remote 提到 clone 前面，但**唯一的调用点硬编码 `isSshLikely={false}`**（`AddRepoDialog.tsx:293` (orca)）。一段有意图但从未生效的代码——和 OpenCove 的 `extraMounts: []`（§0-3）是同一类病。
2. **反馈依赖 toast。** `AddProjectFromFolderDialog.tsx:91-97` (orca) 成功走 `toast.success`。前置报告 §2.5 已指出同样问题：toast 会消失，OpenCove 把诊断留在卡片上更好。
3. **术语依然混乱。** `Add Project` / `Add remote host` / `Add SSH host` / `Add remote server` / `Project on SSH host` / `Open project on SSH host` 同屏并存。**不要照抄 Orca 的词表**——前置报告 §3.3 的结论（用户面只留 2 个名词）依然适用。
4. **步骤机复杂度真实存在。** ~3976 行、十余个 hook、显式 step 状态机。OpenCove 当前的单屏在**本地场景下明显更快**（§8-1），不该为了对标而引入 step 机。

---

## 4. Q3：设计「在项目中使用」的落点

这是前置报告 §8-3 明确拒绝猜测的一条。现在用证据回答。

### 4.1 候选落点评估

| 候选 | 前置条件 | 判定 |
| --- | --- | --- |
| A. 项目挂载管理器（`ProjectMountManagerWindow`） | **必须已有一个 project**：`setProjectMountManager({ workspaceId })`（`useAppShellWorkspaceActions.ts:137`），且只能从项目右键菜单进（`:129-139`） | ❌ **不能作为唯一落点**。刚配好第一台远程机器的用户**大概率一个项目都没有**——这恰是断头路本身 |
| B. 新建项目向导 | 无前置条件；四个入口任一可达（§1.1） | ✅ **默认落点** |
| C. 新建一个专用「远程项目」流程 | — | ❌ 违反 Q5 结论（§6），且要再造一份 UI |

**结论：落点 = 新建项目向导，且按上下文在 A/B 间选择。**

### 4.2 落点规则（把「没有项目」这个坑显式处理掉）

从健康 endpoint 卡片点主动作「在项目中使用…」：

```
读取 workspaces.length（AppShellPopups 已持有，:132 传给向导）
  │
  ├─ 0 个项目 → 直接开新建项目向导，远程预选该 endpoint
  │             （唯一合理动作，不给选择）
  │
  └─ ≥1 个项目 → 展开一个二级菜单（复用 Orca §3.5 的嵌套 popover 推理）：
                  ├─ 「新建项目…」            → 向导，远程预选
                  └─ 「添加到现有项目 ▸」      → 列出项目 → 挂载管理器，远程预选
```

**为什么不无脑跳向导**：已有 10 个项目的用户，想把新机器挂到现有项目上的概率远高于新建第 11 个。强制新建会制造垃圾项目。

**为什么不无脑跳挂载管理器**：见 §4.1-A，0 项目时它根本打不开。

### 4.3 交接契约：什么状态过去，用户还要选什么

**必须过去的状态**（最小集）：

| 字段 | 值 | 理由 |
| --- | --- | --- |
| `defaultLocationKind` | `'remote'` | 否则用户到了向导还要再点一次段控 |
| `defaultRemoteEndpointId` | 卡片的 endpointId | **这就是「预选」的全部含义** |

**必须由用户在向导里选的**（不要替他猜）：

| 字段 | 为什么不预填 |
| --- | --- |
| `defaultRemoteRootPath` | 我们不知道他想用哪个目录。Orca 也拒绝为远程 host 猜默认路径（§3.6） |
| 项目名 | 当前从 basename 推导（§1.3），路径定了它就定了 |

**绝不能过去的**：任何 overview 快照。健康状态必须由落地页**重新拉取**（`useEndpointOverviews`），否则会出现「卡片上说健康、向导里其实已经掉线」的撕裂。这一条对齐前置报告 §5.2 不变量 1（阶段进度是 runtime observation，不持久化）。

**架构落法**（DDD + Clean，`contexts/<ctx>/{domain,application,infrastructure,presentation}`）：

| 层 | 位置 | 内容 |
| --- | --- | --- |
| domain | `contexts/topology/domain/projectCreationTarget.ts`（新） | `ProjectCreationTarget = { kind: 'local' } \| { kind: 'remote'; endpointId: string }`；`resolveUsableEndpoint(overviews, preferredId)` 纯函数（见 §4.4） |
| presentation | `useShellOverlayState.ts`（改） | `openAddProjectWizard(anchor?, target?: ProjectCreationTarget)`；把 target 存进现有 state |
| presentation | `AddProjectWizardWindow.tsx`（改） | 用 target 初始化 `defaultLocationKind` / `defaultRemoteEndpointId` |

**不需要新 Control Surface 契约**——这是 renderer 内部的 overlay 状态传递，不跨进程。这让 Q3 的落点成为一个**纯 presentation 改动**，风险极低。

> 注意：`RemoteEndpointStatusPanel` 目前被 3 个表面复用（`EndpointsSection.tsx:276`、`RemoteDirectoryPickerWindow.tsx:279`、`RemoteEndpointStatusSlot.tsx:32`，而 Slot 又服务向导 `AddProjectWizardWindow.tsx:228` 与挂载管理器 `ProjectMountManagerWindow.tsx:424`）。**本方案不新增任何状态组件**，见 §8-4。

### 4.4 中途变不健康怎么办

**不阻断，降级 + 就地修复。** 三条规则：

1. **预选一个不健康的 endpoint 仍然允许进入向导。** 理由：`mount.create` 本来就不校验可达性（§7.2），阻断创建等于把一个不存在的约束强加给用户。
2. **选择时优先健康项。** 用一个 domain 纯函数替换 `useAddProjectWizardRemoteEndpoints.ts:69` 的 `remoteOverviews[0]`，语义对齐 Orca 的三级回退（`use-add-repo-host-selection.ts:63-70` (orca)）：

```
resolveUsableEndpoint(overviews, preferredId):
  1. preferredId 存在且 canBrowse            → 用它
  2. preferredId 存在但不健康                 → 仍用它，但标记 needsAttention（不静默改选）
  3. preferredId 不存在（已被删除）           → 第一个 canBrowse 的
  4. 都不健康                                → 第一个，并展示状态槽的推荐动作
```
   规则 2 很重要：**用户明确点了「用这台」，静默换成另一台是背叛意图。** Orca 在这点上更激进（`canSelectAddRepoHost` 直接回退到 local），我认为对 OpenCove 不合适——OpenCove 的状态槽已经能就地修复（下条）。

3. **就地修复，不跳走。** 向导已经渲染了 `RemoteEndpointStatusSlot`（`AddProjectWizardWindow.tsx:228-243`），它已接线 `onRunAction` / `onReconnect`（`:236-242`）→ `runRemoteEndpointAction` / `reconnectRemoteEndpoint`（`useAddProjectWizardRemoteEndpoints.ts:81-116`）。**这条路已经通了**——endpoint 掉线时用户可以在向导内点推荐动作修好，不必离开。这是 OpenCove 已有的、Orca 不具备的能力（§8-2）。

4. **endpoint 在向导打开期间被删除**：`useAddProjectWizardRemoteEndpoints.ts:60-70` 的 effect 已经处理——`resolveEndpointId` 发现当前 id 不在 `remoteOverviews` 里就回退到第一个。**这个兜底已存在且正确**，改造时必须保留。

### 4.5 但真正的修复是反过来（对齐 §3.5）

§4.1-4.4 解决的是「从设置页出发」。**Orca 的证据表明这个方向本身是次要的**——它压根没有这个动作，因为它让用户根本不必先去设置页（§3.5）。

所以完整方案是**双向**的，且「拉」侧优先级更高：

```
方向一（推 / Q3 直接问的）：健康卡片 →「在项目中使用…」→ 向导（远程预选）
方向二（拉 / 更高价值）：  向导远程空态 →「添加远程机器…」→ 内联子弹窗 → 保持向导不关
```

**方向二同时消灭 §2.2 的断头路**，且它才是新用户的真实路径（他打开向导时才第一次意识到自己需要远程机器）。方向一服务的是「已经在设置页、刚配完」的用户，是更窄的场景。

§9 的排期据此把方向二（S2）排在方向一（S4）前面。

---

## 5. IA 草图

**当前**（`remoteWorkersEnabled = true`，远程分支，无 endpoint）：

```
┌─ 锚定弹窗 360px（AddProjectWizardWindow.tsx:188-283）────────┐
│ [📁] 添加项目                                                │
│      先选择一个默认运行位置（本地或远程）。…                  │
│                                                              │
│ 默认运行位置        [ 本地 │ 远程 ]   ← 段控 = mode 切换      │
│ ┌──────────────────────────────────────────────────────┐   │
│ │  还没有远程 Worker                                    │   │
│ │  请先到「设置 → 远程 Worker」添加…  ← 导航名不存在     │   │
│ │              [ 添加远程 Worker… ]  ← 💀 点了向导就没了 │   │
│ └──────────────────────────────────────────────────────┘   │
│                                    [取消]  [创建]            │
└──────────────────────────────────────────────────────────────┘
   ✗ 无项目名输入，但校验会要求它（§1.3）
   ✗ 无默认路径
   ✗ 「浏览…」在本地分支 = 「浏览并立即创建」（§1.2）
```

**建议**：

```
┌─ 锚定弹窗（同一个弹窗，不引入 step 机）──────────────────────┐
│ [📁] 添加项目                        位置: [ 本机 ▾ ]  ←①    │
│      选择项目目录。                                          │
│                                                              │
│ ┌─ ① 展开后（作用域选择器，不是 mode 段控）────────────┐    │
│ │  ✓ 本机                                              │    │
│ │    my-box          已连接                            │    │
│ │    gpu-node        远程组件无法启动    [连接]  ←②    │    │
│ │  ──────────────────────────────────────────────      │    │
│ │  + 添加远程机器…                              ▸ ←③   │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ [ /path/to/project                    ] [ 浏览… ]     │   │
│ │  ← 选中远程时：占位符与「浏览…」自动切远程语义         │   │
│ │  ← 选中的机器不健康时，此处显示 RemoteEndpointStatus   │   │
│ │     Slot（已有组件，可就地修复，§4.4-3）              │   │
│ └──────────────────────────────────────────────────────┘   │
│                                    [取消]  [创建]            │
└──────────────────────────────────────────────────────────────┘

① 只有存在远程机器时才渲染（Orca §3.4 推理；判据是事实不是开关）
② 不健康的机器**仍可选中**，下拉内直接给修复动作（Orca §3.2 + OpenCove 已有能力 §4.4-3）
③ 内联二级弹窗，**父弹窗不关闭** —— 修掉 §2.2 断头路（Orca §3.5）
```

变化与缺陷的对应：

| 变化 | 解决 |
| --- | --- |
| 段控 → Host 作用域选择器 | §6（mode vs scope）、§2.3-1 |
| 「添加远程机器」内联，父弹窗不关 | §2.2 断头路（**最高价值**） |
| 不健康机器可选 + 下拉内修复 | §4.4 |
| 无远程机器时选择器整体不渲染 | §3.4；本地路径回到今天的 1 步体验（§8-1 不回退） |
| 路径行按作用域改写占位符/浏览语义 | §3.2 |
| 删除死代码 + 孤儿 i18n key | §0-3、§1.3 |
| 修「浏览 = 浏览并创建」的语义重叠 | §1.2 |

**明确不做**：不引入 Orca 的 step 状态机；不加项目名输入框（basename 推导是对的，只需删掉那条不可执行的错误文案，§1.3）；不加「克隆 URL / 新建空项目」等 Orca 有而 OpenCove 无的能力（超出本报告范围）。

---

## 6. Q5：远程是一个流程内的模式，还是独立路径？

**结论：既不是独立路径，也不该是「模式」——它应该是一个作用域（scope）。** 三者的区别是实质性的。

### 6.1 三种设计的对照

| | 独立路径 | 模式（今天） | 作用域（建议） |
| --- | --- | --- | --- |
| 形态 | 「新建本地项目」/「新建远程项目」两个入口 | 一个向导里的 local/remote 段控 | 一个流程 + 一个贯穿的 Host 选择器 |
| 用户何时决策 | 点入口时（信息最少） | 进向导后立刻（信息仍少） | 任意时刻，可反悔 |
| 代码 | 两套 UI | `AddProjectWizardDefaultLocationSection.tsx:79-158` 的整块三元分叉 | 一套 UI + 按作用域改写文案 |

### 6.2 论证：差异发生在哪一层？

判据应该是——**local 与 remote 的差异，究竟渗透到流程的哪些层？**

逐层检查，全部有据（下表 `:xx` 均指 `useAddProjectWizardCreateProject.ts`，除非另注）：

| 层 | local vs remote 是否不同 | 证据 |
| --- | --- | --- |
| 「项目」这个对象本身 | **相同** | `nextWorkspace` 的构造对两者完全一致（`useAddProjectWizardCreateProject.ts:167-178`），没有任何 remote 分支 |
| 项目名推导 | **相同** | 同一个 `basename(rootPath)`（`AddProjectWizardWindow.tsx:96-99`） |
| mount 记录结构 | **相同** | `PlannedMount { endpointId, rootPath, name }`（`:15-19`），local 只是 `endpointId: 'local'`（`:84`） |
| 后端建 mount | **几乎相同** | `topologyHandlers.ts:336-361` 只在「批准根目录」这一步分叉，`createMount` 本身完全共用（`:364`） |
| **路径怎么选** | **不同** | 系统原生选择器（`AddProjectWizardWindow.tsx:134`）vs `RemoteDirectoryPickerWindow`（`:286-302`） |
| **workspace.path 从哪来** | **不同** | local 用 mount 根路径；remote 要先 `workspace.allocateProjectPlaceholder`（`useAddProjectWizardCreateProject.ts:143-152`） |
| 校验规则 | **应当不同但今天相同** | 共用 `isAbsolutePath`（§1.4-C） |

**差异集中在「路径怎么选」，而不在「项目是什么」。**

这直接否掉独立路径：两条路径会在 `useAddProjectWizardCreateProject.ts` 的 167-178 行**汇合成完全相同的代码**，分叉它们等于制造重复。

也否掉模式：`endpointId: 'local'` 这个设计（`:84`）已经在**数据层**表明 local 只是 endpoint 的一个特例，不是一个平行世界。UI 用段控把它拔高成二选一，**与自己的数据模型不一致**。作用域选择器把 local 放回成「机器列表里的第一项」，UI 才与数据对齐。

### 6.3 用户必须提前知道什么 vs 可以推迟

| 必须提前 | 可以推迟 |
| --- | --- |
| 「这个项目跑在哪台机器上」——它决定后面能浏览哪个文件系统 | 项目名（basename 推导） |
| | 额外挂载点（`description` 已承诺「之后也可以随时再添加更多位置」，`zh-CN.shell.ts:54`） |
| | 远程机器健不健康（§4.4：不阻断，可就地修） |

「跑在哪台机器上」确实必须提前——**但作用域选择器同样是提前问的**，它只是问得更轻（一个默认值为「本机」的下拉，而不是一个必须二选一的段控），且允许反悔。

**成本对称性检查**：作用域方案对纯本地用户的成本是多少？**零**——`shouldShowHostScopeControls` 推理（§3.4）保证没有远程机器时选择器不渲染，本地用户看到的界面与今天一致。这是这个方案能成立的关键前提，也是它优于「模式」的最后一块论据。

### 6.4 反论及回应

> **反论**：段控更直白，用户一眼看到「有远程这个选项」。

有道理，但代价是**每个用户每次都要付这个认知成本**，而绝大多数创建是本地的。且今天段控只在实验开关打开时才渲染（`DefaultLocationSection.tsx:56`），**它的发现价值本来就没兑现**——真正打开开关的用户已经知道有远程了。

> **反论**：作用域选择器藏在下拉里，远程能力更难被发现。

这由 §4.5 方向一（设置页的「在项目中使用…」）补偿：刚配好机器的用户会被主动送到向导。发现路径从「猜界面」变成「跟着流程走」。

---

## 7. Q6：失败与延迟

### 7.1 真实的慢点在「浏览…」，不在「创建」

前置报告 §4.1 测得 prepare 最坏 ~137s。本报告要修正一个可能的误读：**这个耗时不落在创建按钮上，落在「浏览…」按钮上。**

`RemoteDirectoryPickerWindow.tsx:231-242` 的 `useLayoutEffect` 在弹窗打开时**无条件** `void handlePrepare('browse', true)`（`:241`），而 `handlePrepare` 是一次 `endpoint.prepare` 的 await（`:163-168`）。

于是：向导里点「浏览…」（`AddProjectWizardDefaultLocationSection.tsx:146-155`）→ `openRemotePicker`（`AddProjectWizardWindow.tsx:165-179`）→ 打开选择器 → **立刻进入最长 137 秒的静默等待**，期间只有 `isBusy` 让按钮变灰（`:306` 等处的 `disabled={isBusy || !canBrowse}`）。**无阶段、无预计耗时、无取消。**

**创建按钮反而很快**（§7.2）。所以「远程项目创建很慢」这个直觉是错的——**慢的是选路径，而选路径是可以绕过的**（手输路径就不触发 prepare）。这个区分对修复优先级很重要。

### 7.2 `mount.create` 根本不校验可达性——这是双刃剑

`topologyStore.ts:289-297`：remote 分支**只校验 endpoint 记录是否存在**，不做任何连通性检查。随后直接构造记录并落盘（`:303-327`）。

而 `topologyHandlers.ts:338-360` 里那次远程 `workspace.approveRoot`，是一个**彻底的 fire-and-forget**：

```ts
void deps.topology
  .resolveRemoteEndpointConnection(payload.endpointId)
  .then(endpoint => { if (!endpoint) { return } ... })
  ...
  .catch(() => undefined)          // :360
```

`void` 起手、`.catch(() => undefined)` 收尾、`if (!endpoint) return` 静默放过，且 `result.ok === false` 时也只是 `return`（`:357-359`）。**主流程 `:364` 的 `createMount` 完全不等它。**

后果分两面：

**好的一面**：远程项目创建**永远是快的**，不会因为 endpoint 挂了就卡 137 秒。这其实是个正确的产品决策——创建一个指向远程目录的项目，不必然要求此刻能连上（对齐 §4.4-1）。

**坏的一面**：远程根目录**可能从未被批准**，而用户完全不知情。失败被推迟到用户第一次开终端/开文件时，届时得到的是前置报告 §4.4 描述的那句 `'Worker is unavailable.'`（`appError.ts:10`）——**一个与「创建项目」这个动作在时空上完全脱钩的错误**。

> 「未确认」：远程根目录未被批准，是否**必然**导致后续文件/终端操作失败，我没有追完 `filesystemMountSupport` 的完整判定链。但「批准结果被静默丢弃」这一事实由 `topologyHandlers.ts:338-360` 的代码结构直接证实。

### 7.3 建议行为：复用 bootstrap fix 的 `failureKind`，不另起模型

任务要求「复用前置报告的分阶段/StageFailureCode 方向，不要发明第二套竞争模型」。**在途 bootstrap fix 已经把这件事做了一半**，所以正确做法是**接上它，而不是接上前置报告的纸面设计**。

bootstrap fix（未提交，`ssh-bootstrap-fix` 工作区）已引入：

```ts
export type ManagedSshBootstrapFailureKind =
  | 'installer_unavailable'
  | 'runtime_corrupt'
  | 'runtime_start_failed'
  | 'unknown'
```
（`managedSshRuntimeSupport.ts:6-10` (bootstrap-fix)）

配套：`ManagedSshBootstrapError`（`:12-14` (bootstrap-fix)）、`classifyManagedSshBootstrapFailure(detail)`、snapshot 上新增 `failureKind` 字段（`managedSshEndpointRuntime.ts:43` (bootstrap-fix)）、DTO 新增两个状态 `installer_unavailable` / `runtime_corrupt`（`dto/topology.ts:81-82` (bootstrap-fix)），以及**正确的动作映射**（`endpointHealthService.ts:217-233` (bootstrap-fix) 的 `projectManagedRuntimeFailure`）：

| failureKind | status | recommendedAction |
| --- | --- | --- |
| `installer_unavailable` | `installer_unavailable` | `retry` |
| `runtime_corrupt` | `runtime_corrupt` | `install_runtime` |
| `runtime_start_failed` | `error` | `retry` |
| 其他 | `tunnel_failed` | `repair_tunnel` |

**这正是前置报告 §4.3 指出的「隧道好好的却建议重连隧道」那个错误建议的修复。** 前置报告 §6 建议把 `StageFailureCode` 交给 bootstrap fix 作者顺手做——**那个建议被采纳了**。

因此本报告对 Q6 的建议是**纯增量**，不新增枚举：

1. **不新建进度模型。** 前置报告 S6 的 `RemoteSetupStage` 若要落地，应当**以 `ManagedSshBootstrapFailureKind` 为失败维度的唯一真相**，`StageFailureCode` 要么等价于它、要么是它的超集。**由 S6 的所有者负责对齐，本报告不定义第二套。**
2. **向导只需消费，不需生产。** 向导已经通过 `RemoteEndpointStatusSlot` → `RemoteEndpointStatusPanel` 渲染 `recommendedAction`（`RemoteEndpointStatusPanel.tsx:123-149`）。bootstrap fix 落地后，**向导里的错误建议会自动变正确，零改动**。这是复用共享组件的直接回报（§8-4）。
3. **「浏览…」的等待需要阶段反馈**（§7.1）——这是 S6 的作用域，不是本报告的。本报告只补一条：**在 prepare 返回前就把预计耗时说出来**（「首次连接约需 1-2 分钟」），这是纯 i18n + 一行条件渲染，可以先于 S6 发布。
4. **创建路径保持 fire-and-forget，但要可观测。** 不建议让 `mount.create` 等待远程批准（会毁掉 §7.2 的好处），建议改为：批准失败时**在项目上留下一个可见标记**，而不是 `.catch(() => undefined)` 吞掉。具体形态需与 mount 修复流程（`useWorkspaceMountRepair.ts` 已存在）协同设计——**「未确认」：我没有梳理 `useWorkspaceMountRepair` 的完整职责，不确定它是否已覆盖此场景。这一条必须先确认再动。**

---

## 8. 反面论证：OpenCove 现在比 Orca 好的地方（改造不得回退）

前置报告在 endpoints UI 上找到 5 条安静优点，那一节被证明有价值。同样做一遍。

**1. 本地创建只要 1 步，Orca 要 3 步。** OpenCove 默认路径：点「+」→ 系统选择器 → 完成（`AddProjectWizardWindow.tsx:150-163` 自动开选择器 + `:141` 立即创建）。Orca：点「+」→ `AddRepoLocalStartStep` 选「Browse folder」→ 系统选择器 → **还要过一道 `AddProjectFromFolderDialog` 确认**（`AddProjectFromFolderDialog.tsx:169-206` (orca)）。

**这是本报告发现的最大的、也最容易被重构毁掉的优点。** §5 的草图必须保证：**没有远程机器时，本地体验一步不多。** 任何把「统一流程」凌驾于此之上的方案都是回退。

**2. 状态槽可就地修复，Orca 的等价物只能跳走。** 向导内的 `RemoteEndpointStatusSlot` 已接线 `onRunAction`/`onReconnect`（`AddProjectWizardWindow.tsx:236-242`），用户能在向导里直接跑推荐动作。Orca 的 `AddRepoHostSelector` 只有一个 `Connect`（`AddRepoHostSelector.tsx:195-220` (orca)），修不了「runtime 损坏」这类问题，只能去设置页。**OpenCove 更强，保留。**

**3. `showRemote=false` 时强制 `effectiveDefaultLocationKind='local'`。** `AddProjectWizardDefaultLocationSection.tsx:46-48`：

```ts
const effectiveDefaultLocationKind: DefaultLocationKind = showRemote ? defaultLocationKind : 'local'
```

即使 state 里残留 `'remote'`，远程开关关掉后也一定渲染本地分支。**一个防止 UI 卡在不可达状态的正确兜底**，重构时容易顺手删掉。保留。

**4. 已经复用共享状态组件，没有第 4 份实现。** 任务特别要求检查这点，结论是**已经做对了**：

```
RemoteEndpointStatusPanel（唯一实现）
  ├─ EndpointsSection.tsx:276            （设置页）
  ├─ RemoteDirectoryPickerWindow.tsx:279 （远程目录选择器）
  └─ RemoteEndpointStatusSlot.tsx:32     （轻封装）
       ├─ AddProjectWizardWindow.tsx:228     （新建项目向导）
       └─ ProjectMountManagerWindow.tsx:424  （挂载管理器）
```

一个实现，5 个消费点。Orca 的对应物是三份独立实现（前置报告 §7-4）。**§4/§5 的所有建议都不新建状态组件**——Host 选择器复用现有 `RemoteEndpointStatusSlot`，只在下拉项里额外渲染 `getEndpointStatusLabel`（`useAddProjectWizardRemoteEndpoints.ts:48` 已经在算了）。**不得出现第 4 份。**

**5. 创建失败会回滚已建的 mount。** `useAddProjectWizardCreateProject.ts:190-199`：catch 里遍历 `createdMountIds` 逐个 `mount.remove`，且每个都 `.catch(() => undefined)` 防止回滚本身抛错中断其余回滚。多挂载点场景下这是正确的补偿事务。Orca 的 `AddProjectFromFolderDialog` 无等价物（单 repo，不需要）。**保留**——尤其是如果 §0-3 的死代码被复活成真实的多挂载能力，这段回滚会立刻变得关键。

**6. `endpoint.prepare` 的并发合流与 stale 丢弃。** 向导用的 `useEndpointOverviews` 带 `requestCounterRef` 过期丢弃（前置报告 §7 已记，此处确认向导也受益）。

**回退风险最高的是第 1、4 两项**：第 1 项会被「统一流程」的冲动毁掉；第 4 项会被「新建一个 HostSelector 组件」的冲动毁掉。

---

## 9. 分阶段计划

按「用户可见价值 / 风险」排序。**S1、S3、S5、S6 零契约变更。**

| 步骤 | 内容 | 类型 | 独立可发 | 价值/风险 |
| --- | --- | --- | --- | --- |
| **S1** | i18n 修复：改掉 `noRemoteWorkersHint` 的死导航名（`zh-CN.shell.ts:71`/`en.shell.ts:74`）；删除孤儿 key `nameLabel`/`namePlaceholder`/`descriptionLocalOnly`（`zh-CN.shell.ts:55-57`）；把不可执行的 `nameRequired`（`:58`）改成指向真实操作的文案 | 纯 i18n | ✅ | 中/极低 |
| **S2** | **向导内联「添加远程机器」子弹窗，父弹窗不关闭**——修 §2.2 断头路 | 纯 presentation | ✅ | **最高**/低 |
| **S3** | 删除死代码 `AddProjectWizardAdvancedSection.tsx` + `AddProjectWizardPlannedMountsSection.tsx`（338 行），或反向：接线复活。**二选一，不能继续悬空** | 删除 or 接线 | ✅ | 中/低（删除）· 中/中（复活） |
| **S4** | **Q3 落点**：健康卡片主动作「在项目中使用…」→ 按 §4.2 规则跳向导/挂载管理器，携带 `ProjectCreationTarget` | presentation + 1 domain 纯函数 | ✅（依赖 S2 更佳） | 高/低 |
| **S5** | 段控 → Host 作用域选择器（§5 草图）；`resolveUsableEndpoint` 替换 `remoteOverviews[0]`；无远程机器时不渲染 | presentation + domain 纯函数 | ✅ | 高/中 |
| **S6** | 小修：空重名 if（`:123-125`）落实或删除；`isAbsolutePath` 按 `remotePlatform` 分流；「浏览…」预计耗时提示；anchor 归位 | presentation | ✅ | 中/极低 |

**建议顺序**：`S1 → S2 → S3 → (S4, S6 并行) → S5`。

理由：S2 单独就能把最痛的断头路关掉，且不依赖任何其他线；S3 先清死代码，S5 改的正是被清理后的文件，顺序反了会白改；S5 最大，放最后，且它**必须在 S2 之后**——S2 建立的内联子弹窗正是 S5 草图里 ③ 的落点。

### 9.1 独立可发性说明

- **S1/S2/S3/S6 严格独立**，互不依赖。
- **S4 技术上独立**，但在 S2 之前发布价值打折：把用户送进向导，而向导本身还有断头路。
- **S5 依赖 S2**（复用其子弹窗）与 **S3**（避免改动即将删除的文件）。

---

## 10. 冲突分析

### 10.1 与 PR #317（合入中）

**结论：零冲突。** `git diff --name-only origin/main...origin/DeadWaveWave/ssh-experience | grep -E "shell/|addProjectWizard"` 返回空——#317 未触及本报告的任何战场文件。

唯一的间接接触：S1 要改 `zh-CN.shell.ts` / `en.shell.ts`，而 #317 改的是 `{en,zh-CN}.settingsPanel.endpoints.ts`——**不同文件**。

**不要重做 #317 已修的**：endpoint 编辑、删除确认、端口三态校验、`expectedMountCount` fail-closed。

### 10.2 与远程 worker UX 报告的 S2-S7

| 该报告步骤 | 本报告 | 关系 | 归属建议 |
| --- | --- | --- | --- |
| S1（`dependentMountCount` 漏传） | 无 | 无关 | 远程线 / 或并入 #317 |
| S2（术语统一） | S1 改 `shell.ts` 的 endpoint 相关文案 | **文件不同但词表必须一致** | **术语词表归远程线所有**；本线 S1 只做「死导航名 + 孤儿 key」，**不自行定义新词**。若远程线 S2 先落，本线 S1 直接采用其词表 |
| S3（endpoints IA 重组） | 无 | 无关（不同文件） | 远程线 |
| **S4（卡片动作模型，含 `connected` 主动作改「在项目中使用…」）** | **S4（落点）** | **⚠️ 同一个功能的两端** | **动作按钮本身归远程线 S4**（它在 `EndpointsSection.tsx`/`RemoteEndpointStatusPanel.tsx`）；**落点与 `ProjectCreationTarget` 契约归本线 S4**（在 `useShellOverlayState.ts`/`AddProjectWizardWindow.tsx`）。**两边不要各写一半跳转逻辑**——建议本线先落地 target 参数与接收端，远程线的按钮直接调用它 |
| S5（表单脏数据保护） | 无 | 无关 | 远程线 |
| **S6（阶段进度模型）** | **§7.3** | **⚠️ 本线是消费方** | **S6 归远程线 / bootstrap fix 线**。本线**不定义任何阶段枚举**，只在「浏览…」等待处消费。见 10.3 |
| S7（故障现场消费 recommendedAction） | §7.2 的远程批准静默失败 | 弱重叠 | S7 归远程线；本线只提出「不要 `.catch(() => undefined)` 吞掉」，**不实现** |

**最需要协调的是 S4。** 前置报告 §8-3 把落点标为「未确认」并拒绝实现，本报告已经把它确定下来（§4）。建议：**本线 S4 先落 `ProjectCreationTarget` 与接收端**，远程线 S4 的按钮接上它。这样两条线各改各的文件，零重叠。

### 10.3 与在途 bootstrap fix

**本线与它零文件重叠**（它改 `controlSurface/topology/*` + `commonRemoteEndpoints` i18n + `endpointOverviewUi.ts`；本线改 `shell/` + `shell.ts` i18n）。

**但存在一处语义依赖**：§7.3 已述，bootstrap fix 引入的 `ManagedSshBootstrapFailureKind` 应当成为失败分类的唯一真相。

**归属建议**：
- `failureKind` 枚举与动作映射 → **bootstrap fix 所有**，本报告不提议任何修改。
- 前置报告 S6 的 `StageFailureCode` → **必须与 `ManagedSshBootstrapFailureKind` 对齐**，由 S6 所有者负责，**不得引入第二套并行枚举**。
- 向导侧 → **纯消费方，零改动**即可受益（§7.3-2）。

### 10.4 归属总表（避免双改）

| 文件 | 归属 |
| --- | --- |
| `EndpointsSection.tsx`、`EndpointsRegisterDialog.tsx`、`EndpointRemoveDialog.tsx` | 远程线（S3/S4/S5） |
| `RemoteEndpointStatusPanel.tsx` | 远程线（S4/S6）。**本线只消费，不改** |
| `controlSurface/topology/*` | bootstrap fix → 之后远程线 S6 |
| `{en,zh-CN}.commonRemoteEndpoints.ts` | bootstrap fix / 远程线 |
| `addProjectWizard/*`、`AddProjectWizardWindow.tsx`、`useShellOverlayState.ts`、`AppShell.tsx` | **本线** |
| `{en,zh-CN}.shell.ts` | **本线**，但词表服从远程线 S2 |
| `ProjectMountManagerWindow.tsx`、`ProjectMountManagerRemoteSection.tsx` | **本线**（S4 的第二落点） |

---

## 11. 开放问题（需拍板）

1. **S3 二选一：死代码删除还是复活？** 338 行的多挂载点 UI（`AddProjectWizardAdvancedSection.tsx` + `PlannedMountsSection.tsx`）从未接线，但 `useAddProjectWizardCreateProject.ts:126-134` 的 extraMounts 编排与 `:190-199` 的回滚是为它写的。**推荐删除 UI、保留 hook 侧能力**——`description` 文案已承诺「之后也可以随时再添加更多位置」（`zh-CN.shell.ts:54`），而挂载管理器已经提供了这个能力。创建时就配多挂载点是低频高复杂度。

2. **「在项目中使用…」在已有多个项目时，二级菜单是否值得？**（§4.2）备选：永远跳新建项目向导，最简单但会催生垃圾项目。**推荐做二级菜单**，但如果要砍范围，先做「0 项目 → 向导」这一支，它是断头路的核心。

3. **Host 作用域选择器要不要显示「本机」以外的 worker 模式？** `homeWorkerMode` 已被读取（`AddProjectWizardWindow.tsx:73-91`）且 `'remote'` 时禁用本地浏览（`:71`）。这个状态是否该出现在选择器里？**「未确认」**：我没有梳理 `workerClient.getConfig().mode` 的完整语义与它和 endpoint 列表的关系。**动 S5 前必须先确认**，否则选择器里会出现两套并行的「远程」概念。

4. **§7.2 的远程批准静默失败，谁修？** 它在 `topologyHandlers.ts`（远程线/主进程的地盘），但症状暴露在项目创建（本线）。**推荐归远程线 S7**，本线只提供症状证据。需要先回答 §7.3-4 那个「未确认」。

5. **本地路径不存在也能创建（§1.4-F），要不要拦？** **推荐不拦，但要提示。** 拦截需要在 renderer 做 fs 探测（违反分层）或加一次 Control Surface 往返（拖慢 §8-1 的 1 步体验）。手输路径本来就是高级用法。

---

## 附录：证据索引

**OpenCove（`main` = `72b7b244` = 本 worktree；#317 未触及以下任何文件）**

- `src/app/renderer/shell/components/AddProjectWizardWindow.tsx:23`（existingWorkspaces prop）、`:33-46`（11 个 state）、`:68-71`（canBrowseLocal）、`:73-91`（homeWorkerMode）、`:96-99`（basename 推导项目名）、`:105`/`:117`（extraMounts: []）、`:129-133`（取消即关闭）、`:134`（原生选择器）、`:141-147`（**立即创建**）、`:150-163`（**自动开原生选择器**）、`:165-179`（openRemotePicker）、`:180`（**return null**）、`:184`（displayError）、`:188-283`（弹窗主体）、`:205`（无条件用 description）、`:210-214`（错误行）、`:228-243`（**复用 RemoteEndpointStatusSlot**）、`:243-245`（浏览=浏览并创建）、`:250-253`（远程路径 onChange）、`:286-302`（RemoteDirectoryPickerWindow）
- `.../addProjectWizard/useAddProjectWizardCreateProject.ts:15-19`（PlannedMount）、`:62-64`（**不可执行的 nameRequired**）、`:74`/`:100`（defaultMountRequired）、`:78-79`/`:104-105`（isAbsolutePath 校验）、`:84`（**endpointId: 'local'**）、`:123-125`（**空重名 if**）、`:126-134`（extraMounts 编排）、`:136`（projectId）、`:143-152`（allocateProjectPlaceholder）、`:156`（mount.create）、`:164`（createdMountIds）、`:167-178`（**local/remote 完全共用的 workspace 构造**）、`:186`（notifyTopologyChanged）、`:190-199`（**回滚，优点**）、`:201`（toErrorMessage）
- `.../addProjectWizard/useAddProjectWizardRemoteEndpoints.ts:32`（enabled 开关）、`:48`（**徽标已计算**）、`:60-70`（endpoint 消失兜底，优点）、`:69`（**remoteOverviews[0] 不看健康度**）、`:81-116`（就地修复动作，优点）
- `.../addProjectWizard/AddProjectWizardDefaultLocationSection.tsx:46-48`（**showRemote 兜底，优点**）、`:56`（段控条件渲染）、`:59-77`（段控）、`:79-158`（local/remote 三元分叉）、`:82-102`（本地路径行）、`:105`（空态判据）、`:110-121`（**断头路按钮**）、`:128-132`（CoveSelect + showTriggerBadge={false}）、`:133`（remoteStatusSlot）、`:146-155`（远程浏览）
- `.../addProjectWizard/AddProjectWizardAdvancedSection.tsx`（**250 行，零导入方**）、`.../AddProjectWizardPlannedMountsSection.tsx`（**88 行，仅被死代码引用**）、`.../helpers.ts`（DraftMount / RemotePickerState）
- `src/app/renderer/shell/AppShell.tsx:221-224`（快捷键入口）、`:265`（handleAddWorkspace）、`:297-305`（**handleOpenSettings**）、`:301`（**closeTransientOverlays**）、`:356`/`:376`/`:438`（三处入口）、`:426-430`（onRequestOpenEndpoints）、`:490`（settings 关闭不恢复）
- `src/app/renderer/shell/hooks/useShellOverlayState.ts:36`（默认 anchor）、`:46-54`（closeTransientOverlays）、`:53`（**setIsAddProjectWizardOpen(false)**）、`:110-118`（openAddProjectWizard，**anchor 粘滞**）
- `src/app/renderer/shell/hooks/useAddProjectWizardRequest.ts:12-18`
- `src/app/renderer/shell/hooks/useAddWorkspaceAction.ts:7-35`（**第二条创建路径，生产死代码**）、`:16-20`（**有去重**）、`:22-30`（**无 mount**）
- `src/app/renderer/shell/hooks/useAppShellWorkspaceActions.ts:129-139`（**挂载管理器需要 workspaceId**）
- `src/app/renderer/shell/components/AppShellPopups.tsx:129-139`（向导渲染）、`:106-108`、`:161`（挂载管理器）
- `src/app/renderer/shell/components/SidebarToolbar.tsx:39-45`（唯一传 anchor 的入口）
- `src/app/renderer/shell/components/RemoteDirectoryPickerWindow.tsx:85`（canBrowse）、`:140-155`（loadInitialDirectory）、`:157-177`（handlePrepare）、`:231-242`（**打开即 prepare**）、`:279`（复用点）
- `src/app/renderer/shell/components/RemoteEndpointStatusSlot.tsx:32`（复用点）
- `src/app/renderer/shell/components/ProjectMountManagerRemoteSection.tsx:69-83`（空态，同样跳设置）、`:87-95`（**下拉无状态徽标**）、`:110-124`（远程浏览）
- `src/app/renderer/shell/utils/pathHelpers.ts:5-7`（**isAbsolutePath 跨平台错位**）、`:9-13`（basename 可返回空串）
- `src/app/main/controlSurface/handlers/topologyHandlers.ts:331-366`（mount.create）、`:337`（local 批准）、`:338-360`（**远程批准 fire-and-forget**）、`:360`（`.catch(() => undefined)`）、`:364`（不等待）
- `src/app/main/controlSurface/handlers/workspaceHandlers.ts:96-103`（allocateProjectPlaceholder）
- `src/app/main/controlSurface/topology/topologyStore.ts:277-328`（createMount）、`:289-297`（**只校验记录存在**）
- `src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore.ts:160-174`（**registerRoot 不 stat**）
- `src/contexts/settings/domain/agentSettings.defaults.ts:66`（**默认 false**）
- `src/contexts/settings/presentation/renderer/settingsPanel/settingsPageRegistry.ts:98-105`（worker 页）、`:131-134`（**'endpoints' 别名 + scrollTarget，优点**）
- `src/app/renderer/components/CoveSelect.tsx:324-325`（trigger 徽标）、`:388-389`（列表徽标）
- i18n：`zh-CN.shell.ts:52-76` / `en.shell.ts:54-80`（addProjectWizard 全块）、`zh-CN.shell.ts:54`（多位置承诺）、`:55`（**孤儿 descriptionLocalOnly**）、`:56-57`（**孤儿 nameLabel/namePlaceholder**）、`:58`（**不可执行 nameRequired**）、`:71`（**死导航名**）、`en.shell.ts:74`（同）
- 测试：`tests/unit/app/addProjectWizardWindow.spec.tsx:26`/`:46`（**仅 2 个用例，64 行**）、`tests/e2e/m6.endpoints-mounts.addProjectWizard.steps.ts`（123 行）

**OpenCove（未提交的 `ssh-bootstrap-fix` 工作区，仅用于 §7.3/§10.3）**

- `managedSshRuntimeSupport.ts:6-10`（**ManagedSshBootstrapFailureKind**）、`:12-14`（ManagedSshBootstrapError）
- `managedSshEndpointRuntime.ts:43`（snapshot.failureKind）、`:429-432`（error → failureKind）
- `endpointHealthService.ts:217-233`（**projectManagedRuntimeFailure 映射**）、`:177-183`（新增两个 case）
- `dto/topology.ts:81-82`（**新增 installer_unavailable / runtime_corrupt**）

**Orca（`/Users/shihaojie/Development/orca`）**

- `src/renderer/src/components/sidebar/AddRepoHostSelector.tsx:42-45`（**渐进披露**）、`:53-76`（Host 常驻选择器）、`:84-110`（**内联添加远程主机**）、`:112-152`（二级 popover）、`:158-224`（host 列表项）、`:195-220`（行内 Connect）
- `.../AddRepoHostSelectorSlot.tsx:14-26`（**子弹窗不关父弹窗**）
- `.../add-repo-host-availability.ts:3-12`（**canSelect/canConnect 纯函数**）
- `.../sidebar-host-options.ts:98-100`（shouldShowHostScopeControls）
- `.../add-repo-local-start-actions.ts:36-65`（**同一动作按作用域改写文案**）、`:92-108`（**禁用+说明为什么**）、`:113-118`（自适应排序，**但已失效**）
- `.../AddRepoDialog.tsx:42`（step 状态机）、`:50`（useAddRepoHostSelection）、`:293`（**isSshLikely 硬编码 false**）、`:363`（HostSelectorSlot 注入）
- `.../use-add-repo-host-selection.ts:63-70`（**三级回退**）、`:76-89`（**从 settings 读预选 host**）
- `.../use-add-repo-host-change-reset.ts:23-31`（**换 host 清空路径**）
- `.../use-add-repo-hosted-controller.ts:61-70`（跳设置的次要逃生口 + Why 注释）
- `.../AddProjectFromFolderDialog.tsx:45-53`（关闭时清本地态）、`:66-100`（remote/local 分叉）、`:91-97`（**toast，缺点**）、`:169-206`（**额外确认步骤**）
- `.../create-project-defaults.ts:33-39`（`~/orca/projects` 默认）、`:41-61`（**远程时不自动填**）、`:63-88`（人话摘要）
- `.../AddRemoteHostDialog.tsx:31-70`（内联添加主机对话框）、`.../add-remote-host-ssh-actions.ts:37-67`（保存校验）
- `src/renderer/src/components/settings/SshTargetCard.tsx`（动作文案 grep：**无「在项目中使用」**）
- `src/shared/execution-host.ts:166-173`（getSettingsFocusedExecutionHostId）

---

## 变更说明

本报告为只读研究产出，**仅新增本文件，零 `src/` 改动**。
