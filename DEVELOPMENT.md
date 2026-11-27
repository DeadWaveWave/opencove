# DEVELOPMENT - 开发导航（Index）

本文档是本仓库的“开发入口/索引”。为避免一次性信息过载，详细规范已拆分到各模块目录下，请按需打开对应文档。

## 如何使用（给 Agent / 开发者）

1.  **每次任务先读本文件**：获取全局硬规则、文档地图、执行方法与常用入口。
2.  **职责分层**：`AGENTS.md` 只保留关键指令、决策门槛与非协商项；具体方法、步骤和例子优先写在本文件或 `docs/` 专项文档。
3.  **需要专题细节时**：按文档地图继续打开对应 `docs/` 文档。

## 开发与测试指南

### 核心编码原则 (Core Coding Principles)

只保留最容易在日常开发中被忽略、但一旦忽略就容易形成系统性问题的原则：

1.  **优先复用 (Prioritize Reuse)**: 在创建任何新代码、组件或工具函数之前，**必须**彻底搜索现有代码库以查找可复用组件。如无必要勿增实体，避免重复造轮子。
2.  **明确状态所有权 (State Ownership)**: 对会被持久化、恢复、同步或跨层传播的状态，必须明确唯一 owner 与 single source of truth。多个写入口默认视为设计风险。
3.  **边界内聚，副作用靠边 (Keep Boundaries Clean)**: `Main / Preload / Renderer / external CLI` 各司其职。状态决策不要跨层泄漏，IO / IPC / 文件系统等副作用尽量收敛在边界层。
4.  **封装横切关注点 (Encapsulate Cross-Cutting Concerns)**: IPC、日志、错误处理、watcher、persistence coordination 等横切逻辑要统一收口，避免调用方各自实现一份。
5.  **重复行为优先下沉到拥有者 (Logic Internalization)**: 若同一行为在多个调用方重复出现，优先下沉到真正拥有该行为的组件/模块，而不是在使用方复制。
6.  **把 SOLID 当作校准器，不当作教条 (Use SOLID as a Design Check)**:
    - `S`：模块如果同时承担状态决策、IO、UI、恢复策略，通常已经拆分过晚。
    - `O`：新增 `provider / adapter / watcher` 时，优先新增实现，而不是到处改稳定分发逻辑；provider / node kind 的静态差异写进 registry 表项，不要比较 id，见 `docs/architecture/ARCHITECTURE.md#variants-and-registries`。
    - `L`：只有存在真实子类型替换时才考虑；不要为了“像 OO”强造继承层级。
    - `I`：`preload / service / bridge` 接口要小而专用，不暴露大而全 API。
    - `D`：高层依赖抽象端口和类型，不直接依赖 `Electron / PTY / CLI` 细节。
7.  **结构优先于补丁 (Prefer Structural Clarity over Patch Accumulation)**: 不要等问题复发后才升级。只要任务本身已经暴露出 `多个 mutable state owner`、`边界/权限含混`、`同一入口承载多套竞争语义或解释路径`、或 `局部修补会制造隐藏/矛盾状态`，就应先收敛结构而不是继续叠 patch。
8.  **Renderer 反馈统一用应用内消息，不用系统弹窗 (Use In-App Feedback, Not System Dialogs)**: Renderer 层禁止新增 `window.alert / confirm / prompt` 这类系统弹窗；统一复用应用内反馈组件，并按语义区分 `info / warning / error` 三个视觉层级，避免阻塞交互与平台观感割裂。

#### 死代码门禁 (Dead Code Gate)

`pnpm deadcode:check`（属于 `pnpm verify:repo`，因此在 `verify:checks` 与 CI 的 `Repository checks` 步骤中运行）以 knip production 模式从生产入口出发做整图可达性检查：测试文件不算使用者，所以“被替换但仍被自己的 spec 引用”的旧模块会直接失败。修复方式是删除旧代码，不是加豁免。

- **只放生产代码**：`src/` 只放会随产品发布的代码；仅测试使用的模块放在 `tests/`（例如 `tests/support/`）。
- **测试专用导出**：生产代码和同文件都没用到、只有测试使用的导出，必须命名为 `...ForTests` 并标注 `/** @internal */`；`@internal` 只允许用于 `...ForTests`，且必须写成紧贴声明上方的 JSDoc 块；`src/` 下禁止以任何注释形式（行注释、块注释、export 列表）使用 `@public` / `@beta` / `@alias`（knip 不报告带这些标签的导出，会掩盖死代码）。
- **按路径字符串加载的代码**（子进程、worker）必须是构建入口：加入 `scripts/lib/build-entries.mjs`，并注释它在哪里被 spawn。该文件是生产入口的唯一来源，electron-vite、CLI 构建和 `knip.config.ts` 都读取它。
- **未使用的 export / type** 记录在 `scripts/dead-code-ratchet.json`（按文件计数，只减不增）。清理后运行 `pnpm deadcode:ratchet` 锁定；该命令按规则总数与合并基线（merge base）上的基线比较，只有某条规则的总数高于合并基线、或合并基线上总数大于 0 的规则消失时才拒绝（见下文“棘轮基线守卫”）；比较对象始终是合并基线上的文件，不是磁盘上的文件，所以删除或手改基线文件不会改变拒绝与否，总数不超过合并基线（包括文件间移动、重命名）则允许。不要手改该文件，也不要在 `knip.config.ts` 里 `ignore` 文件或目录。
- 文件、依赖、unresolved、binaries 等必须为 0。生产不 import 的依赖用 `pnpm remove` 移除，仅工具链使用的移到 `devDependencies`。

### 命名与前缀 (Naming)

- 对外/协议/持久化统一使用 `OpenCove` / `opencove`（例如 `window.opencoveApi`、`OPENCOVE_*`、`.opencove/`、`opencove.db`）。
- UI 设计系统与样式命名空间保留 `cove` 前缀（例如 `--cove-*`、`data-cove-*`、`.cove-window`），作为稳定的内部约定。
- 历史版本的 localStorage key 可能仍使用 `cove:m0:*` 前缀；命名检查不处理它，兼容读取与迁移代码必须登记到期条件，见 `docs/development/COMPATIBILITY_EXPIRY.md`。

### 架构执行触发器 (Architecture Execution Triggers)

只保留最容易在代码演化中失控、且最值得前置约束的触发器：

1.  **先分离决策与编排**：状态迁移/业务判定属于 owner；`IO / IPC / CLI / watcher` 调用属于 orchestration。一个函数若同时承担两者，默认应先拆分。
2.  **出现以下组合时，先拆再改**：
    - 同一文件出现两个以上独立变更原因。
    - 同一函数同时包含 `状态判定 + 外部调用 + fallback/retry + 写回`。
    - 同一次改动同时触及 `lifecycle / persistence / hydration / resume / watcher` 中两项及以上。
3.  **高风险路径先写不变量**：启动、恢复、关闭、重试、fallback、异步乱序相关改动，先写 `1-3` 条 invariant，再决定实现位置与测试层级。
4.  **结构性风险先升级判断**：以下信号任中其一，就必须按 Large Change 处理，而不是直接以最小改动修补：`多个 mutable state owner`、`边界或 authority 难以解释`、`同一入口/输入/观测承载多套竞争语义或状态迁移`、`局部 patch 可能制造新的矛盾状态或隐藏状态`、`同一真相被 runtime observation 与 durable state 同时改写`。是否“已经复发”只作为额外证据，不作为触发前提。
5.  **当“补丁在增加复杂度”而不是“降低复杂度”时，必须优先重构**：下面任一命中，默认暂停继续堆条件/缓存/协调代码，先做结构收敛（拆 owner、收口写入口、隔离副作用）：
    - **改动开始非局部扩散**：一个小需求/修复需要同时修改多个模块、边界或层才能生效。
    - **真相分裂或覆盖规则不清**：同一事实出现多份镜像状态/缓存/派生值，且无法明确“谁能覆盖谁”。
    - **特殊情况快速增长**：修复主要靠追加分支、开关、临时状态、时序约束，而不是删除分支或合并抽象。
    - **可测试性下降**：无法写出稳定回归测试或不变量，必须依赖真实时序/IO/全局环境才能复现。
    - **同类问题短期内反复出现**：同一类故障在一个迭代内出现多次，说明边界/owner/不变量未收敛。
    - 需要具体案例时，参考：`docs/cases/CASE_STUDY_CANVAS_JITTER_AND_TERMINAL_DURABILITY.md`。

### 架构契约变更 Gate (Architecture Contract Change Gate)

本节只记录必须遵守的入口规则。命令、ratchet 语义与例外写法见
`harness/architecture/README.md`。

- 契约文档包括：`docs/architecture/ARCHITECTURE.md`、`docs/architecture/CONTROL_SURFACE.md`、`docs/architecture/RECOVERY_MODEL.md`。
- 如果改动影响依赖方向、层职责、进程边界、allowlist、禁止 import/API 或 severity，必须同步 `harness/architecture/` 的规则、分析器和测试（计数下降时再运行 `pnpm arch:ratchet`）。
- 如果只是措辞、错别字或说明性例子，必须在 review/提交说明中声明 `no executable-rule impact`。
- `pnpm arch:check` 是 `verify:quick` 与 CI 的阻塞门禁：error 级发现必须为 0，warn 级发现按 (规则, 文件) 计数不得偏离 `harness/architecture/ratchet.json`。新增违规需要修改 `harness/architecture/rules.json`：`allowedEdges` 条目必须带 `reason`，修改规则的 severity、`exclude` 或 `allowedPatterns` 同样属于例外，必须在 review 中写明理由。

### 画布状态棘轮 (Canvas State Ratchet)

`pnpm canvas:state-check` 守护 issue #647（把画布状态收敛到单一 owner）的重构：今天 `workspaceCanvas/` 里的 hook 通过 ref 镜像和 setter 参数互相传递状态，且有多处直接写 workspace store。该检查把这些存量按文件计数并冻结，使重构可以分片落地、每一片的改进都被锁住。它属于 `pnpm verify:repo`，因此 `verify:checks` 与 CI 的 `Repository checks` 都会运行。

