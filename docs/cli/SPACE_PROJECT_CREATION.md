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
