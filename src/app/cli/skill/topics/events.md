# Observe agent events

Use `opencove events` when you need a stream of agent observations while doing other
work. Consume its first `stream.ready` record before starting that work.

```sh
opencove events --spawned-by @self --until agent.turn_completed --timeout 2m
opencove events --lineage @self --type agent.turn_completed --count 10
opencove events --after "$CURSOR"
```

Each stdout line is one JSON record. Save the cursor from the last complete line.
A lost connection exits 3; resume manually with --after. Omit selection flags to
inherit that cursor's resolved selection, even if your node has moved. Explicit
flags must resolve to the same filters. A terminal stream.gap exits 1: decide how
to reconstruct state before starting a fresh stream. Never silently discard it.
Credentials can expire on restart (exit 4); incompatible Workers exit 5.

Types are agent.state_changed and agent.turn_completed. Project, Space, node and
relationship filters combine with AND. --spawned-by selects direct children;
--lineage selects a node and its descendants. New descendants join automatically.
Inside OpenCove the default is your node's current Space, or its project outside
a Space; explicit project or relationship selection suppresses the implicit Space.

Scoped observation only guarantees publications after binding. A very fast initial
turn may end before creation commits: use node create agent --wait --read when you
must reliably collect its initial reply. Do not infer or synthesize a completion
from a later binding snapshot. For observed completions, inspect quality and
snapshot.lastEndedTurn.outcome, save endedTurn.id plus node/session IDs, then read
that exact turn once with agent read --node <id> --turn <endedTurn.id>.

--count and --until count data records only. --fields preserves version/type/cursor;
controls remain complete. Output is always compact NDJSON. The overall --timeout
includes setup and output waits. SIGINT (130), SIGTERM (143) and timeout (124) only
stop observation, never an agent. Do not poll agent.list/get, agent wait or screens
to drive stream completion. The stream contains no final replies or terminal bytes.

中文：先消费 stream.ready，再开始工作；断线后用最后一条完整记录的 cursor 手动恢复。
stream.gap 表示连续性无法保证，应显式决定恢复方式，不要静默跳过。范围筛选只保证绑定后的
事件；可靠收集初始回复请用 node create agent --wait --read。回合结束不等于任务成功，
请检查 outcome。退出观察不会停止 Agent。

## Automatic cursor files and several nodes

Use `opencove events --cursor-file ./events.cursor | tee events.ndjson`. After
Ctrl-C, run again with the same cursor file to resume; explicit `--after` overrides
it. Only fully flushed records advance the file, via temp-file rename. One writer
per file; parent directory must exist. Malformed files exit 2, filesystem errors 1.
Keep separate output files after interruption and discard partial tails; a crash
between stdout and checkpoint may replay a record, so deduplicate by cursor.

`opencove events --until-each-turn --node A --node B --timeout 2m` exits 0 once each
distinct node ends a turn after ready. Consume ready before starting work; inspect
outcomes even on exit 0. Final JSON stderr summaries give nodeId/sessionId/turnId/
outcome for exact reads, with stdout unchanged NDJSON. Timeout is 124; --count and
--until conflict. Repeated nodes are deduplicated. On resume, repeat flags for pending
nodes: replay after the cursor counts, but completion progress is not persisted.
