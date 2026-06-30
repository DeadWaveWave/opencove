# 架构 Harness

本文档是架构 harness 的公开说明，用来解释它为什么存在、检查什么，以及如何解读已提交的检查结果。

操作命令和结果再生成流程见 `harness/architecture/README.md`。未来接入阶段和推广条件见
`harness/ROADMAP.md`。

架构 harness 会把仓库里的架构规则转成可执行检查。

它当前以先审计的方式引入，因为现有代码里存在历史遗留的边界漂移。第一目标是用精确到文件和行号的证据把漂移暴露出来，然后把报告作为渐进式待修复清单使用。

当前接入阶段：手动基线阶段。

## 检查内容

架构 harness 检查从架构契约中提炼出来的可执行架构规则：

- 架构契约：`docs/architecture/ARCHITECTURE.md`
- Harness 目录：`harness/architecture/`
- 规则配置：`harness/architecture/rules.json`
- 分析器：`harness/architecture/check.mjs`
- staged 同步守卫：`harness/architecture/check-doc-sync.mjs`

当前结果文件：

- 当前汇总报告：`harness/architecture/results/summary.json`
- `window.opencoveApi` 边界基线：`harness/architecture/results/window-opencove-api.jsonl`
- 层级依赖基线：`harness/architecture/results/layer-dependency.jsonl`

## 当前基线

已提交的基线报告由 `harness/architecture/README.md` 中记录的流程生成。

当前机器可读基线位于：

- `harness/architecture/results/summary.json`
- `harness/architecture/results/window-opencove-api.jsonl`
- `harness/architecture/results/layer-dependency.jsonl`

详细发现项按 rule 拆分保存，避免单个 JSONL 文件接近仓库行数上限。当前数量以 `summary.json` 为准。本文档有意不重复这些数字，避免重新生成结果后出现第二个事实来源。

## 结果含义

- `arch:check`：源码违反了 hard-error 级别的可执行架构规则。warning 级别待修复项由已提交的 audit baseline 表示。
- `arch:doc-sync`：架构文档、规则或结果基线不同步。
- `arch:results:check`：已提交 audit baseline 与当前分析器输出不同步。
- `arch:test`：harness 实现或 fixture 发生回归。

## 发现项分类

- `architecture.fileRuntimeCycle`：文件级 runtime import cycle。
- `architecture.layerDependency`：import 跨越了配置中的层级边界。
- `architecture.windowOpenCoveApiBoundary`：renderer 在 allowlist 边界 adapter 之外直接访问
  `window.opencoveApi`。
- `architecture.domainNoOuterRuntime`：`domain` 引入了外层 runtime 或平台细节。
- `architecture.applicationNoOuterRuntime`：`application` 引入了外层 runtime 细节。
- `architecture.rendererNoElectronRuntime`：renderer 侧代码直接引入 Electron 或 Node runtime 细节。
