# CLI Agent Prompt

```text
按 docs/cli/AGENT_PLAYBOOK.md 验证 CLI：
1. 使用任务指定的独立 profile；未指定时使用工作树 .codex-out/tmp/cli-profile。
2. 先运行 worker status、ping、project list、space list，检查真实状态和目标 ID。
3. 只在明确授权时启动 Worker 或外部 agent provider。
4. 用本次创建的临时节点做 create/update/get/delete；记录 ID，结束时清理。
5. 成功 stdout 直接解析为 value JSON；失败检查非零 exit code 和 stderr.error。
6. 使用 --help 查询选项；长文本用 --text-file、--content-file、--prompt-file 或 --params-file，- 表示 stdin。
7. 远端显式使用 --endpoint/--token；不要推断或修改未知 profile。
8. focus.delivered 为 false 不算业务失败。PTY stdout 是原始终端流，Ctrl-C detach 返回 130。
9. 汇报实际命令、结果、NOT RUN 和进程/节点清理状态，不把未运行测试写成通过。
```
