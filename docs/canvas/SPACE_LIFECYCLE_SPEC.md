# Space Lifecycle Spec

本规格定义 Space 在画布里的创建、组织、执行目录、Space Worktree 和归档语义。目标是让用户看到的是稳定的 “Space” 心智，而不是被迫理解 root space / child space / worktree binding 等内部实现细节。

Status: Implemented for the Space lifecycle and Space Worktree slice. Runtime behavior, archive records, and targeted unit coverage are expected to match this document; future changes to Space creation, archive, or Worktree conversion must update this spec in the same change.

## Problem Class

这是成熟的 workspace organization 与 Git worktree lifecycle 问题。主流编辑器会把多个工程根组织在同一个 workspace 里，让用户按项目和文件夹工作；Git worktree 则把同一 repository 的多个 working tree 建模为独立目录。OpenCove 的本地约束是：Space 同时承担画布组织、节点归属、执行目录和 Git worktree 入口，如果不拆开这些语义，就会在 child-space、归档、恢复和工作树删除之间制造隐式副作用。

## External References

- [VS Code Multi-root Workspaces](https://code.visualstudio.com/docs/editor/multi-root-workspaces): 一个 workspace 可以组织多个 folder root，用户心智是“在同一工作区管理多个根”，而不是暴露内部 root 类型。
- [Git `worktree`](https://git-scm.com/docs/git-worktree): linked working tree 是 repository 之外的独立工作目录，创建、移除和 branch 关系需要遵守 Git 自身约束。

迁移原则：

- UI label 表达用户意图，内部 root / child 区分只影响命中位置和状态迁移。
- 视觉组织关系和执行根必须分离建模。
- 删除、归档和 worktree cleanup 必须显式，不得从视觉包含关系推断外部文件系统删除。

## Core Model

Space 有两类不同事实：

- 视觉组织：`parentSpaceId` 表示画布上的包含关系。它决定创建位置、拖拽边界、布局、命中测试和归档树范围。
- 执行边界：`targetMountId`、`boundary`、`directoryPath` 和 Space Worktree binding 表示文件、PTY、Agent、Task 和 Git 操作的执行 scope。

`parentSpaceId` 不等价于执行目录继承。一个 child Space 可以先作为父 Space 内的视觉组织区域存在，也可以在满足约束后成为独立 Space Worktree。反过来，一个 Space 是否是 Worktree 不应由它是否有 parent 推断。

## User-Facing Semantics

创建入口：

- 在画布空白处右键，显示 `Create Space`，创建 top-level Space。
- 在某个 Space 内右键，显示 `Create Space`，内部创建 child Space。
- Space 的 `...` 菜单不提供 `Create Child Space`。位置敏感的右键菜单已经能表达创建意图，`...` 菜单继续承载当前 Space 自身的操作。

用户不需要看到 `child space` 文案。只有在 archive / worktree guard 这类需要解释影响范围的地方，UI 才可以用“inside this Space”、“contained Spaces”一类范围描述，而不是把实现类型暴露为主要动作。

## Lifecycle Operations

Create:

- Blank canvas create 产生 top-level Space。
- Inside Space create 产生 child Space，并把 `parentSpaceId` 指向被命中的最内层 Space。
- 新建 child Space 初始使用父 Space 的视觉上下文；执行上下文必须通过 shared Space scope resolver 得到，调用方不能自己用 parent 链猜目录。

Move / resize / arrange:

- Top-level Space 在画布内自由布局。
- Child Space 保持在 parent Space 视觉边界内，移动或缩放时不得破坏 parent-child tree。
- 视觉变化只更新 layout / rect / parent 关系，不得自动改写 worktree binding。

Node operations:

- 在某个 Space 内创建或拖入节点时，节点归属到命中的最内层 Space。
- 一个 node 最多属于一个 Space。
- Agent、Terminal、Task run 和 file operations 从 owning Space 解析执行 scope，而不是从 active top-level Space 推断。

Worktree conversion:

- Top-level Space 和 child Space 都可以成为 Space Worktree，只要满足 worktree eligibility。
- 转换为 Space Worktree 会创建或绑定一个独立物理目录，并只更新目标 Space 的执行边界。
- 转换 child Space 不会把 parent Space 转换为 worktree，也不会改变 sibling child Spaces。
- 多个 sibling child Spaces 可以分别成为独立 Space Worktree，用于在一个组织 Space 下管理多个 repo / service / branch 工作目录。

Archive:

- 归档目标是一个 Space subtree：target Space、所有 descendant Spaces，以及这些 Spaces 拥有的 nodes。
- 普通 child Space 归档只归档该 child subtree，不提供 worktree / branch 删除选项。
- Child Space Worktree 归档可以针对该 child 自己的 worktree / branch 提供删除选项。
- Parent Space 归档如果包含 descendant Space Worktree，必须逐个列出这些 descendant worktree deletion choices；不得因为归档 parent 就隐式删除所有 child worktrees。
- Archive record 必须能快照整个 subtree。旧的 single-space archive record 继续兼容读取和展示，但新记录不能只保存 target Space 的 `nodeIds`。

Archive persistence / review:

- Space archive record 是归档后的可查看历史，不定义“恢复 Space”或“重放 Space”能力。
- Archive records window 展示旧记录时继续按旧 single-space 结构渲染；展示新 subtree 记录时必须能表达被归档的 Space tree、node ownership 和 execution boundary snapshot。
- 旧 archive record 缺少 subtree 快照时，只按旧语义展示单个 Space 和它的 nodes，不尝试凭空重建 descendant Spaces。

## Worktree Eligibility

`canCreateSpaceWorktree(space)` 必须至少满足：

1. 当前 Space 没有 worktree ancestor。
2. 当前 Space 没有 worktree descendant。
3. 当前 Space 的 repo source 可解析。
4. Git worktree 操作可在该 repo source 上执行，并遵守 Git 自身 branch / path 约束。

这意味着一条 ancestor chain 上最多只有一个 Space Worktree boundary，但 sibling child Spaces 可以同时拥有各自的 Space Worktree boundary。

## Archive Scope Model

Archive flow 先计算 scope，再驱动 UI 和副作用：

```ts
archiveScope = {
  targetSpace,
  descendantSpaces,
  archivedSpaceIds,
  archivedNodeIds,
  worktreeSpacesInScope,
}
```

规则：

- `archivedSpaceIds` 决定 workspace state 删除哪些 Spaces。
- `archivedNodeIds` 决定关闭/删除哪些 durable nodes 和 runtime windows。
- `worktreeSpacesInScope` 决定归档 UI 需要列出哪些 optional Git cleanup actions。
- Git cleanup 是 per-worktree explicit choice，不是 archive Space 的隐式副作用。

## State Ownership

| State | Owner | Notes |
| --- | --- | --- |
| `parentSpaceId` / layout / node membership | workspace context | durable visual organization |
| `targetMountId` / `boundary` / `directoryPath` | workspace + space model | durable execution boundary projection |
| Git worktree list / branch status | worktree context | runtime observation from Git |
| Space Worktree creation/removal side effects | worktree context + mount routing | external filesystem / Git operation |
| Archive record | workspace context | durable snapshot for user-visible history |
| Archive deletion choices | archive UI flow | explicit user intent, not durable default truth |

Settings defaults may preselect deletion checkboxes, but they do not replace explicit per-worktree choices in a scoped archive flow.

## Invariants

1. UI creation label stays `Create Space`; root vs child is derived from hit target.
2. Visual containment never implies external filesystem deletion.
3. A Space ancestor chain has at most one Space Worktree boundary.
4. Sibling child Spaces may each become independent Space Worktrees.
5. Archive records for new subtree archives include all archived Spaces and nodes.
6. Runtime close / cleanup failures must not leave durable Space deletion and archive snapshot creation inconsistent.

## Verification Anchors

- Unit: Space tree helpers, innermost hit resolution, `canCreateSpaceWorktree`, archive scope calculation, archive record normalization, scoped worktree cleanup choices.
- Integration: persistence compatibility for old archive records and new subtree archive records, including archive review rendering and node ownership colors.
- E2E: `Create Space` from blank canvas vs inside Space, absence of `Create Child Space` from `...`, sibling child Space Worktree creation, blocked ancestor/descendant Worktree conversion, ordinary child archive, child Worktree archive, parent archive with descendant Worktrees.

Current targeted checks:

- `tests/unit/contexts/space/createChildSpace.spec.ts`
- `tests/unit/contexts/space/spaceTree.spec.ts`
- `tests/unit/contexts/space/spaceArchiveScope.spec.ts`
- `tests/unit/contexts/space/spaceWorktreeEligibility.spec.ts`
- `tests/unit/contexts/spaceArchiveRecords.spec.ts`
- `tests/unit/contexts/spaceWorktreeWindow.archive.spec.tsx`
- `tests/unit/contexts/spaceWorktreeWindow.flow.spec.tsx`
- `tests/unit/contexts/workspaceSpaceActionMenu.spec.tsx`
