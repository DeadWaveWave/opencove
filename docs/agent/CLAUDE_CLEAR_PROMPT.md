# First prompt after Claude Code `/clear`

An authenticated, relay-ordered new-ID `SessionStart(clear)` can authorize an attempted
first prompt without a completed successor turn. Hook coverage, managed launch provenance
and bracketed paste remain required. This private, volatile receipt is lost on activity,
waiting, exit, coverage loss or conversation replacement; restart does not restore it.
It proves neither an empty editor nor absence of dialogs. Missing or metadata-only
transcripts neither grant readiness nor revoke it; actual queue/user activity vetoes it.
Accepted working or waiting file observations also revoke the receipt; later transcript
callbacks cannot restore it. Auxiliary transcript filtering applies during the clear window
or while its first-prompt receipt remains valid;
ordinary conversations retain their existing parser and continuation behavior.

A clear without an orderable relay timestamp immediately revokes input readiness, including
same-ID clears; identifiable duplicate receipts remain idempotent. Buffered successor
activity is folded in strict relay order; missing or tied timestamps grant no clear receipt.
Before the first authenticated clear in an invocation, startup, resume, compact, hooks and
file observations follow the existing behavior, without a clear buffer or generation requirements.
Ordinary completion, waiting notifications and submission receipts have no reconciliation delay.
Only an authenticated clear Start or
End opens a transition window. Input is revoked immediately. The window closes when
the successor's first turn commits, or after 200 ms without transition activity, with a
four-second overall limit. Passive notifications and duplicate receipts do not extend it.
Reordered transition evidence is reconciled within that window; late evidence cannot
rewrite an ended turn. Ordinary single-conversation reordering after the window closes
keeps the existing behavior and is outside this clear-readiness policy.
During the transition and while its empty-conversation receipt remains valid, predecessor
callbacks cannot authorize or revoke successor readiness. Outside that scope, file observations
follow the existing behavior. Metadata,
redacted records without input evidence and local `/clear` echoes do not veto readiness;
identified prompts and actual unidentified user content still do.

During an authenticated clear transition, successor activity received before Start immediately
quarantines input. Expiry, ambiguity or capacity exhaustion withdraws clear readiness; subsequent
ordinary lifecycle hooks continue to work. Generations follow accepted relay order, not guaranteed provider
causal order when relay startup is delayed. Same-ID clear and reused IDs grant no new receipt.
A transition cancels pre-Enter delivery; after Enter it retains unknown and closes reconciliation.
Retired, permanently closed unknown records may be evicted under the existing 32/1024 bounds;
lookup then returns unavailable. Current unresolved attempts remain pinned and blocking.
B4b remains the independent restart authority: empty B can be promptable while A is saved.
Valid managed launches without B4b ownership can prompt but are not promised a saved B.
Legacy Workers retain their existing result; clients never infer readiness or resend.
Web clients consume the executing Worker's projection; mounted remote PTYs remain unsupported.

Claude Code `/clear` 后可在观察到新会话时尝试首条提示，无须手动先完成一轮；
普通会话的完成、等待通知与提交回执即时处理，不增加等待。
在本次 Claude 运行收到经认证的 clear 事件前，启动、恢复、压缩及文件观察保持原有行为，
不启用 clear 缓冲或额外的 generation 限制。终端启动的 Claude 使用实际运行身份，
不能仅凭终端会话 ID 获得 clear 权限。
只有确认 clear 时才打开过渡窗口，并立即暂停输入；新会话首轮提交完成，
或最后一条相关活动后安静 200 毫秒，窗口即结束，整段等待最多四秒。
窗口结束后恢复普通处理；超窗证据不改写已结束轮次，普通会话的乱序处理保持原有行为。
过期、歧义或容量耗尽只撤回 clear 就绪权限，不会阻止后续正常恢复、提交与完成。
被动的空闲与认证通知不影响就绪状态。无法排序的 clear 会立即暂停输入；元数据与本地 `/clear` 回显不会撤销已确认的就绪状态。
这不保证编辑器为空或没有对话框。状态不明时检查屏幕，切勿自动重发。
当前会话的文件观察若确认正在工作或等待，也会撤销 clear 就绪权限；后续 transcript 回调不会恢复权限。
辅助记录仅在 clear 窗口内或首条提示仍获准投递时被过滤；之后恢复普通解析与对账语义。

See [differential verification](CLAUDE_DIFFERENTIAL_VERIFICATION.md) when changing lifecycle or readiness.
