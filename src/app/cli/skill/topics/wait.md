# Wait for an exact turn or a node state

Wait never sends input. After prompting, save turnId, confirm delivery, then select that exact end,
even if a newer turn starts. Matching waiting stops with exit 10 by default. An exact wait returns
`{nodeId, sessionId, turnId, outcome, endedAt?, state}`; all ended outcomes exit 0. Check `outcome`
(completed, failed, aborted or unknown). `--turn` requires exactly one node and conflicts with
`--until`, multiple nodes and `--any`. Unknown/evicted turns or missing retained evidence exit 1;
inspect `agent get`. Its `lastEndedTurn` identifies the latest end and persists during the next
turn; replacement/restart clears it. Older Workers omit it; events/history remain usable. History
fallback requires interact scope. State waits follow the current session; exact archived waits
retain the original session. Inspect persisted before relying on restart durability. For node-level
state waits, a state that already holds counts immediately; unknown or degraded never counts as
idle. `--until turn-end` observes a subsequent end; start while the turn is still running. Default
is `--all`, timeout 20s; minimum is 250ms (smaller budgets exit 2 before connection/target lookup).
Wait accepts whole milliseconds up to 2147483647 (about 24 days). Set `--timeout` for real work.
Live list excludes exited sessions; inspect a known exited node with get or wait.

```sh
opencove agent wait --node agent-123 --node agent-456 --until waiting --any --timeout 30s
opencove agent wait --node agent-123 --node agent-456 --until idle --all --timeout 2m
opencove agent get --node agent-123 --fields state,quality,turnOutcome
```

Exit 10 = waiting observed: the agent may need the user. Never answer its dialog; ask the user to
resolve it in OpenCove (Desktop or this Worker's Web UI), inspect `agent read --node <id> --screen`
(same connection options, matching session/turn IDs), then repeat the wait with the same --turn.
Exit 11 = an unfulfilled target exited. Success beats both; 11 beats 10. --any stops on the first
success or attention event; fulfilled bindings never stop --all, and a session change resets
progress. turn-end results carry `completion` {sessionId, turnId, outcome}; event waits cannot
resume an observed completion, so prefer --turn. --through-waiting keeps waiting through waiting
(not exit 11). Exact PTY exit normally returns 0/unknown.

State waits print all selected latest snapshots; exact-turn waits print one result. Timeout prints
lastKnown on stderr with stdout empty. Ctrl-C exits 130 and closes subscriptions without stopping
the target. Exact local archived waits survive restart; inspect persisted before relying on
durability. Use `opencove skill read` for archive retention, history clearing and unavailable
replies.

```sh
opencove agent wait --node agent-123 --turn turn-123 --timeout 2m
```

## Host strategy

Claude Code coordinators may background an exact-turn wait with Bash `run_in_background: true`;
completion notifications include timeout/error exits, so check exit code and outcome. Codex
coordinators wait in the foreground with a CLI timeout below the tool timeout and repeat the same
turn wait after exit 124. Full guidance: `opencove skill coordinate`.

## Provider continuations and identifiers

Claude queued messages and provider follow-ups stay in one OpenCove turn. Exact waits include these
continuations; exact reads return the final reply. Unknown continuation outcomes remain unknown and
may expose `messageKind: intermediate` when read. Codex retains the first matching Stop end; later
continuation does not replace it. Same-pair Codex steering keeps the active turn and does not clear
waiting.

deliveryIds are retained correlations of OpenCove deliveries with this turn, including refused or
uncertain attempts. Membership proves neither submission nor consumption; inspect each deliveryId
with opencove agent delivery <id>. promptIds are the provider's own prompt IDs (Claude continuations
included); agent delivery does not accept them. Best-effort wait lookup failures omit IDs without
changing completion/outcome/durability. Resolved delivery records expire after 30 minutes and
existing capacity limits apply; restart clears them. Live history keeps up to 64 previous provider
prompt IDs plus the final ID; archives retain only the final prompt ID. Missing IDs never justify
resending.

An exact result may include persisted, memoryOnlyReason, deliveryIds and promptIds. Waiting never
returns message content. Archived local turns return their original session without requiring a live
agent; older remote history requires the executing Worker (remote_history_unavailable).
`archive_unavailable` differs from missing/evicted history. Home's stream cursor cannot certify that
a remote mirror is ready; inspect on the executing Worker if observations are uncertain. Timeout and
Ctrl-C close subscriptions; they never stop the agent. There is no polling input or automatic prompt
retry.
