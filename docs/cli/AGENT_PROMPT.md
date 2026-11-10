# CLI Agent Prompt

```text
按 docs/cli/AGENT_PLAYBOOK.md 验证 CLI：
1. 使用任务指定的独立 profile；未指定时使用工作树 .codex-out/tmp/cli-profile。
2. 先运行 worker status、ping、project list、space list，检查真实状态和目标 ID。
3. 只在明确授权时启动 Worker 或外部 agent provider。
4. 用本次创建的临时节点做 create/update/get/delete；记录 ID，结束时清理。
5. 成功 stdout 直接解析为 value JSON；错误通常检查 exit code 和 stderr.error。agent delivery 正常返回证据时即使退出码为 1 也输出 stdout，请解析结果。
6. 使用 --help 查询选项；长文本用 --text-file、--content-file、--prompt-file 或 --params-file，- 表示 stdin。
7. 远端显式使用 --endpoint/--token；不要推断或修改未知 profile。
8. focus.delivered 为 false 不算业务失败。PTY stdout 是原始终端流，Ctrl-C detach 返回 130。
9. 汇报实际命令、结果、NOT RUN 和进程/节点清理状态，不把未运行测试写成通过。
```

## Send, confirm, wait and read

For a simple hand-off:

```sh
opencove agent prompt --node node-123 --wait --read --timeout 2m "Review the changes"
```

The command sends once, confirms delivery (including Codex steering), then waits for its exact
turn. It returns one JSON result with deliveryId, nodeId, sessionId, turnId, phase,
outcome and endedAt. With --read it adds the structured exact-turn reply; without it reply is
omitted. Missing or unavailable replies produce `reply: null` and `replyUnavailableReason`,
while the completed turn still exits 0. Empty reply text is a valid reply. `--fields` supports
these fields and nested reply fields, such as `--fields deliveryId,turnId,outcome,reply.message`.
After confirmation, phase is submission_observed. Check outcome even when exit is 0.

With --wait, --timeout covers confirmation plus turn waiting (default 20s, minimum 250ms,
maximum 2147483647ms). Sending has its own 15s timeout and five-second HTTP response margin;
optional reading uses the ordinary request timeout. Without --wait, delivery timeout behavior
is unchanged. `--read` requires --wait. Unconfirmed/ambiguous/unknown delivery stops with exit 1
without waiting for the turn. Exit 10 carries the usual waiting-for-user envelope and
blockedSummary; exit 11 means an unfulfilled target exited; timeout exits 124. All retain known
deliveryId and turnId in error.details. Ctrl-C exits 130 and prints known IDs on stderr. Before
the prompt response arrives, only deliveryId may be known; query that delivery to recover turnId.
Never resend. Already-ended exact turns are read from retained evidence, so a fast reply is not missed.

简单交接请使用 `agent prompt --wait --read`，并检查 `outcome` 和回复。确认和等待共享
`--timeout` 预算，发送另有 15 秒预算。轮次已结束但没有回复时返回 `reply: null` 及原因；
超时、中断或等待用户处理后，用已有 `deliveryId` / `turnId` 继续查询，不要重发。

For concurrent work, keep the four-step flow below, saving the returned IDs. Claude Code
coordinators can run the exact-turn wait in the background as described later.

## Send to a running agent

```sh
opencove agent prompt --node node-123 --text 'Review the changes'
opencove agent prompt --node node-123 --text-file ./prompt.txt --timeout 20s
cat prompt.txt | opencove agent prompt --node node-123 --text-file -
```

Choose exactly one of positional text, --text or --text-file. Without --wait, `--timeout` accepts milliseconds or durations (`15s`,
`15000ms`, `1m`); default 15s, maximum 60s. HTTP timeout includes a five-second response margin.
The target must be an agent window OpenCove launched: local Claude Code or Codex
with lifecycle hooks for this invocation,
at authoritative working state or after a hook-observed settled turn (Claude Stop/StopFailure; Codex Stop). Codex notify-only,
opt-in daemon reuse (`codexReuseRunningAppServer`), file-only telemetry and Windows are unsupported.
OpenCove launches Codex with hooks by default even when a shared daemon is running. `@self` resolves through the
calling session grant; prompting an observed agent inside a canvas terminal is refused by the server.

