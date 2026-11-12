# First prompt after Claude Code `/clear`

An authenticated, relay-ordered new-ID `SessionStart(clear)` can authorize an attempted
first prompt without a completed successor turn. Hook coverage, managed launch provenance
and bracketed paste remain required. This private, volatile receipt is lost on activity,
waiting, exit, coverage loss or conversation replacement; restart does not restore it.
It proves neither an empty editor nor absence of dialogs. Missing or metadata-only
transcripts neither grant readiness nor revoke it; actual queue/user activity vetoes it.

A clear without an orderable relay timestamp immediately quarantines input, including
same-ID clears; only identifiable duplicate receipts remain idempotent. Buffered successor
activity is folded in strict relay order; missing or tied timestamps stay quarantined.
Unversioned transcript compatibility ends at the first conversation transition. Metadata,
redacted records without input evidence and local `/clear` echoes do not veto readiness;
identified prompts and actual unidentified user content still do.

Successor activity received before Start immediately quarantines input. Buffer expiry or
overflow stays uncertain. Generations follow accepted relay order, not guaranteed provider
causal order when relay startup is delayed. Same-ID clear and reused IDs grant no new receipt.
A transition cancels pre-Enter delivery; after Enter it retains unknown and closes reconciliation.
Retired, permanently closed unknown records may be evicted under the existing 32/1024 bounds;
lookup then returns unavailable. Current unresolved attempts remain pinned and blocking.
B4b remains the independent restart authority: empty B can be promptable while A is saved.
Valid managed launches without B4b ownership can prompt but are not promised a saved B.
Legacy Workers retain their existing result; clients never infer readiness or resend.
Web clients consume the executing Worker's projection; mounted remote PTYs remain unsupported.

Claude Code `/clear` 后可在观察到新会话时尝试首条提示，无须手动先完成一轮；
无法排序的 clear 会立即暂停输入；元数据与本地 `/clear` 回显不会撤销已确认的就绪状态。
这不保证编辑器为空或没有对话框。状态不明时检查屏幕，切勿自动重发。
