# 项目 Harness

`harness/` 存放项目治理检查。它们检查产品 runtime 之外的仓库健康度。Harness 按关注点分类，避免把未来工具混进 runtime 源码、公开文档或通用维护脚本里。

未来接入阶段和推广条件记录在 `ROADMAP.md`。

## 文档地图

- `README.md`：harness 根目录用途、分类列表和聚合命令。
- `registry.json`：根聚合命令读取的检查注册表。
- `ROADMAP.md`：未来阶段、推广条件和跨分类接入策略。
- `architecture/README.md`：`architecture/` 分类的操作手册。
- `../docs/architecture/ARCHITECTURE_HARNESS.md`：公开架构概览和结果解释。

## 分类

- `architecture/`：检查源码依赖、架构边界，以及实际代码相对架构文档的漂移。

新增分类时，把分类目录放在 `harness/<category>/` 下，并把需要纳入根聚合命令的检查项注册到
`registry.json`。

## 命令

```bash
pnpm harness:check
```

运行所有已注册的项目 harness 检查。当前手动基线阶段里，这只是手动入口，不接入 CI 或 pre-commit。

```bash
pnpm harness:list
```

列出已注册的 harness 检查。