Success is JSON with `deliveryId`, `nodeId`, `sessionId`, `phase` and `turnId`.
`submission_observed` confirms qualifying submission evidence; Codex steering may return
`dispatched` pending confirmation with `agent delivery`.
It also returns `textComparison` (`matched`, `different`, `unavailable`), Claude's
`comparisonProfile: claude-code-v1` and optional diagnostic `promptId`.
`--fields` accepts all these declared fields. The Claude profile, verified for
2.1.319, compares equality modulo newline representation and trailing ASCII space,
tab and LF; leading/interior whitespace remain significant. Codex comparison is
`unavailable` until a profile is verified. Equality proves neither causation nor
model processing. `different` still exits 0, with a notice on stderr: stop automatic
orchestration, retain identifiers, inspect with `opencove agent read --node <id> --screen`,
and never resend or press Enter again because of the comparison. State and delivery refusals exit 1 with the AppError code and typed
`error.details` dispatch-attempt flags; a server deadline exits 124 and preserves those flags.
Usage errors exit 2; authentication or grant-policy refusals exit 4. Local HTTP timeout exits 124; transport loss is outcome unknown.

Agent terminals cannot start delivery or launch prompts with the target provider's command prefixes:
Claude Code `!`, `/`, legacy `#` or `&`; Codex, OpenCode, Pi and Gemini `!` or `/`; Kimi `/`.
These grant refusals exit 4 with `field_denied` before input or a delivery record. Start with words;
`!` or `/` later in a message remains ordinary text. Only the user runs provider commands and answers permission dialogs.


Inspect drafts and dialogs with `opencove agent read --node <selector> --screen`
before sending. Save `deliveryId` and `turnId`, confirm with `agent delivery <deliveryId> --wait`, and use `opencove agent wait --node <selector> --turn <turnId>`,
then `opencove agent read --node <selector> --turn <turnId>` using the saved
`turnId` from prompt. This exact read never falls back to a different turn or transcript. A human editor draft is submitted with the text; unobserved dialogs cannot be excluded.
Submission observation means a token-authenticated UserPromptSubmit passed matching checks
with a range-checked, caller-supplied relay timestamp at or after the pre-Enter boundary. It assumes
the same wall clock without adjustments; any holder of the session's hook token can claim a
submission. It does not prove causation, exact text processing or turn completion. Never resend automatically after interruption, stalled receipt, or transport loss.
See [Prompt delivery](../agent/PROMPT_DELIVERY.md) for admission, errors and recovery.

Agents typed into terminal shells (including terminal shim/launcher invocations) refuse
with `agent.prompt_unsupported` / `terminal_agent_unsupported`, even after an observed Stop.
Agents typed into a terminal cannot receive prompts because the shell would receive the input after the agent stops.
Start an agent meant to receive prompts, such as a lead agent other agents report to, as an agent window using Run Agent on a task, the agent launcher, or `opencove node create agent --space <space> --prompt <text>`; it can still use the opencove CLI from there.
Executable-path overrides and option-like model/session values have no verified lifecycle
coverage for prompting. See the repository [prompt skill source](skills/opencove-agent-prompt/SKILL.md)
for reusable agent instructions; this source does not install or modify a user skill.

A custom executable path refuses with `executable_override_unverified` for both providers.
Remove the override in Settings → agent executable and launch a new agent window with
the required lifecycle hooks; the running invocation's observation behavior is unchanged.

## Read the submitted turn

```sh
opencove agent prompt --node node-123 --text-file ./prompt.txt
opencove agent delivery delivery-123 --wait --timeout 2m
opencove agent wait --node node-123 --turn turn-123 --timeout 2m
opencove agent read --node node-123 --turn turn-123
opencove agent read --node node-123 --turn turn-123 -o json
```

