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
- 文本编辑器使用 Monaco（VS Code 同款编辑器内核）。
- 已打开的 clean 文本文档在磁盘内容变化后应自动刷新；dirty 文档不得静默覆盖本地草稿，而应进入可解释的冲突状态。

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

## Terminal Navigation

终端文件链接与 Space Explorer 复用同一文档创建、复用和空间归属入口：

- 链接的 filesystem scope 来自产生输出的终端 `workerBinding`，不能由终端当前的视觉位置改写。
- 优先在绑定相同 mount 的所属 Space 打开；终端被移走后，仅在唯一匹配来源 mount 的 Space 中打开。没有匹配或存在歧义时返回不可用，不回退到本机同名路径。
- 无 mount 的本机终端可以在 workspace root 打开文件；文件复用同时检查 URI、Space 和 mount。
- 行列范围是每个 canvas 内的 transient navigation intent。Monaco ready 后应用、聚焦并消费；旧请求不能消费新请求，关闭文档或切换 workspace 后不得应用迟到请求。
- 链接跳转不能替换已有文档草稿，不能持久化 selection/cursor，也不能改变终端的启动目录或恢复意图。
- 目录链接可以把匹配 Space 的 Explorer 临时定位到该目录；关闭 Explorer 后清除临时位置。目前 workspace root 没有独立目录浏览窗口。

## UI Constraints

- 使用 `--cove-*` token。
- 编辑区域必须声明 `nodrag` / `nowheel`，避免干扰画布手势。
- 错误展示统一使用应用内反馈。

## Verification Anchors

- 从 Space Explorer 打开文件，修改后磁盘内容变化。
- Mount-aware Space 内打开和保存文件走 `*InMount`。
- 未批准路径或越界 mount root 被拒绝，且 UI 可解释。
