# 架构 Harness

本文档是架构 harness 分类的操作手册。

公开概览和结果解释见 `../../docs/architecture/ARCHITECTURE_HARNESS.md`。未来接入阶段和推广条件见
`../ROADMAP.md`。

该 harness 检查源码依赖和 renderer 边界使用是否偏离 `../../docs/architecture/ARCHITECTURE.md`
中的架构契约。

当前阶段：手动基线阶段。
根命令 `pnpm harness:check` 会把该分类作为手动聚合检查的一部分运行。

## 目录结构

- `check.mjs`：`pnpm arch:audit` 和 `pnpm arch:check` 使用的 CLI 入口。
- `rules.json`：层级、alias、allowlist 和 severity 配置。
- `lib/`：分析器实现。
- `results/`：当前 audit summary，以及按 rule 拆分的 JSONL baseline 输出。
- `tests/`：harness 专用回归测试。

## 结果

使用以下命令重新生成已提交的结果：

```bash
pnpm arch:results
```

该命令会写入 `summary.json`，并按 rule 拆分详细 JSONL：

- `window-opencove-api.jsonl`
- `layer-dependency.jsonl`

每个 JSONL 每行保存一个 finding，让详细 baseline 保持在仓库行数门禁之内，同时保留精确的文件、行号、规则和期望边界证据。

使用以下命令验证已提交结果是否匹配当前分析器输出：

```bash
pnpm arch:results:check
```

该命令不依赖 staged files，适合 clean checkout、CI 候选流程，以及 `pnpm harness:check` 的聚合校验。

## 规则语义

`layerDependencies.ignoreTypeOnly` 只影响层级依赖检查，用于在手动基线阶段降低纯类型跨层边的噪声。`forbiddenImportSpecifiers` 默认仍会检查 type-only import，因为 `electron`、`react`、`node:`、`@app/` 这类规则表达的是禁止外层/runtime/framework 耦合；只有规则显式设置 `ignoreTypeOnly: true` 时才会跳过 type-only 边。`architecture.sharedNoContextDependency` 专门禁止 `shared` 通过 runtime 或 type-only import 反向依赖任何 context。规则可用 `fromPatterns`/`allowedPatterns` 把禁用边收敛到具体组合 seam；当前 terminal calibration 规则会阻止 workspace/settings presentation 重新直连。`layerDependencies.allowedEdges` 只给列出的组合文件开放额外 inward edge；`app/worker` 与 `app/renderer` 的其余文件仍走默认窄依赖，不能借组合根名义承接状态决策。

## 架构契约变更清单

当架构契约文档发生变更时：

1. 判断 diff 是否改变了可执行架构规则。
2. 如果改变规则，更新 `rules.json`、`lib/` 或两者。
3. 为新增或变更的规则行为更新 `tests/`。
4. 运行 `pnpm arch:results` 重新生成 `results/`。
5. 暂存相关的文档、规则、分析器、测试和结果变更。
6. 运行 `pnpm arch:doc-sync`、`pnpm arch:results:check`、`pnpm arch:check` 和 `pnpm arch:test`。
7. 如果 diff 只是措辞变更，在 review 中记录 `no executable-rule impact`。

在既有 Control Surface 边界内新增 operation id（例如新增 command）本身不改变 dependency、
进程边界或 renderer API allowlist，因此没有可生成的 architecture finding；这类契约变更以
handler runtime validation、contract test 与 staged `arch:doc-sync` 作为同步证据。若新 operation
同时改变上述任一可执行规则，仍必须更新 `rules.json` / analyzer / baseline。

`pnpm arch:doc-sync` 是确定性的。它不会尝试理解文档语义，只检查已暂存的架构契约文档变更是否有 harness 同步证据。当已暂存的 audit-relevant 文件或结果文件存在时，它还会验证已提交的 audit 结果是否匹配当前分析器输出。它要求 audit-relevant 文件在比较结果前没有未暂存变更，避免已暂存提交内容因为未暂存的再生成产物而误通过。措辞类本地检查可使用 `OPENCOVE_ARCH_DOC_NO_RULE_IMPACT=1 pnpm arch:doc-sync`。`pnpm arch:results:check` 是不依赖 staged index 的结果基线校验。

Control Surface runtime 与可替换 HTTP listener 的 disposal/排空顺序属于运行时行为契约，当前静态 import/global analyzer 无法判定。该契约由 `controlSurfaceHttpRuntime.listenerLifecycle` 和 `controlSurfaceHttpListener` contract/unit tests 执行；仅修改这类生命周期规则而未改变 dependency、allowlist 或禁止 API 时，应记录 `no executable-rule impact`，而不是添加无法表达该不变量的空规则。

## 规划

未来接入阶段、CI 推广和本地提交门禁条件记录在 `../ROADMAP.md`。