Replace `delivery-123` and `turn-123` with prompt's returned IDs; confirm delivery before waiting. Exact waiting survives a newer
turn starting. Matching waiting now stops with exit 10; use `--through-waiting` to
continue waiting when a target reports waiting. See [wait recovery](../agent/WAIT.md). It returns `{nodeId, sessionId, turnId, outcome, endedAt?, state}` and exits 0
for every ended outcome; inspect `outcome`. Use one node, without `--until` or `--any`.
Unknown/evicted turns or restart without retained evidence exit 1; inspect `agent get`
and its `lastEndedTurn`. Timeout exits 124 with `lastKnown` on stderr. Older Workers
without `lastEndedTurn` still work via events/history (history requires interact scope). Reading defaults to message text
only, even when piped. JSON includes `source: 'hook' | 'transcript'` and `truncated`;
hook results include `outcome`, which can be failed/aborted/unknown.
`--turn` uses hook history only. `agent.final_message_unavailable` preserves its
`details.reason`: `turn_not_ended`, `turn_not_found` (including eviction),
`provider_sent_no_message`, or `no_ended_turn`. Prompt-ID selection keeps the last 8 ended turns per incarnation in memory.
Exact turn-ID selection retains up to 60 local turns for 30 days in the private
archive (global caps: 20,000 records / 128 MiB); inspect persisted and memoryOnlyReason.
Restart or replacement clears incarnation memory, not archived exact turns. Remote exact waits use mirrored
snapshots/events only. Older remote turns require the Worker that runs them;
`details.reason: remote_history_unavailable` identifies that limit, not eviction. Correlated local
Claude and Codex lifecycle hooks provide exact-turn content. Codex retains the first matching Stop reply that ends the local turn; later continuation cannot replace it. Never resend just because reading fails.

Without `--turn`, read tries the latest hook end first and uses transcript fallback
only for `no_ended_turn` or `provider_sent_no_message`; it never searches older
hook messages. Present empty hook content is successful. A truncated hook message
prints one stderr notice pointing to `session final --session <sessionId>` for the
provider transcript or `agent read --node <selector> --screen` to inspect the screen.
The retained prefix remains the result; those paths may not contain the rest.

Exact-read errors include a plain message and a concrete recovery hint while keeping
`code` and `details.reason` unchanged. Known `nodeId`, `sessionId` and `turnId` are
included in details. `turn_not_ended` suggests waiting for that exact turn;
`turn_not_found` means it is not in retained history (eviction, a different session,
or restart without archived evidence) and suggests `agent get`. Provider prompt-ID
selection has an eight-ended-turn window; exact local turn IDs use archive retention. Message-free, absent
ended-history, and remote-history errors point to `--screen` or `session final`;
inspect older remote turns on the Worker that runs the agent. Waiting follows the
node's current session and ignores displaced-session state.

## Steering an existing turn

`agent prompt` defaults to steering an authoritative working Claude Code or Codex
agent; the message belongs to the current OpenCove turn. Use `--if-busy refuse` for
busy refusal. The CLI checks `system.operation.describe` first; an older Worker
without `whenBusy` receives no new fields, and busy refusal stays visible. No retry
is made after an error. Waiting/dialogs and unknown/degraded states refuse.

The CLI prints its generated deliveryId before sending; retain it even if the
response is lost. Codex steering returns `dispatched`, exit 0, while awaiting
consumption. Check `opencove agent delivery <id> --wait --timeout 2m` before treating
it as submitted. Confirmation is in order only while no other PTY input intervenes;
other input makes it ambiguous, and interruption/end can leave it unknown.
Claude same-ID receipts confirm submission independently of run-state acceptance.
textComparison never decides submission. When `textComparison` is `different`, the submitted
text differs from what you sent; an existing draft may have been included. Do not resend; inspect the screen.

