# Recovery Model

本文档定义 OpenCove 当前恢复语义：哪些状态是 durable truth，哪些只是 runtime observation 或 UI projection，以及启动、关闭、恢复时谁有写权。

## State Classes

用户意图：

- 新开 Agent 或 Terminal。
- 恢复某个 session。
- 关闭窗口或节点。
- 为 task 绑定 Agent。

Durable fact：

- Workspace、Space、Node、Viewport layout。
- Task 字段和 task-agent 关系。
- Agent/Terminal 可恢复 metadata。
- Settings。
- Endpoint/mount registry。

Runtime observation：

- PTY alive/exited。
- watcher 观察到的外部 session 文件变化。
- CLI 当前 probe 到的 model 或 provider availability。
- remote endpoint 当前是否可达。

UI projection：

- running / standby / failed badge。
- selection、hover、focus。
- 临时恢复提示、loading shell、recovering overlay。

## Current Recovery Path

Desktop 正常启动要求 Home Worker endpoint 可用。冷启动 runtime 恢复通过 worker `session.prepareOrRevive` contract：

```text
SQLite durable state
  -> renderer hydration requests prepare/revive
  -> Worker resolves or revives runtime sessions
  -> renderer mounts nodes from worker result
  -> terminal clients attach through presentation snapshot + stream
```

Renderer 不拥有恢复判定。它消费 worker result，展示 placeholder/recovering UI，并在 session attach 后渲染 worker-owned output。

## Invariants

1. 恢复判定依赖 durable fact，不依赖 watcher 偶然观察。
2. Watcher 只能上报 observation，不能直接清空 resumable truth。
3. 关闭、fallback、late async completion 不得重写别的 owner 的 durable fact。
4. Agent/Terminal runtime attach 失败不得把业务节点降级成另一种节点。
5. Renderer cache 可用于 UX placeholder，但不能成为恢复正确性来源。

## Ownership Table

| State | Class | Owner | Write entry | Restart source |
| --- | --- | --- | --- | --- |
| workspace list / active workspace | durable fact | workspace persistence/usecase | workspace mutation | SQLite |
| spaces / node layout / viewport | durable fact | workspace context | workspace mutation | SQLite |
| `targetMountId` | durable fact | workspace/space model | space/mount binding mutation | SQLite + topology |
| endpoint/mount registry | durable fact | topology store | endpoint/mount commands | topology files |
| task fields | durable fact | task/workspace model | task mutation | SQLite |
| task-agent relation | durable fact | task/agent usecase | launch/bind/close mutation | SQLite |
| agent session metadata | durable fact | agent/session owner | launch/resume/prepare | SQLite |
| terminal session metadata | durable fact | terminal/session owner | spawn/prepare/kill | SQLite/runtime registry |
| terminal presentation snapshot | runtime state | Worker stream hub | PTY output reduction | Worker runtime |
| PTY alive/exited | runtime observation | Worker runtime | PTY callbacks | none |
| provider availability | runtime observation | agent executable resolver | resolver query/probe | recompute |
| node badge | UI projection | renderer | derived only | derived |

## Boundary Rules

Launch:

- Must persist durable intent before relying on external CLI/session files.
- Agent and Terminal launch create runtime through session/PTY owners, not by directly editing node data.

Prepare/revive:

- Reads durable metadata.
- Attempts worker-owned runtime restore.
- Reports structured failure without mutating durable truth unless the owning usecase explicitly records status.

Watcher/metadata:

- May verify or enrich binding through an owner usecase.
- Must not directly edit renderer store or clear session binding.

Close/delete:

- Node deletion removes durable node and space membership.
- Runtime cleanup is best-effort and must not block durable removal forever.
- Forget/archive semantics must be explicit.

## Terminal Recovery

Terminal visual recovery uses:

```text
session.presentationSnapshot -> attach(afterSeq)
```

The worker presentation session owns serialized screen, applied sequence, epoch and presentation revision. Renderer cache and placeholder data are local UX aids only.

## Verification Anchors

- `tests/integration/recovery/useHydrateAppState.workerPrepare.spec.tsx`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionPrepareOrRevive.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionPrepareOrRevive.parallel.spec.ts`
- Terminal presentation contract and multi-client control surface tests.
