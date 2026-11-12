## Claude conversations after clearing

For eligible Worker-owned local Claude agent windows, managed recovery is enabled by default.
OpenCove saves a new conversation as the restart target
only after a successful response checkpoint has been confirmed in that conversation's transcript.
Clearing without completing a new response restores the previously saved conversation after restart.
With repeated clears, this means the latest successfully saved conversation.
A later failed response does not undo an earlier successful checkpoint.

Saving the restart target does not grant prompt readiness or finish an active turn.
Graceful exit and resume-current handoff allow up to five seconds for admitted saves to finish.
If that deadline expires, the last confirmed target remains authoritative; OpenCove does not claim
that the new conversation was saved. An uncertain transaction is read back before another save.
A committed target survives renderer disconnection. A Worker crash before commitment can lose
in-memory qualification and restore the previous target; crash recovery for this work is not promised.

符合条件的 Worker 本地 Claude 智能体窗口默认启用 managed recovery。OpenCove 会在新对话的 transcript 中确认一次成功响应，
再将该对话保存为重启后的恢复目标。清空后没有完成新响应时，重启会恢复上次已保存的对话。
连续清空时，以最近成功保存的对话为准；后续响应失败不会撤销此前已确认的恢复目标。
保存恢复目标不代表 Agent 已准备好接收新提示，也不会结束正在进行的任务。
正常退出和恢复当前对话会最多等待五秒；超时后保留最后确认的恢复目标，不会显示新对话已保存。
Renderer 断开不会撤销已提交的保存；Worker 在提交前崩溃时，仍可能恢复之前的对话。

### Qualified Claude clear successors

`ManagedClaudeLaunchOwner.qualification` owns process-local admission, immutable occurrence/target/
prompt tickets, the invocation's highest qualified ordinal, and unresolved rebind responsibility.
`ClaudeClearResumeBinding` selects authenticated clear occurrences and bounded orphan evidence;
`ClaudeResumeTranscriptReader` confirms an exact local transcript with a successful `end_turn`
checkpoint and a user-to-assistant UUID parent chain. The ledger remains the only restart authority.
No new persisted schema, provider-observation write path, or public query authority is introduced.

To pause adoption, managed restarts, and saving new resume targets, restart the actual Worker with
`OPENCOVE_MANAGED_CLAUDE_BINDINGS=0`. Remove the override and restart the Worker to resume updates.
Existing saved targets remain protected; freeze is not a database downgrade procedure.
An enabled retiring Worker may finish previously admitted saves during graceful shutdown.
A frozen replacement admits no new clear qualifications. A same-ID clear resets
occurrence evidence; equality with the durable target alone makes its eventual binding a no-op.
Unqualified newer occurrences do not cancel admitted earlier reads. Qualified higher ordinals win,
including after their commit. Retired-ID reuse and ambiguous provenance cannot mint B4b authority.
Token possession authenticates transport, not provider causality; forgery by a valid token holder is
outside this guarantee. Private capabilities never cross mounted-Worker transport.

Normal credential exit closes admission and permits retained tickets to settle within five seconds.
`resumeCurrent` drains before replacement reservation and durable reread; explicit replacements and
deletion cancel tickets. Shutdown freezes client input, bounds accepted launch settlement and retained
qualification with one five-second deadline, then disposes capability owners before persistence.
A deadline invalidates callbacks, but cannot interrupt a synchronous SQLite call already executing.
Durability after abrupt Worker termination before commitment and durable empty-clear intent remain
out of scope. These additions clarify existing boundaries: no executable-rule impact.

Live prompt readiness after a new-ID Claude `/clear` belongs to the executing Worker's
volatile conversation owner, independently of the saved restart target. Clear creates no
successor turn; the first accepted submission captures its own provider session identity.
Late predecessor hooks and transcript callbacks cannot update the successor generation.
See [prompt delivery](CLAUDE_CLEAR_PROMPT.md) for the
relay-order assumption, quarantine and observed-readiness limits. B4b commitment grants
no readiness and rewrites no turn identity. This adds no public generation field or
persistence schema; startup/resume/compact readiness is unchanged.
