# CLI Canvas Node Control Spec

状态：Spec。本文定义通过 CLI 控制 OpenCove 画布窗口的目标架构与命令语义。

## 1. 问题类型

这属于成熟的 CLI 资源管理问题：外部自动化需要用稳定命令创建、查看、更新、删除和导航资源，但不能成为业务状态 owner。

外部参考：

- GitHub CLI formatting: <https://cli.github.com/manual/gh_help_formatting>
- kubectl quick reference: <https://kubernetes.io/docs/reference/kubectl/quick-reference/>

可迁移原则：

- Query 操作必须保持无副作用。
- Command 必须显式表达 scope 和副作用。
- 输出默认要结构化，便于机器消费。
- 资源身份与定位必须由 authoritative service 解析，不能由 CLI 侧启发式猜测。

OpenCove 本地约束：

- CLI 是 client，不是 owner。
- CLI 禁止直读写 DB、renderer store、localStorage 或运行时对象。
- 所有行为必须经过 Control Surface 与 application usecase。

## 2. 目标

- CLI 支持管理 Note、Task、Website、Agent、Terminal 画布窗口。
- 支持这些 node kind 的 create、list、get、delete。
- `node.update` 本阶段只覆盖 Note、Task、Website；Agent 与 Terminal 暂不支持通用 update。
- 支持按稳定 locator 在目标 Space 内创建 node：
  - space id
  - space name
  - worker + branch
  - worker + path
- 支持通过统一 canvas focus command 聚焦 node 或 Space。
- `create --focus` 只是 CLI 编排：先 create，再调用 `canvas.focus`。
- 保持 query 纯净：`node get` 和 `space get` 绝不能移动视口。

## 3. 非目标

- 不要求兼容旧的临时命令或旧 contract。
- 不允许 CLI 直接修改 DB。
- 不把 focus 行为塞进 `node.get`、`space.get` 或任何 query。
- 本 spec 不覆盖 Image、Document node CRUD。
- 本阶段不做 Agent、Terminal 的 `node.update`，也不做运行时细粒度操作，例如发送输入、resize、tail output、获取最近输出消息、获取 final message、resume 等；这些能力需要专门建模。
- 不用持久化 viewport 覆盖来假装 focus。

## 4. 资源模型

CLI 资源名使用 `node`，因为画布持久化模型中窗口以 node 形式存在。用户语义里的“窗口”映射为特定 kind 的 canvas node。

支持的 node kind：

- `note`
- `task`
- `website`
- `agent`
- `terminal`

Focus 不属于 `node` 或 `space` owner。Focus 是 canvas navigation 的行为，所以顶层命令组应为 `canvas focus`。

## 5. CLI 形状

Query：

```bash
opencove node list [space locator] [--pretty]
opencove node get --node <id> [--pretty]
```

Command：

```bash
opencove node create note [space locator] [--title <text>] [--text <text>] [--focus] [--pretty]
opencove node create task [space locator] --requirement <text> [--title <text>] [--priority <low|medium|high|urgent>] [--tag <tag>] [--focus] [--pretty]
opencove node create website [space locator] --url <url> [--title <text>] [--pinned] [--session-mode <shared|incognito|profile>] [--profile <id>] [--focus] [--pretty]
opencove node create agent [space locator] [--prompt <text>] [--provider <id>] [--model <id>] [--focus] [--pretty]
opencove node create terminal [space locator] [--shell <path>] [--command <text>] [--profile <id>] [--focus] [--pretty]
opencove node update note --node <id> [--title <text>] [--text <text>] [--frame <json>] [--pretty]
opencove node update task --node <id> [--title <text>] [--requirement <text>] [--priority <low|medium|high|urgent>] [--status <todo|doing|ai_done|done>] [--tag <tag>] [--frame <json>] [--pretty]
opencove node update website --node <id> [--title <text>] [--url <url>] [--pinned <true|false>] [--session-mode <shared|incognito|profile>] [--profile <id>] [--frame <json>] [--pretty]
opencove node delete --node <id> [--pretty]
opencove canvas focus node --node <id> [--pretty]
opencove canvas focus space [space locator] [--pretty]
```

`--focus` 是 create 命令的 CLI 便利参数，必须按以下顺序实现：

1. 调用 `node.create`。
2. create 成功后调用 `canvas.focus`。
3. 返回组合后的 JSON 结果。

focus 未投递成功不能回滚已经成功的 create。组合结果必须显式暴露 focus delivery 状态。

## 6. Space Locator

CLI 只负责把 locator flags 解析成 DTO，locator 的真正解析必须在 Control Surface / usecase 内完成。