计数规则：用 TypeScript 解析器识别 token，注释、字符串、模板文本、正则字面量与 JSX 文本都不计入，换行与空白差异不会改变计数；`*.spec.*` / `*.test.*` / `__tests__/` / `.d.ts` 不统计。统计范围刻意比今天问题集中的 `workspaceCanvas/` 更宽，这样把代码移出该目录不会让计数下降；后续切片也会在该目录之外新增代码。

| 计数器 | 范围 | 统计内容 |
| --- | --- | --- |
| `ref-type` | `src/contexts/workspace/presentation/renderer/**` | `MutableRefObject<` 与 `RefObject<` |
| `setter-type` | 同上 | `Dispatch<SetStateAction`（含 `React.` 前缀） |
| `ref-write` | 同上 | 对名为 `ref` 或以 `Ref` 结尾的标识符的 `.current` 赋值（`=`、`||=`、`+=` 等；不含 `==`、`===`） |
| `legacy-channel` | 整个 `src/` | 整词标识符 `nodesRef`、`spacesRef`、`setNodes`、`onSpacesChange`、`onRequestPersistFlush`；也统计整个字符串恰为其中之一的情形（如 `Pick<Ctx, 'spacesRef'>`） |
| `workspace-writer` | 整个 `src/` | 写能力提及（write-capability mentions）：整词标识符 `setWorkspaces` 与 `useAppStore.setState`，每次出现都计一次，不论是否为调用 |

已知盲区：整个 hook 返回值作为单个参数传递（如 `canvasState: ReturnType<typeof useWorkspaceCanvasState>`）时，其中携带的 ref 与 setter 不会被任何计数器看到；`ref-write` 看不到对 ref 内状态的修改（如 `someRef.current.set(...)`）。因此计数为 0 不代表不存在由 ref 持有的状态。

语义与 `pnpm ui:style-check` 的棘轮相同：任一文件的计数相对 `scripts/canvas-state-ratchet.json` 增加或减少都会失败。基线只用 `pnpm canvas:state-ratchet` 重新生成，不要手改 JSON；该命令固定写入这一个文件，不接受其他路径或配置参数，并且在任一计数器的总数相对合并基线会上升（或计数器消失）时拒绝写入，除非用 `--accept-rise <规则>` 点名（见下文“棘轮基线守卫”）；总数不变但某些文件的计数上升（代码在文件间移动）时会允许写入，并逐条打印这些文件级上升供评审查看。

降低计数：删除对应的 ref、setter 参数或 workspace 写能力提及（按 #647 的 owner 设计迁移，而不是改写成计数器认不出的形式），运行 `pnpm canvas:state-ratchet`，把更新后的 `scripts/canvas-state-ratchet.json` 与代码改动放进同一个提交。增加计数不被允许：请改用 #647 描述的 owner 与命令。计数器定义见 `scripts/lib/canvas-state-ratchet.mjs`。

workspace 画布文档（节点、Space、活动 Space、Space 归档记录、视口、小地图开关）的写入遵守三条规则（issue #671，#647 的 S2 切片）：提交到 store 的画布文档写入必须经过 `src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands.ts`，不要用 `useAppStore.setState` 直接写 `workspaces`（`setWorkspaces` 已从 store 类型中删除，项目列表写入使用 `addWorkspace`、`removeWorkspaceFromList`、`setWorkspaceName` 等具名 action）；每个命令都显式给出 `workspaceId`，不依赖“当前活动的 workspace”；`setNodes` 在调用时从 store 计算，而不是从 `nodesRef` 快照计算。

画布 UI 投影状态（issue #685，#647 的 S3 切片）遵守以下规则：两个画布菜单（右键菜单 `contextMenu` 与 Space 操作菜单 `spaceActionMenu`）、对话框（任务编辑 `taskEditor`、角色创建 `roleCreator`、节点删除确认 `nodeDeleteConfirmation`）、Space 挂载选择器 `spaceTargetMountPicker` 和 Space 重命名 `spaceRename` 存放在每个画布一个的 canvas store 中，代码在 `src/contexts/workspace/presentation/renderer/store/canvasStore*.ts`，不要再用 `useState` 声明一份，也不要把它们的 setter 当作参数在 hook 之间传递；`WorkspaceCanvasInner` 调用的 hook 通过 `useReadCanvasUi()` 在调用时读取、通过 `useCanvasUiCommands()` 的具名命令写入，只有叶子组件（如 `WorkspaceCanvasMenus`、`WorkspaceCanvasWindows`、`WorkspaceSpaceRegionsOverlay`）用 `useCanvasUi` 订阅（`tests/unit/contexts/canvasUi.leafSubscribers.spec.ts` 机械检查 `hooks/` 下没有 `useCanvasUi(` 调用），节点组件只用命令，这样打开菜单或在对话框里输入不会重渲染 `WorkspaceCanvasInner`；store 不暴露 `setState`（类型与运行时都没有），状态只能经命令改变，互斥关系（两个菜单不会同时打开）由命令在同一次更新里保证；异步流程在 `await` 之后只用 `updateDialog` 写对话框，它在对话框已关闭时什么也不做，所以迟到的结果不会把对话框重新打开；store 随 `workspaceId` 重建，切换 workspace 时菜单、对话框、挂载选择器和重命名都会关闭；只有单一消费者的状态（例如 Space 菜单的路径打开器列表）留在该消费者本地。

画布选择状态（issue #692，#647 的 S4 切片）：选中的节点 id 与 Space id 存放在 canvas store 的 `selection` 切片中，只有两处用 `useCanvasSelection` 订阅：`hooks/useCanvasState.ts`（只订阅 `nodeIds`，`flowNodes` 渲染时需要）和 Space 覆盖层 `WorkspaceSpaceRegionsOverlay`（只订阅 `spaceIds`），所以 Space 选择变化不会重渲染 `WorkspaceCanvasInner`；其余代码在调用时用 `useReadCanvasSelection()` 读取、用 `useCanvasSelectionCommands()` 的具名命令（`select`、`clear`、`setNodeIds`、`setSpaceIds`、`retain`）写入，不再有 `selectedNodeIdsRef`、`selectedSpaceIdsRef` 或选择的 setter 参数（`tests/unit/contexts/canvasUi.leafSubscribers.spec.ts` 机械检查 `src/` 下所有已跟踪的非测试源文件中订阅者恰好是这两处、`useCanvasState.ts` 只订阅 `nodeIds`，以及这些名字不再出现在 `src/`）；节点拖拽开始时用 React Flow 传入的 `node.selected` 判断“拖拽前是否已选中”，因为同一次按下产生的 select 批次已经写过 store；文档节点上的 `selected`、`dragHandle` 镜像已在 S7 PR 3 退役：文档节点不再有 `selected`、`dragHandle`、`dragging`（画布专属字段）。六个选择写入方只写 selection 切片和 React Flow 两个标志（S7 PR 2），节点写入方不再装饰基底，React Flow 的 change path 对只含选择的批次不写文档（S7 PR 3）；React Flow 看到的 `selected` 与 `dragHandle` 只由 `decorateFlowNodes`（`utils/canvasLiveNodes.ts`）从选择切片和拖拽面模式推导，并按已提交节点对象做 `WeakMap` 缓存，所以没有变化的节点保持同一个视图对象（RF 的 `NodeWrapper` 不重渲染）；同步合并（`mergeWorkspaceStateForSync`）不再携带这三个字段；`workspaceDocumentCommands.ts` 的四个写入入口（`commitCanvasDocument`、`applyRuntimeObservation`、`replaceFromSync`、`mergeHydratedNodes`）在开发模式（含单元测试）下用 `assertNoCanvasOnlyFields` 拒绝任何带这三个字段的节点，`tests/unit/contexts/canvasDocument.channels.spec.ts` 用 AST 检查“展开对象并设置这三个字段之一的对象字面量”只出现在 `utils/canvasLiveNodes.ts` 和 `utils/canvasCollapse.ts`；`setNodes` 参数留到 S7 后续 PR 移除（#738 的 Decision 7；#647 的 S7 一行已改为“Action refs 与节点写入方变成稳定命令”）；节点拖拽期间选中 Space 的副本是 `useNodeDragSession` 的私有状态。

画布文档读写（issue #702，#647 的 S5 切片，已完成）：画布代码在调用时用 `useReadCanvasDocument()` 读取已提交的节点与 Space（读取器绑定到创建回调的那次渲染所属的 workspace，切换 workspace 后旧回调仍读写旧 workspace），用 `useCanvasDocumentCommands()` 的 `updateSpaces` 写 Space，用 `setNodes` / `updateCanvasDocument` 写节点，并在同一次写入上带 `{ flush: true }` 请求持久化；没有紧挨着的写入时才调用 `requestPersistFlush()`；`{ flush: true }` 只在写入真正应用时请求 flush，写入没有改变文档（`unchanged`）或 workspace 已不在（`missing`）就不请求，一个操作无论最后一次写入如何都要在结尾 flush 一次时，显式调用 `requestPersistFlush()`（空操作的 flush 不再被写入带出）。`spacesRef`、`onSpacesChange` 和画布的 `onRequestPersistFlush` 属性已移除，`hooks/useCanvasState.spec.ts` 用类型测试（`@ts-expect-error`）守住它们；`nodesRef` 已在 S6 的 PR 4（issue #738）中移除，只剩 `view/WorkspacePixelLayer.tsx` 里该组件对自己 `nodes` 属性的本地 ref（S9 的下限）；`hooks/useCanvasState.spec.ts` 的类型测试守住 `UseWorkspaceCanvasNodesStoreResult` 不再有 `nodesRef`，`tests/unit/contexts/canvasDocument.channels.spec.ts` 的终态清单机械检查每个旧通道标识符还允许出现在哪些文件（`nodesRef` 只允许 `WorkspacePixelLayer.tsx`，`isLiveGestureActive`、`onNodesCommitted`、`publishCommittedNodes`、`resolveCanvasDocumentBase` 不允许出现在任何文件）。

