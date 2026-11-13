# Observe agent events

`opencove events` writes compact UTF-8 NDJSON as observations arrive. Each line is
one complete record. Default output and `-o json` are identical.

```sh
opencove events --space "Main" --until agent.turn_completed --timeout 2m
opencove events --spawned-by @self --count 10
opencove events --lineage @self --type agent.turn_completed
opencove events --after "$CURSOR"
```

The first record is `stream.ready`, containing the effective selection, starting
cursor and mode (`live` or `resume`). It certifies that observation is installed;
it does not certify agent readiness. Start work only after consuming this record.
Without `--after`, the stream begins at the current Worker watermark, with no
snapshot export. With `--after`, retained matching publications strictly after
that cursor are replayed in order before live delivery.

Data types are `agent.state_changed` and `agent.turn_completed`. Repeat `--type`
to combine them. Inspect `snapshot.quality`, `snapshot.source` and
`snapshot.lastEndedTurn.outcome`; a completed turn can have failed, aborted or
unknown outcome. `endedTurn` identifies the original observed turn and its start.
The stream includes no prompts, final replies or terminal output. To read an exact
reply, save the completion's node/session/turn identity and use
`opencove agent read --node <id> --turn <endedTurn.id>` once.

## Selection and attribution

Project, Space, node and relationship filters combine with AND; repeated types
combine with OR. Selectors accept IDs, exact names, unique prefixes and `@self`.
Node selectors also accept `@parent`. `--spawned-by` includes direct creation
children; `--lineage` includes its anchor and transitive creation descendants.
These two filters are mutually exclusive. New descendants join automatically.
Ancestry comes from immutable creation records, including after a parent is deleted.

Inside OpenCove, omitted scope defaults to your node's current Space, or its project
outside a Space. Explicit project or relationship selection suppresses the implicit
Space restriction. Outside OpenCove, omitted filters include all observations allowed
by the selected Worker's read policy. Filters narrow results; they confer no authority.
The current grant policy does not implement project isolation.

Membership uses the publication's project/Space/node binding, including during replay.
**Scoped streams only guarantee events published after binding.** An initial turn
can end before creation commits its binding; that unbound completion is visible to
a global stream but may be excluded from a scoped stream. Binding never synthesizes
a second completion. For reliable initial-turn collection, use
`node create agent --wait --read`, or save and query the exact turn separately.
Leaving a selected binding produces a terminal gap even when state changes were
excluded with `--type agent.turn_completed`. Unavailable ancestry for a relationship
filter also produces a gap rather than silently excluding observations.

## Resume and continuity

Save the `cursor` from the last **complete newline-terminated** record you received.
A token contains the Worker epoch, sequence and resolved selection, without credentials.
It is an opaque checkpoint, not an access token. With `--after` and no selection flags,
the CLI inherits it without re-resolving IDs, names or caller defaults. An explicit
selection flag must resolve to that same dimension; omitted dimensions stay inherited.
Stopping options and `--fields` can change.

A lost connection exits 3 with the last fully written cursor in stderr
`error.details.cursor`. Reconnect manually with `--after`. There is no automatic
reconnect, polling, baseline refresh or durable journal. A different epoch, expired
history, future cursor, binding departure, uncertain ancestry or queue overflow
produces `stream.gap`, then `events.gap` on stderr and exit 1. Start a fresh invocation
only after explicitly deciding how to reconstruct current state. A Worker restart
may instead invalidate credentials (exit 4) or make the connection unavailable (3).
Only successful authentication reaching the new registry can report an epoch gap.

The guarantee covers ordered matching publications in this Worker's bounded runtime
history (normally 1,024 records), not every provider transition or remote Worker.
Filtered sequence numbers can skip. There are no bookmarks: unrelated activity can
expire a quiet subscription's saved cursor. Home observations retain their original
quality limitations and do not certify remote readiness.

## Output, limits and termination

`--fields` projects declared data fields while always retaining `version`, `type`
and `cursor`. Control records stay complete. `--pretty`, table output and `--limit`
are rejected; use `--count N` for a positive safe integer of data records.
`--until` accepts a selected event type. Controls never count; with both stopping
options, the first satisfied condition wins. Conditions are evaluated before projection.

`--timeout` is an overall deadline, including connection, selectors, enrichment and
blocked stdout. Use whole milliseconds from 250 to 2,147,483,647, or duration syntax
such as `30s` and `2m`. Omission permits indefinite quiet observation after the finite
connection/handshake check. SIGINT exits 130; SIGTERM exits 143. Observation cleanup
never sends input to, stops or relaunches an agent.

The server bounds pending publications at 1,024 records / 1 MiB, including the current
publication. Ancestry cache and traversal are bounded. Overflow is terminal. The CLI
accepts at most 1 MiB per SSE frame and waits for stdout write completion and drain.
This acknowledges writing, not downstream processing or durable storage. Output errors
or forced cancellation may leave an incomplete tail: only complete LF records resume.
A closed downstream pipe (EPIPE) exits 0. Other output failures exit 1.

| Exit | Meaning |
| --- | --- |
| 0 | Count/until reached, or downstream pipe closed |
| 1 | Gap, filter evaluation or output failure |
| 2 | Invalid options, cursor or selection mismatch |
| 3 | Connection unavailable or lost |
| 4 | Authentication or authorization failure |
| 5 | Unsupported Worker or incompatible protocol |
| 6 | Ambiguous selector/profile |
| 124 | Overall deadline expired |
| 130 / 143 | SIGINT / SIGTERM |

Errors use the ordinary CLI convention: JSON on non-TTY stderr or with `-o json`,
readable diagnostics on a TTY. Existing stdout records remain usable after failure.
Waiting/exited observations remain data; they do not trigger agent wait's exits 10/11.

中文：`events` 持续输出单行 JSON，首条 `stream.ready` 表示订阅已建立，不代表 Agent 已就绪。
保存最后一条完整记录的 `cursor`，断线后用 `--after` 手动恢复；过滤条件会从游标继承，
不会随调用者移动而变化。历史过期、Worker epoch 改变、绑定离开筛选范围或血缘不可读取时，
输出 `stream.gap` 并退出 1，不会自动跳过事件。范围筛选只保证绑定后发布的事件，初始回复
需要可靠收集时请使用 `node create agent --wait --read`。完成事件只表示观察到回合结束，
请检查 outcome。超时、Ctrl-C 和 SIGTERM 只结束观察，不停止 Agent。
