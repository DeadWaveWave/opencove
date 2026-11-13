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
普通 CI 只读取已提交的 JSON corpus，不依赖历史 commit。

需要调整预期行为时，用生成命令从评审认可的 main 版本生成 golden，检查差异后一起评审，
不要手改生成文件。差分 fuzz 是可选择基线的验证工具，不把未来合法改动锁定在旧 main 上。
内存 transcript IO 使用实际 parser / checkpoint 与 fake timers；真实 Electron 和文件系统路径仍需独立验证。