画布交互状态（issue #738，#647 的 S6 切片，已完成）：每个画布一个的 canvas store 还有 `interaction` 切片，保存手势期间的逐帧状态，只是 UI 投影，不持久化也不同步：节点拖拽的覆盖层 `liveNodes`（`Map<id, { position, dragging? }>`，节点拖拽和 Space 拖拽共用，只含手势所拥有的窗口，其余窗口没有条目）、吸附参考线 `snapGuides`、节点拖拽的 Space 框预览 `nodeDragFramePreview`、Space 拖拽的 Space 框预览 `spaceDragFramePreview`、框选矩形 `selectionDraft` 和磁吸开关 `magneticSnappingEnabled`（开关不是逐帧状态，由 provider 在切换 workspace 时带入新 store，其余字段新 store 一律为空）；状态只经命令改变（`publishLiveNodes`、`endLiveNodes`、`setSnapGuides`、`setNodeDragFramePreview`、`setSpaceDragFramePreview`、`setSelectionDraft`、`toggleMagneticSnapping`），相等的覆盖层（同样的 id、位置和 `dragging`）、参考线、预览和框选矩形保持原引用且不通知任何人，`endLiveNodes` 在没有实时手势时什么也不做。订阅者恰好四个：`CanvasFlowHost`（`liveNodes`，以及两个预览共用的一个选择器 `spaceDragFramePreview ?? nodeDragFramePreview`）、`view/WorkspaceSnapGuidesOverlay.tsx`、`view/WorkspaceSelectionDraftOverlay.tsx` 和 `view/WorkspaceCanvasMenus.tsx`，全部通过 `useCanvasInteraction(selector)`；这个 hook 是手势帧渲染优先级的唯一决定处（现在是 arm B：值放在 React state 里，由 store 的 `subscribe` 设置，所以来自 animation frame 的写入以默认优先级在该帧之后渲染，和原来的 `setState` 一致（Space 拖拽的帧以前经 app store 以同步优先级在帧内渲染，现在和节点拖拽一样在该帧之后渲染）；同步优先级的 arm A 是直接用 `useStore` 订阅；#738 的测量 run 3 在 macOS 上比较了两者（两次、各 6 轮），arm A 没有降低输入到提交的延迟，长帧变多也没有落在噪声之外而得以排除，所以按规则保留 arm B），`hooks/` 下的 hook 和 `WorkspaceCanvasInner` 不订阅，只用 `useReadCanvasInteraction()` 在调用时读取、用 `useCanvasInteractionCommands()` 写入。选择器契约由 `tests/unit/contexts/canvasUi.leafSubscribers.spec.ts` 从语法（TypeScript AST）机械检查：标识符 `useCanvasInteraction` 只出现在 context 文件和上述四个订阅者中（命名空间调用、barrel 重导出、别名都会被发现），四个订阅者不导出任何 `use*` hook，context 的值导出是固定清单（store 的 api 不会被导出），每个选择器是其文件中唯一同名的模块作用域 `const` 箭头函数，参数没有默认值，函数体只由读取、比较和原始值构成（节点种类白名单，不能有 `{`、`[`、`new`、调用或内联函数）：内联函数会在每次渲染重新订阅，每次返回新对象会让订阅者在每次通知时都重渲染（内联且返回新对象，或改用 arm A 时会无限循环）。React Flow 看到的节点只有一处推导：`applyLiveNodes(committed, overlay)`（`utils/canvasLiveNodes.ts`）——已提交的视图（`useCanvasState` 的 `flowNodes`，即 `decorateFlowNodes` 之后的 store 节点）加上覆盖层的条目；覆盖层由 `toLiveNodes(帧数组, 手势基线, 已提交节点)` 从帧数组里挑出手势所拥有的窗口：`dragging` 为 true 的，以及位置既不同于手势基线、也不同于 store 当前位置的（没有基线条目的窗口，例如拖拽中新建的，只与 store 当前位置比较）；`CanvasFlowHost` 在渲染时求值，RF 变更路径（`useApplyNodeChanges`）在调用时从两个 store 读基准：拖拽帧和释放用活视图 `applyLiveNodes(decorate(readDocument().nodes), readInteraction().liveNodes)`，其他批次（选择、删除、没有拖拽的落定移动）用已提交的视图 `decorate(readDocument().nodes)`（拖拽进行中到达的选择或删除批次按释放处理）；节点拖拽帧和 Space 拖拽帧都只渲染宿主及其下的视图，不再渲染 `WorkspaceCanvasInner`；这两处的 `decorate` 是同一个 `decorateFlowNodes`（文档节点加上 `selected` 与 `dragHandle`，来自选择切片和 React Flow 的拖拽面模式；处理函数里经 `useDecorateCommittedNodes()` 在调用时读取），节点写入方不再用它（`canvasNodes`、布局 effect 合并和 `hasTransientNodePositionsRef` 已移除，`tests/e2e/workspace-canvas.drag-commits.spec.ts` 断言 120 帧拖拽中 `WorkspaceCanvasInner` 至多提交两次）。释放（`wasDragging && !isDraggingThisFrame`）在变更路径的同一个同步块里先写一次文档（`useCanvasNodePublishers` 的 `commitNodesRelease`：在 store 当时的节点上用 `applyReleasedPositions` 只应用释放数组的 `toLiveNodes` 条目的位置（`dragging` 是画布专属字段，不写进文档；视图里的 `applyLiveNodes` 仍带 `dragging`），别的窗口一个字段都不碰；这个批次若带删除，同一次写入里一并删除并解除任务与 agent 的关联；Space 主导的拖拽（选中的节点与 Space 一起拖）把 Space 框的矩形也写进同一次写入，`endNodeDragSession()` 只结束会话并把矩形交还，自己不写；只有某个矩形变了才请求持久化 flush；没有任何变化就不写）、再 `endLiveNodes()`，所以没有回弹帧，Space 主导的释放是一次 store 通知；其他批次只写它对文档的实际效果：删除（并解除关联）和没有拖拽的落定移动（规范化后的位置）合成一次对已提交节点的配方，只含选择的批次不写文档（选择只进 canvas store 的选择切片），都不动覆盖层；一个窗口都不在基准里的选择、删除或落定移动批次（例如切换 workspace 之后到达新 workspace 回调的、只含旧 workspace 窗口的批次）不写文档（这条守卫仍然需要：它们否则会为不属于本画布的窗口发出提交；释放不需要，它只对 store 里还在的窗口应用条目，没有匹配就不写，但仍然结束覆盖层），到达旧 workspace 回调的松手只把被抓取的窗口按规范化后的位置落在旧 workspace（切换已把 `isNodeDraggingRef` 重置，所以它按落定移动处理；被它推开的窗口不写入）。`nodesRef`、`onNodesCommitted`、`isLiveGestureActive`、`publishCommittedNodes` 和 `utils/canvasDocumentBase.ts` 已移除（PR 4）：节点写入方是 `hooks/useCanvasNodeWriter.ts` 的 `useCanvasNodeWriter()`，返回 `{ updateNodes, updateCanvasDocument }`，不需要 Inner 的任何状态——workspace 来自 provider（`useCanvasWorkspaceId()`，回调保持创建它的那次渲染的 workspace），配方的基准是调用时 store 里的已提交节点本身（S7 PR 3 起不再装饰，没有 `selected` 与 `dragHandle`），布局同步事件和测试状态同步只在该 workspace 是当前显示的 workspace 时发生；节点 store 把它的 `updateNodes` 以 `setNodes` 之名返回，所以没有调用方改动。因此拖拽中途的画布写入（标题、标签颜色、agent 覆盖）提交的是已提交的位置，不碰覆盖层，宿主继续显示实时位置，被拖动的窗口在松手时才进入文档（以前是提交实时位置并结束覆盖层）；选择、删除或落定移动批次不再丢掉自上次渲染以来的 store 写入（运行时观察是同步写入的）；`normalizePosition` 读 `readDocument().nodes`。覆盖层只含手势所拥有的窗口（PR 5）：手势没有移动的窗口没有条目，所以别处对它的移动（包括画布写入方，例如推开邻居）在拖拽期间立即显示、在松手后保留，拖拽中新建的窗口也一样（以前它们被旧位置遮住并在松手时被覆盖）；已知限制：手势的投影仍从窗口的拖拽开始位置计算推开，所以之后手势经过该窗口的旧位置时，仍可能把它从那里拉回（后续再改）；被手势推开的窗口属于手势，在覆盖层里并在松手时写入，没有拖拽开始位置的窗口（拖拽中新建的）只与 store 当前位置比较，所以手势仍会推开它。释放批次点名的每个窗口都是条目（落在释放位置，`dragging: false`），所以被别处移动过的被拖窗口也落在松手处；不含位置变化的释放（拖拽中的选择或删除批次）同样结束 `isNodeDraggingRef`。对手势所拥有的窗口，拖拽期间别处的移动仍被覆盖层遮住，松手时以手势的位置为准。React Flow 在抓取的窗口离开其 node lookup 时中止节点手柄拖拽且不发释放：`useApplyNodeChanges` 里的 effect 在已提交节点变化时检测（抓取的窗口由指针锚点给出（覆盖层里该窗口仍是 `dragging` 条目时才算，否则是上一次拖拽留下的过期锚点），没有锚点时由覆盖层里唯一 `dragging` 的条目给出），结束会话、覆盖层和 `isNodeDraggingRef`，什么也不写，所以下一次点击是普通选择而不是释放；切换 workspace 也重置 `isNodeDraggingRef`。Space 拖拽的帧也在覆盖层上（PR 6，Decision 9）：`useSpaceDrag.applyLayout.ts` 每帧读一次已提交的文档，投影后把 `toLiveNodes(投影后的节点数组, dragState.allNodePositions, 已提交节点)`（和节点拖拽同一条规则：与拖拽开始位置和 store 当前位置都不同的窗口才进覆盖层）经 `publishLiveNodes`、把 Space 框矩形经 `setSpaceDragFramePreview` 发布，不写文档、不调用 `setNodes`，所以 Space 拖拽的帧没有 app store 通知，侧边栏的 Space 缩略图和持久化防抖都看不到中间位置，其他客户端也是在松手时才看到（以前每帧写文档，Worker 同步时 120 ms 的防抖每秒约写八次中间位置）；按下鼠标就把被按的 Space 自己的矩形放进预览；预览不再是 Inner 的 `useState`（`useWorkspaceCanvasSpaceDrag` 只返回指针处理函数），宿主从 slice 读。松手（`finalizeWorkspaceSpaceDrag`）的配方不变：一次 `updateCanvasDocument`，节点位置和 Space 在同一次写入，带 `{ flush: true }`；之后在同一个同步块里 `endLiveNodes()` 并清空预览，所以没有回弹帧；没有移动的点击（6 px 以内）不写文档、不请求 flush，只结束覆盖层和预览并写选择（S7 Decision 10）。拖拽中切换 workspace：新 store 是空的，帧的 `requestAnimationFrame` 在切换时取消、拖拽状态被清空，所以迟到的松手什么也不写，旧 workspace 的文档保持拖拽前的样子（以前每帧已经把中间位置写进旧 workspace，松手却被丢弃，留下节点移动了而 Space 没动的文档）。别处在拖拽期间移动的、这次拖拽不携带也不推开的窗口立即显示，松手后保留（松手的配方对拖拽没有移动的窗口保留 store 当前位置，即规划位置等于其拖拽开始位置的窗口）；已知限制同节点拖拽：推开仍从拖拽开始位置计算。

