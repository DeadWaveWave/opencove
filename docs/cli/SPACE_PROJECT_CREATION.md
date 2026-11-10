# Create Spaces and add projects

Use `space create` to organize work without building API JSON. Space selectors accept
an exact ID, a case-sensitive name, a unique ID prefix of at least six characters,
or `@self`. Node selectors in `--move` use the same forms.

```sh
opencove space create --name "Review"
opencove space create --name "Migration" --project project-123 --directory /workspace/migration
opencove space create --name "Review notes" --in @self --move "Brief" --move "Checklist"
opencove project add --path /workspace/app --name "App"
```

A top-level Space uses your terminal node’s **current project**, including when the
terminal is on the root canvas. Outside an OpenCove terminal, provide `--project`.
The Worker chooses an empty position and returns the applied `rect`. There is no
`--frame` for top-level creation. `--directory` is passed unchanged to the Worker:
it must be an existing absolute local directory within the project’s default mount.
Symlinks cannot escape that mount. Omit it to use the mount root; remote default
mounts are currently unsupported.

With `--in`, creation uses the selected parent Space. `--project` optionally narrows
the parent lookup. Children inherit their parent’s directory, so `--directory`
cannot accompany `--in`. Repeat `--move` to move direct members of the parent into
the child. Duplicate node selections are moved once. Root-canvas nodes cannot be
moved into a new top-level Space with this command; `--move` requires `--in`.

For a child, `--frame '{"x":100,"y":100,"width":600,"height":400}'` requests a full
canvas boundary. Without a frame, the Worker encloses the moved nodes with padding,
or uses a 420×300 boundary centered in the parent when no nodes are moved. It fits
the boundary inside the parent. An adjusted explicit frame produces one stderr
notice; stdout always contains the applied rect.

`space create` returns `{id, name, projectId, parentSpaceId, rect, directoryPath,
movedNodeIds}`. Top-level results have `parentSpaceId: null` and `movedNodeIds: []`.
`project add` returns `{id, name, path, defaultSpace}`; `defaultSpace` is
`{id, name, directoryPath, rect}`, or null if absent. An existing project at the
same path is reused with its saved name and default Space. Both commands support
`--pretty` and `--fields`; neither supports table output. Failed commands leave
stdout empty and are never automatically retried. If an older Worker reports
success without details, the CLI asks you to inspect the existing result rather
than repeat the creation command.

**Agents cannot add projects.** A terminal session grant receives exit 4 with a
human-decision error. Ask the user to add the project in OpenCove. This refusal is
final; do not retry with another credential.

## 创建 Space 与添加项目

使用 `space create` 整理工作，无需手写 API JSON。`--in` 接受完整 ID、区分大小写的
名称、至少六个字符的唯一 ID 前缀或 `@self`；`--move` 的节点选择器也支持这些形式。

顶层 Space 默认使用终端节点**当前所属的项目**，终端位于 root canvas 时也适用。
在 OpenCove 终端外调用时，请提供 `--project`。位置由 Worker 自动安排，结果包含实际
`rect`，顶层创建不接受 `--frame`。`--directory` 原样传给 Worker，必须是项目默认
mount 内已存在的本地绝对目录，符号链接也不能越界；省略时使用 mount 根目录。
目前不支持远程默认 mount。

指定 `--in` 可在父 Space 内创建子 Space，`--project` 可缩小父 Space 的查找范围。
子 Space 继承父目录，不能同时指定 `--directory`。重复使用 `--move` 可移入多个父
Space 的直属节点，相同节点只移动一次。目前不能将 root-canvas 节点移入新建顶层
Space，因此 `--move` 必须与 `--in` 配合使用。

子 Space 的 `--frame` 接受完整的 `{x,y,width,height}` JSON 对象。不指定时，边界
优先包围所选节点并留出间距；没有所选节点时，在父 Space 中心使用 420×300 的边界。
Worker 会将边界限制在父 Space 内；若显式 frame 被调整，stderr 会提示实际 rect。
stdout 中的 rect 始终是实际采用的值。

