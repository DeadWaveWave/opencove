# CLI Agent Prompt

```text
按 docs/cli/AGENT_PLAYBOOK.md 验证 CLI：
1. 使用任务指定的独立 profile；未指定时使用工作树 .codex-out/tmp/cli-profile。
2. 先运行 worker status、ping、project list、space list，检查真实状态和目标 ID。
3. 只在明确授权时启动 Worker 或外部 agent provider。
4. 用本次创建的临时节点做 create/update/get/delete；记录 ID，结束时清理。
5. 成功 stdout 直接解析为 value JSON；失败检查非零 exit code 和 stderr.error。
6. 使用 --help 查询选项；长文本用 --text-file、--content-file、--prompt-file 或 --params-file，- 表示 stdin。
7. 远端显式使用 --endpoint/--token；不要推断或修改未知 profile。
8. focus.delivered 为 false 不算业务失败。PTY stdout 是原始终端流，Ctrl-C detach 返回 130。
9. 汇报实际命令、结果、NOT RUN 和进程/节点清理状态，不把未运行测试写成通过。
```

## Send to a running agent

```sh
opencove agent prompt --node node-123 --text 'Review the changes'
opencove agent prompt --node node-123 --text-file ./prompt.txt --timeout 20s
cat prompt.txt | opencove agent prompt --node node-123 --text-file -
```

Exactly one text source is required. `--timeout` accepts milliseconds or durations (`15s`,
`15000ms`, `1m`); default 15s, maximum 60s. HTTP timeout includes a five-second response margin.
The target must be an agent window OpenCove launched: local Claude Code or Codex
with lifecycle hooks for this invocation,
after a hook-observed settled turn (Claude Stop/StopFailure; Codex Stop). Codex notify-only,
daemon reuse, file-only telemetry and Windows are unsupported. `@self` resolves through the
calling session grant; prompting an observed agent inside a canvas terminal is refused by the server.

Success is JSON with `deliveryId`, `nodeId`, `sessionId`, `phase: submission_observed`, `turnId`.
It also returns `textComparison` (`matched`, `different`, `unavailable`), Claude's
`comparisonProfile: claude-code-v1` and optional diagnostic `promptId`.
`--fields` accepts all these declared fields. The Claude profile, verified for
2.1.319, compares equality modulo newline representation and trailing ASCII space,
tab and LF; leading/interior whitespace remain significant. Codex comparison is
`unavailable` until a profile is verified. Equality proves neither causation nor
model processing. `different` still exits 0, with a notice on stderr: stop automatic
orchestration, retain identifiers, inspect with `opencove agent read --node <id> --screen`,
and never resend or press Enter again because of the comparison. Refusals exit 1 with the AppError code and typed
`error.details` dispatch-attempt flags; a server deadline exits 124 and preserves those flags.
Usage errors exit 2. Local HTTP timeout exits 124; transport loss is outcome unknown.

Inspect drafts and dialogs with `opencove agent read --node <selector> --screen`
before sending. After success, save `turnId` and use `opencove agent wait --node <selector> --turn <turnId>`,
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
opencove agent wait --node node-123 --turn turn-123 --timeout 2m
opencove agent read --node node-123 --turn turn-123
opencove agent read --node node-123 --turn turn-123 -o json
```

Replace `turn-123` with prompt's returned `turnId`. Exact waiting survives a newer
turn starting and keeps waiting through permission/question pauses in the selected
turn. It returns `{nodeId, sessionId, turnId, outcome, endedAt?, state}` and exits 0
for every ended outcome; inspect `outcome`. Use one node, without `--until` or `--any`.
Unknown/evicted turns or restart without retained evidence exit 1; inspect `agent get`
and its `lastEndedTurn`. Timeout exits 124 with `lastKnown` on stderr. Older Workers
without `lastEndedTurn` still work via events/history (history requires interact scope). Reading defaults to message text
only, even when piped. JSON includes `source: 'hook' | 'transcript'` and `truncated`;
hook results include `outcome`, which can be failed/aborted/unknown.
`--turn` uses hook history only. `agent.final_message_unavailable` preserves its
`details.reason`: `turn_not_ended`, `turn_not_found` (including eviction),
`provider_sent_no_message`, or `no_ended_turn`. History keeps the last 8 ended turns
per incarnation in memory; restart or replacement clears it. Remote exact waits use mirrored
snapshots/events only. Older remote turns require the Worker that runs them;
`details.reason: remote_history_unavailable` identifies that limit, not eviction. Correlated local
Claude hooks currently provide content. Never resend just because reading fails.

Without `--turn`, read tries the latest hook end first and uses transcript fallback
only for `no_ended_turn` or `provider_sent_no_message`; it never searches older
hook messages. Present empty hook content is successful. A truncated hook message
prints one stderr notice pointing to `session final --session <sessionId>` for the
provider transcript or `agent read --node <selector> --screen` to inspect the screen.
The retained prefix remains the result; those paths may not contain the rest.

Exact-read errors include a plain message and a concrete recovery hint while keeping
`code` and `details.reason` unchanged. Known `nodeId`, `sessionId` and `turnId` are
included in details. `turn_not_ended` suggests waiting for that exact turn;
`turn_not_found` means it is not in the session's last eight ended turns (eviction,
a different session, or restart) and suggests `agent get`. Message-free, absent
ended-history, and remote-history errors point to `--screen` or `session final`;
inspect older remote turns on the Worker that runs the agent. Waiting follows the
node's current session and ignores displaced-session state.