Locator flags：

```bash
--space <spaceId>
--space-name <name>
--project <projectId>
--worker <endpointId-or-unique-display-name> --branch <branch>
--worker <endpointId-or-unique-display-name> --path <absolute-path>
```

解析规则：

- 同一次请求只能使用一种 locator mode。
- `--project` 可以用于收窄 `--space-name` 的歧义。
- locator 必须解析到唯一 Space。
- 无匹配返回 `space.not_found`。
- 多匹配不得自动选择，必须返回结构化 ambiguity 结果。
- CLI 禁止自行推断 cwd、branch、mount 或 worktree 归属。
- worker 匹配必须显式保守：display name 有歧义时必须失败。

Worker path 语义：

- `worker + path`：目标 Space 的目录或 mount scope 对输入 path 有最佳包含关系；若多个 Space 同为最佳匹配，按歧义失败。
- `worker + branch`：必须有可靠 branch/worktree 元数据。若元数据无法证明，失败而不是按名称猜测。

多候选处理：

- Space resolution 必须建模为三态：`resolved`、`not_found`、`ambiguous`。
- `ambiguous` 不产生任何 durable mutation，也不发送 focus intent。
- `ambiguous` 响应必须包含候选 Space 列表，便于 CLI 和脚本重试。
- 候选项至少包含 `spaceId`、`spaceName`、`projectId`、`worker`、`directoryPath`、`matchReason`；如果可靠可得，再包含 `branch`。
- CLI 默认只打印结构化错误，不进入交互选择。交互式选择如果未来需要，应作为显式 `--interactive` 功能另行设计。
- 用户应通过更强 locator 重试；最终兜底是 `--space <spaceId>`。
- `worker + path` 允许按“最长包含路径”收敛，但只有唯一最长匹配时才算 `resolved`；最长匹配并列时必须返回 `ambiguous`。
- `space-name` 匹配多个 Space 时，必须要求 `--project` 或 `--space` 收窄。

## 7. Control Surface

目标 operations：

```ts
node.list    // query
node.get     // query
node.create  // command
node.update  // command (note/task/website only in this phase)
node.delete  // command
canvas.focus // command
```

代表性 contract：

```ts
type SpaceLocator =
  | { kind: 'spaceId'; spaceId: string }
  | { kind: 'spaceName'; name: string; projectId?: string | null }
  | { kind: 'workerBranch'; worker: string; branch: string; projectId?: string | null }
  | { kind: 'workerPath'; worker: string; path: string; projectId?: string | null }

type CanvasFocusTarget =
  | { kind: 'node'; nodeId: string }
  | { kind: 'space'; locator: SpaceLocator }

interface CanvasFocusInput {
  target: CanvasFocusTarget
}
```

`node.create` 输入应把通用 placement 与 kind data 分离：

```ts
interface CreateNodeInput {
  kind: 'note' | 'task' | 'website' | 'agent' | 'terminal'
  space: SpaceLocator
  title?: string | null
  frame?: {
    x?: number | null
    y?: number | null
    width?: number | null
    height?: number | null
  } | null
  data: unknown
}
```

`node.get` 和 `node.list` 返回归一化 summary 与 kind-specific data。返回值禁止暴露 runtime handle、BrowserWindow 对象、PTY 对象或进程内引用。

## 8. Focus 语义

`canvas.focus` 是 UI navigation intent，不是持久化 workspace truth。

必要行为：

- 校验目标 node 或 Space 存在。
- 向目标 project 的活跃 canvas client 发布 focus intent。
- 不把 persisted viewport 当作 focus 的替代实现。
- 默认不为未来 client 排队 focus。用户稍后打开 UI 后突然跳转是意外行为，未来如需支持必须作为显式功能。
- 返回 delivery metadata：

```ts
interface CanvasFocusResult {
  projectId: string
  target: CanvasFocusTarget
  deliveredClientCount: number
  delivered: boolean
}
```

CLI create with `--focus` 返回：

```ts
interface CreateNodeCliResult {
  node: CreateNodeResult
  focus: CanvasFocusResult | null
  focusError?: AppErrorDescriptor | null
}
```

如果当前没有活跃 canvas client，`canvas.focus` 可以返回 `ok: true` 且 `delivered: false`。未来可以增加 CLI flag 把 delivery 失败提升为 hard failure，但这不属于基础语义。
如果 `create --focus` 的第二步 focus command 失败，CLI 仍返回 `ok: true`，`node` 保留创建结果，`focus` 为 `null`，并通过 `focusError` 暴露 focus 失败原因。

## 9. 状态所有权