画布节点命令（issue #647 的 S7 切片，进行中；S7 PR 4 接线 `window`、`note`、`website` 三个家族）：这三个家族的窗口回调不再是动作 ref，而是按画布一个的命令对象 `useCanvasNodeCommands()`（`nodeTypes.context.ts`），节点组件在渲染子组件的地方自己绑定 id，`nodeTypes.tsx` 不再逐个传递这些回调；终端、角色和任务窗口的 body 在 S7 PR 5 到 7 之前仍收到 18 个过渡 ref（`TransitionalNodeActionRefs`：终端 8、角色 3、任务 7，由 `nodeTypes.tsx` 逐个传递）。`WorkspaceCanvasNodeTypesParams` 含六个展示偏好（`workspacePath`、`onShowMessage`、`agentProviderOrder`、`defaultProvider`、`browserDefaultMode`、`browserSearchEngine`）、`commands`，并 `extends TransitionalNodeActionRefs`；`nodeTypes.context.spec.ts` 在 `pnpm check` 中类型检查：params 里的 ref 恰好是这 18 个名字（逐名固定，增减都会失败），`commands` 和 note、website、document、folder、image、plugin 的 props 里没有 ref（`RefPaths` 也检查数组），终端、任务、角色的 props 里没有窗口回调，没有命令接受含节点的参数（节点、节点数组、节点的 `data`、一层选项对象里的节点都会被发现，每种都有自检），退役字段既用 `@ts-expect-error` 又用 `keyof` 守住。类型在 `nodeCommands.ts`（只有类型，六个家族是完整表面，`WiredCanvasNodeCommands` 只含已接线的三个，PR 7 删除它和 `TransitionalNodeActionRefs`）。命令对象由 `hooks/useCanvasNodeCommands.ts` 的 `useComposedCanvasNodeCommands` 按函数名从实现函数组合（每个家族按其函数 `useMemo`，整体按家族 `useMemo`），Inner 在 `useWorkspaceCanvasInteractions` 之后、`useWorkspaceCanvasComposedNodeTypes` 之前调用；`window.focusForInteraction` 来自 `hooks/useCanvasFocusForInteraction.ts`。`window.close` 只在文档仍含该窗口时关闭它，从不确认（任务和角色窗口调用 `requestDelete`，由它打开确认框）。命令有自己的 context：`WorkspaceCanvasNodeTypesProvider` 在同一个 provider 内部另提供 `commands`，`useCanvasNodeCommands()` 读它。原因：context 的消费者在 context 值每次变化时都会渲染，不管它读了哪个字段；只读命令的、被 memo 的窗口 body（终端、document、folder、image、plugin）如果订阅整个 params，就会在每次偏好或路径变化时渲染（`canvasNodeCommands.mountedRenders.spec.tsx` 固定这一点）。命令只接收 id 和值，不接收节点对象，并在运行时才从各自的所有者读取：文档（`useReadCanvasDocument`）、canvas store、React Flow（经 `setViewport` 和 `setCenter`，它们读 React Flow 的 store）和应用设置（经画布属性 `readAgentSettings`，由 `WorkspaceMain` 传入模块作用域的 `() => useAppStore.getState().agentSettings`，所以设置变化——例如聚焦缩放滑块每个 input 事件写一次 `focusNodeTargetZoom`——不会让命令对象或 params 换身份）。身份约定由 `tests/unit/contexts/canvasNodeCommands.identity.spec.tsx` 在 Inner 层面固定（与真实实现一致的 React Flow mock，探针在每次宿主渲染时记录 context 的值）：命令对象和整个 params 值在文档写入、选择批次、拖拽帧、等值 props 渲染、不涉及六个偏好的设置变化、设置以反序列化副本到达（Worker 同步，`agentProviderOrder` 在内容相等时保持同一个数组，由 `useWorkspaceCanvasComposedNodeTypes` 里的 `useSameWhileEqual` 保证）以及 React Flow 视口初始化（`useReactFlow()` 的对象会换，但 `setViewport`、`setCenter` 来自 `useViewportHelper`，用 `[]` 做 memo，所以身份不变）下保持不变；命令对象只在 workspace 变化、语言变化和宿主的 `onShowMessage` 变化时变化（后两者由 `note` 家族绑定：`convertToTask` 用 `t` 和 `onShowMessage`）。命令绑定到创建它的那次渲染的 workspace，所以 A 的节点在切换到 B 之后调用的命令仍写 A；对文档已不含的 id，每个命令都什么都不写——不写文档、不请求持久化 flush、选择命令也不写选择切片、React Flow 标志和拖拽面模式，不留悬空 id（写入上的 `{ flush: true }` 只持久化它所伴随的那次写入：写入没有应用——配方返回原文档，或 workspace 已不在——就不请求 flush，所以命令不再用 `didChange` 变量判断）。节点 store 里 `useNodesStore.ts`、`.noteMutations.ts`、`.websiteMutations.ts` 以及 `useNoteToTaskConversion.ts`、`useArrange.ts` 用 `useCanvasNodeWriter()` 自取写入方（后两者的设置经 `readAgentSettings` 在调用时读取），`useNodeDeleteConfirmation` 返回 `requestNodeDelete`（`useLifecycle` 的 Delete 键以参数接收它）。

### 测试闸门 (Test Gates)

`pnpm test-gates:check`（属于 `pnpm verify:repo`，因此在 `verify:checks` 与 CI 的 `Repository checks` 步骤中运行）扫描已跟踪的 `tests/**/*.ts(x)` 与 `src/**/*.{spec,test}.ts(x)`，用 TypeScript 解析器识别调用，字符串和注释里的 `test.only` 不算（issue #683）。三条规则：

| 规则 | 类型 | 内容 |
| --- | --- | --- |
| `platform-gate-suffix` | 硬零 | 只在一个非 Linux 平台运行的用例（`it.skipIf` / `it.runIf` / `test.skip(cond, …)` / `test.describe.skip(cond)` / `cond ? it : it.skip`，以及 `it` / `test`（含 `.each`）回调顶层的 `if (cond) return`——它在其他平台上不断言就通过；条件沿用同文件内的 `const` 间接引用）必须写在文件名带 `.windows.` 或 `.mac.` 的 spec 文件里；helper 文件（非 `*.spec.*`）不在范围内；无法求值的条件被忽略，`--verbose` 会列出所有这类闸门 |
| `focused-test` | 硬零 | 不允许 `test.only`、`it.only`、`describe.only`、`test.describe.only`；三个 Playwright 配置同时设置 `forbidOnly: !!process.env.CI` |
| `unconditional-skip` | 棘轮 | 无条件跳过的声明（`test.skip('标题', fn)`、`test.describe.skip`、`it.skip`、`*.fixme`、`test.skip()`、`test.skip(true, …)`，含 `.skip.each` / `.fixme.each`；`.only.each` 同样算 `focused-test`）按文件计数，冻结在 `scripts/test-gates-ratchet.json`，只减不增 |

平台专属用例写在 `*.windows.spec.ts` / `*.mac.spec.ts` 里，是因为 CI 的 Windows 与 macOS job 用 Vitest 的文件名过滤选择这些文件：Windows 步骤是 `pnpm exec vitest run --pool=forks --maxWorkers=1 ".windows.spec." --exclude <一个文件>`，macOS 步骤是同样命令加 `".mac.spec."`（位置参数是子串过滤，不是 glob，作用于根配置的 `include`/`exclude`，所以 `tests/e2e` 不会被选中）。新增文件无需有人去改 CI 列表。Windows 步骤唯一的排除项是 `windowsNativeArguments.windows.spec.ts`，它有自己的 Electron + WSL 步骤；其他排除必须在步骤上方的注释里写出文件名和 issue 编号，由 `tests/unit/scripts/ci-platform-vitest.spec.ts` 检查，该测试还要求两个步骤没有 `if:` 与 `continue-on-error`、命令不被 `-t` 之类的参数收窄。移动一个用例时：保留原来的闸门，共享夹具移到 `*.helpers.ts`，E2E 用例还要执行 `pnpm e2e:budget:update --reason "…"`。

检查看不到的写法（有意如此）：别名（`const t = test.skip`）、从其他文件导入的闸门或平台值（`it.skipIf(!isWindows)`）、`os.platform()`、标题不是字面量的跳过（`it.skip(reason, fn)`）；`pnpm test-gates:check --verbose` 会列出所有无法求值的闸门，包括导入的标识符。

基线只用 `pnpm test-gates:ratchet` 重新生成，不要手改 JSON；该命令固定写入这一个文件，调用 `guardRatchetUpdate`（见下文“棘轮基线守卫”），总数相对合并基线上升时需要 `--accept-rise unconditional-skip`。降低计数：运行、修复或删除被跳过的用例，再运行 `pnpm test-gates:ratchet`，把基线与代码放进同一个提交。违反硬零规则时更新命令拒绝写入。

### 棘轮基线守卫 (Ratchet Baseline Guard)

任何以 `ratchet.json` 结尾的已跟踪文件都是棘轮基线（目前七个：架构、死代码、画布状态、兼容、UI 样式、UI 标记、测试闸门），形状为 `{ 规则: { 文件: 正整数 } }`。守卫保证基线本身不能在无人确认的情况下增长，计数器、检查模式和文件格式都不变。

