# Document Node

Document Node 是画布内打开和编辑文件的节点形态。它把“读写文件”建模为一等画布能力，同时保持文件内容真相在 filesystem。

## Durable Truth

Document Node 持久化的是：

- 文件 `uri`
- 节点标题和窗口 frame
- 必要的显示偏好
- 当前 mount context（由所属 Space 的 `targetMountId` 提供）

不应持久化为文件内容真相的状态：

- 当前 selection / cursor
- hover / focus
- 临时错误提示
- renderer-local media object URL

## Read And Save

打开文本文件：

- 无 mount context 时调用 `filesystem.readFileText`。
- 有 mount context 时调用 `filesystem.readFileTextInMount`。
- 文件疑似二进制或过大时显示不可编辑状态。

保存文本文件：

- 无 mount context 时调用 `filesystem.writeFileText`。
- 有 mount context 时调用 `filesystem.writeFileTextInMount`。
- 文本变更会 debounce 自动保存；`Save` 按钮和 `Cmd/Ctrl+S` 仍可显式保存。
- 保存失败时保留 dirty 状态并显示应用内错误，不使用系统弹窗。

## Media Preview

Space Explorer 打开的音视频文件也使用 Document Node 风格窗口承载：

- Durable truth 仍是原始文件 `uri`。
- bytes 读取走 `filesystem.readFileBytes` 或 `filesystem.readFileBytesInMount`。
- Renderer 使用原生 `audio` / `video` 控件播放。
- 支持范围：`mp3`、`wav`、`wave`、`ogg`、`oga`、`mp4`、`webm`。

如果扩展名在支持范围内但 runtime 无法解码实际编码，UI 显示不可播放状态，而不是回退成文本编辑。

## Space Explorer Integration

Space Explorer 是 Document Node 的主要入口：

- 点击文本文件创建或聚焦 Document Node。
- 点击媒体文件显示预览或创建媒体窗口。
- 节点读写必须保持在触发它的 mount scope 内。

## UI Constraints

- 使用 `--cove-*` token。
- 编辑区域必须声明 `nodrag` / `nowheel`，避免干扰画布手势。
- 错误展示统一使用应用内反馈。

## Verification Anchors

- 从 Space Explorer 打开文件，修改后磁盘内容变化。
- Mount-aware Space 内打开和保存文件走 `*InMount`。
- 未批准路径或越界 mount root 被拒绝，且 UI 可解释。
