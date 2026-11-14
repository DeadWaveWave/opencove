# Claude lifecycle compatibility verification

Run seeded differential verification whenever changing Claude lifecycle, readiness,
transcript reconciliation, or watcher provenance. It compares each observation with a
reviewed Git baseline and prints a minimized reproducer for any difference.

```sh
OPENCOVE_DIFFERENTIAL_BASELINE=<available-ref> node scripts/verify-claude-differential.mjs
```

Choose a baseline appropriate to the change under review. The ref must exist locally;
fetch it explicitly if necessary. The tool never fetches history. Without the variable,
or when the requested ref is unavailable, the script and differential test skip with a
reason. Ordinary CI does not require historical commits and does not run this fuzz suite.

The fixed corpus runs in ordinary CI from committed JSON traces:

```sh
pnpm test -- --run tests/unit/app/claudeNonClearCompatibility.spec.ts --maxWorkers=1
```

To deliberately update the reviewed expectations, generate them from the chosen main
revision, inspect the trace changes, and include the generated JSON and manifest in review:

```sh
node scripts/generate-claude-non-clear-baseline.mjs <reviewed-main-ref>
```

Do not hand-edit the golden traces. They use one checkpoint per line to keep generated
files bounded. Changing an expected behavior requires review; an old baseline is a
verification input, not a permanent ban on future state-machine changes.

The in-memory harness exercises authenticated hook ingress, the actual publisher,
and each version's parser and EOF checkpoint. Transcript cases provide an available
IO port instead of synthetic missing-file results, replay fixture-shaped metadata,
user, assistant and queue records, and advance fake reconciliation timers. It does
not launch Claude, access user configuration, or replace Electron and filesystem E2E.

修改 Claude lifecycle、readiness、transcript 对账或 watcher 来源时，应显式运行差分验证，
并选择本次评审认可、且本地可用的 Git ref。工具不会自动获取历史；未设置
`OPENCOVE_DIFFERENTIAL_BASELINE` 或 ref 不存在时，会说明原因并跳过。
普通 CI 运行已提交的 JSON corpus 和下面的 clear safety property suite，不依赖历史 commit。

需要调整预期行为时，用生成命令从评审认可的 main 版本生成 golden，检查差异后一起评审，
不要手改生成文件。差分 fuzz 是可选择基线的验证工具，不把未来合法改动锁定在旧 main 上。
内存 transcript IO 使用实际 parser / checkpoint 与 fake timers；真实 Electron 和文件系统路径仍需独立验证。

The clear-safety property suite runs in ordinary CI and needs no baseline ref. Run it
whenever changing clear transitions, readiness receipts, or conversation fencing:

```sh
pnpm test -- --run tests/unit/contexts/claudeClearProperty.spec.ts tests/unit/contexts/claudeClearFirstOrdering.spec.ts tests/unit/app/claudeClearFirstIngress.spec.ts tests/unit/contexts/claudeConversationPending.spec.ts tests/unit/app/claudeClearSuccessor.spec.ts tests/unit/app/claudeClearInputEvidence.spec.ts --maxWorkers=1
```

It uses five fixed seeds and 5,000 sequences, including reused IDs, early successor
activity, delayed predecessor hooks, duplicates, watcher captures and fixture-shaped
transcripts. It checks each publication and input attempt, advances expiry timers, and
prints a deletion-minimized reproducer on failure. It compares complete final records
with relay-order runs when delivery stays inside the reconciliation window and preserves
the causal boundary for a reused wire ID. Unrestricted and expired sequences retain all
safety checks; lost or ambiguous history is not treated as an equivalent replay.

clear safety property suite 在普通 CI 中运行；修改 clear 迁移、许可回执或会话围栏时，
应执行上面的定向命令。固定 seeds 保证可重放，失败会输出最小反例。窗口内且满足
会话因果边界的重排还比较完整终态；任意乱序和超时场景始终检查输入安全。

The first clear has the same unrestricted delivery order as subsequent clears. Only
invocation attachment precedes the generated stream. Equality cases keep A's completed
ordinary history and the Start boundary for reused IDs; they still shuffle the first
clear's End/Start with successor activity. Unrestricted cases impose neither boundary.
Before any clear, annotations retain bounded evidence without changing ordinary state,
watcher capture, admission, or scheduling. The existing zero-delay tests remain required.

首次 clear 与后续 clear 使用相同的任意到达顺序；runtime 只预先建立 invocation。
终态比较组保留 A 已完成的普通历史和复用 ID 的 Start 边界，但首次 clear 的 End/Start
仍与 successor 活动一起打乱；任意顺序的安全组没有这些限制。首次 clear 前只记录有界证据，
不改变普通状态、watcher capture、输入许可或调度；零延迟回归必须保持通过。

The clear oracle is a separate, input-only reference model. It receives every hook,
watcher sample (including idle), capture token, transcript record and clock advance in
delivery order. Its namespace, retired identities, unresolved activity and receipts come
from that stream. It never asks the production owner whether reconciliation is active,
whether a callback was accepted, or whether input is quarantined. Generation tokens are
opaque capture values; the model checks their provenance rather than borrowing a live fence.
Before the first clear, the existing ordinary Stop receipt contract remains in force.

Watcher commands use the actual capture/publisher. Source timestamps and ordinals are
frozen before registry delivery so reordering does not create different evidence. Transcript
positions identify records, not times. Auxiliary metadata cannot establish activity or a
receipt. A user record needs matching current input evidence or a known retired prompt;
a late stale Submit cannot confirm current input after the quiet window has committed.

The suite reports unsafe admissions/writes and quiet-window lockouts separately. Interim
refusals when the model allows input are counted and permitted; a valid receipt must be
usable after the bounded quiet window. In addition to 5,000 generated sequences, 500
fresh-namespace probes check recovery after their randomized prefixes, including an old
unknown watcher callback delivered after the new namespace settles. Failures include
fixed seeds and deletion-minimized input tapes. Run the fixed pending-watcher regressions
alongside the property suite when changing this boundary:

```sh
pnpm test -- --run tests/unit/app/claudeClearPendingWatcher.spec.ts tests/unit/contexts/claudeClearReference.spec.ts tests/unit/contexts/claudeConversationEvidence.spec.ts tests/unit/contexts/claudeClearProperty.spec.ts --maxWorkers=1
```

clear reference 只从输入流维护认证 namespace、retired identity、未决活动和 receipt，
不读取生产 owner、reconciliation、acceptance 或 quarantine 状态。实际 publisher 处理
capture；generation 是不透明来源 token，文件样本保留原始时间与序号，transcript position
仅用于定位记录。metadata / idle 不能凭空建立活动或许可；旧 Submit 不能在 quiet 提交后
替当前输入作确认。首条 clear 前保留普通 Stop receipt 语义，由 non-clear golden 与差分
fuzz 验证完整兼容性。

每步比较 admission 与实际 delivery writes，分别报告不安全放行和 quiet 后锁死。
中途额外拒绝会计数但不算失败；quiet 后合法 receipt 必须可用。除 5,000 条序列外，
另有 500 条 fresh namespace 恢复探针，包含新会话稳定后到达的旧未知 watcher 回调，
防止用永久拒绝掩盖安全问题。失败输出固定 seed
和经删除缩减的输入流；修改 watcher 边界时一并运行上面的真实认证回归。