- **比较点**：合并基线 M（`git merge-base HEAD origin/main`；没有 `origin/main` 或浅克隆缺少它时退回 `HEAD`；没有提交时每个总数为 0）与分支头 H。比较的是每条规则的**总数**，缺失的文件或规则按 0 计；文件间移动、文件重命名不需要任何标志。
- **更新命令**（`pnpm arch:ratchet`、`pnpm deadcode:ratchet`、`pnpm canvas:state-ratchet`、`pnpm ui:style-ratchet`、`pnpm test-gates:ratchet`、`node scripts/check-compat-expiry.mjs --update-ratchet`）都先调用 `guardRatchetUpdate`：总数相对 M 上升、或 M 上总数大于 0 的规则消失时拒绝写入（退出 1），并打印 M 的来源、先修代码的建议和需要粘贴到 PR 描述里的段落。确实要记录时，对每条受影响规则加 `--accept-rise <规则>`（可重复；点名一条没有上升也没有消失的规则同样被拒绝）。没有环境变量或配置项可以替代这个标志，`package.json` 脚本也不得带它。
- **PR 描述**：`scripts/check-pr-template.mjs`（`pr-template-check.yml`，`pull_request` 触发）用同一函数比较 M 和 H；有上升或规则消失时，描述必须有 `## 📈 Ratchet rises` 段，每条一行：``- `基线路径` `规则` M总数 -> H总数: 类别: 理由``（消失写 `-> removed`）。类别是 `merge-skew:`（并行 PR 的合并偏差，须引用 `#N`）、`detection:`（规则检测变宽）、`new-rule:`（新规则或新棘轮）、`rename:`（规则 id 被改名、拆分或移除）、`debt:`（须引用将清除这笔债务的 issue `#N`）。检查失败时会打印可直接粘贴的段落；`pnpm ratchet:rises` 对工作区打印同样的段落。
- **本地检查**：`node scripts/check-pr-template.mjs body.md --base origin/main --head HEAD`；既不带 `--base` 也没有 PR 事件时跳过棘轮部分。PR 描述里的 HTML 注释和围栏代码块会先被去掉，写在里面的段落不算数（GitHub 不把它们渲染成段落标题，合并的人看不到声明）。
- **不在范围内**：`LINE_LIMIT_EXEMPTIONS`、兼容注册表的 `until`、`rules.json` 的例外和 E2E 用例预算。
- 实现只有一处：`scripts/lib/ratchet.mjs`（总数、形状、比较、段落）与 `scripts/lib/ratchet-git.mjs`（修订、发现、`guardRatchetUpdate`）。

### 高风险问题预防策略（只列最容易漏的）

以下内容是前文原则的落地建模方式；正式检查项统一见后文“风险与合规检查”，这里不重复展开检查清单。

1.  **先写状态/所有权表，再写流程**：对跨 `Main / Preload / Renderer / PTY / persistence / external CLI` 的改动，先明确四列：`state`、`owner`、`write entry`、`restart source of truth`。若同一真相存在多个写入口，默认高风险。
2.  **严格区分四类状态**：建模时至少先区分 `用户意图 / 持久化事实 / 运行时观测 / UI 派生展示` 四类状态；owner、恢复语义与写回约束按后文“风险与合规检查”执行。
3.  **优先验证不变量，不堆场景**：每个高风险改动至少先写出 1-3 条不变量。测试优先证明“哪些错误不会发生”，而不是只证明 happy path 能跑通。
4.  **默认过一遍故障模型**：重点考虑 `await` 中途关闭窗口/退出 app、事件重复/乱序/延迟、fallback 或 cleanup 比 happy path 更早写状态、部分成功/部分失败、旧数据恢复，以及跨平台路径/shell/权限差异。
5.  **测试按风险层分配，不按文件平均分配**：
    - `Unit`：状态迁移、normalize、纯逻辑不变量。
    - `Contract`：IPC payload、跨层边界、输入校验。
    - `Integration`：hydration、persistence、restart、lifecycle、watcher 协作。
    - `E2E`：关键用户路径与真实交互链路。
    - UI 手段选择、Playwright、截图 / 录屏等细节，统一见后文“UI 自动化与验证”。
6.  **结构分析先于实现**：凡命中结构性风险信号，实现前至少产出一份最小分析：`mutable state owner 表`、`边界/路由图（按场景可对应事件、消息、watcher、lifecycle）`、`1-3` 条 invariants，以及 `局部 patch vs 抽象收敛` 的 trade-off 说明。缺少这些信息时，不进入编码。
7.  **边界驱动系统先识别 source / route / owner**：涉及事件、消息、watcher、回调、lifecycle 或其他边界驱动系统的冲突时，先明确 `谁发出`、`谁路由`、`谁拥有默认行为`、`谁拥有状态写权`。任何需要靠隐式副作用才能维持正确性的实现，都默认视为结构问题。
8.  **每个真实 bug 都要资产化，且留下适用的最强一档**：资产由强到弱依次是：(1) 类型或结构，让错误写法无法通过编译或无法表达；(2) 机械检查，例如 lint 规则、架构规则、棘轮；(3) 运行时断言；(4) 场景回归测试。修复必须留下其中适用的最强一档，并在 PR 中说明为什么更强的一档不适用；只写进文档的文字规则不算资产，只能作为上述资产的附带说明。若在分析阶段已经能看出同一结构弱点会导出多个相邻故障模式，就必须直接升级为系统性治理任务，目标是合并 owner、消除重复写入口或收敛交互抽象，而不是等待再次复发。

### 通用参考学习与方案生成法（Research -> Synthesize -> Adapt -> Verify）

凡是行业内大概率已有成熟做法、主流产品 / 框架 / 库已有先例、或问题明显不是 OpenCove 独有时，都应主动查找外部参考，再结合本仓约束提出方案，而不是等用户点名要求后才去看。

1.  **先识别问题类，不先写实现**：先写一句 `这是哪一类已有行业先例的问题`，再写一句 `OpenCove 当前真正不稳定 / 不清晰的承诺是什么`。
2.  **按四层查参考**：
    - `产品 / 帮助文档 / 规范`：确认外部世界对该问题类承诺的稳定行为。
    - `官方示例 / 源码 / 测试 / RFC`：确认默认策略、owner、边界和 fallback。
    - `issue / discussion / changelog / maintainer comment`：确认 trade-off、平台差异和已知坑。
    - `本仓现有实现`：确认哪些抽象可以复用，避免平行再造。
3.  **每个参考只提炼五类信息**：`承诺`、`state / authority owner`、`1-3 invariants`、`fallback / override`、`trade-off / 不直接照搬的部分`。
4.  **提出方案时必须做转译**：按 `行业共识 -> 可迁移原则 -> OpenCove 约束 -> 本地设计` 输出，不直接把外部实现贴进来。
5.  **自动化 / 启发式默认保守**：涉及 `auto-detect / auto-switch / auto-retry / auto-recover / heuristic` 时，高置信才切换，歧义保持稳定，并保留显式兜底。
6.  **验证仍遵循本文件前文的按风险分层原则**：重点把从外部参考提炼出的规则、不变量和 trade-off 落到最低 meaningful layer；UI 侧手段选择统一见后文“UI 自动化与验证”。
7.  **最后资产化**：把结论沉淀到 `专项文档 + 测试 + owner / invariant 说明 + review 要点`；否则视为未完成学习闭环。

### 风险与合规检查（Risk & Compliance System）

本节是前文状态、边界、owner 与恢复语义原则的正式检查清单。对 **Large Change** 或任何命中运行时高风险的改动，在进入实现前至少显式过一遍以下检查项：

#### 关键稳定性检查（Critical Stability Checklist）

- **Async Gap Safety**：所有 `await` 边界都要考虑组件卸载、窗口关闭、app 退出、对象失效后的行为。
- **Concurrency & Race**：防止快速连续输入、重复事件、异步乱序、重复回调带来的竞争与边界漂移。
- **State Ownership**：对持久化、恢复、同步或跨层传播的状态，必须明确唯一 authoritative owner，避免多层抢写同一真相。
- **Restart Semantics**：严格区分用户意图、durable fact、runtime observation、UI projection；关闭、watcher 噪声或 fallback 不得默默把可恢复状态降级成终态。
- **IPC Security**：Renderer 到 Main 的输入必须校验，禁止 blind trust。
- **Resource Lifecycle**：事件监听、订阅、child process、watcher、disposable 必须成对清理。
- **Performance**：避免阻塞 Main 线程；关注高频输入、重渲染、布局抖动、大文件和重 IO 路径。
- **Data Integrity**：任何持久化结构、schema 或恢复语义变动都必须考虑兼容、迁移与回滚。

#### 触发式合规门槛（Triggered Compliance Gates）

- **Architecture**：禁止 Main / Preload / Renderer 逻辑越界；边界暴露统一走 `preload` 或契约层。
- **Type Safety**：避免 `any`，IPC payload、跨层 DTO、边界返回值都要保持可校验、可推断。生产代码不得使用 `@ts-expect-error`、`@ts-ignore`、`@ts-nocheck`（`pnpm lint` 会报错）：遇到类型错误就修类型。类型测试写在 spec 里，`@ts-expect-error` 后必须写明预期的错误。
- **Lint**：`pnpm lint` 遇到任何 warning 都失败（`--max-warnings=0`），本地与 CI 相同。确需保留的个例用 `// oxlint-disable-next-line <rule> -- <原因>` 就地写明原因，不放宽规则级别。`src/app/renderer/shell/components/WorkspaceMain.tsx` 额外启用 `react-perf/jsx-no-new-function-as-prop`：画布 `WorkspaceCanvas` 是 memo 组件，在这里传入的内联函数会让 shell 的每次渲染（性能采样器每秒约 3 次）都重渲染整个画布。
- **Security**：保持 Context Isolation；Renderer 禁止 Node Integration；能启用 Sandbox 的路径不要随意放弃。

### UI 自动化与验证（UI Automation & Verification）

对 UI 改动，尤其是 **Large Change**、高交互风险改动、或真实体验比纯逻辑更重要的改动，按以下方式选择验证手段：

