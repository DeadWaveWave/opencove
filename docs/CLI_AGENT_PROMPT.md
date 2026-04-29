# CLI Agent Prompt

把下面这段直接发给 Agent 即可：

```md
请使用 OpenCove CLI 做一次本地 CLI 验证，只讲执行，不做额外设计延伸。

要求：
1. 先设置：
   `OPENCOVE_USER_DATA_DIR="$HOME/Library/Application Support/opencove-dev"`
2. 如果 worker / control surface 不可用，先按需执行：
   - `pnpm build`
   - `pnpm dev`
   - 或 `pnpm opencove worker start --user-data "$HOME/Library/Application Support/opencove-dev"`
3. 先做最小连通性检查：
   - `pnpm opencove worker status`
   - `pnpm opencove ping --pretty`
   - `pnpm opencove project list --pretty`
   - `pnpm opencove space list --pretty`
   - `pnpm opencove node list --pretty`
4. 读取真实上下文，拿到：
   - `projectId`
   - `spaceId`
   - `spaceName`
   - `space.directoryPath`
   - local worktree 的 `branch`
5. 至少验证三种 space locator：
   - `--space-name <spaceName>`
   - `--worker local --branch <branch> --project <projectId>`
   - `--worker local --path <absoluteSpacePath>`
6. 用临时节点做 CRUD smoke，并在结束时清理：
   - note: create -> update -> get -> delete
   - task: create -> update -> get -> delete
   - website: create -> update -> get -> delete
   - terminal: create -> get -> delete
7. 验证：
   - `pnpm opencove canvas focus node --node <nodeId> --pretty`
   - `pnpm opencove canvas focus space --space <spaceId> --pretty`
8. 默认不要做 live `node create agent`，只验证已有 agent 节点的 `node list` / `node get`
9. 所有临时节点统一使用 `cli-smoke-*` 命名
10. 记录所有新建节点 ID，并在流程末尾按逆序删除
11. 如果当前是 remote worker 场景，不要猜测本地连接文件，改用：
    - `--endpoint <host:port>`
    - `--token <token>`

执行约束：
- 不要修改不属于验证目标的现有节点
- 不要保留临时节点
- 不要默认启动真实外部 agent provider
- `focus.delivered === false` 不算失败；没有 renderer client 时这是正常现象

最终汇报格式：
1. 跑了哪些命令
2. 哪些成功
3. 哪些失败
4. 失败属于环境问题、连接问题还是业务问题
5. 是否已经清理所有临时节点
```

更完整的说明见 `docs/CLI_AGENT_PLAYBOOK.md`。
