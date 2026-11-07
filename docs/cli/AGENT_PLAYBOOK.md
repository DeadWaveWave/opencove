# CLI Agent Playbook

使用独立 profile 做 smoke，不自动连接现有用户数据。连接与输出契约见 [CLI README](README.md)。

## 建立上下文

```sh
export OPENCOVE_USER_DATA_DIR="$PWD/.codex-out/tmp/cli-profile"
opencove worker status --all
opencove ping
opencove project list
opencove space list --project project-123
```

`worker status` exit 0 表示查询成功；还需检查返回 `status` 是否为 `running`。
没有 Worker 时，按任务授权启动 `opencove worker start --user-data "$OPENCOVE_USER_DATA_DIR"`；该命令前台运行。
远端连接显式传 `--endpoint <url> --token <token>`。`worker status/stop` 只管理本地 Worker。
出现歧义时指定 profile 或 endpoint，不猜测连接目标。

成功 stdout 直接是 value JSON，不读取 `.ok` 或 `.value`。失败检查 exit code，并解析 stderr 的 `error`。
自动化需要强制 JSON 错误时传 `-o json`。`--help` 不连接 Worker。

## 读取目标

```sh
opencove space get --space space-123
opencove worktree list --project project-123
opencove node list --space space-123
opencove mount resolve --mount mount-123
opencove fs ls --mount mount-123 --uri file:///workspace
```

用实际查询结果替换示例 ID 和 URI。Space locator 支持 `--space`、`--space-name`，或 `--worker` 配合 `--branch`/`--path`；可用 `--project` 收窄。

## 最小 CRUD 验证

```sh
opencove node create note --space space-123 --title cli-smoke-note --text-file ./notes.txt
opencove node update note --node node-123 --text 'updated'
opencove node get --node node-123
opencove canvas focus node --node node-123
opencove node delete --node node-123
```

记录创建结果中的真实 `node.id`，只修改本次创建的节点，结束时逆序清理。
Focus 的 `delivered: false` 表示没有客户端接收，不等于节点操作失败。
长文本可用文件或 stdin（例如 `--content-file -`）；不要同时传 inline/file 两种形式。
默认不创建真实 agent 会话，除非任务明确授权其 provider、model 与目录。

## 生命周期与汇报

`pty attach --session <id>` 把原始终端输出写 stdout；Ctrl-C 只 detach，exit 130。
停止本次启动的 Worker，清理临时节点和目录。不要停止其他任务拥有的 Worker。
汇报执行命令、成功/失败结果、未运行范围和清理状态；静态测试通过不能代替真实 Worker 验收。