| State | Owner | Write Entry | Restart Source |
| --- | --- | --- | --- |
| Workspace nodes | workspace application usecase | `node.create/update/delete` | persisted app state |
| Space membership | workspace application usecase | `node.create/delete`, explicit move operations | persisted app state |
| Agent session runtime | session / PTY runtime | session launch / kill usecase | runtime session registry plus persisted agent metadata |
| Terminal session runtime | terminal / PTY runtime | terminal spawn / kill usecase | runtime session registry plus persisted terminal metadata |
| Website runtime | website window runtime | website runtime manager | runtime only, restored from website node data when UI opens |
| Canvas focus intent | canvas navigation | `canvas.focus` | not durable by default |
| CLI flags | CLI parser | none; converted to DTO | none |

## 10. 不变量

1. Query 操作绝不修改状态，也不移动视口。
2. 一个 node 最多属于一个 Space。
3. mutation 结束后，每个 `space.nodeIds` 条目都必须引用存在的 node。
4. Node `kind` 必须与 kind-specific payload 匹配：
   - note 存 note data
   - task 存 task data
   - website 存 website data
   - agent 存 agent metadata 与 session id
   - terminal 存 terminal metadata 与 session id
5. Space locator 解析必须精确；歧义是错误，不允许静默 tie-break。
6. Focus 不能覆盖 durable viewport。
7. `create --focus` 是有序组合；focus 失败绝不回滚成功的 create。
8. Delete 必须清理 task-agent 关系与 runtime artifacts，并且 runtime cleanup 不能无限阻塞 durable node removal。
9. Agent 与 Terminal 的运行时交互不能通过 `node.update` 表达，必须进入专门的 session / terminal / agent command。

## 11. Node 语义

### Note

Create data：

- `title` 默认 `Note`。
- `text` 默认空字符串。

Update data：

- `title`
- `text`
- `frame`

### Task

Create data：

- `requirement` 必填。
- `title` 可选；缺省时使用确定性 fallback。异步 title enrichment 是 UI 增强，不能成为 CLI success 的前置条件。
- `priority` 默认 `medium`。
- `tags` 默认空数组。
- `status` 默认 `todo`。

Update data：

- `title`
- `requirement`
- `priority`
- `tags`
- `status`
- `frame`

### Website

Create data：

- `url` 必填，并且必须 normalize / validate。
- `title` 默认 URL 或标准 Website title。
- `pinned` 默认 false。
- `sessionMode` 默认 `shared`。
- `profileId` 默认 null，除非 `sessionMode` 明确需要 profile。

Update data：

- `title`
- `url`
- `pinned`
- `sessionMode`
- `profileId`
- `frame`

Runtime activation 不等同于 durable node creation。创建 website node 只记录 workspace state；活跃 UI client 可以在 sync 后激活 website runtime，但 Control Surface 不能返回 WebsiteWindow runtime handle。

### Terminal

Create data：

- `shell` 可选；缺省时使用 settings / platform 默认 terminal profile。
- `command` 可选；缺省时启动交互 shell。
- `profileId` 可选；缺省时使用 settings 中的 default terminal profile。
- execution directory 从目标 Space 与 mount 解析。
- session spawn 必须走现有 terminal / PTY owner，不能直接拼一个 terminal node。

Update data：

- 本阶段不支持 `node.update terminal`。

Terminal create 与 Agent create 一样横跨 durable node state 和 runtime session state。实现必须明确 failure boundary：

- session spawn 失败时，不持久化 terminal node。
- session spawn 成功但 node persistence 失败时，必须 best-effort kill session。
- create 成功但 focus 失败时，保留 node，并单独报告 focus delivery。

### Agent

Create data：

- `prompt` 默认空字符串。
- `provider` 默认来自 settings。
- `model` 默认来自 provider settings。
- execution directory 从目标 Space 与 mount 解析。
- session launch 必须走现有 session / PTY owner，不能直接拼一个 agent node。

Update data：

- 本阶段不支持 `node.update agent`。

Agent create 风险高于被动 node，因为它横跨 durable node state 和 runtime session state。实现必须明确 failure boundary：

- session launch 失败时，不持久化 agent node。
- session launch 成功但 node persistence 失败时，必须 best-effort kill session。
- create 成功但 focus 失败时，保留 node，并单独报告 focus delivery。

## 12. Agent / Terminal 后续运行时操作

Agent 与 Terminal 不适合用通用 `node.update` 表达运行时行为。它们需要更细的 command / query 边界，原因是：