- **Web/Renderer 优先用 Playwright**：主路径走 `pnpm test:e2e` 或最低 meaningful layer 的 Playwright 用例。
- **bug 回归放在能复现不变量破坏的最低层**：新增或加强 unit、component、contract、integration 或 E2E 回归测试；不默认新增 E2E。
- **用户可感知变化必须运行已有 E2E 旅程**：选择覆盖本次变化的路径。只有不变量依赖真实 Desktop、浏览器或 native 边界，且低层测试与已有旅程都不能覆盖时，才新增 E2E；PR 写明该边界与独有断言。
- **终端渲染和画布交互保持 E2E-first**：xterm 几何、renderer/WebGL/DOM、raster/calibration、滚动条、透明度、链接、live reattach、缩放下终端几何，以及拖拽、resize、push-away/squash、框选、snapping、arrange、zoom/pan 的回归依赖真实 renderer。不得削弱断言、改变断言时的画布内容或改用共享 app 进程。
- **下沉必须证明等价**：低层测试通过且断言等价性有记录后，才可替换原 E2E 断言；独有边界用例先迁移，无法等价的部分留在 E2E。移动文件时同步 `scripts/precommit-e2e-selection.mjs`。
- **E2E 提速先削减用例本身，不共享 app 进程**：实测一次 Electron 启动、首屏、种子写入到关闭约 1.6 秒（其中进程启动约 1.0 秒），平均每个 spec 文件不到 2 个用例，按文件共享 app 进程在 macOS 上最多省约 1.5 分钟，还会引入用例间状态泄漏。提速优先把非渲染断言下沉到 unit/contract，或缩短慢用例中的等待与重复路径；用 `node scripts/report-e2e-durations.mjs` 读 CI 耗时 artifact 定位慢用例，再看慢用例的 step 时间线：单个异常 step 会藏在“种子写入”里，例如把 4 MB 图片以 `Array.from` 传给 `page.evaluate`，Playwright 逐元素序列化，每次约 7 秒；大块二进制改传 base64。
- **主题/样式改动必须遵守 UI 规范**：新增颜色走 token，Light/Dark 都要验收可读性；优先在 E2E 中附带截图。详见 `docs/ui/README.md`。
- **复杂交互辅以截图 / 录屏**：当行为依赖拖拽、滚动、动画、命中点或视觉反馈时，用截图或录屏帮助确认真实体验。
- **提交前做一次 smoke 验证**：至少确认核心用户路径、关键视觉状态和交互目标没有回归。
- **开发中用视觉调试**：必要时主动看截图、边框、命中区域、选择框、hover/active 状态，而不是只看日志和断言。
- **非用户可感知改动优先低成本验证层**：纯内部重构、类型收敛、工具链/脚本调整等，优先跑目标明确的 unit/contract 测试；UI 回归风险较高时再补 E2E。

### 快速迭代与完整回归

本地速度和合并质量使用不同入口，不删除既有测试：

| 时机 | 入口与范围 |
| --- | --- |
| 每轮修改 | 运行能复现本轮不变量的最低层测试；用户可感知变化再跑已有对应 E2E，新增条件见上文；不要对累计暂存的整个功能反复跑全量 |
| 本地提交 | `pnpm verify:quick` 或 `pnpm pre-commit`：静态检查（含 `pnpm compat:check`：兼容路径到期门禁，规则见 `docs/development/COMPATIBILITY_EXPIRY.md`）、staged 相关测试、native recovery contracts、固定核心 E2E 与受影响模块的代表场景 |
| 按需本地完整检查 | 暂存后运行 `pnpm verify:full`：静态检查、完整 Vitest、native contracts、完整 Electron E2E |
| PR 合并前 | 最终提交必须通过 PR 的 CI：Ubuntu 上的完整 E2E 分片、Windows 与 Desktop/Web continuity 检查；macOS 只运行一个 `macos-platform` job（Worker CLI contracts、macOS 专属 Vitest 文件、`tests/e2e/*.mac.spec.ts` 与核心 E2E 组，文件由 `scripts/run-macos-platform-e2e.mjs` 选取，新增 `.mac.spec.ts` 无需改 workflow）。PR 的 job 不重试，唯一例外是 Windows E2E 步骤：重试一次，并由 `scripts/check-e2e-retried-tests.mjs --enforce` 判定，每个 run 至多接受一个因重载处渲染进程崩溃而重试通过的用例，见“合并后”一行 |
| 合并后 | `main` 上的 push run 运行完整 macOS E2E（`ci-macos` 三个分片），必须为绿。该 run 不会被后续 push 取消：一个在跑、最新的排队、更旧的排队项被丢弃，因此每个 run 覆盖上次以来的全部合并。红 run 由 `main-status` job 自动打开（或追加评论到）带 `ci-red` 标签的 issue，下一个绿 run 自动评论并关闭它；不要手动开关该 issue。合并者负责响应，issue 未关闭期间，下一次合并必须是修复或回滚。改动终端与 PTY 层、窗口生命周期、文件系统路径、原生菜单与快捷键、字体与渲染时，合并前先在分支上手动触发完整 run（Actions 中对 `CI` 使用 `workflow_dispatch`，选择该分支，不要选 `main`：在 `main` 上手动触发会与 push run 共用队列，可能顶替一个正在排队的 push run）。合并后的 macOS 分片失败时重试一次，重试通过的用例报告为 flaky，不使 `main` 变红；Windows E2E 步骤在所有 run 上重试一次（其在重载处的渲染进程崩溃与被测改动无关，约五次 run 出现一次，#698）：pull request 上，只有首次失败正是该崩溃的用例才允许靠重试通过（该次尝试的首个错误是 Playwright 在 `page.reload` 丢失页面，且进程诊断记录渲染进程以访问冲突退出），每个 run 至多一个；其他靠重试通过的用例、第二个这样的崩溃、失败的用例或与 Playwright 自身计数不符的报告都使 job 失败（`scripts/check-e2e-retried-tests.mjs --enforce`）；合并后与手动 run 上只报告、不判红。定时 nightly 发布取 `main` 上最新一个 CI push run 为绿的提交构建，不是 `main` 的最新提交；没有绿 run 时跳过并给出原因 |

Ubuntu job 的 Playwright 浏览器都经 `.github/actions/install-playwright-browsers` 安装：apt 下载的 `.deb` 存进 Actions 缓存（按 runner 镜像版本、浏览器和 Playwright 版本分键），安装前归档目录里已有的每个 `.deb` 都先按刚更新的签名包索引校验 SHA256，不符的删掉重下（apt 自己只比较大小），所以 runner 的 apt 镜像只需提供包索引（约 13 MB）和缓存缺少的包；镜像变慢时安装步骤仍在 15 分钟后失败（#749）。新增需要浏览器的 Ubuntu job 也用这个 action（`tests/unit/scripts/ci-e2e-browser-provisioning.spec.ts` 检查现有两处）。

E2E 选组规则维护在 `scripts/precommit-e2e-selection.mjs`。快速门禁输出选中组、原因和测试文件，固定覆盖启动、终端创建、重启后可输入；插件、共享窗口、Space、设置、连接、Sidebar 和文件相关改动追加对应组。删除、重命名、CSS、配置与未知源码也必须参与判断；未知范围扩大代表组并明确提示，不能静默跳过。代表组选取不等于完整依赖分析：开发者仍须为本次修改的不变量补跑直接相关用例。

持久化与迁移、启动/退出恢复、IPC/认证、Worker 所有权与生命周期变更，应新增或加强 contract/integration 覆盖，并运行已有真实边界/恢复旅程，不能仅以普通冒烟通过代替。共享窗口几何或依赖/构建变更也须选择对应回归层。曾捕获真实产品缺陷的测试优先进入快速组；睡眠、窗口焦点和测试夹具导致的失败按环境问题定位，不用重试或放宽断言掩盖。

E2E 数量门禁：`pnpm e2e:budget` 用 Playwright `--list` 检查全部 Electron 用例（含 skip 和平台专属声明），不启动 Electron。稳定 ID 为所属 spec 文件 + 完整参数化标题路径，不含行号；平台条件用 `test.skip`，不要按 OS 隐藏声明。基线在 `tests/e2e/budget/cases-*.json`。新增/重命名须执行 `pnpm e2e:budget:update --reason "Desktop: 所需边界和独有断言"`（也可用 `browser:` / `native:`）；理由随每个新 ID 进入 diff。删除后执行 `pnpm e2e:budget:update` 锁定下降。`verify:checks` 在 staged E2E/枚举配置变化时执行，CI 静态检查始终执行。

Ubuntu/macOS 每个 Electron 分片保留 list 日志并上传 `e2e-durations-<OS>-<shard>` JSON artifact（成功或失败均上传）。CI 的 `e2e-duration-summary` job summary 展示总串行/分片耗时、最慢 20 例、新增超过 15 秒的用例和相对 `tests/e2e/budget/duration-*.json` 中位数基线的增长。计时仅供观察；缺失、损坏或中断报告显示警告，不阻断 CI，也不视为节省。基线来源和更新方法见该目录的 `README.md`。

Ubuntu 四个分片、macOS 三个分片，数量只在 `scripts/lib/e2e-shards.mjs` 的 `E2E_SHARD_COUNTS` 定义；规划器、耗时报告和 CI 接线测试都读它，workflow 的 matrix 必须与之相等（`tests/unit/scripts/ci-e2e-budget.spec.ts` 校验），运行行不再带 `--shards`。分片用 `scripts/plan-e2e-shards.mjs` 按文件内用例的 OS 基线耗时之和做 LPT 分配（最长文件先放入最轻分片；文件同分按路径，分片同分按文件数和编号），不拆文件。新文件/未计时用例采用该 OS 正数基线的中位数，无样本时为 10 秒；只有显式零值计为未运行，缺失记录不能当作 skip。刷新耗时基线即重新平衡分片。`e2e-duration-summary` 通过 `--expect` 得知本次 run 含哪些平台（pull request 为 `ubuntu`，其余为 `ubuntu,macos`），不含的平台不读取、不告警，summary 标注 not in this run。静态 job 与每个分片执行前均校验完整、互斥、无非必要空分片，文件列表仍通过 `pnpm test:e2e` 运行；JSON summary 并列展示计划与实测分钟数。

