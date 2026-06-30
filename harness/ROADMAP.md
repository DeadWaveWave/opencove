# 项目 Harness 规划

本文档记录未来 harness 工作，这些内容当前还不是默认产品测试或 CI 的一部分。它放在 `harness/` 下，因为这里记录的是治理工具规划、接入顺序和推广条件，而不是当前产品 runtime 行为。

## 范围

Harness 是仓库治理检查。它们检查项目是否仍然遵守已约定的工程契约，但必须和 unit、integration、E2E 这类产品功能测试分开。

当前分类：

- `architecture/`：源码依赖、层级边界和架构漂移检查。

未来分类可以放在 `harness/<category>/` 下，并在具备明确 owner、命令、结果格式和接入阶段后注册到 `harness/registry.json`。

## 阶段模型

### 1. 手动基线

目标：暴露现有漂移，但不阻塞日常开发。

规则：

- Harness 检查由人工手动运行。
- 检查结果可以作为基线证据提交。
- 发现项作为修复待办，不作为立即阻塞 CI 的失败。
- Harness 命令不得调用完整 E2E、`pnpm test:e2e`、`pnpm test:e2e:pre-commit` 或
  `pnpm pre-commit`。

当前 `architecture/` 分类状态：

- `architecture/` 分类处于手动基线阶段。
- 分类命令和结果再生成流程记录在 `architecture/README.md`。
- 当前详细基线已按 rule 拆分到多个 JSONL 文件，避免单个结果文件接近仓库行数上限。
- 在已注册分类达到干净基线或已接受基线之前，根聚合命令保持手动入口。

### 2. 渐进式修复

目标：通过独立、可 review 的分支修复发现项，同时避免隐藏新的漂移。

规则：

- 使用 baseline 报告选择窄范围修复切片。
- 每次只修复一个规则族、context 或边界区域。
- 每次修复后重新生成相关 harness 结果。
- 只有修复区域已确认通过后，才收紧对应规则严重级别。
- 临时例外必须在分类配置中显式记录，并说明架构理由。

架构示例：

- 把 renderer 中直接访问 `window.opencoveApi` 的代码收回到批准的边界 adapter 后面。
- 移除违反 `domain -> application -> infrastructure/presentation` 依赖方向的跨层 import。
- 当已修复的 warning 组归零后，把对应规则收紧为 hard error。

### 3. 干净基线

目标：把 harness 结果从 drift 记录转成“没有已知漂移”的证明。

推广条件：

- 分类汇总报告为 `0` hard errors 和 `0` warnings，或所有剩余 warning 都是已记录的 accepted exception。
- 分类测试覆盖可执行规则行为。
- 分类的一键检查命令确定、快速。
- 根命令 `pnpm harness:check` 可以运行所有已注册分类，并且不调用产品 E2E。

### 4. CI 推广

目标：把已清理的 harness 分类变成回归门禁。

规则：

- 把 harness 检查作为小型、独立的 CI 任务添加。
- Harness CI 必须和产品测试任务分开。
- Harness CI 不得运行完整 E2E。
- 如果某个分类需要生成结果，CI 应验证结果与分析器输出一致。
- Harness 检查失败应表示仓库契约发生漂移，而不是产品行为测试失败。

架构分类推广后的候选命令：

```bash
pnpm arch:check
pnpm arch:results:check
pnpm arch:test
```

`pnpm arch:doc-sync` 当前是 staged 本地守卫。`pnpm arch:results:check` 是不依赖 staged index 的结果验证模式，可作为未来 CI 推广时的候选命令。

所有已注册分类清理完成后的推荐根命令：

```bash
pnpm harness:check
```

### 5. 本地提交门禁

目标：只在相关待修复清单清理完成后，在 review 前捕获契约漂移。

规则：

- 只添加短命令。
- 本地提交门禁必须和完整 E2E、产品 pre-commit 检查分开。
- 如果某个分类仍把 warning 当作待修复清单记录，不得为该分类启用本阶段。

## 架构分类待办

当前 `architecture/` 分类应按以下顺序演进：

1. 保留已提交 baseline 作为当前 drift 记录。
2. 用窄分支修复高频 warning 组。
3. 如果未来分类需要更细的 ownership tracking，在对应分类内继续扩展结果文件命名或 manifest。
4. 把已修复的 warning 规则收紧成 hard error。
5. 在待修复清单清理完成或被明确接受后，把 architecture 检查推广到独立 CI 任务。
6. CI 推广稳定后，再添加本地提交门禁。

## 未来 Harness 分类

潜在的未来分类应遵循同一阶段模型：

- 架构之外的文档契约同步。
- 依赖或 package 边界检查。
- 对通用脚本来说过于项目特定的仓库维护检查。
- 检查源码结构、而不是产品行为的安全或 runtime 边界检查。

每个新分类应包含：

- `README.md`，说明范围、当前阶段、命令和结果解释。
- 一个专用检查命令。
- 需要纳入根聚合命令时，在 `harness/registry.json` 中注册检查项。
- 当逻辑非平凡时，为 harness 实现提供聚焦测试。
- 只有在分类需要持久化 baseline 或 review evidence 时，才提供机器可读结果。
- 在接入 CI 或提交门禁前，明确推广条件。
