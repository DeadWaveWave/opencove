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
The target must be local Claude Code after an observed settled turn. `@self` resolves through the
calling session grant; a canvas terminal is not an agent and is refused by the server.

Success is JSON with `deliveryId`, `nodeId`, `sessionId`, `phase: submission_observed`, `turnId`.
`--fields` accepts those declared fields. Refusals exit 1 with the AppError code and typed
`error.details` dispatch-attempt flags; a server deadline exits 124 and preserves those flags.
Usage errors exit 2. Local HTTP timeout exits 124; transport loss is outcome unknown.

Inspect drafts and dialogs with `opencove agent read --node <selector> --screen`
before sending. After success, use `opencove agent wait --node <selector> --until idle`,
then `agent read`. A human editor draft is submitted with the text; unobserved dialogs cannot be excluded.
Submission observation means a token-authenticated UserPromptSubmit passed matching checks
with a range-checked, caller-supplied relay timestamp at or after the pre-Enter boundary. It assumes
the same wall clock without adjustments; any holder of the session's hook token can claim a
submission. It does not prove causation, exact text processing or turn completion. Never resend automatically after interruption, stalled receipt, or transport loss.
See [Prompt delivery](../agent/PROMPT_DELIVERY.md) for admission, errors and recovery.