本地查看计划：`node scripts/plan-e2e-shards.mjs --os ubuntu`（也支持 `macos`，按各自的分片数；加 `--shard 1 --run` 执行该分片）。`--shards <n>` 仅作本地查看其他分法的覆盖，`--check` 不接受它。原有 `pnpm test:e2e -- --shard=1/3` 和 pre-commit 选组保持不变。

快速 E2E 首个失败即停止，保留 trace 后先定向修复。一次代码版本的一组定向 E2E 只构建一次；只有确认源码与构建产物一致时才可复用，代码改动后重新构建。完整 CI 保留现有分片策略；本地快速通过不代表完整回归通过，汇报必须分别列出通过、跳过与尚未执行的范围。

### 变更影响面（`pnpm impact`）

改动之间的联系不能只靠 Agent 的记忆：每次会话都从零开始，而一个典型提交约涉及 20 个文件、3 个区域。`pnpm impact` 在动手前和提交前列出一组文件的影响面，不改动工作区和 Git 状态，退出码恒为 0（仅用法或 I/O 错误非 0）。

- **输入**：`pnpm impact <文件...>`（计划中尚不存在的文件也可以）、`pnpm impact --staged`、`pnpm impact --base origin/main`（与合并基点的差异，含未提交与新建文件）。输出格式：默认完整、`--brief` 摘要、`--json`（`schemaVersion: 1`）、`--pr-section`（可直接粘贴的 PR 小节）。
- **输出内容**：涉及的区域与分层（`src/contexts/<x>`、`src/app/<x>`、`src/shared`、`src/platform`，其余取顶层目录；分层来自 `harness/architecture/rules.json`）；直接引用者（按区域分组，标注运行时或仅类型；`export … from` 会穿透，barrel 不会遮住真正的引用者）；相关测试（引用者中的 `tests/**/*.spec.*`，加上 `scripts/lib/file-read-dependents.mjs` 登记的读文件型测试）；快速 E2E 组（直接调用 `selectPrecommitE2E`）；以及历史上常与它们一起改动、但本次缺席的**共变伙伴**。
- **共变伙伴**来自提交的索引 `scripts/impact-cochange-index.json`，由 `pnpm impact:index` 从 Git 历史生成（跟随重命名；排除合并提交、超过 40 个文件的提交、spec/CSS/多语言/快照等；取最近 500 个符合条件的提交）。展示条件：共同出现至少 5 次，且共同占该文件改动的至少 50%。支持度 ≥10 且置信度 ≥90% 的一对会标为"always together"，应优先考虑生成或抽取，而不是反复解释。
- **为什么提交索引**：它让 50 个提交的浅克隆、1 个提交的 CI 检出和完整本地克隆得到同样的答案，PR 检查与 Agent 本地看到的一致。索引是生成物，不要手改（`AGENTS.md` 规则 3）：`pnpm impact:index` 需要完整历史（浅克隆会拒绝并提示 `git fetch --unshallow`），`pnpm impact:index --check` 从记录的 `throughCommit` 重建并逐字节比较，PR 修改索引时 CI 会运行它。维护者约每月运行一次 `pnpm impact:index` 并作为单独提交；超过 45 天输出会给出过期警告。
- **PR 检查**：PR 描述必须有 `## 🔗 Co-change partners left untouched` 小节，对本 PR 差异里每个缺席的伙伴写一行理由（"should be extracted, follow-up #N" 也是有效理由）；伙伴或理由缺失、理由为空或仍是 `<reason>` 都会失败，失败日志会打印应粘贴的完整小节。PR 检查与 `pnpm impact --base` 使用同一个函数 `findMissingPartners` 和同一份索引。
- **本地门禁**：`verify:quick` 末尾运行 `pnpm impact --staged --brief`，只做提示，不阻塞提交。
- **不能告诉你什么**：经由字符串、IPC 通道名、依赖注入注册、CSS 类名、i18n key 或动态 import 产生的耦合；没有历史的新文件；以及伙伴是否真的需要修改（它只说"通常一起改"，不说"必须"）。相关测试只覆盖静态 import（含 re-export）与 `FILE_READ_DEPENDENTS`。

## 全局硬规则（摘要）

-   **架构基线**：本项目以 `DDD` 划分领域，以 `Clean` 约束依赖；`context` 是一级组织单位，每个 context 强制拆为 `domain / application / infrastructure / presentation`，`app/main`、`app/preload`、`app/renderer` 只做组合与边界。细则见 `docs/architecture/ARCHITECTURE.md`。
-   **Small vs Large**（详见 `AGENTS.md`）：
    -   **Small**：直接做，小步快反馈，跑针对性验证。
    -   **Large / 运行时高风险**：遵循 **Spec -> (Feasibility Check) -> Plan** 流程。
        -   **高风险触发器（最易漏）**：启动/重启恢复、hydration、持久化写回、退出生命周期、跨层状态同步、external CLI / watcher 回写、fallback/cleanup 改写状态、多写者共享同一真相、边界冲突、同一入口对应多套竞争语义。
        -   **Spec**：明确验收标准、风险点及验证手段，等待确认。
        -   **Feasibility Check**：针对新技术/高性能/核心重构，必须先调研并跑通 PoC。
        -   **Plan**：制定详细执行计划，等待确认。
    -   **验证**：用户可感知变化必须跑对应 E2E；UI 变更需提供截图/录屏。包括重大功能在内，本地提交跑快速门禁；完整回归由 PR CI 承担，不要求每次本地提交重复全套。
        -   **兼容与迁移（必须可回归）**：改动 IPC 接口、持久化数据结构、拓扑/配置文件时，必须提供迁移或启动期修复（repair）策略，并补回归测试覆盖“已有用户数据”（缺字段/空记录/旧格式）。不要只验证“新建流程”的 happy path。
        -   **跨平台兼容**：开发默认应考虑 `macOS / Windows / Linux` 三平台；如本次只支持部分平台，必须在方案与交付说明中明确标注差异、限制与后续补齐计划。平台特有 bug 在能复现问题的最低层补回归，并在该平台 CI runner 验证；真实渲染/原生边界遵循上文 E2E 新增规则。Windows / macOS / Linux 专属用例优先使用 `*.windows.spec.ts` / `*.mac.spec.ts` / `*.linux.spec.ts` 命名收口。
-   **禁止提交**：
    -   lock 文件 (`pnpm-lock.yaml`) 必须由命令生成/更新。
    -   生成代码（如自动生成的类型定义等）禁止手改。
    -   **调研/验收报告默认不入库**：调研分析报告，以及某次 PR 的 review / acceptance 记录，都只是**本地分析与决策产物**，不是仓库资产。它们是某一时刻的快照，会很快过期，却没有人维护。除非明确要求，否则不要提交；评审结论写在 PR 描述/评论里。`docs/` 只收**本项目自身的**长期文档：架构、不变量、开发流程、案例。若调研中得出的结论具有长期价值（如一条不变量），把**结论**写进对应的项目文档，而不是提交整份报告。
-   **提交前检查（本地快速门禁，合并前 CI 完整回归）**：
    -   `pnpm verify:repo` 对整个仓库检查行数、命名（`cove:*` 等前缀）、UI 样式、画布状态棘轮（`pnpm canvas:state-check`）、测试闸门（`pnpm test-gates:check`）、架构棘轮（`pnpm arch:check`）、死代码（`pnpm deadcode:check`）与兼容路径到期（`pnpm compat:check`）；结果不依赖 staged 内容，CI（`ci-ubuntu` 的 `Repository checks` 步骤）以同样方式运行。行数上限只约束手写代码（`.ts/.tsx/.mjs/.css/.sh` 等），生成文件与 `.md/.json/.jsonl/.yml/.html` 不受限；超限文件只能登记在 `scripts/check-max-lines.mjs` 的 `LINE_LIMIT_EXEMPTIONS` 中，且记录的行数只降不增。命名检查不处理 `cove:m0:` 前缀（由 `pnpm compat:check` 负责，写 `legacy` 不能绕过）；UI 设计系统前缀仍保留 `cove`（见上文命名约定）。
    -   其余 staged 检查（格式、密钥、相关测试）只看 staged 文件；CI 会对整个仓库重跑格式、密钥扫描与全部单测。对 0 个文件运行的 staged 检查实际上没有运行，将其报告为“通过”属于错误陈述；需要强制防空时，使用 `OPENCOVE_REQUIRE_STAGED=1 pnpm pre-commit`（运行前先 `git add -A`，并用 `git diff --cached --name-only` 确认文件列表非空）。
    -   若本次改动包含用户可感知变化（新增功能、UX 改动、修复 bug、默认行为变化），应先提交代码并创建 PR；拿到 PR 链接/编号后，再更新 `CHANGELOG.md` 的 `## [Unreleased]` 并单独提交（每个变化一条，尽量附 `#PR` 编号）。`nightly` tag 不要求更新 changelog；发 `stable` 时再把 `Unreleased` 结算进新版本段。
    -   创建/更新 PR 时：若本次改动包含用户可感知变化，必须跑对应 Playwright E2E，并列明本地验证范围；合并前以最终提交的 PR CI 为准（macOS 的完整 E2E 在合并后的 `main` push run 上运行）。
    -   创建/更新 PR 时：必须按 `.github/pull_request_template.md` 的结构完整填写；若使用 `gh pr create` / `gh pr edit`，也要显式按模板组织 title/body，不得跳过必填段落。
    -   **提交 PR 正文前，必须先把正文写入文件并运行 `node scripts/check-pr-template.mjs <file>`，确认输出为通过。** 章节标题必须逐字取自 `.github/pull_request_template.md`（先读模板，不要凭记忆写），因为 `pr-template` CI 按精确标题匹配：少一个字或改写措辞都会判失败。本地校验一次，比推上去等 CI 红再改快得多。
    -   PR 中的截图 / 录屏应通过 GitHub PR 描述或评论框直接上传，不要把这类评审素材作为 repo 资产提交；只有明确作为视觉回归基线的 snapshot / golden 文件，才应进入仓库并纳入测试。
    -   若本次改动涉及 **Renderer 用户可见文案**，必须做好 i18n：禁止新增硬编码用户文案，新增/修改文案时同步更新 `src/app/renderer/i18n/locales/en.ts` 与 `src/app/renderer/i18n/locales/zh-CN.ts`，并在提交前做一次对应语言的最小 smoke/测试验证。
    -   通过上述检查后，再执行 `pnpm pre-commit` （type, lint, format, test）。
    -   **门禁通过后必须立即 `git commit`，然后才能汇报完成。** 只 `git add` 不 `git commit` 的工作不算交付：暂存区不是持久状态，清理 worktree、`git checkout`、`git stash` 都会让它消失。汇报前用 `git log --oneline <base>..HEAD` 确认自己的提交在列，且 `git status --short` 为空——这两条是「已交付」的判据，`pnpm pre-commit` 通过不是。
