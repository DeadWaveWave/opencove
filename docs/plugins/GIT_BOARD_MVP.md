# Git Board 插件 MVP

> 实现状态：当前版本已提供内置 Git Board、共用画布窗口、设置中的插件列表与启用/停用、
> CLI 指南。下文的 GitHub 安装、独立插件进程、源码更新和回退是后续目标，尚未实现。
> 当前行为与窗口接入契约见 [README](./README.md)。

本文档定义首个可运行的 Git Board 插件示例，以及插件源码优先（source-first）的最小运行闭环。它是实现边界，不是任意 Node 代码的安全沙盒说明。插件进程拥有用户明确授予的 Node 权限；宿主仍负责生命周期、路由、持久化和恢复。

## 首期目标

Git Board 是一个可从 GitHub 发现并安装的插件，能够：

- 在一个指定的本地 Mac 或远程 Linux Worker 上安装；
- 在 Space 中创建一个插件节点，并在 Desktop 和 Web UI 中显示同一节点；
- 通过固定的插件 facade 注册一个命令、一个节点视图，以及可选的 CLI/skill 资料；
- 从源码仓库创建用户可修改的分支，构建候选版本，手动应用并在失败时回退；
- 被禁用后保留节点位置和数据，显示占位视图，重新启用后恢复。

首期只支持一个 GitHub 仓库、固定 commit/tag、pnpm lockfile、Node/TypeScript 后台入口和浏览器 UI bundle。暂不支持自动 fork/PR、submodule/LFS、任意构建系统、自动冲突解决、热替换运行中的实例或虚拟文件系统 provider。

## 运行与执行位置

安装目标是 Worker，不是当前浏览器。Space 的 `targetMountId` 决定插件的执行 Worker 和工作目录；`parentSpaceId` 只表示画布层级。Mac Desktop 连接 Linux Worker 时，后台插件必须使用 Linux/arch/Node ABI 匹配的产物，不能因为 UI 在 Mac 上就切到本机运行。

插件节点由宿主拥有窗口外壳、拖动、resize、折叠、选择、位置持久化和缺失插件占位。插件只拥有节点内容和自己的 JSON state。停用或版本不兼容时，宿主不得把节点转换成终端或删除 state。

Control Surface 在 Worker 启动时只注册固定的 `plugins.*` facade，例如 `plugins.list`、`plugins.install`、`plugins.invoke`、`plugins.getContributions`。插件命令和贡献在 PluginRegistry/PluginHost 内动态管理；不要在 HTTP listener 已启动后向核心 Control Surface 热插入任意 handler。

## 源码优先生命周期

每个插件目标宿主维护四类目录：

```text
plugins/sources/<plugin-id>/       # 用户可修改的 Git checkout
plugins/candidates/<operation-id>/ # 更新和构建用的独立 worktree
plugins/artifacts/<digest>/        # 不可变、可运行的产物
plugins/state/<plugin-id>/<scope>/ # 插件数据、配置和迁移记录
```

1. **发现和安装**：读取 manifest，克隆仓库并把 tag/branch 解析成 commit SHA。记录 repository ID、来源 URL、上游分支、commit、lockfile digest、目标 OS/arch/Node ABI。安装脚本和 build 脚本属于可信 Node 代码执行。
2. **本地改造**：从固定 commit 建 customization 分支。用户和 Agent 只在 source checkout 或 candidate worktree 中提交修改；不自动 stash、reset、force-push 或覆盖未提交文件。
3. **上游更新**：fetch 后在 candidate 分支中 merge 新的上游 commit，保留用户历史。冲突 candidate 保留在原处并显示冲突文件；当前 active 版本继续运行。
4. **构建候选**：候选记录创建时的 customization HEAD。按仓库声明的 pnpm 版本和 frozen lockfile 安装依赖，运行约定的 build/check。若 HEAD 在构建期间继续变化，候选过期，必须重新合并构建。
5. **发布产物**：成功构建后复制后台入口、Web bundle、依赖和 build descriptor 到新的 digest 目录。运行时绑定该目录，不直接读取可编辑 checkout 或其 `node_modules`。commit 相同不代表跨平台产物相同。
6. **激活和回退**：PluginHost 为目标插件排空调用、停止旧实例并清理贡献；候选通过 ready 握手后才成为 active。激活失败时恢复上一兼容 artifact；源码分支和插件数据不因回退而 reset。插件升级不得重启 Worker、PTY 或其他插件。