The orchestration loop is prompt → delivery status → `wait --turn` = **the containing
turn ended** (check outcome) → `read --turn` (Claude and Codex lifecycle replies are correlated). Turn end does not prove a steer was handled. `agent delivery`
exits 0 for submitted, 1 for not_sent/ambiguous/unknown/unavailable or an unconfirmed
snapshot, 124 for a wait timeout. Self-wait returns immediately so consumption can
proceed. Unresolved records are pinned; capacity refuses before bytes. A closed evidenceWindow is not a result. Worker restart/expiry makes lookup unavailable, never
proof of not_sent. A pasted draft may remain after not_sent (no CR).
Late qualifying hooks can upgrade retained uncertainty within the existing 60 s
trust window. Claude transcript-based reconciliation is out of scope, a known
limit. Never resend; check delivery status or the screen.

Use `agent prompt --expect-turn <turnId>` when a correction must steer that exact
active turn: idle or a changed turn refuses before paste, and the condition is
rechecked before Enter. Without this option, an ended turn may become a new turn.
The CLI negotiates `expectTurnId` separately; a Worker without the guard refuses
this option without writing. `--if-busy refuse` still refuses working agents.
`evidenceWindow: open | closed` describes collecting delivery evidence, not the
agent's work; a closed window does not mean that the containing turn finished.
A completed turn means the agent stopped, not that your request was fulfilled —
check the reply covers what you asked before marking work done.
Scripts should read replies with `-o json`.

## Coordinator waiting strategy

Claude Code coordinators can run `opencove agent wait --node <selector> --turn <id> --timeout 10m`
with Bash `run_in_background: true`, keep working and resume on completion. The notification
can mean success, timeout or error; always check exit code and outcome. Codex coordinators
wait in the foreground with a CLI timeout below their tool timeout, repeating the same
turn wait after exit 124. Never resend the prompt. See `opencove skill coordinate`.

## Prompt command reference

Prompting works only for agent windows OpenCove launched from tasks, the agent launcher, or node create agent. Agents typed into terminal shells (including shim/launcher invocations) are unsupported for both Claude Code and Codex. Option-like model/session values have no verified lifecycle coverage.

Supported providers: local Claude Code with installed lifecycle hooks (Stop or StopFailure); local Codex with trusted lifecycle hooks for this invocation (Stop). Both require the default executable path (no override in Settings → agent executable), authoritative hook state and bracketed paste. Custom executable paths refuse with executable_override_unverified; remove the override and launch a new agent window. Codex notify-only, daemon reuse, file-only telemetry and Windows are unsupported.

Idle agents need a hook-observed completed turn. Working agents receive steering in the current OpenCove turn by default; --if-busy refuse preserves busy refusal. Use --expect-turn <turnId> to require steering into that exact active turn: idle or a changed turn refuses before paste, and the same condition is rechecked before Enter. A Worker without expectTurnId support refuses this option without input. Waiting, unknown or degraded agents refuse. The CLI negotiates whenBusy through system.operation.describe before sending; older Workers retain busy refusal. Use exactly one text source; --text-file - reads stdin. Text must be valid Unicode, nonblank and at most 32 KiB in UTF-8 before newline normalization; trailing newlines are removed.

This attempts to paste into the current editor; any existing draft may be submitted with it. Run "opencove agent read --node <selector> --screen" to check for drafts and dialogs first: unseen dialogs, including one-time settings notices, may consume the input.

Success (submission_observed) means the provider reported a qualifying submission after this Enter. Codex steering returns dispatched (exit 0) until consumption is confirmed; check opencove agent delivery <deliveryId> --wait. The CLI generates and prints the deliveryId before sending so a lost response remains queryable. It does not prove the model read exactly this text, and the turn may still be running: wait for it with "opencove agent wait --node <selector> --turn <turnId>". Confirm delivery with agent delivery <deliveryId> --wait, save the returned turnId, check its outcome, then read the correlated reply with "opencove agent read --node <selector> --turn <turnId>". The exact checks and their trust limits are in docs/agent/PROMPT_DELIVERY.md.

