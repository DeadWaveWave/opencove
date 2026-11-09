# Waiting for agents

`opencove agent wait` observes Worker run state without sending input or stopping the agent.
After a prompt, save its `turnId`, wait with `--turn <turnId>`, then read the same turn.
All ended outcomes exit 0: inspect `outcome` before claiming completion succeeded.
PTY exit ends an active turn with outcome `unknown`, so an exact wait normally returns 0.
Missing history, unavailable archives, authorization and protocol errors retain their specific errors.

## Waiting observed and exited targets

By default, state waits (`--until idle|turn-end|exited`) stop with exit **10** when an
unfulfilled target reports `state: waiting` with nondegraded quality. Waiting observed;
the agent may need the user — inspect before acting. `blockedReason` can be permission,
question, plan or null. Inferred evidence counts; degraded evidence does not. A hook may
resolve the request programmatically, so this does not prove a pending human request.
Exact waits stop at waiting only when the current session's `turn.id` matches `--turn`.
A retained selected end wins even when a newer turn is waiting. An exact wait reports an
exit only for a session observed owning the selected active turn; another session bound
to the node cannot stop it by exiting. Without that proof, the exact history wait continues.

State waits stop with exit **11** if an unfulfilled target exits before satisfying the
condition, except when waiting for `--until exited`. `--through-waiting` continues waiting
when a target reports waiting; it does not suppress exit 11. `--until waiting` succeeds
when nondegraded waiting is observed instead of returning 10. Success wins over attention at the same
reconciled cursor; otherwise exited wins over waiting.

`--all` is the default. Progress belongs to a `(nodeId, sessionId)` binding, and
`turn-end` requires a completion observed on that binding during this invocation.
The first completion keeps that binding fulfilled through later turns and resync,
including when several completed turns arrive together in replay.
If its session changes or the node is unbound, that progress is dropped: the target
becomes pending and must meet the condition again on its new binding. Moving a session
to another node never transfers its previous completion. A pending target without a
binding fails with `agent.not_running` unless success or attention at the same
reconciled cursor has already stopped the wait. **`--any` stops on the first success
OR the first waiting/exited observation of an unfulfilled target.**

Turn-end results include a separate `completion: { nodeId, sessionId, turnId, outcome }`.
Those IDs identify the completion itself; use `completion.sessionId` with
`completion.turnId` for history lookup. The surrounding snapshot's `sessionId`, `turn`
and `state` describe current observations. `endedTurn` and `endedTurnOutcome` remain
available for compatibility, with the same first completion's identity and outcome.
Exact-turn (`--turn`) results and behavior are unchanged.

Exits 10/11 leave stdout empty and use the standard stderr error envelope:
`agent.wait_attention` / `agent.wait_exited`. `error.details` includes `mode`, `until` or
`turnId`, and `targets` with `nodeId`, `sessionId`, `status` (fulfilled/pending/waiting/exited),
`state`, `blockedReason` and active `turnId` when available. No credentials are included.

Ask the user to resolve it in OpenCove (Desktop or this Worker's Web UI). Inspect with
`opencove agent read --node <id> --screen` using the same connection options, and check
the session/turn IDs match. Then run the same wait again; for exact turns reuse the same
`--turn`. Event waits (`--until turn-end`) cannot resume a completion already observed:
prefer `--turn`. Never approve or answer another agent's dialog automatically.

中文：退出 10 表示观察到等待，agent 可能需要用户处理；先查看屏幕和 session/turn ID，
不要据此自动批准请求。请用户在 OpenCove 桌面端或该 Worker 的 Web UI 处理后，重跑原命令。
退出 11 表示未完成目标已退出；`--through-waiting` 不会忽略退出。节点解绑或更换 session
会清除旧的完成进度；请用独立 `completion` 对象中的 sessionId 和 turnId 查询结束证据。
同一绑定回放多次完成事件时，结果仍保留最先观察到的完成及其结果。

## Freshness and cleanup

The Worker is authoritative. CLI resolves owners through `agent.get`, takes a post-get
`agent.list` watermark and reconciles one global ordered SSE stream. After each successful
subscription or reconnect, another watermark fences replay before attention decisions.
An already satisfied initial condition still returns immediately without opening a stream;
this preserves existing success semantics. Fulfilled progress survives resync only for
an unchanged binding. Resync replaces current snapshots while retaining the first observed
completion until reconciliation finishes. Exact turn history remains identity-bound.

Home's cursor cannot certify that a remote mirror has reached `agent.ready`: remote replay
can populate Home snapshots before ready. A remote waiting observation may therefore be
transient even after the Home fence. Inspect on the Worker that runs the agent; the CLI
cannot prove remote readiness from the current public contract.

Timeout exits 124 with `error.details.lastKnown`; interruption exits 130. Both close
subscriptions. The default budget is 20s, minimum 250ms, maximum 2147483647ms.
