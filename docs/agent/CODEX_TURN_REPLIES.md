# Codex turn replies

With lifecycle hooks on macOS/Linux, save the OpenCove `turnId` returned by prompt,
confirm delivery when steering, then wait and read that exact turn:

```sh
opencove agent delivery <deliveryId> --wait --timeout 30s
opencove agent wait --node <nodeId> --turn <turnId> --timeout 60s
opencove agent read --node <nodeId> --turn <turnId> -o json
```

Check both `outcome` and `message`. A completed turn does not prove that it handled
every request. The reply is the first matching Stop message that actually ends the
local turn. Another provider hook may continue processing afterward; later replies
cannot replace this result. `stop_hook_active` does not predict whether processing
will continue. A continuation without another start creates no local turn.

The same exact-read output and 64 KiB UTF-8 limit apply to Claude and Codex. The
existing relay may shorten an oversized hook payload to a marked 16 KiB message
prefix before delivery. `truncated: true` reports either limit. Reply text appears
only in reads, never in completion events, delivery receipts or recovery hints.

## Identity and recovery

The Worker binds the first observed UserPromptSubmit's private
`(session_id, turn_id)` pair to the OpenCove turn. A Stop must match both IDs to
supply content. Known conflicting Stops are ignored before state arbitration.
Same-pair submits can confirm steering but do not change the turn, its start time,
activity or permission wait. Codex text comparison remains `unavailable`.

A fresh distinct-pair submit ends an unfinished identified turn as `unknown`, with
no reply, then starts a new local turn. Its relay timestamp must be newer than the
original submit's timestamp; repeated steering does not move that fence. A fresh
submit from a previously unseen provider session can switch sessions under the
same rule. Retained prior sessions cannot switch back. SessionStart, including
compaction, supplies identity only and never resets an active turn.

The private identity index keeps up to 1,024 pairs per invocation, independently
of reply retention. It rejects retained-pair replays and associates late receipts
with their original local turn. It excludes pairs already ended before Enter and
never assigns an unknown pair to the current turn. An invocation replacement clears
this runtime index. Archived replies use OpenCove turn IDs and require no provider
turn ID or archive migration.

Missing IDs preserve legacy run-state transitions but supply no correlated reply.
When a delivery fence knows both IDs, confirmation requires both: steering must
match the pair and local turn; a new-turn receipt must carry a distinct pair.
Without a complete known pair, legacy receipt compatibility remains, subject to
existing source, timestamp, binding, local-turn and FIFO checks.

Interrupt hooks are not registered. An interrupted turn may remain active until a
fresh submit supersedes it or its PTY exits; its outcome is then `unknown`, with no
reply. There is no promise of a timely `aborted` result.

Daemon reuse, notify-only coverage and Windows do not add hook-correlated replies.
A daemon merely running beside the default hook-enabled invocation does not disable
hooks. Previously archived exact replies remain readable in every mode and after
restart. Missing content uses the existing `agent.final_message_unavailable`
reasons, such as `provider_sent_no_message` or `turn_not_found`; inspect the terminal
or transcript and do not resend merely because a read failed.

## 中文说明

在 macOS/Linux 启用生命周期 hooks 后，保存 prompt 返回的 `turnId`。Steering 先查
`delivery` 确认，再用同一 ID 等待和读取回复，并检查 `outcome` 与正文。

回复取自首次真正结束该本地轮次、且会话和轮次 ID 都匹配的 Stop。后续继续生成不会
覆盖已保存的结果。同一 pair 的追加输入不会新建轮次，也不会解除权限等待。
缺少 ID 时仍兼容旧版状态观察，但不提供精确关联的正文。

中断不保证立即结束；下一次可信新输入或终端退出可以将旧轮次记为 `unknown`。
Windows、daemon reuse 和 notify-only 模式不新增关联回复；以前归档的回复仍可读取。
读取失败时先检查终端或会话记录，不要因此自动重发。
