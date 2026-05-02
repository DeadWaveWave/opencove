# Space Explorer

Space Explorer 是吸附在 Space 边界上的文件浏览器。它用于在当前 Space 的 mount root 内浏览、创建和打开文件，并把文件物化为画布节点。

## Entry

- 在 Space 左上角点击 `Files` pill 打开或关闭 Explorer。
- Space 离开视口时 Explorer 自动关闭。
- `Esc` 关闭当前 Explorer。
- Git worktree 变更计数会以低噪音提示显示在入口上。

## Root And Scope

当前主路径以 `space.targetMountId` 解析根目录：

1. `WorkspaceSpaceExplorerOverlay` 接收 `targetMountId`。
2. 当没有显式 `directoryPath` root 时，通过 `mountTarget.resolve` 获取 mount root。
3. 文件操作使用 `mountAwareFilesystemApi`，在存在 mount id 时调用 `filesystem.*InMount`。
4. 展示和兼容路径仍可使用 `directoryPath`，但它不是 mount-aware 执行路径的唯一真相。

Explorer 只展示 root 内条目；越界路径不会进入文件树。

## File Tree Operations

- 点击文件夹：展开或折叠。
- 点击文件：创建或聚焦对应画布节点。
- 选中行用于确定创建/复制/移动等操作的目标目录。
- `New File`：创建空文件。
- `New Folder`：创建目录。
- `Refresh`：重新读取当前目录。

创建位置规则：

- 选中目录时，在该目录下创建。
- 选中文件时，在该文件所在目录创建。
- 无选中项时，在 Explorer root 下创建。

## Open Behavior

文本文件：

- 打开为 Document Node。
- 绑定文件 `uri` 与当前 mount context。
- 读取和保存走 mount-aware filesystem。

图片文件：

- 读取 bytes 后创建 Image Node。
- Image Node 用于查看和对照，不直接编辑原始图片文件。

音视频文件：

- 支持 `mp3`、`wav`、`wave`、`ogg`、`oga`、`mp4`、`webm`。
- 单击可在 Explorer 侧边预览；双击可创建媒体窗口。
- 解码能力取决于当前 Electron / Chromium runtime。

## Current Limits

- 没有文件系统 watcher；目录刷新依赖用户触发或调用方重新读取。
- 大文件和大媒体文件会经过 bytes 读取路径，应避免把 Explorer 当作批量传输工具。
- Remote media preview 受远端 Worker、网络延迟和浏览器解码能力限制；失败时应展示结构化错误或不可播放状态。

## Related Docs

- `FILESYSTEM.md`
- `DOCUMENT_NODE.md`
- `CURRENT_ARCHITECTURE.md`
