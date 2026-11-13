# 架构 Harness

该 harness 检查源码依赖和 renderer 边界是否偏离 `../../docs/architecture/ARCHITECTURE.md` 中的架构契约。
`rules.json` 是可执行规则与例外的唯一事实来源；文档只描述意图，不重复规则清单。

## 目录结构

- `check.mjs`：所有 `arch:*` 命令的 CLI 入口。
- `rules.json`：层级、alias、allowlist、例外和 severity，手工编辑并经 review。
- `ratchet.json`：ratchet 基线，只由 `pnpm arch:ratchet` 写入。
- `lib/`：分析器与 ratchet 实现。
- `tests/`：harness 专用回归测试。

## 命令

```bash
pnpm arch:audit    # 打印全部发现（error 与 warn），不影响退出码
pnpm arch:check    # 阻塞门禁：verify:quick 与 CI 运行
pnpm arch:ratchet  # 把当前计数写入 ratchet.json（只允许降低）
pnpm arch:test     # harness 自身的测试
```

## Ratchet 语义

ratchet 基线 `ratchet.json` 的形状是 `{ ruleId: { file: count } }`，每个 (规则, 文件) 一个计数，不记录行号。
只有 `severity: "warn"` 的规则进入基线；`severity: "error"` 的规则必须为 0 个发现，且不得出现在基线里。

`pnpm arch:check` 在以下任一情况退出 1：

- 存在任何 error 级发现。
- 任一 (规则, 文件) 的计数与基线不同：上升是新增违规；下降时提示运行 `pnpm arch:ratchet` 并提交 `ratchet.json`，让每次改进都被同一个改动锁定。
- 基线引用了未知规则或 error 级规则。

`pnpm arch:ratchet` 写入当前计数，但只要基线中已有规则的**总数**会上升就拒绝（退出 1，不写任何内容）。
单个文件的计数可以变化，所以移动或拆分带有既有违规的文件不需要例外。基线里没有的规则会记录首次计数，这是新增 warn 规则的路径；
没有基线文件时命令会创建一个，仅用于初始化。

## 添加有理由的例外

新增违规的唯一途径是在 `rules.json` 中显式声明例外：

- `checks.layerDependencies.allowedEdges`：给指定的组合文件开放额外 inward edge。每一项都必须有非空的 `reason`，否则 `rules.json` 加载失败。
- `forbiddenText[].allowedPatterns`：例如 `window.opencoveApi` 只能经由匹配 `*Api.ts` 的边界 adapter 访问。

## 规则语义

`layerDependencies.ignoreTypeOnly` 只影响层级依赖检查。`forbiddenImportSpecifiers` 默认仍检查 type-only import，
只有规则显式设置 `ignoreTypeOnly: true` 才跳过。`architecture.sharedNoContextDependency` 禁止 `shared` 通过 runtime 或
type-only import 反向依赖任何 context。规则可用 `fromPatterns` / `allowedPatterns` 把禁用边收敛到具体组合 seam。
`allowedEdges` 只给列出的文件开放额外 edge，`app/worker` 与 `app/renderer` 的其余文件仍走默认窄依赖。

## 架构契约变更清单

修改 `ARCHITECTURE.md`、`CONTROL_SURFACE.md` 或 `RECOVERY_MODEL.md` 时：

1. 判断 diff 是否改变了可执行规则；只是措辞变更时，在 review 中写明 `no executable-rule impact`。
2. 如果改变规则，更新 `rules.json`、`lib/` 和 `tests/`。
3. 运行 `pnpm arch:check` 和 `pnpm arch:test`；如果计数下降，再运行 `pnpm arch:ratchet` 并提交 `ratchet.json`。

## 无法表达为规则的契约

- **Control Surface operation id 边界**：在既有 transport、进程边界和依赖方向内新增 command/query/event id，不改变 dependency、
  进程边界或 renderer API allowlist，所以没有对应的 architecture finding；这类变化由 handler runtime validation 与 contract test 约束。
  若新 operation 同时改变上述任一可执行规则，仍必须更新 `rules.json` 与 `tests/`。
- **Listener 生命周期**：Control Surface runtime 与可替换 HTTP listener 的 disposal/排空顺序是运行时行为契约，静态 import/global
  分析器无法判定。它由 `controlSurfaceHttpRuntime.listenerLifecycle` 和 `controlSurfaceHttpListener` 的 contract/unit tests 执行；
  仅修改这类生命周期规则时记录 `no executable-rule impact`，不要添加无法表达该不变量的空规则。