textComparison is matched, different, or unavailable. claude-code-v1 compares equality modulo newline representation and trailing ASCII whitespace (space, tab, LF), verified for Claude Code 2.1.319; leading and interior whitespace remain significant. Codex comparison is unavailable until a profile is verified. Optional promptId is diagnostic. When textComparison is different, the submitted text differs from what you sent; an existing draft may have been included. Do not resend; inspect the screen. Different still exits 0: stop automatic orchestration, inspect with opencove agent read --node <id> --screen, and never resend or press Enter again because of the comparison.

The loop is prompt → delivery status → wait --turn (the containing turn ended; check outcome) → read --turn (Claude and Codex lifecycle replies are correlated). This command never retries automatically. After an interrupted or uncertain delivery, inspect the terminal with "opencove agent read --node <selector> --screen" and read the conversation. Do not resend a prompt that may already have been submitted.

Exit codes: 0 submission observed or Codex steer dispatched; 1 refused or delivery unconfirmed; 2 invalid input; 4 authentication or grant-policy refusal; 124 overall deadline; 130 interrupted. A timeout or interruption does not prove that nothing was sent.

## Wait command reference

Waits without sending any input. A state that already holds counts immediately. idle requires no active turn and never accepts an unknown or degraded state. After "agent prompt", save turnId and use --turn <turnId> to wait for that exact turn, even if a newer turn has started.

--turn requires one node and conflicts with --until, multiple --node options and --any. It includes Claude queued provider continuations. Matching waiting now stops with exit 10 by default; --through-waiting continues when waiting is reported, without suppressing exit 11 for an unfulfilled exited target. Returns {nodeId, sessionId, turnId, outcome, endedAt?, state, persisted, memoryOnlyReason?}; every ended outcome exits 0, including failed, aborted and unknown. Read outcome before claiming success. Exact archived local ends survive Worker restarts and can be read without a live agent. Unknown/evicted turns exit 1; archive_unavailable is distinct. Inspect persisted before relying on restart durability.

Local exact history retains at most 60 turns per node for 30 days, with global caps of 20,000 records and 128 MiB. For remote agents, --turn uses mirrored snapshots/events; older turns can only be checked on the Worker that runs them. Missing remote history reports details.reason: remote_history_unavailable, not eviction.

State waits follow the current session; exact archived turn waits return the original session independently. Exact-turn errors keep their code and details.reason, include known nodeId/sessionId/turnId, and suggest concrete agent get, --screen or session final commands.

--until turn-end waits for a turn to finish after this command starts; use it only when you start waiting while the turn is still running. A finished turn is not necessarily a successful one: check turnOutcome (or endedTurnOutcome for turn-end).