应用更新只自动更新官方 base。用户定制版本使用独立 package ID，记录 `derivedFrom` 和 `baseCommit`；“合并官方更新”始终在 candidate worktree 中完成。官方副本不可被用户直接覆盖，个人派生也不能冒充官方身份。

## API 与贡献边界

首期公开的 API 只有固定 facade 和明确贡献点：command、context-menu/action、plugin node view、namespaced storage、Space/mount 查询、受控 filesystem/terminal 调用、CLI/skill 资料。节点和命令 ID 使用插件命名空间。正式 API、PluginHost 通信协议和插件数据 schema 分开版本化；开发分支可以有 breaking change，但仍必须声明 API 版本并拒绝不匹配的插件。

`opencove plugin guide` 是离线、版本匹配的 CLI 资料入口，说明 manifest、贡献注册、生命周期清理、Space/mount 路由和验证命令。它应在 CLI 连接 Worker 前处理，使 Agent 在无 Web UI 时也能读取同一份指南；远端 Worker 执行时使用远端对应版本。

可选 skill 只是版本化资料贡献，不隐式修改全局 Agent 配置。Git Board 的示例角色可以要求 Agent 优先运行 `opencove plugin guide`，但角色提示词不能绕过插件 facade 或自行假设客户端 OS。

## 状态 owner 与不变量

| 状态 | 唯一 owner | 持久化来源 |
| --- | --- | --- |
| 安装版本、启用意图、来源和更新记录 | PluginInstallation owner | 插件操作 journal |
| 进程、generation、调用和订阅清理 | PluginHost | active/previous artifact 记录 |
| 节点位置、尺寸、折叠、Space 归属 | Workspace/SQLite | 现有 workspace state |
| mount/endpoint 路由 | topology owner | topology registry |
| 插件私有配置和数据 | Plugin storage owner | `plugins/state/<plugin-id>/<scope>` |
| UI hover、拖拽和展开状态 | Renderer | 派生状态 |

必须满足：

1. **Active 固定**：一个活跃 generation 绑定确定的 artifact digest、API 版本和目标 Worker；源码 fetch、冲突、构建失败都不能改变当前运行版本。
2. **源码不丢失**：所有更新在独立 candidate 中完成；自动流程不得覆盖用户提交、隐式 stash、force reset 或删除仍有用户修改的 checkout。
3. **数据不降级**：插件数据独立于源码和 artifact；旧代码不能写入更高 schema，也不能用旧快照覆盖已经接受的新写入。恢复前必须通过 API/schema 兼容检查。
4. **路由不漂移**：插件的 filesystem、terminal 和 Agent 操作始终按 Space 的 `targetMountId` 路由；远端失败不能静默回退到本机。
5. **缺失可恢复**：插件禁用、崩溃或不兼容只影响其节点和贡献；应用、Workspace、PTY 及其他插件仍可启动，节点 state 保留并提供重新启用或恢复官方实现。

## 最小验证链

验证应覆盖：GitHub pinned commit 安装 → source customization commit → candidate 上游 merge/冲突保留 → frozen lockfile build → target Worker activation → Desktop/Web 显示同一节点 → disable 占位 → re-enable 恢复 → activation failure 回退。每一步记录 operation ID、source commit、artifact digest、target mount、API/schema 版本，避免只凭 UI 状态判断成功。

现有 Worker 运行产物、generation、原子发布和回退原则可参照 [`docs/runtime/MANAGED_SSH_RUNTIME.md`](../runtime/MANAGED_SSH_RUNTIME.md)；插件实现不应复制一套 Worker/PTY 生命周期 owner。