-   **测试失败排查前置**：
    -   凡遇到 `pnpm pre-commit`、`pnpm test -- --run`、`pnpm test:e2e` 或单独 `Playwright` 用例失败，继续排查前**必须先阅读** `docs/development/DEBUGGING.md`。
    -   需要复现/定位 bug 时：先阅读 `docs/development/DEBUGGING.md` 选择合适的调试方法与测试层级；若没有覆盖到的合适方法，则自行探索新方法；当用户反馈“确实解决了困难问题”后，应补充对应案例到 `docs/cases/`，并按需更新 `docs/development/DEBUGGING.md`（方法+适用场景）及其它必要信息。
-   **安全（Electron Security）**：
    -   始终开启 Context Isolation。
    -   Renderer 进程禁止开启 Node Integration。
    -   IPC 通信必须校验参数类型 (validate ALL inputs)。
    -   生产环境 CSP 禁止 `style-src 'unsafe-inline'`（仅开发环境允许），配置入口：`electron.vite.config.ts`。

## 快速开始

-   **安装依赖**：`pnpm install`
-   **启动开发环境**：`pnpm dev`
    - 默认使用独立的 `userData` 目录（避免污染已安装版本的数据）
    - 如需临时复用已安装包的数据：`OPENCOVE_DEV_USE_SHARED_USER_DATA=1 pnpm dev` 或 `pnpm dev -- --shared-user-data`
    - 如需自定义 dev 的数据目录：`OPENCOVE_DEV_USER_DATA_DIR=/path/to/userData pnpm dev`
-   **使用 Worker/Web UI（dev）**：先执行 `pnpm build`
    - Worker 进程运行 `out/main/worker.js`，不会随 `pnpm dev` 的 HMR 自动更新
    - 若遇到“恢复/同步/持久化看起来没生效，但代码明明已改”的情况，先 `pnpm build` 再重启 App
    - 旧数据说明（M6 mounts / locations）：若你的 profile 早于 M6，引入 mounts 后首次启动会尝试自动修复旧项目数据（为缺失 mounts 的本地项目创建一个默认本地位置，并修复 Space 的 target mount 绑定）。若项目是 remote-only 且缺失位置数据，无法凭空推断远程路径，需要在项目菜单中手动添加位置后才能正常运行相关能力。
-   **运行 CLI**：先 `pnpm build`，再 `pnpm opencove --help`；仅 CLI 迭代可用 `pnpm build:cli`，产物为 `out/cli/opencove.mjs`，不随 dev HMR 更新。
-   **运行单元测试**：`pnpm test -- --run`
    - 覆盖率运行（`pnpm test:coverage`，只在 `main` 的 push run 中执行）把用例默认超时设为 30 秒，其余运行保持 Vitest 默认的 5 秒：插桩使 CPU 密集用例慢约 4 倍（CI 实测 1.0 秒变为 3.8 至 4.2 秒，慢 runner 上超过 5 秒）。因此只在覆盖率下超时的用例不要单独加超时参数；本身就需要更久的用例显式写出超时并注明实测值。该参数由 `tests/unit/scripts/coverage-timeout.spec.ts` 校验。
-   **真实 Worker / CLI 契约**：先 `pnpm build`，再 `pnpm test:contract:worker-cli`；重复验证可加 `--repeat-each=5`。
    - 独立 Playwright runner 不启动 Desktop 或浏览器；每例隔离 userData、workspace、真实 PTY 和生产 session grant。Worker 使用 `ELECTRON_RUN_AS_NODE=1`，复用 postinstall 的 Electron ABI 原生模块，不另行构建 Node ABI。
    - 夹具拥有进程清理，退出时检查 Worker 与已观测 PTY 子进程；断言通过 HTTP 控制面和真实内置 CLI 执行。只把不依赖 UI 的断言放到这里。
    - Ubuntu 在 unit job 的 Build 后运行；macOS 在 `macos-platform` job 中运行（与 macOS 专属文件和核心 E2E 组同一个 job），避免挤占 E2E shard 预算。CLI、Worker、控制面和进程实现的 staged 修改会在快速门禁构建后运行此套件。
-   **运行 E2E 测试**：`pnpm test:e2e`
    -   说明：`pnpm test:e2e` 已包含构建步骤，默认使用 `offscreen` 后台窗口模式；检测到 Electron 崩溃特征时，会按窗口模式链路自动降级并重跑失败用例（例如 `hidden -> offscreen`、`offscreen -> inactive`）。
    -   可通过 `OPENCOVE_E2E_WINDOW_MODE` 指定窗口模式（`inactive / offscreen / hidden`，禁止 `normal` 以避免抢占焦点）。
    -   如需关闭自动降级，可设置 `OPENCOVE_E2E_DISABLE_CRASH_FALLBACK=1`。
    -   成功路径的诊断截图与 viewport screencast 默认关闭；设置 `OPENCOVE_E2E_DIAGNOSTICS=1` 恢复采集。失败保留可用的最终截图与已采集指标，断言读取的图像和 Playwright 的 failure screenshot / trace 策略不变。
    -   `pnpm pre-commit` 与 CI 的 required Electron/Web continuity gates 固定使用 `OPENCOVE_E2E_RETRIES=0` 且关闭 crash fallback（例外只有两处，各重试一次：合并后 `main` 与手动 run 上的 `ci-macos` 分片，以及各 run 上的 Windows E2E 步骤，因其在重载处的渲染进程崩溃与被测改动无关，约五次 run 出现一次（#698）；pull request 上该步骤只接受因这一崩溃而重试通过的用例，其他重试通过的用例仍使 job 失败，见“合并后”一行）；本地诊断命令可以显式覆盖，但 retry/fallback 结果不能作为合并证据。
    -   若需单独执行 Playwright（如 `pnpm exec playwright test tests/e2e/xxx.spec.ts`），必须先执行 `pnpm build`，否则可能仍会使用旧的 `out/` 产物，导致结果与当前源码不一致。

## 常见问题（FAQ）

-   **为什么我用 `pnpm dev` 启动后，Worker/Web UI 相关功能表现很奇怪（恢复/同步/持久化不生效）？**
    -   先检查是否启用了本机 Worker 模式（userData 目录下的 `home-worker.json` 中 `mode=local`，或环境变量 `OPENCOVE_WORKER_CLIENT=1`）。
    -   然后执行一次 `pnpm build` 并重启 App，确保 `out/main/worker.js` 与当前源码一致。

## 文档地图（按问题找入口）

-   **Agent 关键指令与决策门槛**：`AGENTS.md`
-   **架构标准（DDD + Clean）**：`docs/architecture/ARCHITECTURE.md`
-   **架构 harness（源码偏离检查）**：说明见 `harness/architecture/README.md`
-   **Project / Space / Endpoint / Mount 能力链路**：`docs/architecture/WORKSPACE_CAPABILITY_ARCHITECTURE.md`
-   **统一控制面（command/query/event）**：`docs/architecture/CONTROL_SURFACE.md`
-   **CLI 规范**：`docs/cli/README.md`
-   **外部可执行发现与解析**：`docs/cli/EXTERNAL_EXECUTABLE_RESOLUTION.md`
-   **Filesystem（URI + providers + guardrails）**：`docs/canvas/FILESYSTEM.md`
-   **画布内文件编辑（Document Node）**：`docs/canvas/DOCUMENT_NODE.md`
-   **画布内浏览器能力规格**：`docs/canvas/BROWSER_WINDOW_CAPABILITY_SPEC.md`
-   **恢复模型与 owner 表**：`docs/architecture/RECOVERY_MODEL.md`
-   **持久化（SQLite schema / migrations）**：`docs/architecture/PERSISTENCE.md`
-   **终端架构文档入口**：`docs/terminal/README.md`
-   **终端多端架构（当前 owner / attach / geometry / display calibration）**：`docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`
-   **Worker Web access 生命周期**：`docs/runtime/WORKER_WEB_ACCESS_LIFECYCLE.md`
-   **终端渲染基准（tactical baseline）**：`docs/terminal/TUI_RENDERING_BASELINE.md`
-   **UI 开发标准**：
    -   总体 UI 规范：`docs/ui/README.md`
    -   窗口 UI 标准：`docs/ui/WINDOW_UI_STANDARD.md`
    -   任务 UI 标准：`docs/ui/TASK_UI_STANDARD.md`
    -   视口导航标准：`docs/ui/VIEWPORT_NAVIGATION_STANDARD.md`
-   **诊断与复盘案例**：
    -   Issue Report 诊断包：`docs/development/ISSUE_REPORT_DIAGNOSTICS.md`
    -   Win10 Codex Scroll：`docs/cases/WIN10_CODEX_SCROLL_DIAGNOSTICS.md`
    -   画布抖动与终端持久化：`docs/cases/CASE_STUDY_CANVAS_JITTER_AND_TERMINAL_DURABILITY.md`
-   **参考优秀项目与方案调研法**：`docs/development/REFERENCE_RESEARCH_METHOD.md`
-   **兼容路径与到期门禁**：`docs/development/COMPATIBILITY_EXPIRY.md`
-   **调试指南**：`docs/development/DEBUGGING.md`
-   **贡献代码指南**：`CONTRIBUTING.md`
-   **API Client 生成与使用**：暂无，参考 `src/shared/contracts` 定义。

## 检索建议（避免一次性读完）

-   优先在 `AGENTS.md` 中查找开发及其流程规范。
-   若问题大概率已有行业成熟做法、主流产品先例或框架惯例，先读 `docs/development/REFERENCE_RESEARCH_METHOD.md`。
-   涉及具体 UI/功能模块时，检索 `docs/` 下的相关文档。
-   搜索现有代码中的实现模式，遵循 "Prioritize Reuse" 原则。