- durable node metadata、runtime session、PTY stream、agent resume state 是不同 owner。
- 输出读取是 query，输入发送、resize、kill、resume 是 command。
- “最近一次输出消息”与“terminal scrollback / stream replay / agent final message”语义不同，不能用一个 `update` 或通用字段覆盖。
- 这些操作需要处理 session 是否仍然存活、远端 worker 是否可达、stream seq 是否过期、resume id 是否已验证等状态。

未来应单独设计的能力示例：

```bash
opencove terminal output --node <id> [--tail <lines>] [--pretty]
opencove terminal stream --node <id>
opencove terminal send --node <id> --text <text>
opencove terminal resize --node <id> --cols <n> --rows <n>
opencove terminal kill --node <id>

opencove agent last-message --node <id> [--pretty]
opencove agent final --node <id> [--pretty]
opencove agent resume --node <id>
opencove agent kill --node <id>
```

这些命令应复用 session / PTY / agent owner，并通过 Control Surface 暴露独立 contract；本 spec 只记录方向，本轮不实现。

## 13. Placement

Placement owner 是 workspace application logic，不是 CLI。

规则：

- 除非显式传入 frame，否则使用 settings 中标准窗口尺寸对应的 canonical node size。
- 如果目标 Space 有 rect，优先按现有 canvas layout policy 放入或邻近该 Space。
- 在可确定 free slot 时避免与已有 node 重叠。
- 显式 frame 低于最小尺寸时必须 clamp。
- 若无法找到可接受位置，返回 `common.invalid_input`，且不写入 partial state。

如果当前 placement utility 只能在 renderer 使用，应先抽取 shared pure layout logic，再实现 CLI node create。禁止在 Control Surface 复制第二套 placement policy。

## 14. Delete 语义

删除 node 时，必须移除 durable node，并从所有 Space 中移除该 node id。

额外 cleanup：

- Agent 或 Terminal runtime session：按 session id best-effort kill。
- Agent 绑定 Task：按现有 UI 语义追加或保留 session record，清空 `linkedAgentNodeId`，必要时把 `doing` 回退到 `todo`。
- Task 绑定 Agent：清空 Agent 的 task binding。
- Website node：best-effort close / deactivate 活跃 website runtime。

Runtime cleanup 不能无限阻塞 durable state removal。

## 15. 错误语义

错误必须使用稳定 `AppErrorDescriptor` code。

预期错误：

- invalid payload: `common.invalid_input`
- missing Space: `space.not_found`
- missing node: 增加 `node.not_found`，或选择一个等价 code 并在实现中统一记录
- unavailable worker/runtime/session: `worker.unavailable`、`session.not_found` 或 `common.unavailable`
- path outside approved scope: `common.approved_path_required`
- persistence failure: 使用现有 persistence codes

CLI 禁止依赖错误字符串分支。

## 16. 验证计划

最低有效验证层：

- Unit：
  - space locator normalize、三态 resolution 与 ambiguity candidate 输出
  - 各 kind 的 node factory
  - placement invariants
  - delete relation cleanup
  - Agent / Terminal update 被拒绝
- Contract：
  - `node.*` 与 `canvas.focus` 的 Control Surface validate
  - 结构化 error envelope
  - focus delivery result shape
- CLI：
  - args 解析到 DTO
  - `create --focus` 编排与 partial focus delivery output
- Integration：
  - create / update / delete 后的 persisted state
  - session cleanup 失败不阻塞 durable delete
  - Terminal / Agent create 的 session spawn / launch failure boundary
- E2E：
  - `canvas focus node` 能让活跃 canvas 移动到目标 node
  - `canvas focus space` 能让活跃 canvas 移动到目标 Space
  - 不带 `--focus` 的 create 不移动 viewport
  - 带 `--focus` 的 create 在有活跃 client 时聚焦新 node

最终实现必须执行 `DEVELOPMENT.md` 要求的项目检查。

## 17. 实现前门槛

编码前必须确认：

1. focus intent transport：复用现有 sync events、使用专门 canvas event channel，还是新增 Control Surface event stream。
2. Control Surface 如何关闭活跃 Website runtime，且不依赖 renderer-only state。
3. local 与 remote mounts 下 `worker + branch/path` 是否有可靠元数据。
4. 抽取或复用 shared node placement logic，避免重复 renderer placement 规则。
5. 是否新增 `node.not_found` error code。
6. Terminal create 是否复用现有 PTY spawn usecase，以及 session spawn 成功但 node persistence 失败时的 kill 补偿路径。
7. Agent / Terminal 的后续 runtime commands 是否归入 `agent.*`、`terminal.*` 还是统一 `session.*`，本轮先不实现。