With several --node options, --all (default) remembers each fulfilled node/session binding; session changes or unbinding reset progress. State turn-end results include completion with its own sessionId/turnId/outcome; --any stops on the first success OR waiting/exited observation of an unfulfilled target. Waiting observed: the agent may need the user — inspect before acting. Success wins over attention; 11 wins over 10. Ask the user to resolve it in OpenCove (Desktop or this Worker's Web UI), inspect agent read --screen with the same connection options and matching session/turn IDs, then repeat the wait. Event waits cannot resume an already observed completion: prefer --turn. The result lists the latest state of every selected agent. Budgets below 250ms are rejected with usage exit 2 before connecting. On timeout (default 20s) it exits 124, prints the last known states on stderr and nothing on stdout; Ctrl-C exits 130. The agents keep running either way.

## Read command reference

Reads agent.finalMessage first: the latest observed ended turn, or exactly --turn <turnId> from agent prompt. --turn never uses prefixes, another turn or a transcript fallback. --last makes the latest-turn default explicit and can accompany --turn.

Only an unqualified hook read reporting no_ended_turn or provider_sent_no_message falls back to session.finalMessage, including restored conversations. Other errors are preserved. Hook content, including empty or whitespace-only messages, wins. Exact-turn errors use agent.final_message_unavailable with details.reason: turn_not_ended (still active), turn_not_found (unknown/evicted), no_ended_turn, provider_sent_no_message, archive_unavailable, or remote_history_unavailable. CLI errors retain code/reason and include known nodeId/sessionId/turnId plus concrete recovery commands: wait for a running turn, inspect agent get for missing history, or inspect --screen/session final for unavailable content.

Plain message text goes to stdout even when piped. -o json or --fields returns structured data: hook results have nodeId, sessionId, turnId, optional promptId, outcome, persisted, optional memoryOnlyReason, message, truncated and source: hook; transcript results have sessionId, provider, startedAt, cwd, resumeSessionId, message, truncated: false and source: transcript. A cut hook message prints one stderr notice with transcript/screen recovery commands; it never automatically replaces the retained prefix.

Claude messages queued mid-turn continue the same OpenCove turn, including provider follow-ups. Exact reads return its final reply after all continuations. An unknown continuation outcome marks the last provider reply with messageKind: intermediate and prints a notice. After wait --until idle, read returns only the latest ended turn reply.

After agent prompt, retain its turnId, run "opencove agent wait --node <selector> --turn <turnId>", then "opencove agent read --node <selector> --turn <turnId>". Exact --turn reads survive Worker restarts for archived local turns. The private archive stores final replies up to 64 KiB, outcome and IDs: at most 60 turns per node, 30 days, 20,000 global records and 128 MiB of message text. JSON reports persisted and a memoryOnlyReason when false. Deleting the node removes OpenCove history, not provider transcripts or existing backups. Unqualified reads remain current-incarnation reads. Remote wait --turn uses mirrored snapshots/events; older remote turns can only be checked on the Worker that runs them (remote_history_unavailable). Hook replies require matching local Claude session/prompt IDs or Codex lifecycle session/turn IDs; Codex keeps the first matching Stop reply that ends the local turn.

Use --screen before prompting to inspect drafts and dialogs. It resolves the current session, replays its presentation snapshot at its columns/rows, preserving cursor-created spaces, overwrites and wide CJK/emoji cells. It selects the normal or alternate buffer, ignores styling/mode sequences, trims row-end spaces and trailing blank rows, then returns the last --lines rendered rows (default: 40). -o json returns {nodeId, sessionId, lines: [...]}. Screen-mode projectable fields are nodeId, sessionId, lines; the field list below applies to final-message mode. --lines requires --screen; --screen conflicts with --last and --turn. This is a read only snapshot, not permission to answer another agent's dialog.

If transcript fallback has no readable message, session.transcript_not_ready exits 1. A working agent may need to reach idle first; an idle agent may have transcript saving disabled. Inspect --screen and check provider settings; waiting cannot create a transcript. Reading never sends input.

## Turn correlation identifiers

JSON `agent read --turn` and exact `agent wait --turn` expose `deliveryIds` and
`promptIds`, with no submitted text, digests, tokens or hook payloads. Existing
promptId remains the final provider prompt ID. promptIds lists unique retained
provider prompt IDs in encounter order, including the final ID; Claude steering
and queued follow-ups can span several IDs inside one OpenCove turn.

Delivery IDs come from the existing volatile delivery ledger, joined by exact
sessionId and turnId. They include all retained attempts assigned to that turn,
including uncertain/refused attempts: **membership is not proof of receipt or
consumption**. Check each `agent delivery <id>` and verify the reply. Message-free
ended turns expose the same metadata to wait; read still reports its existing
provider_sent_no_message error. Waiting never returns message content.

These are retained identifiers, not a complete durable audit log. Delivery records
expire after 30 minutes when resolved and have existing per-session/global capacity
limits; restart clears them. Live turn history keeps up to 64 previous prompt IDs
plus the final ID; archived records currently retain only the final promptId.
Thus older/restarted turns may report empty deliveryIds and only the final
promptIds entry. Older Workers or mirrored remote end evidence may omit these
fields entirely. Missing identifiers never justify resending a prompt.