`space create` 返回 `{id,name,projectId,parentSpaceId,rect,directoryPath,movedNodeIds}`；
顶层 Space 的 `parentSpaceId` 为 null，`movedNodeIds` 为空数组。`project add` 返回
`{id,name,path,defaultSpace}`，默认 Space 包含 `{id,name,directoryPath,rect}`，没有时为
null。相同路径的已有项目会复用其保存的名称和默认 Space。两个命令均支持 `--pretty`
和 `--fields`，不支持表格输出；失败时 stdout 为空，不自动重试。旧版 Worker 若仅返回
成功而缺少详情，CLI 会引导查询已有结果，避免重复创建。

**智能体不能添加项目。** 终端 session grant 会收到退出码 4，提示此操作需要用户在
OpenCove 中决定。请用户在 OpenCove 添加项目，不要重试或借用其他凭证。

## Rename and arrange Spaces

```sh
opencove space update --space @self --name "Review"
opencove space update --space "Review" --frame '{"width":1200,"height":800}'
opencove space update --space space-123 --frame '{"x":100,"y":200}'
```

Select a Space explicitly with `--space`; the same selectors as `space get` apply.
Supply `--name`, `--frame`, or both. Names follow `space create`: surrounding
whitespace is removed and blank names are rejected. A frame accepts any nonempty
subset of x, y, width and height; values must be finite and dimensions positive.
Changing x/y translates every node and child Space in the subtree once, preserving
node sizes. Changing dimensions resizes only the boundary. Combined requests first
move the contents, then fit the boundary around them.

The boundary expands to keep 24 canvas units around direct nodes and 12 around
child Spaces. Ancestors grow as needed, including when a child moves beyond its
previous parent boundary. Other nodes keep their positions; this command does not
apply canvas snapping or move neighboring Spaces out of the way. An empty Space
can use any positive dimensions. A Space without a saved boundary can be renamed;
open it in OpenCove before changing its frame.

Output is `{id, name, projectId, parentSpaceId, rect, directoryPath, movedNodeIds}`.
Frame updates also return `appliedFrame` and `frameAdjusted`; the latter compares
only the components you requested. An adjustment prints one notice to stderr.
`movedNodeIds` lists nodes whose coordinates changed, including descendants, or
is empty for rename/resize alone. Use `--fields` or `--pretty`; table output is
unavailable. The update saves the name, boundaries and positions together. On a
conflict, inspect the Space again before deciding whether to repeat the update.
Session grants may rename and arrange Spaces. Directory and worktree bindings,
parentage and membership remain unchanged; use `worktree` commands for bindings.

## 重命名与调整 Space

使用 `space update --space <选择器>` 编辑已有 Space，至少提供 `--name` 或 `--frame`
之一，也可同时提供。选择器与 `space get` 相同。名称规则与 `space create` 一致：
去除首尾空白，不接受空名称。`--frame` 接受 x、y、width、height 的非空子集，数值
必须有限，宽高必须为正数。

改变 x/y 会整体平移所有直属节点、子 Space 及其节点；改变宽高只调整边界，不缩放
内容。同时指定位置和尺寸时，先移动内容，再扩张边界以容纳内容。直属节点周围保留
24 个画布单位，子 Space 周围保留 12 个；祖先 Space 按需扩张，包括子 Space 移出
父边界的情况。其他节点位置保持不变，命令不执行磁吸或避让。空 Space 接受任意正数
尺寸。没有已保存边界的 Space 可以改名；调整其边界前，请先在 OpenCove 中打开它。

返回 `{id,name,projectId,parentSpaceId,rect,directoryPath,movedNodeIds}`；修改 frame
时另含 `appliedFrame` 和 `frameAdjusted`，后者只比较显式请求的分量。发生调整时，
stderr 显示一次提示。`movedNodeIds` 包含坐标实际改变的所有节点（包括后代节点）；
仅改名或改尺寸时为空。支持 `--fields` 和 `--pretty`，不支持表格输出。

名称、边界和坐标一次保存；如遇并发冲突，请重新查询 Space 后再决定是否更新。
智能体终端可以改名和调整布局；目录、worktree 绑定、父子关系和成员归属保持不变。
需要修改 worktree 绑定时，请使用 `worktree` 命令。
